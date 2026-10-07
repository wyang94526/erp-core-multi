# @author: Wendy Yang
# @date: 2026-09-19

from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps.auth import require_permission
from app.models import ChartOfAccount, JournalEntry, LedgerPosting, User
from app.schemas import (
    JournalBulkImportRequest,
    JournalBulkImportResponse,
    JournalEntryCreate,
    JournalEntryRead,
    JournalEntryUpdate,
    MonthEndClosePreview,
    MonthEndCloseRequest,
    MonthEndCloseResult,
    YearEndClosePreview,
    YearEndCloseRequest,
    YearEndCloseResult,
)
from app.services.accounting import (
    normalize_journal_period,
    resolve_posting_date,
    validate_journal_balance,
    validate_posting_rows,
)
from app.services import month_end_close, year_end_close
from app.services.document_sequences import DOC_JOURNAL, generate_document_number
from app.services.journal_list import apply_journal_list_filters
from app.services.journal_source import assert_journal_editable, assert_journal_mutable
from app.services.period_close import KIND_ADJUSTMENT, assert_transaction_date_open

router = APIRouter(prefix="/journal-entries", tags=["journal-entries"])


_POSTING_LOAD = (
    selectinload(JournalEntry.postings).selectinload(LedgerPosting.account),
    selectinload(JournalEntry.posting_rule),
)
_EDITABLE_APPROVAL = {"DRAFT", "REJECTED"}


def _load_entry(db: Session, entry_id: UUID) -> JournalEntry | None:
    return (
        db.query(JournalEntry)
        .options(*_POSTING_LOAD)
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
    limit: int = 500,
    q: str | None = None,
    source: str | None = Query(
        default=None,
        alias="source",
        description="One source or a comma-separated list (e.g. GOODS_RECEIPT,MANUAL). Omit or ALL for every source.",
    ),
    origin: str | None = None,
    rule: str | None = Query(default=None, alias="rule"),
    date_from: date | None = None,
    date_to: date | None = None,
    period: str | None = None,
    posting: str | None = Query(default=None, alias="posting"),
    approval: str | None = Query(default=None, alias="approval"),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:view")),
) -> list[JournalEntry]:
    query = apply_journal_list_filters(
        db.query(JournalEntry).options(*_POSTING_LOAD),
        q=q,
        source_document_type=source,
        origin=origin,
        posting_rule_id=rule,
        date_from=date_from,
        date_to=date_to,
        period=period,
        posting_status=posting,
        approval_status=approval,
    )
    return (
        query.order_by(JournalEntry.posting_date.desc().nullslast(), JournalEntry.created_at.desc())
        .offset(skip)
        .limit(min(limit, 1000))
        .all()
    )


@router.get("/month-end-close", response_model=MonthEndClosePreview)
def preview_month_end_close(
    period: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:view")),
) -> dict:
    return month_end_close.preview_month_end_close(db, period=period)


@router.post("/month-end-close", response_model=MonthEndCloseResult)
def run_month_end_close(
    payload: MonthEndCloseRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("journal:create")),
) -> dict:
    """Create a Draft park-NI journal (3354 / 3353). It does not post until approved."""
    body = payload or MonthEndCloseRequest()
    entry = month_end_close.run_month_end_close(
        db,
        user,
        period=body.period,
        current_period_ni_account_id=body.current_period_ni_account_id,
    )
    db.commit()
    loaded = month_end_close.find_month_end_journal(
        db, month_end_close.resolve_period(body.period)
    )
    return {
        "message": (
            "Month-end park journal created as Draft. Submit it for approval; "
            "current-period NI is parked to 3353 / 3354 when the journal is posted."
        ),
        "journal": loaded or entry,
    }


@router.get("/year-end-close", response_model=YearEndClosePreview)
def preview_year_end_close(
    fiscal_year: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:view")),
) -> dict:
    return year_end_close.preview_year_end_close(db, fiscal_year=fiscal_year)


@router.post("/year-end-close", response_model=YearEndCloseResult)
def run_year_end_close(
    payload: YearEndCloseRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("journal:create")),
) -> dict:
    """Create a Draft / DRAFT closing journal. It does not post until approved."""
    body = payload or YearEndCloseRequest()
    entry = year_end_close.run_year_end_close(
        db,
        user,
        fiscal_year=body.fiscal_year,
        retained_earnings_account_id=body.retained_earnings_account_id,
    )
    db.commit()
    loaded = year_end_close.find_year_end_journal(db, year_end_close.resolve_fiscal_year(body.fiscal_year))
    return {
        "message": (
            "Year-end close journal created as Draft. Submit it for approval; "
            "P&L closes to 3350 and monthly NI parking is reversed when posted."
        ),
        "journal": loaded or entry,
    }


def _create_journal_entry(db: Session, payload: JournalEntryCreate, user: User) -> JournalEntry:
    posting_rows = _validated_posting_rows(db, payload.postings)
    posting_date = resolve_posting_date(payload.posting_date)
    assert_transaction_date_open(
        db, posting_date, document="journal entry", kind=KIND_ADJUSTMENT
    )
    period = normalize_journal_period(payload.period, posting_date)
    reference = (payload.reference or "").strip() or None

    entry = JournalEntry(
        journal_number=generate_document_number(db, DOC_JOURNAL, posting_date),
        description=payload.description.strip(),
        posted_by_user_id=user.id,
        posting_date=posting_date,
        period=period,
        reference=reference,
        posting_status="Draft",
        approval_status="DRAFT",
        current_approval_step=None,
        is_system_generated=False,
        source_document_type=None,
        source_record_id=None,
        posting_rule_id=None,
    )
    for row in posting_rows:
        entry.postings.append(LedgerPosting(**row))

    db.add(entry)
    db.flush()
    return entry


@router.post("/bulk-import", response_model=JournalBulkImportResponse)
def bulk_import_journal_entries(
    payload: JournalBulkImportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("journal:create")),
) -> dict:
    created_ids: list[UUID] = []
    errors: list[dict[str, str]] = []
    for index, item in enumerate(payload.journals, start=1):
        group_id = (item.group_id or item.reference or str(index)).strip() or str(index)
        try:
            with db.begin_nested():
                entry = _create_journal_entry(db, item, user)
                created_ids.append(entry.id)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            errors.append({"group_id": group_id, "message": detail})
        except Exception as exc:  # noqa: BLE001 — keep remaining journals importing
            errors.append({"group_id": group_id, "message": str(exc)})

    db.commit()
    journals = [entry for entry_id in created_ids if (entry := _load_entry(db, entry_id))]
    return {
        "created": len(journals),
        "journals": journals,
        "errors": errors,
    }


@router.post("", response_model=JournalEntryRead, status_code=status.HTTP_201_CREATED)
def create_journal_entry(
    payload: JournalEntryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("journal:create")),
) -> JournalEntry:
    entry = _create_journal_entry(db, payload, user)
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
    assert_journal_editable(entry)
    assert_transaction_date_open(
        db, entry.posting_date, document="journal entry", kind=KIND_ADJUSTMENT
    )
    if payload.posting_date is not None:
        assert_transaction_date_open(
            db,
            resolve_posting_date(payload.posting_date),
            document="journal entry",
            kind=KIND_ADJUSTMENT,
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


def _is_draft_status(value: str | None) -> bool:
    return (value or "").strip().lower() == "draft"


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_journal_entry(
    entry_id: UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:create")),
) -> None:
    entry = _load_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")

    posting = entry.posting_status or ""
    approval = entry.approval_status or ""
    assert_journal_mutable(entry)
    if not _is_draft_status(posting) or not _is_draft_status(approval):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Cannot delete this journal entry unless posting status and "
                f"approval status are both Draft (posting={posting or '—'}, "
                f"approval={approval or '—'})."
            ),
        )

    # ledger_postings.entry_id is ON DELETE RESTRICT — remove lines first.
    for posting_row in list(entry.postings):
        db.delete(posting_row)
    db.delete(entry)
    db.commit()
