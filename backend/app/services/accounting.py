import re
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import ChartOfAccount, JournalEntry, LedgerPosting

_PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def validate_posting_amounts(debit: Decimal, credit: Decimal) -> None:
    if (debit > 0 and credit > 0) or (debit == 0 and credit == 0):
        raise HTTPException(
            status_code=400,
            detail="Each posting must have either a debit or a credit, not both or neither",
        )


def ensure_account_exists(db: Session, account_id: UUID) -> ChartOfAccount:
    account = db.get(ChartOfAccount, account_id)
    if not account:
        raise HTTPException(status_code=400, detail=f"Account {account_id} not found")
    return account


def ensure_journal_entry_exists(db: Session, entry_id: UUID) -> JournalEntry:
    entry = db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return entry


def validate_journal_balance(postings: list[LedgerPosting]) -> None:
    if len(postings) < 2:
        raise HTTPException(
            status_code=400,
            detail="Journal entry requires at least two postings",
        )
    total_debit = sum((p.debit for p in postings), Decimal("0"))
    total_credit = sum((p.credit for p in postings), Decimal("0"))
    if total_debit <= 0 or total_credit <= 0:
        raise HTTPException(
            status_code=400,
            detail="Journal entry requires at least one debit line and one credit line",
        )
    if total_debit != total_credit:
        raise HTTPException(
            status_code=400,
            detail=f"Journal entry is not balanced: debits={total_debit}, credits={total_credit}",
        )


def validate_posting_rows(rows: list[dict]) -> tuple[Decimal, Decimal]:
    if len(rows) < 2:
        raise HTTPException(
            status_code=400,
            detail="Journal entry requires at least two postings",
        )
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    for row in rows:
        debit = Decimal(str(row["debit"]))
        credit = Decimal(str(row["credit"]))
        validate_posting_amounts(debit, credit)
        total_debit += debit
        total_credit += credit
    if total_debit <= 0 or total_credit <= 0:
        raise HTTPException(
            status_code=400,
            detail="Journal entry requires at least one debit line and one credit line",
        )
    if total_debit != total_credit:
        raise HTTPException(
            status_code=400,
            detail=f"Journal entry is not balanced: debits={total_debit}, credits={total_credit}",
        )
    return total_debit, total_credit


def period_from_date(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def normalize_journal_period(period: str | None, posting_date: date) -> str:
    value = (period or "").strip() or period_from_date(posting_date)
    if not _PERIOD_RE.match(value):
        raise HTTPException(status_code=400, detail="period must be YYYY-MM")
    return value


def resolve_posting_date(value: date | None) -> date:
    if value is not None:
        return value
    return datetime.utcnow().date()
