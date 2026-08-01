from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import ChartOfAccount, JournalEntry, LedgerPosting


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
    if total_debit != total_credit:
        raise HTTPException(
            status_code=400,
            detail=f"Journal entry is not balanced: debits={total_debit}, credits={total_credit}",
        )


def validate_posting_rows(rows: list[dict]) -> tuple[Decimal, Decimal]:
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    for row in rows:
        validate_posting_amounts(row["debit"], row["credit"])
        total_debit += row["debit"]
        total_credit += row["credit"]
    return total_debit, total_credit
