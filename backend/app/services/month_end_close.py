# @author: Wendy Yang
# @date: 2026-09-24

"""Month-end close: park current-period NI.

Revenue and expense stay open and keep accumulating through the year.
Monthly net income is parked to temporary accounts 3354 (IS) and 3353 (BS).
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
from app.services.period_close import period_lock_message
from app.services.document_sequences import DOC_JOURNAL, generate_document_number
from app.services.financial_reports import ZERO, _account_balances, money
from app.services.journal_source import SOURCE_MONTH_END_CLOSE, generated_journal_fields, rule_id
from app.services.posting_rules import (
    EVENT_MONTH_END_CLOSE,
    VARIANT_PARK_NI,
    resolve_posting_rule,
)
from app.services.year_end_close import build_park_ni_lines

MEC_REFERENCE_PREFIX = "MEC-"
NI_PREFERRED_CODE = "3353"
NI_IS_PREFERRED_CODE = "3354"
NI_NAME_MARKERS = ("current period", "current year")
GENERATED_POSTING_STATUS = "Draft"
GENERATED_APPROVAL_STATUS = "DRAFT"


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


def _account_payload(account: ChartOfAccount | None) -> dict | None:
    if account is None:
        return None
    return {
        "account_id": account.id,
        "account_code": account.account_code,
        "account_name": account.account_name,
        "account_type": account.account_type,
    }


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
        try:
            _ni_is, ni_bs, _rule = resolve_posting_rule(db, EVENT_MONTH_END_CLOSE, VARIANT_PARK_NI)
            match = next((row for row in accounts if row.id == ni_bs.id), ni_bs)
            if (match.account_type or "").strip().lower() == "equity":
                return match
        except HTTPException:
            pass

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


def resolve_current_period_ni_is(accounts: list[ChartOfAccount], db: Session | None = None) -> ChartOfAccount | None:
    if db is not None:
        try:
            ni_is, _ni_bs, _rule = resolve_posting_rule(db, EVENT_MONTH_END_CLOSE, VARIANT_PARK_NI)
            match = next((row for row in accounts if row.id == ni_is.id), ni_is)
            if (match.account_type or "").strip().lower() == "equity":
                return match
        except HTTPException:
            pass
    return next(
        (
            row
            for row in accounts
            if (row.account_code or "") == NI_IS_PREFERRED_CODE
            and (row.account_type or "").strip().lower() == "equity"
        ),
        None,
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
        for item in _account_balances(
            db,
            date_from=start,
            date_to=end,
            currency=currency,
            exclude_close_journals=True,
        )
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


def _serialize_close_lines(lines) -> list[dict]:
    return [
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
    ]


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
    except HTTPException:
        target = None
    ni_is = resolve_current_period_ni_is(accounts, db=db)

    revenue_total, expense_total, net_income = _period_pnl_totals(
        db, start, end, currency
    )

    lines = []
    try:
        park_is, park_bs, _rule = resolve_posting_rule(db, EVENT_MONTH_END_CLOSE, VARIANT_PARK_NI)
        if target is None:
            target = park_bs
        if ni_is is None:
            ni_is = park_is
        lines = build_park_ni_lines(net_income, park_is, park_bs, close_period)
    except HTTPException as exc:
        blockers.append(str(exc.detail))

    if not lines:
        blockers.append(f"No net income or loss to park for {close_period}.")

    drafts = _drafts_in_period(db, close_period)
    ready = [row for row in drafts if (row.approval_status or "").upper() == "APPROVED"]
    held = [row for row in drafts if (row.approval_status or "").upper() != "APPROVED"]
    if ready:
        blockers.append(
            f"{len(ready)} approved draft journal(s) in {close_period} are not posted. "
            "Approve remaining journals so they post before you finish month-end."
        )

    existing = find_month_end_journal(db, close_period)
    if existing is not None:
        blockers.append(
            f"A month-end park journal already exists for {close_period} "
            f"({existing.approval_status or 'DRAFT'} / {existing.posting_status or 'Draft'}). "
            "Submit or delete that journal instead of generating another."
        )

    today = datetime.utcnow().date()
    period_still_open = today <= end
    lock_message = period_lock_message(
        db, end, document="month-end close", kind="adjustment"
    )
    if lock_message:
        blockers.append(lock_message)
    return {
        "period": close_period,
        "close_date": end,
        "period_still_open": period_still_open,
        "current_period_ni": _account_payload(target),
        "current_period_ni_is": _account_payload(ni_is),
        "revenue_total": revenue_total,
        "expense_total": expense_total,
        "net_income": net_income,
        "lines": _serialize_close_lines(lines),
        "adjustment_rules": [],
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
    _debit, _credit, park_rule = resolve_posting_rule(db, EVENT_MONTH_END_CLOSE, VARIANT_PARK_NI)
    entry = JournalEntry(
        journal_number=generate_document_number(db, DOC_JOURNAL, preview["close_date"]),
        description=f"Month-end close {close_period} — park current-period net income",
        posted_by_user_id=user.id,
        posting_date=preview["close_date"],
        period=close_period,
        reference=month_end_reference(close_period),
        posting_status=GENERATED_POSTING_STATUS,
        approval_status=GENERATED_APPROVAL_STATUS,
        current_approval_step=None,
        **generated_journal_fields(
            source_document_type=SOURCE_MONTH_END_CLOSE,
            source_record_id=close_period,
            posting_rule_id=rule_id(park_rule),
        ),
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
