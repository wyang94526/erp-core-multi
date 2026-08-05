from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import APBill
from app.schemas import APBillRead, CashTransactionRead, PaymentRequest
from app.services import finance

router = APIRouter(prefix="/ap-bills", tags=["ap-bills"])


@router.get("", response_model=list[APBillRead])
def list_ap_bills(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[APBill]:
    return (
        db.query(APBill)
        .order_by(APBill.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/{bill_id}", response_model=APBillRead)
def get_ap_bill(bill_id: str, db: Session = Depends(get_db)) -> APBill:
    bill = db.get(APBill, bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="AP Bill not found")
    return bill


@router.post("/{bill_id}/pay", response_model=CashTransactionRead, status_code=status.HTTP_201_CREATED)
def pay_ap_bill(
    bill_id: str, payload: PaymentRequest | None = None, db: Session = Depends(get_db)
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

    transaction = finance.make_payment(
        db, bill, amount=amount, bank_account_id=bank_account_id
    )
    db.commit()
    db.refresh(transaction)
    return transaction
