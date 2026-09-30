# @author: Wendy Yang
# @date: 2026-09-24

"""Year-end close: generate a Draft P&L → retained earnings journal.

Revenue and expense accumulate through the year. This flow zeros full-year
P&L into retained earnings (3350) and clears leftover current-period NI
(3353). The journal stays Draft / DRAFT until it is submitted and approved.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Date, cast, func
from sqlalchemy.orm import Session, selectinload

from app.models import ChartOfAccount, JournalEntry, LedgerPosting, User
from app.services.financial_reports import ZERO, AccountBalance, _account_balances, money
from app.services.document_sequences import DOC_JOURNAL, generate_document_number
from app.services.journal_source import SOURCE_YEAR_END_CLOSE, generated_journal_fields, rule_id
from app.services.posting_rules import (
    EVENT_YEAR_END_CLOSE,
    VARIANT_NI_CLEAR,
    resolve_close_pair,
    resolve_close_rule,
    resolve_posting_rule,
)

YEC_REFERENCE_PREFIX = "YEC-"
GENERATED_POSTING_STATUS = "Draft"
GENERATED_APPROVAL_STATUS = "DRAFT"
RE_PREFERRED_CODE = "3350"
RE_NAME_MARKERS = ("retained earnings", "retained earning", "accumulated deficit")
CURRENT_PERIOD_MARKERS = ("current period", "current year")


@dataclass(frozen=True)
class CloseLine:
    account_id: UUID
    account_code: str
    account_name: str
    account_type: str
    debit: Decimal
    credit: Decimal
    description: str


def year_end_reference(fiscal_year: int) -> str:
    return f"{YEC_REFERENCE_PREFIX}{fiscal_year}"


def fiscal_year_bounds(fiscal_year: int) -> tuple[date, date]:
    if fiscal_year < 1900 or fiscal_year > 2100:
        raise HTTPException(status_code=400, detail="Fiscal year is out of range")
    return date(fiscal_year, 1, 1), date(fiscal_year, 12, 31)


def resolve_fiscal_year(raw: int | None) -> int:
    if raw is None:
        return datetime.utcnow().year
    try:
        year = int(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Fiscal year must be a number") from exc
    fiscal_year_bounds(year)
    return year


def _entry_date():
    return func.coalesce(JournalEntry.posting_date, cast(JournalEntry.created_at, Date))


def _is_current_period_equity(name: str) -> bool:
    hay = (name or "").strip().lower()
    return any(token in hay for token in CURRENT_PERIOD_MARKERS)


def resolve_retained_earnings(
    accounts: list[ChartOfAccount],
    *,
    account_id: UUID | None = None,
    db: Session | None = None,
) -> ChartOfAccount:
    if account_id is not None:
        match = next((row for row in accounts if row.id == account_id), None)
        if match is None:
            raise HTTPException(status_code=400, detail="Retained earnings account not found")
        if (match.account_type or "").strip().lower() != "equity":
            raise HTTPException(
                status_code=400,
                detail="Retained earnings account must be an Equity account",
            )
        return match

    if db is not None:
        _ni, retained = resolve_close_pair(db, EVENT_YEAR_END_CLOSE)
        if (retained.account_type or "").strip().lower() == "equity":
            return next((row for row in accounts if row.id == retained.id), retained)

    equity = [row for row in accounts if (row.account_type or "").strip().lower() == "equity"]
    preferred = next((row for row in equity if (row.account_code or "") == RE_PREFERRED_CODE), None)
    if preferred is not None:
        return preferred

    scored: list[tuple[int, ChartOfAccount]] = []
    for row in equity:
        name = (row.account_name or "").strip().lower()
        if _is_current_period_equity(name):
            continue
        if any(marker in name for marker in RE_NAME_MARKERS):
            scored.append((0 if "unappropriated" in name else 1, row))
    if scored:
        scored.sort(key=lambda item: (item[0], item[1].account_code or ""))
        return scored[0][1]

    raise HTTPException(
        status_code=400,
        detail=(
            "No retained earnings account found. Use Equity account 3350 "
            "(Retained earnings-unappropriated) or pass retained_earnings_account_id."
        ),
    )


def build_closing_lines(
    pnl_balances: list[AccountBalance],
    target_account: ChartOfAccount,
    period_label: str,
) -> tuple[list[CloseLine], Decimal, Decimal, Decimal]:
    revenue_total = ZERO
    expense_total = ZERO
    lines: list[CloseLine] = []

    for item in pnl_balances:
        signed = money(item.signed)
        if signed == ZERO:
            continue
        kind = (item.account_type or "").strip().lower()
        if kind == "revenue":
            revenue_total = money(revenue_total + signed)
            debit = signed if signed > ZERO else ZERO
            credit = money(-signed) if signed < ZERO else ZERO
        elif kind == "expense":
            expense_total = money(expense_total + signed)
            credit = signed if signed > ZERO else ZERO
            debit = money(-signed) if signed < ZERO else ZERO
        else:
            continue
        lines.append(
            CloseLine(
                account_id=item.account_id,
                account_code=item.account_code,
                account_name=item.account_name,
                account_type=item.account_type,
                debit=debit,
                credit=credit,
                description=f"Close {period_label} {item.account_name}",
            )
        )

    net_income = money(revenue_total - expense_total)
    if net_income != ZERO:
        lines.append(
            CloseLine(
                account_id=target_account.id,
                account_code=target_account.account_code,
                account_name=target_account.account_name,
                account_type=target_account.account_type,
                debit=money(-net_income) if net_income < ZERO else ZERO,
                credit=net_income if net_income > ZERO else ZERO,
                description=(
                    f"Transfer {period_label} net income"
                    if net_income > ZERO
                    else f"Transfer {period_label} net loss"
                ),
            )
        )
    return lines, revenue_total, expense_total, net_income


CURRENT_PERIOD_NI_CODES = frozenset({"3353", "3354"})


def resolve_current_period_ni_ids(db: Session) -> set[UUID]:
    """Account ids for leftover current-period NI (not the P&L representative debit)."""
    try:
        debit, _credit, _rule = resolve_posting_rule(
            db, EVENT_YEAR_END_CLOSE, VARIANT_NI_CLEAR
        )
    except HTTPException:
        return set()
    if (debit.account_type or "").strip().lower() != "equity":
        return set()
    return {debit.id}


def merge_target_lines(lines: list[CloseLine], target: ChartOfAccount, period_label: str) -> list[CloseLine]:
    others = [line for line in lines if line.account_id != target.id]
    target_lines = [line for line in lines if line.account_id == target.id]
    net_credit = sum((line.credit - line.debit for line in target_lines), ZERO)
    net_credit = money(net_credit)
    if net_credit == ZERO:
        return others
    others.append(
        CloseLine(
            account_id=target.id,
            account_code=target.account_code,
            account_name=target.account_name,
            account_type=target.account_type,
            debit=money(-net_credit) if net_credit < ZERO else ZERO,
            credit=net_credit if net_credit > ZERO else ZERO,
            description=(
                f"Transfer {period_label} net income"
                if net_credit > ZERO
                else f"Transfer {period_label} net loss"
            ),
        )
    )
    return others


def build_current_period_ni_lines(
    balances: list[AccountBalance],
    retained_earnings: ChartOfAccount,
    period_label: str,
    extra_account_ids: set[UUID] | None = None,
) -> list[CloseLine]:
    extra = extra_account_ids or set()
    lines: list[CloseLine] = []
    for item in balances:
        if item.account_id == retained_earnings.id:
            continue
        code = item.account_code or ""
        name = item.account_name or ""
        if (
            code not in CURRENT_PERIOD_NI_CODES
            and not _is_current_period_equity(name)
            and item.account_id not in extra
        ):
            continue
        if (item.account_type or "").strip().lower() != "equity":
            continue
        signed = money(item.signed)
        if signed == ZERO:
            continue
        lines.append(
            CloseLine(
                account_id=item.account_id,
                account_code=item.account_code,
                account_name=item.account_name,
                account_type=item.account_type,
                debit=signed if signed > ZERO else ZERO,
                credit=money(-signed) if signed < ZERO else ZERO,
                description=f"Close {period_label} {item.account_name}",
            )
        )
        lines.append(
            CloseLine(
                account_id=retained_earnings.id,
                account_code=retained_earnings.account_code,
                account_name=retained_earnings.account_name,
                account_type=retained_earnings.account_type,
                debit=money(-signed) if signed < ZERO else ZERO,
                credit=signed if signed > ZERO else ZERO,
                description=f"Transfer {period_label} current-period net income",
            )
        )
    return merge_target_lines(lines, retained_earnings, period_label)


def is_generated_close_reference(reference: str | None) -> bool:
    value = (reference or "").upper()
    return value.startswith("YEC-") or value.startswith("MEC-")


def find_year_end_journal(db: Session, fiscal_year: int) -> JournalEntry | None:
    return (
        db.query(JournalEntry)
        .options(selectinload(JournalEntry.postings).selectinload(LedgerPosting.account))
        .filter(JournalEntry.reference == year_end_reference(fiscal_year))
        .order_by(JournalEntry.created_at.desc())
        .first()
    )


def _drafts_in_year(db: Session, fiscal_year: int) -> list[JournalEntry]:
    start, end = fiscal_year_bounds(fiscal_year)
    return (
        db.query(JournalEntry)
        .options(selectinload(JournalEntry.postings).selectinload(LedgerPosting.account))
        .filter(func.lower(func.coalesce(JournalEntry.posting_status, "Draft")) == "draft")
        .filter(_entry_date() >= start, _entry_date() <= end)
        .filter(~func.coalesce(JournalEntry.reference, "").ilike("YEC-%"))
        .filter(~func.coalesce(JournalEntry.reference, "").ilike("MEC-%"))
        .order_by(JournalEntry.created_at.desc())
        .all()
    )


def preview_year_end_close(
    db: Session,
    *,
    fiscal_year: int | None = None,
    retained_earnings_account_id: UUID | None = None,
    currency: str = "USD",
) -> dict:
    year = resolve_fiscal_year(fiscal_year)
    start, end = fiscal_year_bounds(year)
    accounts = db.query(ChartOfAccount).order_by(ChartOfAccount.account_code).all()
    blockers: list[str] = []
    retained = None
    try:
        retained = resolve_retained_earnings(
            accounts, account_id=retained_earnings_account_id, db=db
        )
    except HTTPException as exc:
        blockers.append(str(exc.detail))

    balances = _account_balances(db, date_from=start, date_to=end, currency=currency)
    pnl = [
        item
        for item in balances
        if (item.account_type or "").strip().lower() in {"revenue", "expense"}
    ]
    lines: list[CloseLine] = []
    revenue_total = ZERO
    expense_total = ZERO
    net_income = ZERO
    if retained is not None:
        ni_account_ids = resolve_current_period_ni_ids(db)
        lines, revenue_total, expense_total, net_income = build_closing_lines(
            pnl, retained, f"FY {year}"
        )
        lines = merge_target_lines(
            lines
            + build_current_period_ni_lines(
                balances, retained, f"FY {year}", extra_account_ids=ni_account_ids
            ),
            retained,
            f"FY {year}",
        )
    if not lines:
        blockers.append(f"No posted P&L or current-period net income to close for FY {year}.")

    existing = find_year_end_journal(db, year)
    if existing is not None:
        blockers.append(
            f"A year-end close journal already exists for FY {year} "
            f"({existing.approval_status or 'DRAFT'} / {existing.posting_status or 'Draft'}). "
            "Submit or delete that journal instead of generating another."
        )

    drafts = _drafts_in_year(db, year)
    ready = [row for row in drafts if (row.approval_status or "").upper() == "APPROVED"]
    held = [row for row in drafts if (row.approval_status or "").upper() != "APPROVED"]
    if ready:
        blockers.append(
            f"{len(ready)} approved draft journal(s) in FY {year} are not posted. "
            "Approve remaining journals so they post before year-end close."
        )

    open_month_closes = (
        db.query(JournalEntry)
        .filter(JournalEntry.reference.ilike(f"MEC-{year}-%"))
        .filter(func.lower(func.coalesce(JournalEntry.posting_status, "Draft")) == "draft")
        .all()
    )
    if open_month_closes:
        blockers.append(
            f"{len(open_month_closes)} Month-End Close journal(s) for FY {year} are still Draft. "
            "Submit and approve them before year-end close."
        )

    today = datetime.utcnow().date()
    year_still_open = today <= end
    can_run = not blockers
    return {
        "fiscal_year": year,
        "period": f"{year}-12",
        "close_date": end,
        "year_still_open": year_still_open,
        "retained_earnings": (
            {
                "account_id": retained.id,
                "account_code": retained.account_code,
                "account_name": retained.account_name,
                "account_type": retained.account_type,
            }
            if retained is not None
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
        "can_run": can_run,
        "blockers": blockers,
    }


def run_year_end_close(
    db: Session,
    user: User,
    *,
    fiscal_year: int | None = None,
    retained_earnings_account_id: UUID | None = None,
    currency: str = "USD",
) -> JournalEntry:
    preview = preview_year_end_close(
        db,
        fiscal_year=fiscal_year,
        retained_earnings_account_id=retained_earnings_account_id,
        currency=currency,
    )
    if not preview["can_run"]:
        raise HTTPException(status_code=400, detail=preview["blockers"][0])

    year = preview["fiscal_year"]
    _debit, _credit, close_rule = resolve_close_rule(db, EVENT_YEAR_END_CLOSE)
    entry = JournalEntry(
        journal_number=generate_document_number(db, DOC_JOURNAL, preview["close_date"]),
        description=f"Year-end close FY {year} — close P&L to retained earnings",
        posted_by_user_id=user.id,
        posting_date=preview["close_date"],
        period=preview["period"],
        reference=year_end_reference(year),
        posting_status=GENERATED_POSTING_STATUS,
        approval_status=GENERATED_APPROVAL_STATUS,
        current_approval_step=None,
        **generated_journal_fields(
            source_document_type=SOURCE_YEAR_END_CLOSE,
            source_record_id=year,
            posting_rule_id=rule_id(close_rule),
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
    loaded = find_year_end_journal(db, year)
    return loaded or entry
