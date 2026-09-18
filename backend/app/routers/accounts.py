from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BankAccount, ChartOfAccount, LedgerPosting, PostingRule, SupplierInvoiceDistribution
from app.schemas import ChartOfAccountCreate, ChartOfAccountRead, ChartOfAccountUpdate

router = APIRouter(prefix="/accounts", tags=["chart-of-accounts"])


@router.get("", response_model=list[ChartOfAccountRead])
def list_accounts(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[ChartOfAccount]:
    return db.query(ChartOfAccount).offset(skip).limit(limit).all()


@router.post("", response_model=ChartOfAccountRead, status_code=status.HTTP_201_CREATED)
def create_account(payload: ChartOfAccountCreate, db: Session = Depends(get_db)) -> ChartOfAccount:
    account = ChartOfAccount(**payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.get("/{account_id}", response_model=ChartOfAccountRead)
def get_account(account_id: UUID, db: Session = Depends(get_db)) -> ChartOfAccount:
    account = db.get(ChartOfAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.patch("/{account_id}", response_model=ChartOfAccountRead)
def update_account(
    account_id: UUID, payload: ChartOfAccountUpdate, db: Session = Depends(get_db)
) -> ChartOfAccount:
    account = db.get(ChartOfAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, key, value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: UUID, db: Session = Depends(get_db)) -> None:
    account = db.get(ChartOfAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if db.query(LedgerPosting.id).filter(LedgerPosting.account_id == account_id).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an account that has journal postings. Remap those transactions first.",
        )
    if db.query(BankAccount.bank_account_id).filter(BankAccount.gl_account_id == account_id).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an account mapped to a bank account.",
        )
    if (
        db.query(PostingRule.id)
        .filter(
            (PostingRule.debit_account_id == account_id)
            | (PostingRule.credit_account_id == account_id)
        )
        .first()
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an account used by a posting rule. Remap the rule first.",
        )
    if (
        db.query(SupplierInvoiceDistribution.id)
        .filter(SupplierInvoiceDistribution.gl_account_id == account_id)
        .first()
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an account used on a supplier invoice distribution.",
        )
    db.delete(account)
    db.commit()
