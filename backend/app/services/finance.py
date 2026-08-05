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

from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    APBill,
    ARInvoice,
    CashTransaction,
    ChartOfAccount,
    JournalEntry,
    LedgerPosting,
    PurchaseOrder,
    SalesOrder,
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


def receive_payment(
    db: Session,
    invoice: ARInvoice,
    amount: Decimal | None = None,
    bank_account_id: str | None = None,
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
        bank_account_id=bank_account_id,
        approval_status="APPROVED",
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
        bank_account_id=bank_account_id,
        approval_status="APPROVED",
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
