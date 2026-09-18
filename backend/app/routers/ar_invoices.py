# @author: Wendy Yang
# @date: 2026-09-19

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ARInvoice
from app.schemas import ARInvoiceDetailRead, ARInvoiceRead, CashTransactionRead, PaymentRequest
from app.services import finance

router = APIRouter(prefix="/ar-invoices", tags=["ar-invoices"])


@router.get("", response_model=list[ARInvoiceRead])
def list_ar_invoices(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[ARInvoice]:
    return (
        db.query(ARInvoice)
        .order_by(ARInvoice.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/{invoice_id}", response_model=ARInvoiceRead)
def get_ar_invoice(invoice_id: str, db: Session = Depends(get_db)) -> ARInvoice:
    invoice = db.get(ARInvoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="AR Invoice not found")
    return invoice


@router.get("/{invoice_id}/detail", response_model=ARInvoiceDetailRead)
def get_ar_invoice_detail(invoice_id: str, db: Session = Depends(get_db)):
    return finance.get_invoice_detail(db, invoice_id)


@router.post("/{invoice_id}/credit-memo", response_model=ARInvoiceDetailRead)
def create_ar_credit_memo(invoice_id: str, db: Session = Depends(get_db)):
    invoice = db.get(ARInvoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="AR Invoice not found")
    result = finance.create_ar_credit_memo(db, invoice)
    db.commit()
    return result


@router.post("/{invoice_id}/pay", response_model=CashTransactionRead, status_code=status.HTTP_201_CREATED)
def pay_ar_invoice(
    invoice_id: str, payload: PaymentRequest | None = None, db: Session = Depends(get_db)
):
    """
    Record receipt of payment against an AR Invoice.

    Marks the invoice Paid (or Partial), creates a Cash Transaction
    (Check Deposit), and posts a balanced Journal Entry
    (Debit: Cash, Credit: Accounts Receivable).
    """
    invoice = db.get(ARInvoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="AR Invoice not found")

    amount = payload.amount if payload else None
    bank_account_id = payload.bank_account_id if payload else None
    payment_method = payload.payment_method if payload else None
    instrument_ref_no = payload.instrument_ref_no if payload else None
    payment_date = payload.payment_date if payload else None

    transaction = finance.receive_payment(
        db,
        invoice,
        amount=amount,
        bank_account_id=bank_account_id,
        payment_method=payment_method,
        instrument_ref_no=instrument_ref_no,
        payment_date=payment_date,
    )
    db.commit()
    db.refresh(transaction)
    return finance.serialize_cash_transaction(db, transaction)
