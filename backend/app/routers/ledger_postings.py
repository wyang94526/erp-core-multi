# @author: Wendy Yang
# @date: 2026-09-19

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import LedgerPosting
from app.schemas import LedgerPostingCreate, LedgerPostingRead, LedgerPostingUpdate
from app.services.accounting import (
    ensure_account_exists,
    ensure_journal_entry_exists,
    validate_journal_balance,
    validate_posting_amounts,
)

router = APIRouter(prefix="/ledger-postings", tags=["ledger-postings"])


def _reload_entry_postings(db: Session, entry_id: UUID) -> list[LedgerPosting]:
    return db.query(LedgerPosting).filter(LedgerPosting.entry_id == entry_id).all()


@router.get("", response_model=list[LedgerPostingRead])
def list_ledger_postings(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[LedgerPosting]:
    return (
        db.query(LedgerPosting)
        .options(joinedload(LedgerPosting.account))
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.post("", response_model=LedgerPostingRead, status_code=status.HTTP_201_CREATED)
def create_ledger_posting(payload: LedgerPostingCreate, db: Session = Depends(get_db)) -> LedgerPosting:
    ensure_journal_entry_exists(db, payload.entry_id)
    ensure_account_exists(db, payload.account_id)
    validate_posting_amounts(payload.debit, payload.credit)

    posting = LedgerPosting(**payload.model_dump())
    db.add(posting)
    db.flush()

    postings = _reload_entry_postings(db, payload.entry_id)
    if len(postings) >= 2:
        validate_journal_balance(postings)

    db.commit()
    db.refresh(posting)
    return posting


@router.get("/{posting_id}", response_model=LedgerPostingRead)
def get_ledger_posting(posting_id: UUID, db: Session = Depends(get_db)) -> LedgerPosting:
    posting = (
        db.query(LedgerPosting)
        .options(joinedload(LedgerPosting.account))
        .filter(LedgerPosting.id == posting_id)
        .first()
    )
    if not posting:
        raise HTTPException(status_code=404, detail="Ledger posting not found")
    return posting


@router.patch("/{posting_id}", response_model=LedgerPostingRead)
def update_ledger_posting(
    posting_id: UUID, payload: LedgerPostingUpdate, db: Session = Depends(get_db)
) -> LedgerPosting:
    posting = db.get(LedgerPosting, posting_id)
    if not posting:
        raise HTTPException(status_code=404, detail="Ledger posting not found")

    data = payload.model_dump(exclude_unset=True)
    if "entry_id" in data:
        ensure_journal_entry_exists(db, data["entry_id"])
    if "account_id" in data:
        ensure_account_exists(db, data["account_id"])

    for key, value in data.items():
        setattr(posting, key, value)

    validate_posting_amounts(posting.debit, posting.credit)
    db.flush()

    postings = _reload_entry_postings(db, posting.entry_id)
    if len(postings) >= 2:
        validate_journal_balance(postings)
    elif len(postings) == 1:
        raise HTTPException(
            status_code=400,
            detail="Journal entry must have at least two balanced postings",
        )

    db.commit()
    db.refresh(posting)
    return posting


@router.delete("/{posting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ledger_posting(posting_id: UUID, db: Session = Depends(get_db)) -> None:
    posting = db.get(LedgerPosting, posting_id)
    if not posting:
        raise HTTPException(status_code=404, detail="Ledger posting not found")

    entry_id = posting.entry_id
    db.delete(posting)
    db.flush()

    postings = _reload_entry_postings(db, entry_id)
    if len(postings) >= 2:
        validate_journal_balance(postings)
    elif len(postings) == 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot leave a journal entry with a single posting; delete the entry or add lines",
        )

    db.commit()
