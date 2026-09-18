# @author: Wendy Yang
# @date: 2026-09-19

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import CashTransaction
from app.schemas import CashTransactionRead, NextInstrumentRead
from app.services import finance

router = APIRouter(prefix="/cash-transactions", tags=["cash-transactions"])


@router.get("", response_model=list[CashTransactionRead])
def list_cash_transactions(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
):
    rows = (
        db.query(CashTransaction)
        .options(selectinload(CashTransaction.bank_account))
        .order_by(CashTransaction.transaction_date.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [finance.serialize_cash_transaction(db, row) for row in rows]


@router.get("/next-instrument", response_model=NextInstrumentRead)
def get_next_instrument(payment_method: str = "CHECK", db: Session = Depends(get_db)):
    method = (payment_method or "CHECK").upper()
    if method not in finance.CASH_PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Unsupported payment method")
    return {
        "payment_method": method,
        "instrument_ref_no": finance.next_instrument_ref(db, method),
    }


@router.get("/{transaction_id}", response_model=CashTransactionRead)
def get_cash_transaction(transaction_id: str, db: Session = Depends(get_db)):
    transaction = db.get(CashTransaction, transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Cash transaction not found")
    return finance.serialize_cash_transaction(db, transaction)


@router.get("/{transaction_id}/detail", response_model=CashTransactionRead)
def get_cash_transaction_detail(transaction_id: str, db: Session = Depends(get_db)):
    transaction = db.get(CashTransaction, transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Cash transaction not found")
    return finance.serialize_cash_transaction(db, transaction)
