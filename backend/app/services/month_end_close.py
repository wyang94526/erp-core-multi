# @author: Wendy Yang
# @date: 2026-09-24

"""Month-end close: generate a Draft P&L → current-period NI journal.

Approved operational journals post through their own workflow. This flow
creates the monthly closing journal as Draft / DRAFT so it must be
submitted and approved before P&L moves to Equity 3353.
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
from app.services.financial_reports import ZERO, _account_balances
from app.services.posting_rules import EVENT_MONTH_END_CLOSE, resolve_close_pair
from app.services.year_end_close import (
    GENERATED_APPROVAL_STATUS,
    GENERATED_POSTING_STATUS,
    CloseLine,
    build_closing_lines,
)

MEC_REFERENCE_PREFIX = "MEC-"
NI_PREFERRED_CODE = "3353"
NI_NAME_MARKERS = ("current period", "current year")


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

    if db is not None:
        _source, target = resolve_close_pair(db, EVENT_MONTH_END_CLOSE)
        if (target.account_type or "").strip().lower() == "equity":
            return next((row for row in accounts if row.id == target.id), target)

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
            accounts, account_id=current_period_ni_account_id, db=db
        )
    except HTTPException as exc:
        blockers.append(str(exc.detail))

    pnl = [
        item
        for item in _account_balances(db, date_from=start, date_to=end, currency=currency)
        if (item.account_type or "").strip().lower() in {"revenue", "expense"}
    ]
    lines: list[CloseLine] = []
    revenue_total = ZERO
    expense_total = ZERO
    net_income = ZERO
    if target is not None:
        lines, revenue_total, expense_total, net_income = build_closing_lines(
            pnl, target, close_period
        )
    if not lines:
        blockers.append(f"No posted P&L activity to close for {close_period}.")

    existing = find_month_end_journal(db, close_period)
    if existing is not None:
        blockers.append(
            f"A month-end close journal already exists for {close_period} "
            f"({existing.approval_status or 'DRAFT'} / {existing.posting_status or 'Draft'}). "
            "Submit or delete that journal instead of generating another."
        )

    drafts = _drafts_in_period(db, close_period)
    ready = [row for row in drafts if (row.approval_status or "").upper() == "APPROVED"]
    held = [row for row in drafts if (row.approval_status or "").upper() != "APPROVED"]
    if ready:
        blockers.append(
            f"{len(ready)} approved draft journal(s) in {close_period} are not posted. "
            "Approve remaining journals so they post before month-end close."
        )

    today = datetime.utcnow().date()
    period_still_open = today <= end
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
        "lines": [
            {
                "account_id": line.account_id,
                "account_code": line.account_code,
                "account_name": line.account_name,
                "account_type": line.account_type,
                "debit": line.debit,
                "credit": line.credit,
                "description": line.description,
            }
            for line in lines
        ],
        "ready": ready,
        "held": held,
        "existing_journal": existing,
        "can_run": not blockers,
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
    preview = preview_month_end_close(
        db,
        period=period,
        current_period_ni_account_id=current_period_ni_account_id,
        currency=currency,
    )
    if not preview["can_run"]:
        raise HTTPException(status_code=400, detail=preview["blockers"][0])

    close_period = preview["period"]
    entry = JournalEntry(
        description=f"Month-end close {close_period} — close P&L to current-period net income",
        posted_by_user_id=user.id,
        posting_date=preview["close_date"],
        period=close_period,
        reference=month_end_reference(close_period),
        posting_status=GENERATED_POSTING_STATUS,
        approval_status=GENERATED_APPROVAL_STATUS,
        current_approval_step=None,
    )
    for line in preview["lines"]:
        entry.postings.append(
            LedgerPosting(
                account_id=line["account_id"],
                debit=line["debit"],
                credit=line["credit"],
                currency=currency,
                description=line["description"],
            )
        )
    db.add(entry)
    db.flush()
    loaded = find_month_end_journal(db, close_period)
    return loaded or entry
