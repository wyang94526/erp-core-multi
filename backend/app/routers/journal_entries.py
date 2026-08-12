from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import ChartOfAccount, JournalEntry, LedgerPosting, User
from app.schemas import JournalEntryCreate, JournalEntryRead, JournalEntryUpdate
from app.services.accounting import validate_journal_balance, validate_posting_rows

router = APIRouter(prefix="/journal-entries", tags=["journal-entries"])


_POSTING_LOAD = selectinload(JournalEntry.postings).selectinload(LedgerPosting.account)


def _load_entry(db: Session, entry_id: UUID) -> JournalEntry | None:
    return (
        db.query(JournalEntry)
        .options(_POSTING_LOAD)
        .filter(JournalEntry.id == entry_id)
        .first()
    )


@router.get("", response_model=list[JournalEntryRead])
def list_journal_entries(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[JournalEntry]:
    return (
        db.query(JournalEntry)
        .options(_POSTING_LOAD)
        .order_by(JournalEntry.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.post("/month-end-close")
def run_month_end_close(db: Session = Depends(get_db)) -> dict:
    """
    Batch-posting operation for the Month-End Close process.

    Finds all Journal Entries currently sitting in 'Draft' posting_status
    (across all periods) and flips them to 'Posted'. Returns the count of
    entries that were posted and the list of their IDs.

    Note: this MUST be declared before the "/{entry_id}" routes below,
    otherwise FastAPI will try to parse "month-end-close" as a UUID path
    parameter and return a 422 error.
    """
    draft_entries = (
        db.query(JournalEntry)
        .filter(JournalEntry.posting_status == "Draft")
        .all()
    )

    posted_ids: list[str] = []
    for entry in draft_entries:
        entry.posting_status = "Posted"
        posted_ids.append(str(entry.id))

    db.commit()

    return {
        "message": "Month-End Close process completed.",
        "entries_posted": len(posted_ids),
        "journal_entry_ids": posted_ids,
    }


@router.post("", response_model=JournalEntryRead, status_code=status.HTTP_201_CREATED)
def create_journal_entry(payload: JournalEntryCreate, db: Session = Depends(get_db)) -> JournalEntry:
    if payload.posted_by_user_id is not None and db.get(User, payload.posted_by_user_id) is None:
        raise HTTPException(status_code=400, detail="posted_by_user_id not found")

    posting_rows: list[dict] = []
    for line in payload.postings:
        row = line.model_dump()
        if db.get(ChartOfAccount, row["account_id"]) is None:
            raise HTTPException(status_code=400, detail=f"Account {row['account_id']} not found")
        posting_rows.append(row)

    total_debit, total_credit = validate_posting_rows(posting_rows)
    if total_debit != total_credit:
        raise HTTPException(
            status_code=400,
            detail=f"Journal entry is not balanced: debits={total_debit}, credits={total_credit}",
        )

    entry = JournalEntry(
        description=payload.description,
        posted_by_user_id=payload.posted_by_user_id,
    )
    for row in posting_rows:
        entry.postings.append(LedgerPosting(**row))

    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{entry_id}", response_model=JournalEntryRead)
def get_journal_entry(entry_id: UUID, db: Session = Depends(get_db)) -> JournalEntry:
    entry = _load_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return entry


@router.patch("/{entry_id}", response_model=JournalEntryRead)
def update_journal_entry(
    entry_id: UUID, payload: JournalEntryUpdate, db: Session = Depends(get_db)
) -> JournalEntry:
    entry = _load_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")

    data = payload.model_dump(exclude_unset=True)
    if "posted_by_user_id" in data and data["posted_by_user_id"] is not None:
        if db.get(User, data["posted_by_user_id"]) is None:
            raise HTTPException(status_code=400, detail="posted_by_user_id not found")

    if "postings" in data:
        posting_rows: list[dict] = []
        for line in payload.postings or []:
            row = line.model_dump()
            if db.get(ChartOfAccount, row["account_id"]) is None:
                raise HTTPException(status_code=400, detail=f"Account {row['account_id']} not found")
            posting_rows.append(row)

        total_debit, total_credit = validate_posting_rows(posting_rows)
        if total_debit != total_credit:
            raise HTTPException(
                status_code=400,
                detail=f"Journal entry is not balanced: debits={total_debit}, credits={total_credit}",
            )

        entry.postings.clear()
        db.flush()
        for row in posting_rows:
            entry.postings.append(LedgerPosting(entry_id=entry.id, **row))
        validate_journal_balance(entry.postings)

    if "description" in data:
        entry.description = data["description"]
    if "posted_by_user_id" in data:
        entry.posted_by_user_id = data["posted_by_user_id"]

    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_journal_entry(entry_id: UUID, db: Session = Depends(get_db)) -> None:
    entry = _load_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")

    for posting in list(entry.postings):
        db.delete(posting)
    db.delete(entry)
    db.commit()
