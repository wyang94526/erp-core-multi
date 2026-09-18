# @author: Wendy Yang
# @date: 2026-09-19

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import BankAccount
from app.schemas import BankAccountCreate, BankAccountRead, BankAccountUpdate
from app.services import finance

router = APIRouter(prefix="/bank-accounts", tags=["bank-accounts"])


def _bank_query(db: Session):
    return db.query(BankAccount).options(joinedload(BankAccount.gl_account))


@router.get("", response_model=list[BankAccountRead])
def list_bank_accounts(active_only: bool = True, db: Session = Depends(get_db)):
    finance.ensure_default_bank_account(db)
    query = _bank_query(db)
    if active_only:
        query = query.filter(BankAccount.is_active.is_(True))
    rows = query.order_by(BankAccount.is_default.desc(), BankAccount.bank_name.asc()).all()
    db.commit()
    return [finance.serialize_bank_account(row) for row in rows]


@router.get("/{bank_account_id}", response_model=BankAccountRead)
def get_bank_account(bank_account_id: str, db: Session = Depends(get_db)):
    account = _bank_query(db).filter(BankAccount.bank_account_id == bank_account_id).one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Bank account not found")
    return finance.serialize_bank_account(account)


@router.post("", response_model=BankAccountRead, status_code=status.HTTP_201_CREATED)
def create_bank_account(payload: BankAccountCreate, db: Session = Depends(get_db)):
    account = finance.create_bank_account(
        db,
        bank_name=payload.bank_name,
        account_name=payload.account_name,
        account_number=payload.account_number,
        routing_number=payload.routing_number,
        account_type=payload.account_type,
        currency=payload.currency,
        gl_account_id=payload.gl_account_id,
        is_default=payload.is_default,
        is_active=payload.is_active,
    )
    db.commit()
    account = _bank_query(db).filter(BankAccount.bank_account_id == account.bank_account_id).one()
    return finance.serialize_bank_account(account)


@router.patch("/{bank_account_id}", response_model=BankAccountRead)
def update_bank_account(
    bank_account_id: str,
    payload: BankAccountUpdate,
    db: Session = Depends(get_db),
):
    finance.update_bank_account(db, bank_account_id, payload.model_dump(exclude_unset=True))
    db.commit()
    account = _bank_query(db).filter(BankAccount.bank_account_id == bank_account_id).one()
    return finance.serialize_bank_account(account)
