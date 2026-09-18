# @author: Wendy Yang
# @date: 2026-09-19

from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps.auth import require_permission
from app.models import ChartOfAccount, JournalEntry, LedgerPosting, User
from app.schemas import (
    JournalEntryCreate,
    JournalEntryRead,
    JournalEntryUpdate,
    MonthEndClosePreview,
)
from app.services.accounting import (
    normalize_journal_period,
    resolve_posting_date,
    validate_journal_balance,
    validate_posting_rows,
)

router = APIRouter(prefix="/journal-entries", tags=["journal-entries"])


_POSTING_LOAD = selectinload(JournalEntry.postings).selectinload(LedgerPosting.account)
_EDITABLE_APPROVAL = {"DRAFT", "REJECTED"}


def _load_entry(db: Session, entry_id: UUID) -> JournalEntry | None:
    return (
        db.query(JournalEntry)
        .options(_POSTING_LOAD)
        .filter(JournalEntry.id == entry_id)
        .first()
    )


def _validated_posting_rows(db: Session, lines) -> list[dict]:
    posting_rows: list[dict] = []
    for line in lines:
        row = line.model_dump()
        if db.get(ChartOfAccount, row["account_id"]) is None:
            raise HTTPException(status_code=400, detail=f"Account {row['account_id']} not found")
        if row.get("description") is not None:
            row["description"] = str(row["description"]).strip() or None
        posting_rows.append(row)
    validate_posting_rows(posting_rows)
    return posting_rows


def _apply_header(
    entry: JournalEntry,
    *,
    description: str | None = None,
    posting_date: date | None = None,
    period: str | None = None,
    reference: str | None = None,
    posted_by_user_id: UUID | None = None,
) -> None:
    if description is not None:
        entry.description = description.strip()
    if posting_date is not None or entry.posting_date is None:
        resolved_date = resolve_posting_date(posting_date or entry.posting_date)
        entry.posting_date = resolved_date
    else:
        resolved_date = entry.posting_date
    if period is not None or not entry.period:
        entry.period = normalize_journal_period(period, resolved_date)
    if reference is not None:
        cleaned = reference.strip()
        entry.reference = cleaned or None
    if posted_by_user_id is not None:
        entry.posted_by_user_id = posted_by_user_id


@router.get("", response_model=list[JournalEntryRead])
def list_journal_entries(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:view")),
) -> list[JournalEntry]:
    return (
        db.query(JournalEntry)
        .options(_POSTING_LOAD)
        .order_by(JournalEntry.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/month-end-close", response_model=MonthEndClosePreview)
def preview_month_end_close(
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:view")),
) -> dict:
    drafts = (
        db.query(JournalEntry)
        .options(_POSTING_LOAD)
        .filter(JournalEntry.posting_status == "Draft")
        .order_by(JournalEntry.created_at.desc())
        .all()
    )
    ready = [entry for entry in drafts if (entry.approval_status or "").upper() == "APPROVED"]
    held = [entry for entry in drafts if (entry.approval_status or "").upper() != "APPROVED"]
    return {
        "period": datetime.utcnow().strftime("%Y-%m"),
        "ready": ready,
        "held": held,
    }


@router.post("/month-end-close")
def run_month_end_close(
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:approve")),
) -> dict:
    """
    Batch-posting operation for the Month-End Close process.

    Finds approved Journal Entries still sitting in 'Draft' posting_status
    and flips them to 'Posted'. Unapproved drafts are left for the approval
    workflow. This MUST be declared before the "/{entry_id}" routes below.
    """
    draft_entries = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.posting_status == "Draft",
            JournalEntry.approval_status == "APPROVED",
        )
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
def create_journal_entry(
    payload: JournalEntryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("journal:create")),
) -> JournalEntry:
    posting_rows = _validated_posting_rows(db, payload.postings)
    posting_date = resolve_posting_date(payload.posting_date)
    period = normalize_journal_period(payload.period, posting_date)
    reference = (payload.reference or "").strip() or None

    entry = JournalEntry(
        description=payload.description.strip(),
        posted_by_user_id=user.id,
        posting_date=posting_date,
        period=period,
        reference=reference,
        posting_status="Draft",
        approval_status="DRAFT",
        current_approval_step=None,
    )
    for row in posting_rows:
        entry.postings.append(LedgerPosting(**row))

    db.add(entry)
    db.commit()
    created = _load_entry(db, entry.id)
    return created or entry


@router.get("/{entry_id}", response_model=JournalEntryRead)
def get_journal_entry(
    entry_id: UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:view")),
) -> JournalEntry:
    entry = _load_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return entry


@router.patch("/{entry_id}", response_model=JournalEntryRead)
def update_journal_entry(
    entry_id: UUID,
    payload: JournalEntryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("journal:create")),
) -> JournalEntry:
    entry = _load_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")

    approval = (entry.approval_status or "DRAFT").upper()
    posting = (entry.posting_status or "").lower()
    if posting == "posted" or approval not in _EDITABLE_APPROVAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot edit a journal entry with approval status {approval}",
        )

    data = payload.model_dump(exclude_unset=True)
    _apply_header(
        entry,
        description=data.get("description"),
        posting_date=data.get("posting_date"),
        period=data.get("period") if "period" in data else None,
        reference=data["reference"] if "reference" in data else None,
        posted_by_user_id=user.id,
    )

    if "postings" in data:
        posting_rows = _validated_posting_rows(db, payload.postings or [])
        for posting in list(entry.postings):
            db.delete(posting)
        db.flush()
        for row in posting_rows:
            entry.postings.append(LedgerPosting(entry_id=entry.id, **row))
        validate_journal_balance(entry.postings)

    db.commit()
    updated = _load_entry(db, entry.id)
    return updated or entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_journal_entry(
    entry_id: UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:create")),
) -> None:
    entry = _load_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")

    approval = (entry.approval_status or "DRAFT").upper()
    if approval not in _EDITABLE_APPROVAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete a journal entry with approval status {approval}",
        )

    for posting in list(entry.postings):
        db.delete(posting)
    db.delete(entry)
    db.commit()
