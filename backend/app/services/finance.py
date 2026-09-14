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
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.models import (
    APBill,
    ARInvoice,
    BankAccount,
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
)

# ------------------------------------------------------------------
# Standard Chart of Accounts codes used by the finance automation.
# These are auto-created on first use if they don't already exist,
# since the seed data does not currently populate a chart of accounts.
# ------------------------------------------------------------------
CASH_ACCOUNT_CODE = "1000"
CASH_ACCOUNT_NAME = "Cash"

AR_ACCOUNT_CODE = "1100"
AR_ACCOUNT_NAME = "Accounts Receivable"

AP_ACCOUNT_CODE = "2000"
AP_ACCOUNT_NAME = "Accounts Payable"

REVENUE_ACCOUNT_CODE = "4000"
REVENUE_ACCOUNT_NAME = "Sales Revenue"

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


def _parse_payment_terms_days(payment_terms: str | None) -> int:
    """Best-effort parse of a 'Net 30' style string into an integer day count."""
    if not payment_terms:
        return _DEFAULT_PAYMENT_TERM_DAYS
    digits = "".join(ch for ch in payment_terms if ch.isdigit())
    if digits:
        try:
            return int(digits)
        except ValueError:
            pass
    return _DEFAULT_PAYMENT_TERM_DAYS


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

    term_days = _parse_payment_terms_days(order.payment_terms)
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

    term_days = _parse_payment_terms_days(po.payment_terms)
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
    )
    db.add(bill)
    db.flush()
    return bill


# ==================================================================
# Cash Management + GL Postings
# ==================================================================

def _post_balanced_journal_entry(
    db: Session,
    description: str,
    debit_account: ChartOfAccount,
    credit_account: ChartOfAccount,
    amount: Decimal,
) -> JournalEntry:
    period = datetime.utcnow().strftime("%Y-%m")
    entry = JournalEntry(
        description=description,
        period=period,
        posting_status="Posted",
        approval_status="APPROVED",
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


def serialize_bank_account(account: BankAccount) -> dict:
    return {
        "bank_account_id": account.bank_account_id,
        "bank_name": account.bank_name,
        "account_name": account.account_name,
        "account_number": account.account_number,
        "account_number_masked": mask_account_number(account.account_number),
        "routing_number": account.routing_number,
        "display_name": bank_account_display(account),
        "is_default": bool(account.is_default),
        "is_active": bool(account.is_active),
    }


def _bank_account_id_from_name(account_name: str) -> str:
    slug = "".join(ch if ch.isalnum() else "-" for ch in (account_name or "BANK").upper())
    slug = "-".join(part for part in slug.split("-") if part) or "BANK"
    return f"BANK-{slug}"[:50]


def create_bank_account(
    db: Session,
    *,
    bank_name: str,
    account_name: str,
    account_number: str,
    routing_number: str | None = None,
    is_default: bool = False,
) -> BankAccount:
    account_id = _bank_account_id_from_name(account_name)
    if db.get(BankAccount, account_id):
        account_id = f"{account_id[:40]}-{uuid4().hex[:6].upper()}"
    routing = (routing_number or "").strip() or None
    if routing and (not routing.isdigit() or len(routing) != 9):
        raise HTTPException(status_code=400, detail="Routing number must be 9 digits")
    if is_default:
        db.query(BankAccount).filter(BankAccount.is_default.is_(True)).update({"is_default": False})
    account = BankAccount(
        bank_account_id=account_id,
        bank_name=bank_name.strip(),
        account_name=account_name.strip(),
        account_number=account_number.strip(),
        routing_number=routing,
        is_default=is_default,
        is_active=True,
    )
    db.add(account)
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
    account = BankAccount(
        bank_account_id=DEFAULT_BANK_ACCOUNT_ID,
        bank_name="Amerant Bank",
        account_name="Operating",
        account_number="0000008420",
        routing_number="067000123",
        is_default=True,
        is_active=True,
    )
    db.add(account)
    db.flush()
    return account


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

    pay_amount = amount if amount is not None else invoice.amount

    cash_account = get_or_create_account(db, CASH_ACCOUNT_CODE, CASH_ACCOUNT_NAME, "Asset")
    ar_account = get_or_create_account(db, AR_ACCOUNT_CODE, AR_ACCOUNT_NAME, "Asset")

    if getattr(invoice, "approval_status", None) not in (None, "APPROVED"):
        raise HTTPException(
            status_code=400,
            detail=f"AR invoice must be APPROVED before payment (current: {invoice.approval_status})",
        )

    transaction = CashTransaction(
        transaction_id=f"CASH-{uuid4().hex[:10].upper()}",
        type="Check Deposit",
        reference_id=invoice.invoice_id,
        amount=pay_amount,
        approval_status="APPROVED",
        **_transaction_date_kwargs(payment_date),
        **_cash_ledger_fields(
            db,
            txn_type="Check Deposit",
            reference_id=invoice.invoice_id,
            bank_account_id=bank_account_id,
            payment_method=payment_method,
            instrument_ref_no=instrument_ref_no,
        ),
    )
    db.add(transaction)

    _post_balanced_journal_entry(
        db,
        description=f"AR payment received for invoice {invoice.invoice_id}",
        debit_account=cash_account,
        credit_account=ar_account,
        amount=pay_amount,
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

    cash_account = get_or_create_account(db, CASH_ACCOUNT_CODE, CASH_ACCOUNT_NAME, "Asset")
    ap_account = get_or_create_account(db, AP_ACCOUNT_CODE, AP_ACCOUNT_NAME, "Liability")

    transaction = CashTransaction(
        transaction_id=f"CASH-{uuid4().hex[:10].upper()}",
        type="Check Issue",
        reference_id=bill.bill_id,
        amount=pay_amount,
        approval_status="APPROVED",
        **_transaction_date_kwargs(payment_date),
        **_cash_ledger_fields(
            db,
            txn_type="Check Issue",
            reference_id=bill.bill_id,
            bank_account_id=bank_account_id,
            payment_method=payment_method,
            instrument_ref_no=instrument_ref_no,
        ),
    )
    db.add(transaction)

    _post_balanced_journal_entry(
        db,
        description=f"AP payment made for bill {bill.bill_id}",
        debit_account=ap_account,
        credit_account=cash_account,
        amount=pay_amount,
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

    revenue = get_or_create_account(db, REVENUE_ACCOUNT_CODE, REVENUE_ACCOUNT_NAME, "Revenue")
    ar_account = get_or_create_account(db, AR_ACCOUNT_CODE, AR_ACCOUNT_NAME, "Asset")
    _post_balanced_journal_entry(
        db,
        description=f"Credit memo {invoice.invoice_id}",
        debit_account=revenue,
        credit_account=ar_account,
        amount=credit_amount,
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
        .options(selectinload(SupplierInvoice.lines))
        .filter(or_(*filters))
        .order_by(SupplierInvoice.id.desc())
        .first()
    )


def _lookup_supplier_invoice(db: Session, bill_id: str) -> SupplierInvoice | None:
    return (
        db.query(SupplierInvoice)
        .options(selectinload(SupplierInvoice.lines))
        .filter(
            (SupplierInvoice.invoice_number == bill_id) | (SupplierInvoice.ap_bill_id == bill_id)
        )
        .order_by(SupplierInvoice.id.desc())
        .first()
    )


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


def _ap_line_from_supplier(line) -> dict:
    return {
        "item_id": line.item_id,
        "description": line.description or line.item_id,
        "quantity": _qty(line.quantity_billed),
        "unit_price": _money(line.unit_price),
        "line_subtotal": _money(line.line_subtotal),
    }


def serialize_supplier_invoice_detail(db: Session, supplier_invoice: SupplierInvoice) -> dict:
    """Draft / unposted supplier invoice with the same shape as AP bill detail."""
    vendor = db.get(Supplier, supplier_invoice.vendor_id)
    invoice_total = _money(supplier_invoice.total_amount)
    po_number = (
        supplier_invoice.source_order_id
        if supplier_invoice.source_type == "PURCHASE_ORDER"
        else None
    )
    lines = [_ap_line_from_supplier(line) for line in (supplier_invoice.lines or [])]
    return {
        "bill_id": supplier_invoice.invoice_number,
        "purchase_order_id": po_number,
        "vendor_id": supplier_invoice.vendor_id,
        "supplier_invoice_id": supplier_invoice.id,
        "source_type": supplier_invoice.source_type,
        "source_order_id": supplier_invoice.source_order_id,
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
        "payment_terms": vendor.payment_terms if vendor else None,
        "currency": supplier_invoice.currency or (vendor.currency if vendor else None) or "USD",
        "subtotal": _money(supplier_invoice.subtotal),
        "tax_amount": _money(supplier_invoice.tax_amount),
        "freight_amount": _money(supplier_invoice.freight_amount),
        "total_amount": invoice_total,
        "outstanding_balance": _money(supplier_invoice.outstanding_balance or invoice_total),
        "supplier_invoice_number": supplier_invoice.invoice_number,
        "supplier_invoice_status": supplier_invoice.status,
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
        lines = [_ap_line_from_supplier(line) for line in (supplier_invoice.lines or [])]

    po_number = bill.purchase_order_id
    if not po_number and source_type == "PURCHASE_ORDER":
        po_number = source_order_id
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
        "vendor_id": bill.vendor_id,
        "supplier_invoice_id": (
            supplier_invoice.id if supplier_invoice else bill.supplier_invoice_id
        ),
        "source_type": source_type,
        "source_order_id": source_order_id,
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
        "match_warnings": _match_warnings(
            supplier_invoice.match_warnings if supplier_invoice else None
        ),
        "lines": lines,
        "payments": payments,
    }

