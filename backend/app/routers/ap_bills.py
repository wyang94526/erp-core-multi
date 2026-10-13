# @author: Wendy Yang
# @date: 2026-09-19

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import get_current_user
from app.models import APBill, User
from app.schemas import APBillDetailRead, APBillRead, CashTransactionRead, PaymentRequest
from app.services import finance

router = APIRouter(prefix="/ap-bills", tags=["ap-bills"])


@router.get("", response_model=list[APBillRead])
def list_ap_bills(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[dict]:
    return finance.list_ap_bills(db, skip=skip, limit=limit)


@router.get("/{bill_id}", response_model=APBillRead)
def get_ap_bill(bill_id: str, db: Session = Depends(get_db)) -> dict:
    bill = db.get(APBill, bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="AP Bill not found")
    return finance.serialize_ap_bill_row(db, bill)


@router.get("/{bill_id}/detail", response_model=APBillDetailRead)
def get_ap_bill_detail(bill_id: str, db: Session = Depends(get_db)):
    return finance.get_bill_detail(db, bill_id)


@router.post("/{bill_id}/pay", response_model=CashTransactionRead, status_code=status.HTTP_201_CREATED)
def pay_ap_bill(
    bill_id: str,
    payload: PaymentRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Record an outgoing payment against an AP Bill.

    Marks the bill Paid (or Partial), creates a Cash Transaction
    (Check Issue), and posts a balanced Journal Entry
    (Debit: Accounts Payable, Credit: Cash).
    """
    bill = db.get(APBill, bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="AP Bill not found")

    amount = payload.amount if payload else None
    bank_account_id = payload.bank_account_id if payload else None
    payment_method = payload.payment_method if payload else None
    instrument_ref_no = payload.instrument_ref_no if payload else None
    payment_date = payload.payment_date if payload else None

    transaction = finance.make_payment(
        db,
        bill,
        amount=amount,
        bank_account_id=bank_account_id,
        payment_method=payment_method,
        instrument_ref_no=instrument_ref_no,
        payment_date=payment_date,
        user_id=user.id,
    )
    db.commit()
    db.refresh(transaction)
    return finance.serialize_cash_transaction(db, transaction)
