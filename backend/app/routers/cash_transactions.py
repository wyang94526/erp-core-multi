from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CashTransaction
from app.schemas import CashTransactionRead

router = APIRouter(prefix="/cash-transactions", tags=["cash-transactions"])


@router.get("", response_model=list[CashTransactionRead])
def list_cash_transactions(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[CashTransaction]:
    return (
        db.query(CashTransaction)
        .order_by(CashTransaction.transaction_date.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/{transaction_id}", response_model=CashTransactionRead)
def get_cash_transaction(transaction_id: str, db: Session = Depends(get_db)) -> CashTransaction:
    transaction = db.get(CashTransaction, transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Cash transaction not found")
    return transaction
