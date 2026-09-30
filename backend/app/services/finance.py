# @author: Wendy Yang
# @date: 2026-09-19

"""
Finance service layer: AR / AP / Cash Management / General Ledger integration.

Implements the core event-driven accounting logic for the O2C (Order-to-Cash)
and P2P (Procure-to-Pay) cycles:

  - Sales Order Approved  -> auto-create AR Invoice
  - Purchase Order Approved -> auto-create AP Bill
  - Receive Payment (AR)  -> mark invoice Paid, create Cash Transaction
                             (Check Deposit), post Journal Entry
                             (Debit: Cash, Credit: Accounts Receivable)
  - Make Payment (AP)     -> mark bill Paid, create Cash Transaction
                             (Check Issue), post Journal Entry
                             (Debit: Accounts Payable, Credit: Cash)

All multi-step operations are wrapped so that they either fully succeed or
roll back entirely (the caller's db.commit() finalizes the transaction; on
any error an HTTPException is raised before commit, and FastAPI/SQLAlchemy
session handling will not persist partial changes since nothing was
committed yet).
"""

import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import Date, and_, cast, func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    APBill,
    ARInvoice,
    BankAccount,
    BankTransfer,
    CashTransaction,
    ChartOfAccount,
    Customer,
    Item,
    JournalEntry,
    LedgerPosting,
    PurchaseOrder,
    SalesInvoice,
    SalesOrder,
    Supplier,
    SupplierInvoice,
    SupplierInvoiceDistribution,
)
from app.services.document_sequences import DOC_JOURNAL, generate_document_number
from app.services.financial_reports import signed_balance
from app.services.payment_terms import due_days_for, due_days_from_string
from app.services.journal_source import (
    SOURCE_AP_PAYMENT,
    SOURCE_AR_PAYMENT,
    SOURCE_BANK_TRANSFER,
    SOURCE_SALES_CREDIT,
    generated_journal_fields,
    rule_id,
)
from app.services.posting_rules import (
    EVENT_AP_PAYMENT,
    EVENT_AR_PAYMENT,
    EVENT_BANK_TRANSFER,
    EVENT_GOODS_RECEIPT,
    EVENT_SALES_CREDIT,
    EVENT_SALES_INVOICE,
    EVENT_SUPPLIER_INVOICE,
    PARTY_ANY,
    PARTY_RELATED,
    PARTY_TRADE,
    VARIANT_CREDIT_MEMO,
    VARIANT_EXPENSE,
    VARIANT_GRNI_CLEAR,
    VARIANT_MATERIALS,
    VARIANT_PPV_UNFAVORABLE,
    VARIANT_REVENUE,
    VARIANT_SETTLE,
    VARIANT_SUBCONTRACT,
    VARIANT_TAX,
    VARIANT_TRANSFER,
    catalog_account,
    receipt_variant,
    resolve_posting_pair,
    resolve_posting_rule,
)

# Catalog fallbacks — live posting uses posting_rules rows when present.
CASH_ACCOUNT_CODE, CASH_ACCOUNT_NAME, _ = catalog_account(
    EVENT_AR_PAYMENT, VARIANT_SETTLE, PARTY_ANY, "debit"
)
AR_ACCOUNT_CODE, AR_ACCOUNT_NAME, _ = catalog_account(
    EVENT_SALES_INVOICE, VARIANT_REVENUE, PARTY_ANY, "debit"
)
AP_ACCOUNT_CODE, AP_ACCOUNT_NAME, _ = catalog_account(
    EVENT_SUPPLIER_INVOICE, VARIANT_GRNI_CLEAR, PARTY_TRADE, "credit"
)
RELATED_AP_ACCOUNT_CODE, RELATED_AP_ACCOUNT_NAME, _ = catalog_account(
    EVENT_SUPPLIER_INVOICE, VARIANT_GRNI_CLEAR, PARTY_RELATED, "credit"
)
REVENUE_ACCOUNT_CODE, REVENUE_ACCOUNT_NAME, _ = catalog_account(
    EVENT_SALES_INVOICE, VARIANT_REVENUE, PARTY_ANY, "credit"
)
INVENTORY_ACCOUNT_CODE, INVENTORY_ACCOUNT_NAME, _ = catalog_account(
    EVENT_GOODS_RECEIPT, VARIANT_MATERIALS, PARTY_TRADE, "debit"
)
PROCESSING_FEES_ACCOUNT_CODE, PROCESSING_FEES_ACCOUNT_NAME, _ = catalog_account(
    EVENT_GOODS_RECEIPT, VARIANT_SUBCONTRACT, PARTY_TRADE, "debit"
)
PURCHASE_EXPENSE_ACCOUNT_CODE, PURCHASE_EXPENSE_ACCOUNT_NAME, _ = catalog_account(
    EVENT_GOODS_RECEIPT, VARIANT_EXPENSE, PARTY_TRADE, "debit"
)
GRNI_ACCOUNT_CODE, GRNI_ACCOUNT_NAME, _ = catalog_account(
    EVENT_GOODS_RECEIPT, VARIANT_MATERIALS, PARTY_TRADE, "credit"
)
GRNI_RELATED_ACCOUNT_CODE, GRNI_RELATED_ACCOUNT_NAME, _ = catalog_account(
    EVENT_GOODS_RECEIPT, VARIANT_MATERIALS, PARTY_RELATED, "credit"
)
PPV_ACCOUNT_CODE, PPV_ACCOUNT_NAME, _ = catalog_account(
    EVENT_SUPPLIER_INVOICE, VARIANT_PPV_UNFAVORABLE, PARTY_TRADE, "debit"
)
TAX_EXPENSE_ACCOUNT_CODE, TAX_EXPENSE_ACCOUNT_NAME, _ = catalog_account(
    EVENT_SUPPLIER_INVOICE, VARIANT_TAX, PARTY_TRADE, "debit"
)
TAX_PAYABLE_ACCOUNT_CODE, TAX_PAYABLE_ACCOUNT_NAME, _ = catalog_account(
    EVENT_SALES_INVOICE, VARIANT_TAX, PARTY_ANY, "credit"
)

# Historical placeholder codes — still used when settling older journals.
_LEGACY_AP_CODES = frozenset({"2000", "2170", "2171", "2172", "2180", "2181", "2182"})
_LEGACY_AR_CODES = frozenset({"1100", "1170", "1172", "1180", "1181"})

_MONEY = Decimal("0.01")

_DEFAULT_PAYMENT_TERM_DAYS = 30


def get_or_create_account(
    db: Session, code: str, name: str, account_type: str
) -> ChartOfAccount:
    """Fetch a Chart of Accounts row by code, creating it if missing."""
    account = db.query(ChartOfAccount).filter(ChartOfAccount.account_code == code).first()
    if account is not None:
        return account

    account = ChartOfAccount(account_code=code, account_name=name, account_type=account_type)
    db.add(account)
    db.flush()
    return account


def is_related_party_supplier(supplier: Supplier | None) -> bool:
    """TIPTOP pmc903=Y is stored as related_party=Y in supplier notes."""
    if supplier is None:
        return False
    notes = (getattr(supplier, "notes", None) or "").lower().replace(" ", "")
    return "related_party=y" in notes


def ap_account_spec(supplier: Supplier | None = None) -> tuple[str, str, str]:
    party = PARTY_RELATED if is_related_party_supplier(supplier) else PARTY_TRADE
    return catalog_account(EVENT_SUPPLIER_INVOICE, VARIANT_GRNI_CLEAR, party, "credit")


def receipt_debit_spec(source_type: str | None, item=None) -> tuple[str, str, str]:
    return catalog_account(
        EVENT_GOODS_RECEIPT, receipt_variant(source_type, item), PARTY_TRADE, "debit"
    )


def grni_account_spec(supplier: Supplier | None = None) -> tuple[str, str, str]:
    party = PARTY_RELATED if is_related_party_supplier(supplier) else PARTY_TRADE
    return catalog_account(EVENT_GOODS_RECEIPT, VARIANT_MATERIALS, party, "credit")


def resolve_ap_account(db: Session, supplier: Supplier | None = None) -> ChartOfAccount:
    """Trade/related AP from the posting rule, or the vendor's mapped AP account."""
    if supplier is not None:
        mapped_id = getattr(supplier, "ap_account_id", None)
        if mapped_id:
            mapped = getattr(supplier, "ap_account", None) or db.get(ChartOfAccount, mapped_id)
            if mapped is not None:
                return mapped
    _debit, credit = resolve_posting_pair(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_GRNI_CLEAR, supplier
    )
    return credit


def receipt_debit_account(
    db: Session,
    *,
    source_type: str | None,
    item=None,
    supplier: Supplier | None = None,
) -> ChartOfAccount:
    """Debit side of a goods-receipt GRNI accrual."""
    debit, _credit = resolve_posting_pair(
        db, EVENT_GOODS_RECEIPT, receipt_variant(source_type, item), supplier
    )
    return debit


def resolve_grni_account(db: Session, supplier: Supplier | None = None) -> ChartOfAccount:
    _debit, credit = resolve_posting_pair(
        db, EVENT_GOODS_RECEIPT, VARIANT_MATERIALS, supplier
    )
    return credit


def _journal_side_account(
    db: Session,
    description_contains: str,
    *,
    credit: bool,
    codes: frozenset[str],
) -> ChartOfAccount | None:
    entries = (
        db.query(JournalEntry)
        .options(selectinload(JournalEntry.postings).joinedload(LedgerPosting.account))
        .filter(JournalEntry.description.contains(description_contains))
        .order_by(JournalEntry.created_at.desc())
        .all()
    )
    for entry in entries:
        for posting in entry.postings or []:
            amount = posting.credit if credit else posting.debit
            if Decimal(str(amount or 0)) <= 0:
                continue
            account = posting.account
            if account is not None and account.account_code in codes:
                return account
    return None


def resolve_ap_account_for_settlement(
    db: Session,
    *,
    document_number: str,
    supplier: Supplier | None = None,
) -> ChartOfAccount:
    posted = _journal_side_account(
        db, document_number, credit=True, codes=_LEGACY_AP_CODES
    )
    if posted is not None:
        return posted
    return resolve_ap_account(db, supplier)


def resolve_ar_account_for_settlement(db: Session, invoice_id: str) -> ChartOfAccount:
    posted = _journal_side_account(
        db, invoice_id, credit=False, codes=_LEGACY_AR_CODES
    )
    if posted is not None:
        return posted
    ar_account, _revenue = resolve_posting_pair(db, EVENT_SALES_INVOICE, VARIANT_REVENUE, None)
    return ar_account


def _parse_payment_terms_days(payment_terms: str | None) -> int:
    """Best-effort parse of a 'Net 30' style string into an integer day count."""
    return due_days_from_string(payment_terms, _DEFAULT_PAYMENT_TERM_DAYS)


# ==================================================================
# O2C: Sales Order -> AR Invoice
# ==================================================================

def create_ar_invoice_for_sales_order(db: Session, order: SalesOrder) -> ARInvoice:
    """Auto-generate an AR Invoice when a Sales Order is Approved.

    Idempotent: if an invoice already exists for this sales order, it is
    returned unchanged rather than creating a duplicate.
    """
    existing = (
        db.query(ARInvoice)
        .filter(ARInvoice.sales_order_id == order.sales_order_id)
        .first()
    )
    if existing is not None:
        return existing

    term_days = due_days_for(
        db,
        payment_term_id=getattr(order, "payment_term_id", None),
        payment_terms=order.payment_terms,
    )
    due_date = order.order_date + timedelta(days=term_days) if order.order_date else date.today() + timedelta(days=term_days)

    invoice = ARInvoice(
        invoice_id=f"ARINV-{uuid4().hex[:10].upper()}",
        sales_order_id=order.sales_order_id,
        customer_id=order.customer_id,
        amount=order.total_amount,
        status="Unpaid",
        approval_status="APPROVED",  # inherits parent SO approval
        due_date=due_date,
    )
    db.add(invoice)
    db.flush()
    return invoice


# ==================================================================
# P2P: Purchase Order -> AP Bill
# ==================================================================

def create_ap_bill_for_purchase_order(db: Session, po: PurchaseOrder) -> APBill:
    """Auto-generate an AP Bill when a Purchase Order is Approved.

    Idempotent: if a bill already exists for this PO, it is returned
    unchanged rather than creating a duplicate.
    """
    existing = (
        db.query(APBill)
        .filter(APBill.purchase_order_id == po.po_number)
        .first()
    )
    if existing is not None:
        return existing

    term_days = due_days_for(
        db,
        payment_term_id=getattr(po, "payment_term_id", None),
        payment_terms=po.payment_terms,
    )
    order_date = po.order_date or date.today()
    due_date = order_date + timedelta(days=term_days)

    bill = APBill(
        bill_id=f"APBILL-{uuid4().hex[:10].upper()}",
        purchase_order_id=po.po_number,
        vendor_id=po.supplier_id,
        amount=po.grand_total,
        status="Unpaid",
        approval_status="APPROVED",  # inherits parent PO approval
        due_date=due_date,
        payment_term_id=getattr(po, "payment_term_id", None),
    )
    db.add(bill)
    db.flush()
    return bill


# ==================================================================
# Cash Management + GL Postings
# ==================================================================

GENERATED_JOURNAL_POSTING_STATUS = "Draft"
GENERATED_JOURNAL_APPROVAL_STATUS = "DRAFT"


def _post_balanced_journal_entry(
    db: Session,
    description: str,
    debit_account: ChartOfAccount,
    credit_account: ChartOfAccount,
    amount: Decimal,
    *,
    reference: str | None = None,
    posted_by_user_id: UUID | None = None,
    posting_date: date | None = None,
    posting_status: str | None = None,
    approval_status: str | None = None,
    source_document_type: str,
    source_record_id: str | int | UUID | None = None,
    posting_rule_id: UUID | None = None,
) -> JournalEntry:
    """Create a balanced two-line journal.

    Receipts, invoices, payments, credit memos, and other automatic
    postings default to Draft / DRAFT so they can be reviewed before
    month-end. Posted bank transfers pass Posted / APPROVED so the
    cash movement hits G/L balances immediately.
    """
    today = posting_date or datetime.utcnow().date()
    period = today.strftime("%Y-%m")
    entry = JournalEntry(
        journal_number=generate_document_number(db, DOC_JOURNAL, today),
        description=description,
        period=period,
        posting_date=today,
        posting_status=posting_status or GENERATED_JOURNAL_POSTING_STATUS,
        approval_status=approval_status or GENERATED_JOURNAL_APPROVAL_STATUS,
        current_approval_step=None,
        reference=(reference.strip() if reference else None) or None,
        posted_by_user_id=posted_by_user_id,
        **generated_journal_fields(
            source_document_type=source_document_type,
            source_record_id=source_record_id,
            posting_rule_id=posting_rule_id,
        ),
    )
    db.add(entry)
    db.flush()

    debit_posting = LedgerPosting(
        entry_id=entry.id,
        account_id=debit_account.id,
        debit=amount,
        credit=Decimal("0.0000"),
    )
    credit_posting = LedgerPosting(
        entry_id=entry.id,
        account_id=credit_account.id,
        debit=Decimal("0.0000"),
        credit=amount,
    )
    db.add(debit_posting)
    db.add(credit_posting)
    db.flush()
    return entry


DEFAULT_BANK_ACCOUNT_ID = "BANK-OPERATING"
_INSTRUMENT_START = 1042
CASH_PAYMENT_METHODS = {"CHECK", "WIRE", "ACH", "CARD"}
INSTRUMENT_PREFIX = {"CHECK": "CHK", "WIRE": "WIRE", "ACH": "ACH", "CARD": "CC"}
BANK_ACCOUNT_TYPES = frozenset({"CHECKING", "SAVINGS", "MONEY_MARKET", "OTHER"})


def mask_account_number(account_number: str | None) -> str | None:
    if not account_number:
        return None
    digits = "".join(ch for ch in str(account_number) if ch.isdigit()) or str(account_number)
    last4 = digits[-4:] if len(digits) >= 4 else digits
    return f"...{last4}"


def instrument_display_number(instrument_ref_no: str | None) -> str | None:
    if not instrument_ref_no:
        return None
    value = str(instrument_ref_no).replace("#", "").strip()
    upper = value.upper()
    for prefix in INSTRUMENT_PREFIX.values():
        token = f"{prefix}-"
        if upper.startswith(token):
            return value[len(token) :].strip() or None
    if "-" in value:
        value = value.split("-")[-1]
    return value or None


def cash_type_label(
    *,
    txn_type: str,
    payment_method: str | None = None,
    instrument_ref_no: str | None = None,
) -> str:
    method = (payment_method or "CHECK").upper()
    labels = {
        "ACH": "ACH",
        "WIRE": "Wire",
        "CHECK": "Check",
        "CARD": "Credit Card",
    }
    base = labels.get(method)
    if not base:
        is_deposit = "deposit" in (txn_type or "").lower()
        base = txn_type or ("Deposit" if is_deposit else "Issue")
    number = instrument_display_number(instrument_ref_no)
    if number:
        return f"{base} - Ref #{number}"
    return base


def bank_account_display(account: BankAccount | None) -> str | None:
    if account is None:
        return None
    masked = mask_account_number(account.account_number)
    name = f"{account.bank_name} - {account.account_name}".strip(" -")
    return f"{name} ({masked})" if masked else name


def gl_account_display(account: ChartOfAccount | None) -> str | None:
    if account is None:
        return None
    code = (account.account_code or "").strip()
    name = (account.account_name or "").strip()
    if code and name:
        return f"{code} — {name}"
    return code or name or None


def serialize_bank_account(account: BankAccount, book_balance: Decimal | None = None) -> dict:
    gl = getattr(account, "gl_account", None)
    return {
        "bank_account_id": account.bank_account_id,
        "bank_name": account.bank_name,
        "account_name": account.account_name,
        "account_number": account.account_number,
        "account_number_masked": mask_account_number(account.account_number),
        "routing_number": account.routing_number,
        "account_type": (getattr(account, "account_type", None) or "CHECKING").upper(),
        "currency": (getattr(account, "currency", None) or "USD").upper(),
        "gl_account_id": getattr(account, "gl_account_id", None),
        "gl_account_code": gl.account_code if gl is not None else None,
        "gl_account_name": gl.account_name if gl is not None else None,
        "gl_account_display": gl_account_display(gl),
        "display_name": bank_account_display(account),
        "is_default": bool(account.is_default),
        "is_active": bool(account.is_active),
        "book_balance": book_balance,
    }


def _bank_account_id_from_name(account_name: str) -> str:
    slug = "".join(ch if ch.isalnum() else "-" for ch in (account_name or "BANK").upper())
    slug = "-".join(part for part in slug.split("-") if part) or "BANK"
    return f"BANK-{slug}"[:50]


def normalize_routing_or_swift(value: str | None) -> str | None:
    """Accept a 9-digit ABA routing number or an 8–11 character SWIFT/BIC."""
    raw = (value or "").strip().upper().replace(" ", "")
    if not raw:
        return None
    if raw.isdigit() and len(raw) == 9:
        return raw
    if 8 <= len(raw) <= 11 and raw.isalnum():
        return raw
    raise HTTPException(
        status_code=400,
        detail="Routing number must be 9 digits, or SWIFT/BIC must be 8–11 alphanumeric characters",
    )


def normalize_bank_account_type(value: str | None) -> str:
    account_type = (value or "CHECKING").strip().upper().replace(" ", "_").replace("-", "_")
    aliases = {
        "CHECKING": "CHECKING",
        "CHECK": "CHECKING",
        "SAVINGS": "SAVINGS",
        "SAVING": "SAVINGS",
        "MONEY_MARKET": "MONEY_MARKET",
        "MONEYMARKET": "MONEY_MARKET",
        "MM": "MONEY_MARKET",
        "OTHER": "OTHER",
    }
    normalized = aliases.get(account_type)
    if normalized is None:
        raise HTTPException(
            status_code=400,
            detail="Account type must be Checking, Savings, Money Market, or Other",
        )
    return normalized


def normalize_currency(value: str | None) -> str:
    code = (value or "USD").strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise HTTPException(status_code=400, detail="Currency must be a 3-letter ISO code")
    return code


def require_gl_account(db: Session, gl_account_id) -> ChartOfAccount:
    if gl_account_id is None:
        raise HTTPException(status_code=400, detail="Mapped G/L Account is required")
    account = db.get(ChartOfAccount, gl_account_id)
    if account is None:
        raise HTTPException(status_code=400, detail="Mapped G/L Account was not found")
    return account


def resolve_bank_cash_gl(db: Session, bank_account: BankAccount | None) -> ChartOfAccount:
    """Cash/bank G/L used for payment posting and bank reconciliation."""
    if bank_account is not None:
        gl = getattr(bank_account, "gl_account", None)
        if gl is not None:
            return gl
        gl_id = getattr(bank_account, "gl_account_id", None)
        if gl_id is not None:
            gl = db.get(ChartOfAccount, gl_id)
            if gl is not None:
                return gl
    cash, _ar = resolve_posting_pair(db, EVENT_AR_PAYMENT, VARIANT_SETTLE, None)
    return cash


def create_bank_account(
    db: Session,
    *,
    bank_name: str,
    account_name: str,
    account_number: str,
    routing_number: str | None = None,
    account_type: str | None = "CHECKING",
    currency: str | None = "USD",
    gl_account_id=None,
    is_default: bool = False,
    is_active: bool = True,
) -> BankAccount:
    account_id = _bank_account_id_from_name(account_name)
    if db.get(BankAccount, account_id):
        account_id = f"{account_id[:40]}-{uuid4().hex[:6].upper()}"
    gl = require_gl_account(db, gl_account_id)
    if is_default:
        db.query(BankAccount).filter(BankAccount.is_default.is_(True)).update({"is_default": False})
    account = BankAccount(
        bank_account_id=account_id,
        bank_name=bank_name.strip(),
        account_name=account_name.strip(),
        account_number=account_number.strip(),
        routing_number=normalize_routing_or_swift(routing_number),
        account_type=normalize_bank_account_type(account_type),
        currency=normalize_currency(currency),
        gl_account_id=gl.id,
        is_default=bool(is_default),
        is_active=bool(is_active),
    )
    db.add(account)
    db.flush()
    return account


def update_bank_account(db: Session, bank_account_id: str, updates: dict) -> BankAccount:
    account = db.get(BankAccount, bank_account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Bank account not found")
    payload = dict(updates or {})
    if "routing_number" in payload:
        payload["routing_number"] = normalize_routing_or_swift(payload.get("routing_number"))
    if "account_type" in payload and payload["account_type"] is not None:
        payload["account_type"] = normalize_bank_account_type(payload["account_type"])
    if "currency" in payload and payload["currency"] is not None:
        payload["currency"] = normalize_currency(payload["currency"])
    if "gl_account_id" in payload:
        gl = require_gl_account(db, payload.get("gl_account_id"))
        payload["gl_account_id"] = gl.id
    for field in (
        "bank_name",
        "account_name",
        "account_number",
        "routing_number",
        "account_type",
        "currency",
        "gl_account_id",
        "is_default",
        "is_active",
    ):
        if field not in payload:
            continue
        value = payload[field]
        if field in {"bank_name", "account_name", "account_number"} and isinstance(value, str):
            value = value.strip()
        setattr(account, field, value)
    if account.is_default:
        db.query(BankAccount).filter(
            BankAccount.is_default.is_(True),
            BankAccount.bank_account_id != account.bank_account_id,
        ).update({"is_default": False})
    if not account.is_active:
        account.is_default = False
    db.flush()
    return account


def ensure_default_bank_account(db: Session) -> BankAccount:
    account = db.get(BankAccount, DEFAULT_BANK_ACCOUNT_ID)
    if account:
        return account
    default = (
        db.query(BankAccount)
        .filter(BankAccount.is_default.is_(True), BankAccount.is_active.is_(True))
        .first()
    )
    if default:
        return default
    cash, _ar = resolve_posting_pair(db, EVENT_AR_PAYMENT, VARIANT_SETTLE, None)
    account = BankAccount(
        bank_account_id=DEFAULT_BANK_ACCOUNT_ID,
        bank_name="Amerant Bank",
        account_name="Operating",
        account_number="0000008420",
        routing_number="067000123",
        account_type="CHECKING",
        currency="USD",
        gl_account_id=cash.id,
        is_default=True,
        is_active=True,
    )
    db.add(account)
    db.flush()
    return account


BANK_TRANSFER_STATUSES = frozenset({"DRAFT", "POSTED"})


def assert_bank_transfer_accounts(from_account_id: str, to_account_id: str) -> None:
    source = (from_account_id or "").strip()
    dest = (to_account_id or "").strip()
    if not source or not dest:
        raise HTTPException(status_code=400, detail="From account and to account are required")
    if source == dest:
        raise HTTPException(
            status_code=400,
            detail="From account and to account must be different",
        )


def assert_bank_transfer_amount(amount) -> Decimal:
    try:
        value = Decimal(str(amount))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero") from exc
    if value <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    return value.quantize(Decimal("0.01"))


def _format_money(value: Decimal) -> str:
    return f"{Decimal(value).quantize(Decimal('0.01')):,.2f}"


def assert_transfer_within_balance(amount: Decimal, available: Decimal, *, account_label: str | None = None) -> None:
    if amount <= available:
        return
    source = account_label or "the source account"
    raise HTTPException(
        status_code=400,
        detail=(
            f"Insufficient funds in {source}. Available book balance is "
            f"{_format_money(available)}; transfer amount is {_format_money(amount)}."
        ),
    )


def gl_book_balances(
    db: Session,
    gl_account_ids,
    *,
    as_of: date | None = None,
    currency: str = "USD",
) -> dict:
    """Posted G/L book balances keyed by chart-of-accounts id."""
    ids = [gid for gid in (gl_account_ids or []) if gid is not None]
    if not ids:
        return {}
    debit_sum = func.coalesce(func.sum(LedgerPosting.debit), 0)
    credit_sum = func.coalesce(func.sum(LedgerPosting.credit), 0)
    query = (
        db.query(ChartOfAccount.id, ChartOfAccount.account_type, debit_sum, credit_sum)
        .join(LedgerPosting, LedgerPosting.account_id == ChartOfAccount.id)
        .join(JournalEntry, JournalEntry.id == LedgerPosting.entry_id)
        .filter(ChartOfAccount.id.in_(ids))
        .filter(func.lower(func.coalesce(JournalEntry.posting_status, "Posted")) == "posted")
        .filter(func.upper(func.coalesce(LedgerPosting.currency, "USD")) == (currency or "USD").upper())
    )
    if as_of is not None:
        query = query.filter(
            func.coalesce(JournalEntry.posting_date, cast(JournalEntry.created_at, Date)) <= as_of
        )
    rows = query.group_by(ChartOfAccount.id, ChartOfAccount.account_type).all()
    balances = {gid: Decimal("0.00") for gid in ids}
    for account_id, account_type, debit, credit in rows:
        balances[account_id] = signed_balance(account_type, debit, credit)
    return balances


def bank_account_book_balance(
    db: Session,
    bank_account: BankAccount,
    *,
    as_of: date | None = None,
) -> Decimal:
    gl = resolve_bank_cash_gl(db, bank_account)
    currency = getattr(bank_account, "currency", None) or "USD"
    gl_id = getattr(gl, "id", None) or getattr(bank_account, "gl_account_id", None)
    return gl_book_balances(db, [gl_id], as_of=as_of, currency=currency).get(gl_id, Decimal("0.00"))


def serialize_bank_accounts_with_balances(db: Session, accounts: list[BankAccount]) -> list[dict]:
    by_currency: dict[str, list] = {}
    for account in accounts:
        ccy = (getattr(account, "currency", None) or "USD").upper()
        by_currency.setdefault(ccy, []).append(account)
    balances: dict = {}
    for ccy, group in by_currency.items():
        balances.update(gl_book_balances(db, [row.gl_account_id for row in group], currency=ccy))
    return [
        serialize_bank_account(
            account,
            book_balance=balances.get(account.gl_account_id, Decimal("0.00")),
        )
        for account in accounts
    ]


def reserved_outbound_transfer_amount(
    db: Session,
    from_account_id: str,
    *,
    exclude_id: int | None = None,
) -> Decimal:
    """Amounts already committed but not yet in posted G/L."""
    query = db.query(func.coalesce(func.sum(BankTransfer.amount), 0)).filter(
        BankTransfer.from_account_id == from_account_id,
        or_(
            func.upper(BankTransfer.approval_status) == "PENDING_APPROVAL",
            and_(
                func.upper(BankTransfer.approval_status) == "APPROVED",
                func.upper(BankTransfer.status) != "POSTED",
            ),
        ),
    )
    if exclude_id is not None:
        query = query.filter(BankTransfer.id != exclude_id)
    raw = query.scalar()
    return Decimal(str(raw or 0)).quantize(Decimal("0.01"))


def assert_source_has_funds(
    db: Session,
    from_account: BankAccount,
    amount: Decimal,
    *,
    as_of: date | None = None,
    exclude_transfer_id: int | None = None,
) -> Decimal:
    book = bank_account_book_balance(db, from_account, as_of=as_of)
    reserved = reserved_outbound_transfer_amount(
        db,
        from_account.bank_account_id,
        exclude_id=exclude_transfer_id,
    )
    available = book - reserved
    assert_transfer_within_balance(
        amount,
        available,
        account_label=bank_account_display(from_account) or from_account.bank_account_id,
    )
    return available


def _require_bank_account(db: Session, bank_account_id: str, label: str) -> BankAccount:
    account = (
        db.query(BankAccount)
        .options(joinedload(BankAccount.gl_account))
        .filter(BankAccount.bank_account_id == bank_account_id)
        .one_or_none()
    )
    if account is None:
        raise HTTPException(status_code=404, detail=f"{label} bank account was not found")
    return account


def _require_active_bank_account(db: Session, bank_account_id: str, label: str) -> BankAccount:
    account = _require_bank_account(db, bank_account_id, label)
    if not account.is_active:
        raise HTTPException(status_code=400, detail=f"{label} bank account is inactive")
    return account


def _bank_transfer_query(db: Session):
    return db.query(BankTransfer).options(
        joinedload(BankTransfer.from_account).joinedload(BankAccount.gl_account),
        joinedload(BankTransfer.to_account).joinedload(BankAccount.gl_account),
    )


def serialize_bank_transfer(transfer: BankTransfer) -> dict:
    from_acct = getattr(transfer, "from_account", None)
    to_acct = getattr(transfer, "to_account", None)
    return {
        "id": transfer.id,
        "from_account_id": transfer.from_account_id,
        "to_account_id": transfer.to_account_id,
        "from_account_name": bank_account_display(from_acct) if from_acct is not None else None,
        "to_account_name": bank_account_display(to_acct) if to_acct is not None else None,
        "amount": transfer.amount,
        "transfer_date": transfer.transfer_date,
        "reference_number": transfer.reference_number,
        "status": (getattr(transfer, "status", None) or "DRAFT").upper(),
        "approval_status": (getattr(transfer, "approval_status", None) or "DRAFT").upper(),
        "current_approval_step": getattr(transfer, "current_approval_step", None),
        "journal_entry_id": getattr(transfer, "journal_entry_id", None),
        "created_at": getattr(transfer, "created_at", None),
    }


def list_bank_transfers(db: Session) -> list[BankTransfer]:
    return (
        _bank_transfer_query(db)
        .order_by(BankTransfer.transfer_date.desc(), BankTransfer.id.desc())
        .all()
    )


def get_bank_transfer(db: Session, transfer_id: int) -> BankTransfer:
    transfer = _bank_transfer_query(db).filter(BankTransfer.id == transfer_id).one_or_none()
    if transfer is None:
        raise HTTPException(status_code=404, detail="Bank transfer not found")
    return transfer


def create_bank_transfer(
    db: Session,
    *,
    from_account_id: str,
    to_account_id: str,
    amount,
    transfer_date: date,
    reference_number: str | None = None,
) -> BankTransfer:
    assert_bank_transfer_accounts(from_account_id, to_account_id)
    pay_amount = assert_bank_transfer_amount(amount)
    from_account = _require_active_bank_account(db, from_account_id.strip(), "From")
    to_account = _require_active_bank_account(db, to_account_id.strip(), "To")
    from_ccy = (from_account.currency or "USD").upper()
    to_ccy = (to_account.currency or "USD").upper()
    if from_ccy != to_ccy:
        raise HTTPException(
            status_code=400,
            detail="Source and destination accounts must use the same currency",
        )
    assert_source_has_funds(db, from_account, pay_amount, as_of=transfer_date)
    transfer = BankTransfer(
        from_account_id=from_account.bank_account_id,
        to_account_id=to_account.bank_account_id,
        amount=pay_amount,
        transfer_date=transfer_date,
        reference_number=(reference_number or "").strip() or None,
        status="DRAFT",
        approval_status="DRAFT",
        current_approval_step=None,
    )
    db.add(transfer)
    db.flush()
    if not transfer.reference_number:
        transfer.reference_number = f"BTR-{transfer.id:06d}"
        db.flush()
    return get_bank_transfer(db, transfer.id)


BANK_TRANSFER_EDITABLE = frozenset({"DRAFT", "REJECTED"})


def is_bank_transfer_deletable(transfer: BankTransfer) -> bool:
    gl = (getattr(transfer, "status", None) or "DRAFT").upper()
    approval = (getattr(transfer, "approval_status", None) or "DRAFT").upper()
    return gl == "DRAFT" and approval == "DRAFT"


def _validate_transfer_accounts_and_amount(
    db: Session,
    *,
    from_account_id: str,
    to_account_id: str,
    amount,
    transfer_date: date,
    exclude_transfer_id: int | None = None,
) -> tuple[BankAccount, BankAccount, Decimal]:
    assert_bank_transfer_accounts(from_account_id, to_account_id)
    pay_amount = assert_bank_transfer_amount(amount)
    from_account = _require_active_bank_account(db, from_account_id.strip(), "From")
    to_account = _require_active_bank_account(db, to_account_id.strip(), "To")
    from_ccy = (from_account.currency or "USD").upper()
    to_ccy = (to_account.currency or "USD").upper()
    if from_ccy != to_ccy:
        raise HTTPException(
            status_code=400,
            detail="Source and destination accounts must use the same currency",
        )
    assert_source_has_funds(
        db,
        from_account,
        pay_amount,
        as_of=transfer_date,
        exclude_transfer_id=exclude_transfer_id,
    )
    return from_account, to_account, pay_amount


def update_bank_transfer(
    db: Session,
    transfer_id: int,
    *,
    from_account_id: str,
    to_account_id: str,
    amount,
    transfer_date: date,
    reference_number: str | None = None,
) -> BankTransfer:
    transfer = get_bank_transfer(db, transfer_id)
    approval = (transfer.approval_status or "DRAFT").upper()
    if approval not in BANK_TRANSFER_EDITABLE:
        raise HTTPException(
            status_code=400,
            detail=f"Only draft or rejected transfers can be edited (current: {approval})",
        )
    if (transfer.status or "").upper() == "POSTED":
        raise HTTPException(status_code=400, detail="Posted transfers cannot be edited")
    from_account, to_account, pay_amount = _validate_transfer_accounts_and_amount(
        db,
        from_account_id=from_account_id,
        to_account_id=to_account_id,
        amount=amount,
        transfer_date=transfer_date,
        exclude_transfer_id=transfer.id,
    )
    transfer.from_account_id = from_account.bank_account_id
    transfer.to_account_id = to_account.bank_account_id
    transfer.amount = pay_amount
    transfer.transfer_date = transfer_date
    if reference_number is not None:
        transfer.reference_number = reference_number.strip() or transfer.reference_number
    db.flush()
    return get_bank_transfer(db, transfer.id)


def delete_bank_transfer(db: Session, transfer_id: int) -> None:
    transfer = get_bank_transfer(db, transfer_id)
    gl = (transfer.status or "DRAFT").upper()
    approval = (transfer.approval_status or "DRAFT").upper()
    if not is_bank_transfer_deletable(transfer):
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot delete this bank transfer unless G/L status and "
                f"approval status are both Draft (G/L={gl}, approval={approval})."
            ),
        )
    if getattr(transfer, "journal_entry_id", None):
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a bank transfer that has a journal entry",
        )
    db.delete(transfer)
    db.flush()


def ensure_transfer_journal(db: Session, transfer: BankTransfer) -> JournalEntry:
    """Create the linked G/L journal as Draft / DRAFT after transfer approval.

    Cash does not move until that journal is approved and posted.
    """
    loaded = get_bank_transfer(db, transfer.id)
    if loaded.journal_entry_id:
        existing = db.get(JournalEntry, loaded.journal_entry_id)
        if existing is not None:
            return existing

    from_account = _require_active_bank_account(db, loaded.from_account_id, "From")
    to_account = _require_active_bank_account(db, loaded.to_account_id, "To")
    from_gl = resolve_bank_cash_gl(db, from_account)
    to_gl = resolve_bank_cash_gl(db, to_account)
    amount = assert_bank_transfer_amount(loaded.amount)
    assert_source_has_funds(
        db,
        from_account,
        amount,
        as_of=loaded.transfer_date,
        exclude_transfer_id=loaded.id,
    )
    reference = loaded.reference_number or f"BTR-{loaded.id:06d}"
    from_label = bank_account_display(from_account) or from_account.bank_account_id
    to_label = bank_account_display(to_account) or to_account.bank_account_id
    _to, _from, transfer_rule = resolve_posting_rule(
        db, EVENT_BANK_TRANSFER, VARIANT_TRANSFER, None
    )
    entry = _post_balanced_journal_entry(
        db,
        description=f"Bank transfer {reference} from {from_label} to {to_label}",
        debit_account=to_gl,
        credit_account=from_gl,
        amount=amount,
        reference=reference,
        posting_date=loaded.transfer_date,
        source_document_type=SOURCE_BANK_TRANSFER,
        source_record_id=loaded.id,
        posting_rule_id=rule_id(transfer_rule),
    )
    loaded.journal_entry_id = entry.id
    transfer.journal_entry_id = entry.id
    db.flush()
    return entry


def post_bank_transfer(db: Session, transfer_id: int) -> BankTransfer:
    """Kept for compatibility: only approved transfers may generate a draft journal."""
    transfer = get_bank_transfer(db, transfer_id)
    if (transfer.status or "").upper() == "POSTED":
        raise HTTPException(status_code=400, detail="Transfer is already posted")
    approval = (transfer.approval_status or "DRAFT").upper()
    if approval != "APPROVED":
        raise HTTPException(
            status_code=400,
            detail="Submit the transfer for approval before generating its journal entry",
        )
    ensure_transfer_journal(db, transfer)
    return get_bank_transfer(db, transfer.id)


def next_instrument_ref(db: Session, payment_method: str = "CHECK") -> str:
    method = (payment_method or "CHECK").upper()
    if method not in CASH_PAYMENT_METHODS:
        method = "CHECK"
    prefix = INSTRUMENT_PREFIX[method]
    rows = (
        db.query(CashTransaction.instrument_ref_no)
        .filter(CashTransaction.instrument_ref_no.ilike(f"{prefix}-%"))
        .all()
    )
    start = _INSTRUMENT_START if method == "CHECK" else 1
    max_n = start - 1
    for (raw,) in rows:
        number = instrument_display_number(raw)
        if number and number.isdigit():
            max_n = max(max_n, int(number))
    return f"{prefix}-{max_n + 1}"


def normalize_instrument_ref(
    db: Session,
    payment_method: str,
    instrument_ref_no: str | None,
) -> str:
    method = (payment_method or "CHECK").upper()
    if method not in CASH_PAYMENT_METHODS:
        method = "CHECK"
    prefix = INSTRUMENT_PREFIX[method]
    value = str(instrument_ref_no or "").replace("#", "").strip()
    if not value:
        return next_instrument_ref(db, method)
    upper = value.upper()
    token = f"{prefix}-"
    if upper.startswith(token):
        rest = value[len(token) :].strip()
        return f"{prefix}-{rest}" if rest else next_instrument_ref(db, method)
    return f"{prefix}-{value}"


def _resolve_payment_datetime(payment_date: date | datetime | None) -> datetime | None:
    if payment_date is None:
        return None
    if isinstance(payment_date, datetime):
        return payment_date
    now = datetime.now().replace(microsecond=0)
    return datetime.combine(payment_date, now.time())


def _transaction_date_kwargs(payment_date: date | datetime | None) -> dict:
    resolved = _resolve_payment_datetime(payment_date)
    return {"transaction_date": resolved} if resolved is not None else {}


def resolve_cash_entity_name(db: Session, *, txn_type: str, reference_id: str) -> str | None:
    ref = (reference_id or "").strip()
    if not ref:
        return None
    if "deposit" in (txn_type or "").lower():
        invoice = db.get(ARInvoice, ref)
        if invoice:
            customer = db.get(Customer, invoice.customer_id)
            return customer.company_name if customer else invoice.customer_id
        sales = (
            db.query(SalesInvoice)
            .filter(SalesInvoice.invoice_number == ref)
            .order_by(SalesInvoice.id.desc())
            .first()
        )
        if sales:
            customer = db.get(Customer, sales.customer_id)
            return customer.company_name if customer else sales.customer_id
        return None
    bill = db.get(APBill, ref)
    if bill:
        vendor = db.get(Supplier, bill.vendor_id)
        return vendor.company_name if vendor else bill.vendor_id
    supplier_invoice = (
        db.query(SupplierInvoice)
        .filter((SupplierInvoice.invoice_number == ref) | (SupplierInvoice.ap_bill_id == ref))
        .order_by(SupplierInvoice.id.desc())
        .first()
    )
    if supplier_invoice:
        vendor = db.get(Supplier, supplier_invoice.vendor_id)
        return vendor.company_name if vendor else supplier_invoice.vendor_id
    return None


def _cash_ledger_fields(
    db: Session,
    *,
    txn_type: str,
    reference_id: str,
    bank_account_id: str | None = None,
    payment_method: str | None = None,
    instrument_ref_no: str | None = None,
) -> dict:
    account = db.get(BankAccount, bank_account_id) if bank_account_id else None
    if account is None:
        account = ensure_default_bank_account(db)
    method = (payment_method or "CHECK").upper()
    if method not in CASH_PAYMENT_METHODS:
        method = "CHECK"
    return {
        "bank_account_id": account.bank_account_id,
        "payment_method": method,
        "instrument_ref_no": normalize_instrument_ref(db, method, instrument_ref_no),
        "entity_name": resolve_cash_entity_name(db, txn_type=txn_type, reference_id=reference_id),
        "clearing_status": "CLEARED",
    }


def serialize_cash_transaction(db: Session, txn: CashTransaction) -> dict:
    account = txn.bank_account
    if account is None and txn.bank_account_id:
        account = db.get(BankAccount, txn.bank_account_id)
    is_deposit = "deposit" in (txn.type or "").lower()
    return {
        "transaction_id": txn.transaction_id,
        "type": txn.type,
        "type_label": cash_type_label(
            txn_type=txn.type,
            payment_method=getattr(txn, "payment_method", None),
            instrument_ref_no=getattr(txn, "instrument_ref_no", None),
        ),
        "reference_id": txn.reference_id,
        "amount": _money(txn.amount),
        "transaction_date": txn.transaction_date,
        "bank_account_id": txn.bank_account_id,
        "bank_account_name": bank_account_display(account),
        "bank_name": account.bank_name if account else None,
        "account_name": account.account_name if account else None,
        "account_number": account.account_number if account else None,
        "account_number_masked": mask_account_number(account.account_number) if account else None,
        "routing_number": account.routing_number if account else None,
        "gl_account_id": getattr(account, "gl_account_id", None) if account else None,
        "payment_method": getattr(txn, "payment_method", None) or "CHECK",
        "instrument_ref_no": getattr(txn, "instrument_ref_no", None),
        "instrument_display_number": instrument_display_number(getattr(txn, "instrument_ref_no", None)),
        "entity_name": getattr(txn, "entity_name", None)
        or resolve_cash_entity_name(db, txn_type=txn.type, reference_id=txn.reference_id),
        "entity_role": "Payer" if is_deposit else "Payee",
        "clearing_status": getattr(txn, "clearing_status", None) or "CLEARED",
        "approval_status": txn.approval_status or "DRAFT",
        "current_approval_step": txn.current_approval_step,
    }


def receive_payment(
    db: Session,
    invoice: ARInvoice,
    amount: Decimal | None = None,
    bank_account_id: str | None = None,
    payment_method: str | None = None,
    instrument_ref_no: str | None = None,
    payment_date: date | datetime | None = None,
) -> CashTransaction:
    """Process an incoming AR payment.

    Updates invoice status to Paid, creates a Cash Transaction
    (Check Deposit), and posts a balanced Journal Entry:
      Debit: Cash
      Credit: Accounts Receivable
    """
    if invoice.status == "Paid":
        raise HTTPException(status_code=400, detail="Invoice is already fully paid")

    if getattr(invoice, "approval_status", None) not in (None, "APPROVED"):
        raise HTTPException(
            status_code=400,
            detail=f"AR invoice must be APPROVED before payment (current: {invoice.approval_status})",
        )

    pay_amount = amount if amount is not None else invoice.amount

    ledger_fields = _cash_ledger_fields(
        db,
        txn_type="Check Deposit",
        reference_id=invoice.invoice_id,
        bank_account_id=bank_account_id,
        payment_method=payment_method,
        instrument_ref_no=instrument_ref_no,
    )
    bank = db.get(BankAccount, ledger_fields["bank_account_id"])
    cash_account = resolve_bank_cash_gl(db, bank)
    ar_account = resolve_ar_account_for_settlement(db, invoice.invoice_id)

    transaction = CashTransaction(
        transaction_id=f"CASH-{uuid4().hex[:10].upper()}",
        type="Check Deposit",
        reference_id=invoice.invoice_id,
        amount=pay_amount,
        approval_status="APPROVED",
        **_transaction_date_kwargs(payment_date),
        **ledger_fields,
    )
    db.add(transaction)

    _cash, _ar, settle_rule = resolve_posting_rule(db, EVENT_AR_PAYMENT, VARIANT_SETTLE, None)
    _post_balanced_journal_entry(
        db,
        description=f"AR payment received for invoice {invoice.invoice_id}",
        debit_account=cash_account,
        credit_account=ar_account,
        amount=pay_amount,
        reference=invoice.invoice_id,
        source_document_type=SOURCE_AR_PAYMENT,
        source_record_id=invoice.invoice_id,
        posting_rule_id=rule_id(settle_rule),
    )

    invoice.status = "Paid" if pay_amount >= invoice.amount else "Partial"

    db.flush()
    return transaction


def make_payment(
    db: Session,
    bill: APBill,
    amount: Decimal | None = None,
    bank_account_id: str | None = None,
    payment_method: str | None = None,
    instrument_ref_no: str | None = None,
    payment_date: date | datetime | None = None,
) -> CashTransaction:
    """Process an outgoing AP payment.

    Updates bill status to Paid, creates a Cash Transaction
    (Check Issue), and posts a balanced Journal Entry:
      Debit: Accounts Payable
      Credit: Cash
    """
    if bill.status == "Paid":
        raise HTTPException(status_code=400, detail="Bill is already fully paid")

    if getattr(bill, "approval_status", None) not in (None, "APPROVED"):
        raise HTTPException(
            status_code=400,
            detail=f"AP bill must be APPROVED before payment (current: {bill.approval_status})",
        )

    pay_amount = amount if amount is not None else bill.amount

    ledger_fields = _cash_ledger_fields(
        db,
        txn_type="Check Issue",
        reference_id=bill.bill_id,
        bank_account_id=bank_account_id,
        payment_method=payment_method,
        instrument_ref_no=instrument_ref_no,
    )
    bank = db.get(BankAccount, ledger_fields["bank_account_id"])
    cash_account = resolve_bank_cash_gl(db, bank)
    ap_account = resolve_ap_account_for_settlement(
        db,
        document_number=bill.bill_id,
        supplier=bill.vendor or db.get(Supplier, bill.vendor_id),
    )

    transaction = CashTransaction(
        transaction_id=f"CASH-{uuid4().hex[:10].upper()}",
        type="Check Issue",
        reference_id=bill.bill_id,
        amount=pay_amount,
        approval_status="APPROVED",
        **_transaction_date_kwargs(payment_date),
        **ledger_fields,
    )
    db.add(transaction)

    _cash, _ap, settle_rule = resolve_posting_rule(
        db, EVENT_AP_PAYMENT, VARIANT_SETTLE, bill.vendor or db.get(Supplier, bill.vendor_id)
    )
    _post_balanced_journal_entry(
        db,
        description=f"AP payment made for bill {bill.bill_id}",
        debit_account=ap_account,
        credit_account=cash_account,
        amount=pay_amount,
        reference=bill.bill_id,
        source_document_type=SOURCE_AP_PAYMENT,
        source_record_id=bill.bill_id,
        posting_rule_id=rule_id(settle_rule),
    )

    bill.status = "Paid" if pay_amount >= bill.amount else "Partial"

    db.flush()
    return transaction


def _money(value: Decimal | int | float | str | None) -> Decimal:
    return Decimal(str(value or 0)).quantize(_MONEY)


def ar_display_status(*, status: str, due_date: date | None, today: date | None = None) -> str:
    if (status or "") == "Paid":
        return "Paid"
    if (status or "") == "Partial":
        return "Partial"
    due = due_date
    as_of = today or date.today()
    if due is not None and due < as_of:
        return "Overdue"
    return "Open"


def _sales_invoice_for_ar(db: Session, invoice: ARInvoice) -> SalesInvoice | None:
    return (
        db.query(SalesInvoice)
        .options(selectinload(SalesInvoice.lines))
        .filter(
            (SalesInvoice.ar_invoice_id == invoice.invoice_id)
            | (SalesInvoice.invoice_number == invoice.invoice_id)
        )
        .order_by(SalesInvoice.id.desc())
        .first()
    )


def get_invoice_detail(db: Session, invoice_id: str) -> dict:
    invoice = db.get(ARInvoice, invoice_id)
    if invoice is None:
        sales = (
            db.query(SalesInvoice)
            .options(selectinload(SalesInvoice.lines))
            .filter(
                (SalesInvoice.invoice_number == invoice_id)
                | (SalesInvoice.ar_invoice_id == invoice_id)
            )
            .order_by(SalesInvoice.id.desc())
            .first()
        )
        if sales and sales.ar_invoice_id:
            invoice = db.get(ARInvoice, sales.ar_invoice_id)
        if invoice is None and sales is not None:
            return serialize_sales_invoice_detail(db, sales)
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found")
    return serialize_ar_invoice_detail(db, invoice)


def serialize_sales_invoice_detail(db: Session, sales_invoice: SalesInvoice) -> dict:
    """Draft / unposted sales invoice with the same shape as AR invoice detail."""
    customer = db.get(Customer, sales_invoice.customer_id)
    order = db.get(SalesOrder, sales_invoice.sales_order_id)
    invoice_total = _money(sales_invoice.total_amount)
    lines = [
        {
            "item_id": line.item_id,
            "description": line.description or line.item_id,
            "quantity": int(line.quantity or 0),
            "unit_price": _money(line.unit_price),
            "line_subtotal": _money(line.line_subtotal),
        }
        for line in (sales_invoice.lines or [])
    ]
    return {
        "invoice_id": sales_invoice.invoice_number,
        "sales_order_id": sales_invoice.sales_order_id,
        "customer_id": sales_invoice.customer_id,
        "customer_name": customer.company_name if customer else None,
        "customer_email": (
            (order.buyer_contact_email if order else None)
            or (customer.primary_email if customer else None)
        ),
        "amount": invoice_total,
        "status": "Unpaid",
        "display_status": "Open",
        "approval_status": sales_invoice.status or "DRAFT",
        "current_approval_step": None,
        "issue_date": sales_invoice.issue_date,
        "due_date": sales_invoice.due_date,
        "payment_date": None,
        "payment_terms": sales_invoice.payment_terms or (order.payment_terms if order else None),
        "currency": (order.currency if order else None) or (customer.currency if customer else None) or "USD",
        "subtotal": _money(sales_invoice.subtotal),
        "tax_amount": _money(sales_invoice.tax_amount),
        "freight_amount": Decimal("0.00"),
        "total_amount": invoice_total,
        "outstanding_balance": _money(sales_invoice.outstanding_balance or invoice_total),
        "sales_invoice_id": sales_invoice.id,
        "sales_invoice_number": sales_invoice.invoice_number,
        "sales_invoice_status": sales_invoice.status,
        "lines": lines,
        "payments": [],
        "can_create_credit_memo": False,
        "credit_memo_reason": "Credit memo is unavailable until this sales invoice is approved.",
        "duplicate_invoice_ids": [],
        "created_at": sales_invoice.created_at,
    }


def serialize_ar_invoice_detail(db: Session, invoice: ARInvoice) -> dict:
    customer = db.get(Customer, invoice.customer_id)
    order = db.get(SalesOrder, invoice.sales_order_id)
    sales_invoice = _sales_invoice_for_ar(db, invoice)
    invoice_total = _money(invoice.amount)

    lines: list[dict] = []
    subtotal = invoice_total
    tax_amount = Decimal("0.00")
    freight_amount = Decimal("0.00")
    issue_date = invoice.created_at.date() if invoice.created_at else None
    payment_terms = order.payment_terms if order else None
    currency = (order.currency if order else None) or (customer.currency if customer else None) or "USD"

    if sales_invoice:
        issue_date = sales_invoice.issue_date or issue_date
        payment_terms = sales_invoice.payment_terms or payment_terms
        subtotal = _money(sales_invoice.subtotal)
        tax_amount = _money(sales_invoice.tax_amount)
        invoice_total = _money(sales_invoice.total_amount or invoice.amount)
        for line in sales_invoice.lines or []:
            lines.append(
                {
                    "item_id": line.item_id,
                    "description": line.description or line.item_id,
                    "quantity": int(line.quantity or 0),
                    "unit_price": _money(line.unit_price),
                    "line_subtotal": _money(line.line_subtotal),
                }
            )
    if not lines and order and order.items:
        computed_subtotal = Decimal("0.00")
        computed_tax = Decimal("0.00")
        for so_line in order.items:
            qty = int(so_line.quantity_ordered or 0)
            unit_price = _money(so_line.unit_price)
            line_subtotal = _money(so_line.total_amount) or (unit_price * qty)
            computed_tax += _money(so_line.tax_amount)
            computed_subtotal += line_subtotal - _money(so_line.tax_amount)
            item = so_line.item if getattr(so_line, "item", None) is not None else db.get(Item, so_line.item_id)
            lines.append(
                {
                    "item_id": so_line.item_id,
                    "description": (item.description if item else None) or so_line.item_id,
                    "quantity": qty,
                    "unit_price": unit_price,
                    "line_subtotal": line_subtotal,
                }
            )
        if not sales_invoice:
            subtotal = computed_subtotal
            tax_amount = computed_tax
            invoice_total = _money(order.total_amount or invoice.amount)

    deposits = (
        db.query(CashTransaction)
        .filter(
            CashTransaction.reference_id == invoice.invoice_id,
            CashTransaction.type == "Check Deposit",
        )
        .order_by(CashTransaction.transaction_date.asc())
        .all()
    )
    credit_entries = (
        db.query(JournalEntry)
        .options(selectinload(JournalEntry.postings))
        .filter(JournalEntry.description.ilike(f"Credit memo {invoice.invoice_id}%"))
        .order_by(JournalEntry.created_at.asc())
        .all()
    )

    remaining = invoice_total
    payments: list[dict] = []
    paid_total = Decimal("0.00")
    payment_date = None

    def _append_payment(*, when, method: str, reference: str, amount: Decimal) -> None:
        nonlocal remaining, paid_total, payment_date
        amt = _money(amount)
        applied = min(amt, remaining) if remaining > 0 else Decimal("0.00")
        remaining = _money(remaining - applied)
        paid_total += amt
        if when:
            payment_date = when.date() if hasattr(when, "date") else when
        payments.append(
            {
                "payment_date": when,
                "method": method,
                "reference": reference,
                "amount_applied": applied,
                "unapplied_balance": _money(amt - applied),
            }
        )

    for txn in deposits:
        _append_payment(
            when=txn.transaction_date,
            method=cash_type_label(
                txn_type=txn.type,
                payment_method=getattr(txn, "payment_method", None),
                instrument_ref_no=getattr(txn, "instrument_ref_no", None),
            ),
            reference=txn.transaction_id,
            amount=_money(txn.amount),
        )
    for entry in credit_entries:
        credit_amt = sum((_money(p.credit) for p in (entry.postings or [])), Decimal("0.00"))
        if credit_amt <= 0:
            credit_amt = sum((_money(p.debit) for p in (entry.postings or [])), Decimal("0.00"))
        _append_payment(
            when=entry.created_at,
            method="Credit Memo",
            reference=str(entry.id),
            amount=credit_amt,
        )

    siblings = (
        db.query(ARInvoice.invoice_id)
        .filter(
            ARInvoice.sales_order_id == invoice.sales_order_id,
            ARInvoice.invoice_id != invoice.invoice_id,
        )
        .all()
    )
    duplicate_ids = [row[0] for row in siblings]
    overpaid = paid_total > invoice_total
    can_credit = bool(duplicate_ids) and (invoice.status or "") != "Paid"
    credit_reason = None
    if duplicate_ids and (invoice.status or "") == "Paid":
        credit_reason = "Credit memo is unavailable because this invoice is already paid."
    elif overpaid:
        credit_reason = "Credit memo is unavailable because extra cash is already unapplied. Use Cash Management for a refund."
    elif can_credit:
        credit_reason = "Create a credit memo to reverse remaining AR (another invoice exists for this sales order)."

    return {
        "invoice_id": invoice.invoice_id,
        "sales_order_id": invoice.sales_order_id,
        "customer_id": invoice.customer_id,
        "customer_name": customer.company_name if customer else None,
        "customer_email": (
            (order.buyer_contact_email if order else None)
            or (customer.primary_email if customer else None)
        ),
        "amount": _money(invoice.amount),
        "status": invoice.status,
        "display_status": ar_display_status(status=invoice.status, due_date=invoice.due_date),
        "approval_status": invoice.approval_status or "DRAFT",
        "current_approval_step": invoice.current_approval_step,
        "issue_date": issue_date,
        "due_date": invoice.due_date,
        "payment_date": payment_date,
        "payment_terms": payment_terms,
        "currency": currency,
        "subtotal": subtotal,
        "tax_amount": tax_amount,
        "freight_amount": freight_amount,
        "total_amount": invoice_total,
        "outstanding_balance": remaining,
        "sales_invoice_id": sales_invoice.id if sales_invoice else None,
        "sales_invoice_number": sales_invoice.invoice_number if sales_invoice else None,
        "sales_invoice_status": sales_invoice.status if sales_invoice else None,
        "lines": lines,
        "payments": payments,
        "can_create_credit_memo": can_credit,
        "credit_memo_reason": credit_reason,
        "duplicate_invoice_ids": duplicate_ids,
        "created_at": invoice.created_at,
    }


def create_ar_credit_memo(db: Session, invoice: ARInvoice) -> dict:
    detail = serialize_ar_invoice_detail(db, invoice)
    if not detail["can_create_credit_memo"]:
        raise HTTPException(
            status_code=400,
            detail=detail["credit_memo_reason"] or "This invoice is not eligible for a credit memo.",
        )
    credit_amount = _money(detail["outstanding_balance"] or invoice.amount)
    if credit_amount <= 0:
        raise HTTPException(status_code=400, detail="Nothing remaining to credit on this invoice")

    revenue, rule_ar, credit_rule = resolve_posting_rule(
        db, EVENT_SALES_CREDIT, VARIANT_CREDIT_MEMO, None
    )
    ar_account = resolve_ar_account_for_settlement(db, invoice.invoice_id) or rule_ar
    _post_balanced_journal_entry(
        db,
        description=f"Credit memo {invoice.invoice_id}",
        debit_account=revenue,
        credit_account=ar_account,
        amount=credit_amount,
        reference=invoice.invoice_id,
        source_document_type=SOURCE_SALES_CREDIT,
        source_record_id=invoice.invoice_id,
        posting_rule_id=rule_id(credit_rule),
    )
    invoice.status = "Paid"
    db.flush()
    return serialize_ar_invoice_detail(db, invoice)


def ap_display_status(*, status: str, due_date: date | None, today: date | None = None) -> str:
    return ar_display_status(status=status, due_date=due_date, today=today)


def _qty(value: Decimal | int | float | str | None) -> Decimal:
    return Decimal(str(value or 0))


def _match_warnings(raw: str | list | None) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(item) for item in raw if str(item).strip()]
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(item) for item in parsed if str(item).strip()]
        if parsed:
            return [str(parsed)]
    except json.JSONDecodeError:
        return [str(raw)]
    return []


def _supplier_invoice_for_ap(db: Session, bill: APBill) -> SupplierInvoice | None:
    filters = [SupplierInvoice.invoice_number == bill.bill_id, SupplierInvoice.ap_bill_id == bill.bill_id]
    if bill.supplier_invoice_id:
        filters.append(SupplierInvoice.id == bill.supplier_invoice_id)
    return (
        db.query(SupplierInvoice)
        .options(*_supplier_invoice_detail_options())
        .filter(or_(*filters))
        .order_by(SupplierInvoice.id.desc())
        .first()
    )


def _lookup_supplier_invoice(db: Session, bill_id: str) -> SupplierInvoice | None:
    return (
        db.query(SupplierInvoice)
        .options(*_supplier_invoice_detail_options())
        .filter(
            (SupplierInvoice.invoice_number == bill_id) | (SupplierInvoice.ap_bill_id == bill_id)
        )
        .order_by(SupplierInvoice.id.desc())
        .first()
    )


def resolve_ap_bill_po_number(db: Session, bill: APBill) -> str | None:
    """PO number the AP list/detail can link to, including landed-cost NON_PO bills."""
    if bill.purchase_order_id:
        return bill.purchase_order_id
    tracking = (getattr(bill, "reference_po_number", None) or "").strip() or None
    if tracking:
        return tracking
    source_id = (bill.source_order_id or "").strip() or None
    if not source_id:
        return None
    if (bill.source_type or "").upper() == "PURCHASE_ORDER":
        return source_id
    if db.get(PurchaseOrder, source_id) is not None:
        return source_id
    return None


def serialize_ap_bill_row(db: Session, bill: APBill) -> dict:
    po_number = resolve_ap_bill_po_number(db, bill)
    return {
        "bill_id": bill.bill_id,
        "purchase_order_id": po_number,
        "po_number": po_number,
        "vendor_id": bill.vendor_id,
        "supplier_invoice_id": bill.supplier_invoice_id,
        "source_type": bill.source_type,
        "source_order_id": bill.source_order_id or po_number,
        "reference_po_number": getattr(bill, "reference_po_number", None) or po_number,
        "amount": bill.amount,
        "status": bill.status,
        "approval_status": bill.approval_status or "DRAFT",
        "current_approval_step": bill.current_approval_step,
        "due_date": bill.due_date,
        "payment_term_id": getattr(bill, "payment_term_id", None),
        "created_at": bill.created_at,
    }


def list_ap_bills(db: Session, skip: int = 0, limit: int = 100) -> list[dict]:
    rows = (
        db.query(APBill)
        .order_by(APBill.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [serialize_ap_bill_row(db, bill) for bill in rows]


def get_bill_detail(db: Session, bill_id: str) -> dict:
    bill = db.get(APBill, bill_id)
    if bill is None:
        supplier_invoice = _lookup_supplier_invoice(db, bill_id)
        if supplier_invoice is not None and supplier_invoice.ap_bill_id:
            bill = db.get(APBill, supplier_invoice.ap_bill_id)
        if bill is None and supplier_invoice is not None:
            return serialize_supplier_invoice_detail(db, supplier_invoice)
        if bill is None:
            raise HTTPException(status_code=404, detail="Bill not found")
    return serialize_ap_bill_detail(db, bill)


def _supplier_invoice_detail_options():
    return (
        selectinload(SupplierInvoice.lines),
        selectinload(SupplierInvoice.distributions).joinedload(
            SupplierInvoiceDistribution.gl_account
        ),
        selectinload(SupplierInvoice.distributions).joinedload(
            SupplierInvoiceDistribution.department
        ),
    )


def _ap_line_from_supplier(line) -> dict:
    return {
        "item_id": line.item_id,
        "description": line.description or line.item_id,
        "quantity": _qty(line.quantity_billed),
        "unit_price": _money(line.unit_price),
        "line_subtotal": _money(line.line_subtotal),
    }


def _ap_lines_for_invoice(supplier_invoice: SupplierInvoice) -> list[dict]:
    dists = list(getattr(supplier_invoice, "distributions", None) or [])
    if dists:
        return [
            {
                "item_id": dist.gl_account.account_code if dist.gl_account else None,
                "description": dist.description
                or (dist.gl_account.account_name if dist.gl_account else None),
                "quantity": Decimal("1"),
                "unit_price": _money(dist.amount),
                "line_subtotal": _money(dist.amount),
            }
            for dist in dists
        ]
    return [_ap_line_from_supplier(line) for line in (supplier_invoice.lines or [])]


def serialize_supplier_invoice_detail(db: Session, supplier_invoice: SupplierInvoice) -> dict:
    """Draft / unposted supplier invoice with the same shape as AP bill detail."""
    vendor = db.get(Supplier, supplier_invoice.vendor_id)
    invoice_total = _money(supplier_invoice.total_amount)
    tracking_po = getattr(supplier_invoice, "reference_po_number", None)
    po_number = (
        tracking_po
        or (
            supplier_invoice.source_order_id
            if supplier_invoice.source_type == "PURCHASE_ORDER"
            or (
                supplier_invoice.source_order_id
                and db.get(PurchaseOrder, supplier_invoice.source_order_id) is not None
            )
            else None
        )
    )
    lines = _ap_lines_for_invoice(supplier_invoice)
    return {
        "bill_id": supplier_invoice.invoice_number,
        "purchase_order_id": po_number,
        "po_number": po_number,
        "vendor_id": supplier_invoice.vendor_id,
        "supplier_invoice_id": supplier_invoice.id,
        "source_type": supplier_invoice.source_type,
        "source_order_id": supplier_invoice.source_order_id,
        "reference_po_number": tracking_po or po_number,
        "amount": invoice_total,
        "status": "Unpaid",
        "display_status": "Open",
        "approval_status": supplier_invoice.status or "DRAFT",
        "current_approval_step": None,
        "due_date": supplier_invoice.due_date,
        "created_at": supplier_invoice.created_at,
        "vendor_name": vendor.company_name if vendor else None,
        "vendor_email": vendor.contact_email if vendor else None,
        "vendor_invoice_number": supplier_invoice.vendor_invoice_number,
        "issue_date": supplier_invoice.invoice_date,
        "payment_date": None,
        "payment_terms": (
            getattr(supplier_invoice, "payment_terms", None)
            or (vendor.payment_terms if vendor else None)
        ),
        "currency": supplier_invoice.currency or (vendor.currency if vendor else None) or "USD",
        "subtotal": _money(supplier_invoice.subtotal),
        "tax_amount": _money(supplier_invoice.tax_amount),
        "freight_amount": _money(supplier_invoice.freight_amount),
        "total_amount": invoice_total,
        "outstanding_balance": _money(supplier_invoice.outstanding_balance or invoice_total),
        "supplier_invoice_number": supplier_invoice.invoice_number,
        "supplier_invoice_status": supplier_invoice.status,
        "invoice_type": getattr(supplier_invoice, "invoice_type", None) or "PO_MATCHED",
        "match_warnings": _match_warnings(supplier_invoice.match_warnings),
        "lines": lines,
        "payments": [],
    }


def serialize_ap_bill_detail(db: Session, bill: APBill) -> dict:
    vendor = db.get(Supplier, bill.vendor_id)
    supplier_invoice = _supplier_invoice_for_ap(db, bill)
    invoice_total = _money(bill.amount)
    lines: list[dict] = []
    subtotal = invoice_total
    tax_amount = Decimal("0.00")
    freight_amount = Decimal("0.00")
    issue_date = bill.created_at.date() if bill.created_at else None
    payment_terms = vendor.payment_terms if vendor else None
    currency = (vendor.currency if vendor else None) or "USD"
    source_type = bill.source_type
    source_order_id = bill.source_order_id or bill.purchase_order_id
    vendor_invoice_number = None

    if supplier_invoice:
        issue_date = supplier_invoice.invoice_date or issue_date
        currency = supplier_invoice.currency or currency
        subtotal = _money(supplier_invoice.subtotal)
        tax_amount = _money(supplier_invoice.tax_amount)
        freight_amount = _money(supplier_invoice.freight_amount)
        invoice_total = _money(supplier_invoice.total_amount or bill.amount)
        source_type = supplier_invoice.source_type or source_type
        source_order_id = supplier_invoice.source_order_id or source_order_id
        vendor_invoice_number = supplier_invoice.vendor_invoice_number
        lines = _ap_lines_for_invoice(supplier_invoice)

    po_number = resolve_ap_bill_po_number(db, bill) or (
        source_order_id if (source_type or "").upper() == "PURCHASE_ORDER" else None
    )
    order = None
    if po_number:
        order = (
            db.query(PurchaseOrder)
            .options(selectinload(PurchaseOrder.items))
            .filter(PurchaseOrder.po_number == po_number)
            .first()
        )
        if order and order.payment_terms:
            payment_terms = order.payment_terms
    if not lines and order and order.items:
        computed_subtotal = Decimal("0.00")
        computed_tax = Decimal("0.00")
        for po_line in order.items:
            qty = _qty(po_line.quantity)
            unit_price = _money(po_line.unit_price)
            line_subtotal = _money(po_line.line_subtotal) or (unit_price * qty)
            computed_tax += _money(po_line.line_tax)
            computed_subtotal += line_subtotal
            lines.append(
                {
                    "item_id": po_line.sku,
                    "description": po_line.description or po_line.sku,
                    "quantity": qty,
                    "unit_price": unit_price,
                    "line_subtotal": line_subtotal,
                }
            )
        if not supplier_invoice:
            subtotal = computed_subtotal
            tax_amount = computed_tax
            freight_amount = _money(order.shipping_fee)
            invoice_total = _money(bill.amount)

    ref_ids = {bill.bill_id}
    if supplier_invoice:
        ref_ids.add(supplier_invoice.invoice_number)
        if supplier_invoice.ap_bill_id:
            ref_ids.add(supplier_invoice.ap_bill_id)

    issues = (
        db.query(CashTransaction)
        .filter(
            CashTransaction.reference_id.in_(list(ref_ids)),
            CashTransaction.type == "Check Issue",
        )
        .order_by(CashTransaction.transaction_date.asc())
        .all()
    )

    remaining = invoice_total
    payments: list[dict] = []
    payment_date = None

    for txn in issues:
        amt = _money(txn.amount)
        applied = min(amt, remaining) if remaining > 0 else Decimal("0.00")
        remaining = _money(remaining - applied)
        if txn.transaction_date:
            payment_date = (
                txn.transaction_date.date()
                if hasattr(txn.transaction_date, "date")
                else txn.transaction_date
            )
        method = cash_type_label(
            txn_type=txn.type,
            payment_method=getattr(txn, "payment_method", None),
            instrument_ref_no=getattr(txn, "instrument_ref_no", None),
        )
        payments.append(
            {
                "payment_date": txn.transaction_date,
                "method": method,
                "reference": txn.transaction_id,
                "amount_applied": applied,
                "unapplied_balance": _money(amt - applied),
            }
        )

    return {
        "bill_id": bill.bill_id,
        "purchase_order_id": bill.purchase_order_id or po_number,
        "po_number": bill.purchase_order_id or po_number,
        "vendor_id": bill.vendor_id,
        "supplier_invoice_id": (
            supplier_invoice.id if supplier_invoice else bill.supplier_invoice_id
        ),
        "source_type": source_type,
        "source_order_id": source_order_id,
        "reference_po_number": (
            getattr(supplier_invoice, "reference_po_number", None)
            if supplier_invoice
            else getattr(bill, "reference_po_number", None)
        )
        or po_number,
        "amount": _money(bill.amount),
        "status": bill.status,
        "display_status": ap_display_status(status=bill.status, due_date=bill.due_date),
        "approval_status": bill.approval_status or "DRAFT",
        "current_approval_step": bill.current_approval_step,
        "due_date": bill.due_date,
        "created_at": bill.created_at,
        "vendor_name": vendor.company_name if vendor else None,
        "vendor_email": vendor.contact_email if vendor else None,
        "vendor_invoice_number": vendor_invoice_number,
        "issue_date": issue_date,
        "payment_date": payment_date,
        "payment_terms": payment_terms,
        "currency": currency,
        "subtotal": subtotal,
        "tax_amount": tax_amount,
        "freight_amount": freight_amount,
        "total_amount": invoice_total,
        "outstanding_balance": remaining,
        "supplier_invoice_number": supplier_invoice.invoice_number if supplier_invoice else None,
        "supplier_invoice_status": supplier_invoice.status if supplier_invoice else None,
        "invoice_type": (
            getattr(supplier_invoice, "invoice_type", None) if supplier_invoice else None
        ),
        "match_warnings": _match_warnings(
            supplier_invoice.match_warnings if supplier_invoice else None
        ),
        "lines": lines,
        "payments": payments,
    }

