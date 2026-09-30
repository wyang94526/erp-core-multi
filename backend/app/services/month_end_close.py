# @author: Wendy Yang
# @date: 2026-09-24

"""Month-end close: review period activity and post adjustment journals.

Revenue and expense stay open and keep accumulating through the year.
P&L is closed into retained earnings only by Year-End Close.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Date, cast, func
from sqlalchemy.orm import Session, selectinload

from app.models import ChartOfAccount, JournalEntry, LedgerPosting, User
from app.services.accounting import normalize_journal_period
from app.services.financial_reports import ZERO, _account_balances, money
from app.services.posting_rules import EVENT_MONTH_END_CLOSE, list_posting_rules

MEC_REFERENCE_PREFIX = "MEC-"
NI_PREFERRED_CODE = "3353"
NI_NAME_MARKERS = ("current period", "current year")
MONTH_END_NO_PNL_CLOSE = (
    "Month-end close does not generate a P&L closing journal. "
    "Post adjustment journals (GRNI cutoff, prepayments, accruals, depreciation, "
    "or currency revaluation) and leave revenue and expense balances "
    "to accumulate. Use Year-End Close to close P&L into retained earnings."
)


def month_end_reference(period: str) -> str:
    return f"{MEC_REFERENCE_PREFIX}{period}"


def resolve_period(raw: str | None) -> str:
    today = datetime.utcnow().date()
    return normalize_journal_period(raw, today)


def period_bounds(period: str) -> tuple[date, date]:
    period = resolve_period(period)
    year, month = (int(part) for part in period.split("-"))
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def _entry_date():
    return func.coalesce(JournalEntry.posting_date, cast(JournalEntry.created_at, Date))


def resolve_current_period_ni(
    accounts: list[ChartOfAccount],
    *,
    account_id: UUID | None = None,
    db: Session | None = None,
) -> ChartOfAccount:
    if account_id is not None:
        match = next((row for row in accounts if row.id == account_id), None)
        if match is None:
            raise HTTPException(status_code=400, detail="Current-period net income account not found")
        if (match.account_type or "").strip().lower() != "equity":
            raise HTTPException(
                status_code=400,
                detail="Current-period net income account must be an Equity account",
            )
        return match

    equity = [row for row in accounts if (row.account_type or "").strip().lower() == "equity"]
    preferred = next((row for row in equity if (row.account_code or "") == NI_PREFERRED_CODE), None)
    if preferred is not None:
        return preferred

    scored: list[tuple[int, ChartOfAccount]] = []
    for row in equity:
        name = (row.account_name or "").strip().lower()
        if "retained" in name:
            continue
        if any(marker in name for marker in NI_NAME_MARKERS):
            score = 0 if "bs" in name or "balance" in name else 1
            if "is" in name or "income statement" in name:
                score += 2
            scored.append((score, row))
    if scored:
        scored.sort(key=lambda item: (item[0], item[1].account_code or ""))
        return scored[0][1]

    raise HTTPException(
        status_code=400,
        detail=(
            "No current-period net income account found. Use Equity account 3353 "
            "(Net income or loss for current period-BS) or pass current_period_ni_account_id."
        ),
    )


def find_month_end_journal(db: Session, period: str) -> JournalEntry | None:
    return (
        db.query(JournalEntry)
        .options(selectinload(JournalEntry.postings).selectinload(LedgerPosting.account))
        .filter(JournalEntry.reference == month_end_reference(period))
        .order_by(JournalEntry.created_at.desc())
        .first()
    )


def _drafts_in_period(db: Session, period: str) -> list[JournalEntry]:
    start, end = period_bounds(period)
    return (
        db.query(JournalEntry)
        .options(selectinload(JournalEntry.postings).selectinload(LedgerPosting.account))
        .filter(func.lower(func.coalesce(JournalEntry.posting_status, "Draft")) == "draft")
        .filter(_entry_date() >= start, _entry_date() <= end)
        .filter(~func.coalesce(JournalEntry.reference, "").ilike("MEC-%"))
        .filter(~func.coalesce(JournalEntry.reference, "").ilike("YEC-%"))
        .order_by(JournalEntry.created_at.desc())
        .all()
    )


def _period_pnl_totals(db: Session, start: date, end: date, currency: str) -> tuple:
    pnl = [
        item
        for item in _account_balances(db, date_from=start, date_to=end, currency=currency)
        if (item.account_type or "").strip().lower() in {"revenue", "expense"}
    ]
    revenue_total = ZERO
    expense_total = ZERO
    for item in pnl:
        kind = (item.account_type or "").strip().lower()
        signed = item.signed
        if kind == "revenue":
            revenue_total = money(revenue_total + signed)
        elif kind == "expense":
            expense_total = money(expense_total + signed)
    return revenue_total, expense_total, money(revenue_total - expense_total)


def preview_month_end_close(
    db: Session,
    *,
    period: str | None = None,
    current_period_ni_account_id: UUID | None = None,
    currency: str = "USD",
) -> dict:
    close_period = resolve_period(period)
    start, end = period_bounds(close_period)
    accounts = db.query(ChartOfAccount).order_by(ChartOfAccount.account_code).all()
    blockers: list[str] = []
    target = None
    try:
        target = resolve_current_period_ni(
            accounts, account_id=current_period_ni_account_id
        )
    except HTTPException:
        target = None

    revenue_total, expense_total, net_income = _period_pnl_totals(
        db, start, end, currency
    )

    drafts = _drafts_in_period(db, close_period)
    ready = [row for row in drafts if (row.approval_status or "").upper() == "APPROVED"]
    held = [row for row in drafts if (row.approval_status or "").upper() != "APPROVED"]
    if ready:
        blockers.append(
            f"{len(ready)} approved draft journal(s) in {close_period} are not posted. "
            "Approve remaining journals so they post before you finish month-end adjustments."
        )

    today = datetime.utcnow().date()
    period_still_open = today <= end
    adjustment_rules = [
        {
            "id": row["id"],
            "rule_code": row["rule_code"],
            "name": row["name"],
            "variant": row["variant"],
            "variant_label": row["variant_label"],
            "debit_account_code": row["debit_account_code"],
            "debit_account_name": row["debit_account_name"],
            "credit_account_code": row["credit_account_code"],
            "credit_account_name": row["credit_account_name"],
        }
        for row in list_posting_rules(db)
        if row["event_code"] == EVENT_MONTH_END_CLOSE
    ]
    return {
        "period": close_period,
        "close_date": end,
        "period_still_open": period_still_open,
        "current_period_ni": (
            {
                "account_id": target.id,
                "account_code": target.account_code,
                "account_name": target.account_name,
                "account_type": target.account_type,
            }
            if target is not None
            else None
        ),
        "revenue_total": revenue_total,
        "expense_total": expense_total,
        "net_income": net_income,
        "lines": [],
        "adjustment_rules": adjustment_rules,
        "ready": ready,
        "held": held,
        "existing_journal": find_month_end_journal(db, close_period),
        "can_run": False,
        "blockers": blockers,
    }


def run_month_end_close(
    db: Session,
    user: User,
    *,
    period: str | None = None,
    current_period_ni_account_id: UUID | None = None,
    currency: str = "USD",
) -> JournalEntry:
    raise HTTPException(status_code=400, detail=MONTH_END_NO_PNL_CLOSE)
