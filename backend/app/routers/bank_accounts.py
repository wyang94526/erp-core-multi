from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BankAccount
from app.schemas import BankAccountCreate, BankAccountRead
from app.services import finance

router = APIRouter(prefix="/bank-accounts", tags=["bank-accounts"])


@router.get("", response_model=list[BankAccountRead])
def list_bank_accounts(active_only: bool = True, db: Session = Depends(get_db)):
    finance.ensure_default_bank_account(db)
    query = db.query(BankAccount)
    if active_only:
        query = query.filter(BankAccount.is_active.is_(True))
    rows = query.order_by(BankAccount.is_default.desc(), BankAccount.bank_name.asc()).all()
    db.commit()
    return [finance.serialize_bank_account(row) for row in rows]


@router.post("", response_model=BankAccountRead, status_code=status.HTTP_201_CREATED)
def create_bank_account(payload: BankAccountCreate, db: Session = Depends(get_db)):
    account = finance.create_bank_account(
        db,
        bank_name=payload.bank_name,
        account_name=payload.account_name,
        account_number=payload.account_number,
        routing_number=payload.routing_number,
        is_default=payload.is_default,
    )
    db.commit()
    db.refresh(account)
    return finance.serialize_bank_account(account)
