# @author: Wendy Yang
# @date: 2026-09-19

"""Financial statement and management-report builders.

Reports are derived from posted journal entries, AR/AP open balances, cash
ledger clearing, and (when present) the financial_budgets book.
"""

from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Date, cast, func, or_
from sqlalchemy.orm import Session, selectinload

from app.models import (
    APBill,
    ARInvoice,
    BankAccount,
    CashTransaction,
    ChartOfAccount,
    Customer,
    FinancialBudget,
    JournalEntry,
    LedgerPosting,
    Supplier,
)

ZERO = Decimal("0.00")
MONEY = Decimal("0.01")
PNL_CLOSE_SOURCES = ("MONTH_END_CLOSE", "YEAR_END_CLOSE")


def pnl_operating_journal_filter():
    """Keep operating journals only. Close entries zero revenue/expense after month-end."""
    return or_(
        JournalEntry.source_document_type.is_(None),
        ~JournalEntry.source_document_type.in_(PNL_CLOSE_SOURCES),
    )

DEBIT_NORMAL = {"asset", "expense"}
CREDIT_NORMAL = {"liability", "equity", "revenue", "income"}

FIXED_ASSET_NAME_MARKERS = (
    "equipment",
    "furniture",
    "vehicle",
    "building",
    "ppe",
    "plant",
    "machinery",
    "leasehold",
    "fixed asset",
    "accumulat",
    "depreciat",
    "capital",
)

CASH_NAME_MARKERS = ("cash", "bank", "checking", "savings", "money market", "petty")

REPORT_CATALOG: list[dict[str, Any]] = [
    {
        "id": "balance-sheet",
        "title": "Balance Sheet",
        "category": "primary",
        "category_label": "Primary Financial Statements",
        "description": "Assets, liabilities, and equity as of the selected date, with current-period net income plugged to equity.",
        "parameters": ["As Of Date", "Fiscal Year", "Currency"],
        "default_action": "Generate Report",
    },
    {
        "id": "income-statement",
        "title": "Income Statement (Profit & Loss)",
        "category": "primary",
        "category_label": "Primary Financial Statements",
        "description": "Period and year-to-date debit, credit, and signed net for revenue and expense. Close journals are excluded.",
        "parameters": ["Date Range", "Financial Period", "Currency"],
        "default_action": "Generate Report",
    },
    {
        "id": "cash-flow",
        "title": "Statement of Cash Flows",
        "category": "primary",
        "category_label": "Primary Financial Statements",
        "description": "Operating, investing, and financing cash movements from posted cash and bank G/L activity.",
        "parameters": ["Date Range", "Currency"],
        "default_action": "Generate Report",
    },
    {
        "id": "ar-aging",
        "title": "Accounts Receivable Aging",
        "category": "operational",
        "category_label": "Operational & Sub-Ledger Reports",
        "description": "Open customer invoices bucketed Current / 1–30 / 31–60 / 61–90 / 90+ by due date.",
        "parameters": ["As Of Date"],
        "default_action": "View",
    },
    {
        "id": "ap-aging",
        "title": "Accounts Payable Aging",
        "category": "operational",
        "category_label": "Operational & Sub-Ledger Reports",
        "description": "Open supplier bills bucketed Current / 1–30 / 31–60 / 61–90 / 90+ by due date.",
        "parameters": ["As Of Date"],
        "default_action": "View",
    },
    {
        "id": "trial-balance",
        "title": "Trial Balance",
        "category": "operational",
        "category_label": "Operational & Sub-Ledger Reports",
        "description": "Cumulative posted debit/credit through the as-of date, plus period operating activity that matches the P&L.",
        "parameters": ["As Of Date", "Currency"],
        "default_action": "Generate Report",
    },
    {
        "id": "fixed-asset-schedule",
        "title": "Fixed Asset Schedule",
        "category": "operational",
        "category_label": "Operational & Sub-Ledger Reports",
        "description": "Beginning balance, additions, disposals, and ending net book value for PPE and contra-depreciation accounts.",
        "parameters": ["Date Range", "As Of Date"],
        "default_action": "Generate Report",
    },
    {
        "id": "cash-flow-forecast",
        "title": "Cash Flow Forecast",
        "category": "managerial",
        "category_label": "Managerial & Cash Reports",
        "description": "Starting cash plus expected AR collections and AP payments by due-date bucket.",
        "parameters": ["As Of Date"],
        "default_action": "View",
    },
    {
        "id": "budget-vs-actual",
        "title": "Budget vs. Actual",
        "category": "managerial",
        "category_label": "Managerial & Cash Reports",
        "description": "P&L actuals against the budget book (or prior-year actuals when no budget is loaded).",
        "parameters": ["Financial Period", "Fiscal Year", "Currency"],
        "default_action": "Generate Report",
    },
    {
        "id": "bank-reconciliation",
        "title": "Bank Reconciliation Summary",
        "category": "managerial",
        "category_label": "Managerial & Cash Reports",
        "description": "Book balance versus cleared and outstanding cash instruments per company bank account.",
        "parameters": ["As Of Date", "Period"],
        "default_action": "View",
    },
]

REPORT_IDS = {item["id"] for item in REPORT_CATALOG}


@dataclass
class AccountBalance:
    account_id: UUID
    account_code: str
    account_name: str
    account_type: str
    debit: Decimal
    credit: Decimal

    @property
    def signed(self) -> Decimal:
        return signed_balance(self.account_type, self.debit, self.credit, self.account_code, self.account_name)


def money(value: Any) -> Decimal:
    if value is None:
        return ZERO
    return Decimal(str(value)).quantize(MONEY)


def num(value: Decimal | int | float | None) -> float:
    return float(money(value))


def normalize_account_type(
    account_type: str | None,
    account_code: str | None = None,
    account_name: str | None = None,
) -> str:
    """Map chart labels so P&L/TB treat 4110001-style sales as revenue, not credit-only."""
    kind = (account_type or "").strip().lower()
    if kind == "income":
        kind = "revenue"
    if kind in DEBIT_NORMAL or kind in CREDIT_NORMAL:
        return kind
    blob = f"{account_code or ''} {account_name or ''}".lower()
    digits = "".join(ch for ch in (account_code or "") if ch.isdigit())
    if "revenue" in blob or "sales" in blob or digits.startswith("4"):
        return "revenue"
    if any(token in blob for token in ("expense", "cost of", "cogs")) or digits.startswith(("5", "6")):
        return "expense"
    return kind


def signed_balance(
    account_type: str | None,
    debit: Any,
    credit: Any,
    account_code: str | None = None,
    account_name: str | None = None,
) -> Decimal:
    debit_amt = money(debit)
    credit_amt = money(credit)
    kind = normalize_account_type(account_type, account_code, account_name)
    if kind in DEBIT_NORMAL:
        return money(debit_amt - credit_amt)
    return money(credit_amt - debit_amt)


def aging_bucket(days_past_due: int) -> str:
    if days_past_due <= 0:
        return "current"
    if days_past_due <= 30:
        return "d1_30"
    if days_past_due <= 60:
        return "d31_60"
    if days_past_due <= 90:
        return "d61_90"
    return "d90"


def period_bounds(period: str) -> tuple[date, date]:
    year_s, month_s = period.split("-", 1)
    year, month = int(year_s), int(month_s)
    last = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def is_fixed_asset_account(code: str | None, name: str | None, account_type: str | None) -> bool:
    if (account_type or "").strip().lower() != "asset":
        # Accumulated depreciation is often Equity/Contra or Asset
        blob = f"{code or ''} {name or ''}".lower()
        return "depreciat" in blob or "accumulat" in blob
    code_digits = "".join(ch for ch in (code or "") if ch.isdigit())
    if code_digits[:2] in {"15", "16", "17", "18"}:
        return True
    blob = f"{code or ''} {name or ''}".lower()
    return any(marker in blob for marker in FIXED_ASSET_NAME_MARKERS)


def is_contra_asset(name: str | None) -> bool:
    blob = (name or "").lower()
    return "accumulat" in blob or "depreciat" in blob


def is_cash_account(code: str | None, name: str | None, account_type: str | None) -> bool:
    if (account_type or "").strip().lower() != "asset":
        return False
    blob = f"{code or ''} {name or ''}".lower()
    if "receivable" in blob or "inventory" in blob or "prepaid" in blob:
        return False
    code_digits = "".join(ch for ch in (code or "") if ch.isdigit())
    if code_digits.startswith("1000") or code_digits.startswith("101") or code_digits.startswith("1101") or code_digits.startswith("1103"):
        return True
    return any(marker in blob for marker in CASH_NAME_MARKERS)


def classify_counter_account(account_type: str | None, code: str | None, name: str | None) -> str:
    """Map the non-cash side of a journal to cash-flow section."""
    kind = (account_type or "").strip().lower()
    blob = f"{code or ''} {name or ''}".lower()
    if is_cash_account(code, name, account_type):
        return "cash"
    if kind in {"revenue", "expense"}:
        return "operating"
    if kind == "asset":
        if "receivable" in blob:
            return "operating"
        if is_fixed_asset_account(code, name, account_type):
            return "investing"
        if is_cash_account(code, name, account_type):
            return "cash"
        return "operating"
    if kind == "liability":
        if "payable" in blob or "accrual" in blob or "accrued" in blob:
            return "operating"
        return "financing"
    if kind == "equity":
        return "financing"
    return "operating"


def report_catalog() -> list[dict[str, Any]]:
    return REPORT_CATALOG


def resolve_filters(
    *,
    as_of_date: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    period: str | None = None,
    fiscal_year: int | None = None,
    currency: str | None = None,
    branch: str | None = None,
) -> dict[str, Any]:
    today = date.today()
    cleaned_period = (period or "").strip()
    if cleaned_period and len(cleaned_period) >= 7:
        try:
            start, end = period_bounds(cleaned_period[:7])
        except (ValueError, IndexError) as exc:
            raise HTTPException(status_code=400, detail="period must be YYYY-MM") from exc
    else:
        start, end = date(today.year, today.month, 1), date(today.year, today.month, monthrange(today.year, today.month)[1])
        cleaned_period = f"{today.year:04d}-{today.month:02d}"

    resolved_from = date_from or start
    resolved_to = date_to or end
    if resolved_from > resolved_to:
        raise HTTPException(status_code=400, detail="date_from must be on or before date_to")

    as_of = as_of_date or min(today, resolved_to)
    year = fiscal_year or as_of.year
    return {
        "as_of_date": as_of.isoformat(),
        "date_from": resolved_from.isoformat(),
        "date_to": resolved_to.isoformat(),
        "period": cleaned_period,
        "fiscal_year": year,
        "currency": (currency or "USD").strip().upper() or "USD",
        "branch": (branch or "COMPANY").strip().upper() or "COMPANY",
        "_as_of": as_of,
        "_from": resolved_from,
        "_to": resolved_to,
        "_year": year,
        "_period": cleaned_period,
        "_currency": (currency or "USD").strip().upper() or "USD",
        "_branch": (branch or "COMPANY").strip().upper() or "COMPANY",
    }


def get_financial_report(db: Session, report_type: str, **raw_filters: Any) -> dict[str, Any]:
    report_id = (report_type or "").strip().lower()
    if report_id not in REPORT_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown report type '{report_type}'")
    filters = resolve_filters(**raw_filters)
    builders = {
        "balance-sheet": _balance_sheet,
        "income-statement": _income_statement,
        "cash-flow": _cash_flow_statement,
        "ar-aging": _ar_aging,
        "ap-aging": _ap_aging,
        "trial-balance": _trial_balance,
        "fixed-asset-schedule": _fixed_asset_schedule,
        "cash-flow-forecast": _cash_flow_forecast,
        "budget-vs-actual": _budget_vs_actual,
        "bank-reconciliation": _bank_reconciliation,
    }
    payload = builders[report_id](db, filters)
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    payload["filters"] = {
        key: filters[key]
        for key in ("as_of_date", "date_from", "date_to", "period", "fiscal_year", "currency", "branch")
    }
    payload["currency"] = filters["_currency"]
    payload["report_type"] = report_id
    if filters["_branch"] == "COMPANY":
        payload.setdefault("notes", []).append("Company-wide: this ledger does not keep a branch dimension.")
    return payload


def _columns(*specs: tuple[str, str, str, str]) -> list[dict[str, str]]:
    cols = []
    for key, label, align, fmt in specs:
        cols.append({"key": key, "label": label, "align": align, "format": fmt})
    return cols


def _row(
    cells: dict[str, Any],
    *,
    indent: int = 0,
    emphasis: str = "normal",
    link: str | None = None,
    row_id: str | None = None,
) -> dict[str, Any]:
    return {
        "id": row_id,
        "cells": cells,
        "indent": indent,
        "emphasis": emphasis,
        "link": link,
    }


def _empty_row(label: str, amount_keys: Iterable[str]) -> dict[str, Any]:
    cells: dict[str, Any] = {"label": label}
    for key in amount_keys:
        cells[key] = 0
    return _row(cells, emphasis="section")


def _posted_status_filter():
    return func.lower(func.coalesce(JournalEntry.posting_status, "Posted")) == "posted"


def _currency_filter(currency: str):
    return func.upper(func.coalesce(LedgerPosting.currency, "USD")) == currency.upper()


def _entry_date():
    return func.coalesce(JournalEntry.posting_date, cast(JournalEntry.created_at, Date))


def _account_balances(
    db: Session,
    *,
    as_of: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    currency: str = "USD",
    exclude_close_journals: bool = False,
) -> list[AccountBalance]:
    debit_sum = func.coalesce(func.sum(LedgerPosting.debit), 0)
    credit_sum = func.coalesce(func.sum(LedgerPosting.credit), 0)
    query = (
        db.query(
            ChartOfAccount.id,
            ChartOfAccount.account_code,
            ChartOfAccount.account_name,
            ChartOfAccount.account_type,
            debit_sum,
            credit_sum,
        )
        .join(LedgerPosting, LedgerPosting.account_id == ChartOfAccount.id)
        .join(JournalEntry, JournalEntry.id == LedgerPosting.entry_id)
        .filter(_posted_status_filter())
        .filter(_currency_filter(currency))
    )
    if exclude_close_journals:
        query = query.filter(pnl_operating_journal_filter())
    if as_of is not None:
        query = query.filter(_entry_date() <= as_of)
    if date_from is not None:
        query = query.filter(_entry_date() >= date_from)
    if date_to is not None:
        query = query.filter(_entry_date() <= date_to)
    rows = (
        query.group_by(
            ChartOfAccount.id,
            ChartOfAccount.account_code,
            ChartOfAccount.account_name,
            ChartOfAccount.account_type,
        )
        .order_by(ChartOfAccount.account_code)
        .all()
    )
    return [
        AccountBalance(
            account_id=row[0],
            account_code=row[1] or "",
            account_name=row[2] or "",
            account_type=row[3] or "",
            debit=money(row[4]),
            credit=money(row[5]),
        )
        for row in rows
    ]


def _section_accounts(balances: list[AccountBalance], account_type: str) -> list[AccountBalance]:
    wanted = normalize_account_type(account_type)
    return [
        item
        for item in balances
        if normalize_account_type(item.account_type, item.account_code, item.account_name) == wanted
    ]


def _append_account_rows(
    rows: list[dict[str, Any]],
    title: str,
    accounts: list[AccountBalance],
    amount_key: str = "amount",
) -> Decimal:
    rows.append(_row({"label": title, amount_key: None}, emphasis="section"))
    total = ZERO
    for account in accounts:
        amount = account.signed
        total += amount
        rows.append(
            _row(
                {
                    "label": f"{account.account_code}  {account.account_name}",
                    amount_key: num(amount),
                },
                indent=1,
            )
        )
    if not accounts:
        rows.append(_row({"label": "No balances", amount_key: 0}, indent=1))
    rows.append(_row({"label": f"Total {title}", amount_key: num(total)}, emphasis="total"))
    return total


def _zero_pnl_balance(account: AccountBalance) -> AccountBalance:
    return AccountBalance(
        account_id=account.account_id,
        account_code=account.account_code,
        account_name=account.account_name,
        account_type=account.account_type,
        debit=ZERO,
        credit=ZERO,
    )


def _combine_pnl_accounts(
    period_accounts: list[AccountBalance],
    ytd_accounts: list[AccountBalance],
) -> list[tuple[AccountBalance, AccountBalance]]:
    period_by_id = {item.account_id: item for item in period_accounts}
    ytd_by_id = {item.account_id: item for item in ytd_accounts}
    ordered: list[AccountBalance] = []
    seen: set[UUID] = set()
    for item in period_accounts:
        ordered.append(item)
        seen.add(item.account_id)
    extras = sorted(
        (item for item in ytd_accounts if item.account_id not in seen),
        key=lambda item: item.account_code,
    )
    ordered.extend(extras)
    pairs: list[tuple[AccountBalance, AccountBalance]] = []
    for item in ordered:
        pairs.append(
            (
                period_by_id.get(item.account_id) or _zero_pnl_balance(item),
                ytd_by_id.get(item.account_id) or _zero_pnl_balance(item),
            )
        )
    return pairs


def _pnl_year_start(filters: dict[str, Any]) -> date:
    date_to: date = filters["_to"]
    year_start = date(int(filters["_year"]), 1, 1)
    if year_start > date_to:
        year_start = date(date_to.year, 1, 1)
    return year_start


def _is_cogs_account(account: AccountBalance) -> bool:
    blob = f"{account.account_code} {account.account_name}".lower()
    return any(token in blob for token in ("cogs", "cost of", "cost of sales", "cost of goods"))


def _split_cogs(accounts: list[AccountBalance]) -> tuple[list[AccountBalance], list[AccountBalance]]:
    cogs: list[AccountBalance] = []
    opex: list[AccountBalance] = []
    for account in accounts:
        if _is_cogs_account(account):
            cogs.append(account)
        else:
            opex.append(account)
    return cogs, opex


def _pnl_keys(
    *,
    debit: float | None = None,
    credit: float | None = None,
    amount: float | None = None,
    ytd_debit: float | None = None,
    ytd_credit: float | None = None,
    ytd_amount: float | None = None,
) -> dict[str, Any]:
    return {
        "debit": debit,
        "credit": credit,
        "amount": amount,
        "ytd_debit": ytd_debit,
        "ytd_credit": ytd_credit,
        "ytd_amount": ytd_amount,
    }


def _append_pnl_account_rows(
    rows: list[dict[str, Any]],
    title: str,
    accounts: list[AccountBalance],
    ytd_accounts: list[AccountBalance] | None = None,
) -> tuple[Decimal, Decimal]:
    """P&L lines show period and YTD debit, credit, and signed net so 4110001 reconciles."""
    ytd_list = ytd_accounts if ytd_accounts is not None else accounts
    pairs = _combine_pnl_accounts(accounts, ytd_list)
    rows.append(_row({"label": title, **_pnl_keys()}, emphasis="section"))
    total = ZERO
    ytd_total = ZERO
    debit_total = ZERO
    credit_total = ZERO
    ytd_debit_total = ZERO
    ytd_credit_total = ZERO
    for period, ytd in pairs:
        amount = period.signed
        ytd_amount = ytd.signed
        total += amount
        ytd_total += ytd_amount
        debit_total += period.debit
        credit_total += period.credit
        ytd_debit_total += ytd.debit
        ytd_credit_total += ytd.credit
        rows.append(
            _row(
                {
                    "label": f"{period.account_code}  {period.account_name}",
                    **_pnl_keys(
                        debit=num(period.debit),
                        credit=num(period.credit),
                        amount=num(amount),
                        ytd_debit=num(ytd.debit),
                        ytd_credit=num(ytd.credit),
                        ytd_amount=num(ytd_amount),
                    ),
                },
                indent=1,
            )
        )
    if not pairs:
        rows.append(
            _row(
                {
                    "label": "No balances",
                    **_pnl_keys(debit=0, credit=0, amount=0, ytd_debit=0, ytd_credit=0, ytd_amount=0),
                },
                indent=1,
            )
        )
    rows.append(
        _row(
            {
                "label": f"Total {title}",
                **_pnl_keys(
                    debit=num(debit_total),
                    credit=num(credit_total),
                    amount=num(total),
                    ytd_debit=num(ytd_debit_total),
                    ytd_credit=num(ytd_credit_total),
                    ytd_amount=num(ytd_total),
                ),
            },
            emphasis="total",
        )
    )
    return total, ytd_total


def _balance_sheet(db: Session, filters: dict[str, Any]) -> dict[str, Any]:
    as_of: date = filters["_as_of"]
    year_start = date(filters["_year"], 1, 1)
    balances = _account_balances(db, as_of=as_of, currency=filters["_currency"])
    period_pnl = _account_balances(
        db, date_from=year_start, date_to=as_of, currency=filters["_currency"]
    )
    revenue = sum((item.signed for item in _section_accounts(period_pnl, "Revenue")), ZERO)
    expense = sum((item.signed for item in _section_accounts(period_pnl, "Expense")), ZERO)
    net_income = money(revenue - expense)

    rows: list[dict[str, Any]] = []
    asset_total = _append_account_rows(rows, "Assets", _section_accounts(balances, "Asset"))
    liability_total = _append_account_rows(rows, "Liabilities", _section_accounts(balances, "Liability"))
    equity_accounts = _section_accounts(balances, "Equity")
    equity_total = _append_account_rows(rows, "Equity", equity_accounts)
    rows.append(
        _row(
            {"label": "Current year net income", "amount": num(net_income)},
            indent=1,
        )
    )
    equity_with_ni = money(equity_total + net_income)
    rows.append(_row({"label": "Total Equity", "amount": num(equity_with_ni)}, emphasis="total"))
    le_total = money(liability_total + equity_with_ni)
    rows.append(_row({"label": "Total Liabilities & Equity", "amount": num(le_total)}, emphasis="net"))
    difference = money(asset_total - le_total)
    if difference != ZERO:
        rows.append(_row({"label": "Out of balance", "amount": num(difference)}, emphasis="negative"))

    notes = [
        f"Balances include posted journals through {as_of.isoformat()}.",
        "Current year net income (YTD) is presented under equity until period close.",
    ]
    return {
        "title": "Balance Sheet",
        "subtitle": f"As of {as_of.isoformat()}",
        "columns": _columns(("label", "Account", "left", "text"), ("amount", "Amount", "right", "number")),
        "rows": rows,
        "summary": {
            "total_assets": num(asset_total),
            "total_liabilities": num(liability_total),
            "total_equity": num(equity_with_ni),
            "net_income_ytd": num(net_income),
            "out_of_balance": num(difference),
        },
        "notes": notes,
    }


def _income_statement(db: Session, filters: dict[str, Any]) -> dict[str, Any]:
    date_from: date = filters["_from"]
    date_to: date = filters["_to"]
    ytd_from = _pnl_year_start(filters)
    currency = filters["_currency"]
    balances = _account_balances(
        db,
        date_from=date_from,
        date_to=date_to,
        currency=currency,
        exclude_close_journals=True,
    )
    ytd_balances = _account_balances(
        db,
        date_from=ytd_from,
        date_to=date_to,
        currency=currency,
        exclude_close_journals=True,
    )
    revenue_accts = _section_accounts(balances, "Revenue")
    ytd_revenue_accts = _section_accounts(ytd_balances, "Revenue")
    expense_accts = _section_accounts(balances, "Expense")
    ytd_expense_accts = _section_accounts(ytd_balances, "Expense")
    cogs, opex = _split_cogs(expense_accts)
    ytd_cogs, ytd_opex = _split_cogs(ytd_expense_accts)

    rows: list[dict[str, Any]] = []
    revenue_total, ytd_revenue_total = _append_pnl_account_rows(
        rows, "Revenue", revenue_accts, ytd_revenue_accts
    )
    if cogs or ytd_cogs:
        cogs_total, ytd_cogs_total = _append_pnl_account_rows(rows, "Cost of Sales", cogs, ytd_cogs)
        gross = money(revenue_total - cogs_total)
        ytd_gross = money(ytd_revenue_total - ytd_cogs_total)
        rows.append(
            _row(
                {
                    "label": "Gross Profit",
                    **_pnl_keys(amount=num(gross), ytd_amount=num(ytd_gross)),
                },
                emphasis="total",
            )
        )
    else:
        cogs_total = ZERO
        ytd_cogs_total = ZERO
        gross = revenue_total
        ytd_gross = ytd_revenue_total
    opex_total, ytd_opex_total = _append_pnl_account_rows(
        rows, "Operating Expenses", opex, ytd_opex
    )
    net = money(revenue_total - cogs_total - opex_total)
    ytd_net = money(ytd_revenue_total - ytd_cogs_total - ytd_opex_total)
    rows.append(
        _row(
            {
                "label": "Net Income",
                **_pnl_keys(amount=num(net), ytd_amount=num(ytd_net)),
            },
            emphasis="net",
        )
    )
    return {
        "title": "Income Statement (Profit & Loss)",
        "subtitle": (
            f"{date_from.isoformat()} to {date_to.isoformat()}"
            f" · YTD {ytd_from.isoformat()} to {date_to.isoformat()}"
        ),
        "columns": _columns(
            ("label", "Account", "left", "text"),
            ("debit", "Debit", "right", "number"),
            ("credit", "Credit", "right", "number"),
            ("amount", "Net", "right", "number"),
            ("ytd_debit", "YTD Debit", "right", "number"),
            ("ytd_credit", "YTD Credit", "right", "number"),
            ("ytd_amount", "YTD Net", "right", "number"),
        ),
        "rows": rows,
        "summary": {
            "revenue": num(revenue_total),
            "cogs": num(cogs_total),
            "gross_profit": num(gross),
            "operating_expenses": num(opex_total),
            "net_income": num(net),
            "ytd_revenue": num(ytd_revenue_total),
            "ytd_cogs": num(ytd_cogs_total),
            "ytd_gross_profit": num(ytd_gross),
            "ytd_operating_expenses": num(ytd_opex_total),
            "ytd_net_income": num(ytd_net),
        },
        "notes": [
            "Debit / Credit / Net are posted operating activity in the selected date range (revenue: credit − debit; expense: debit − credit).",
            f"YTD Debit / YTD Credit / YTD Net are the same operating activity from {ytd_from.isoformat()} through {date_to.isoformat()}.",
            "Month-end and year-end close journals are excluded so operating revenue is not zeroed after park.",
            "Trial Balance Period Debit / Period Credit / Period Net match the Income Statement period columns, so 4110001 must match.",
        ],
    }


def _cash_account_ids(db: Session) -> set[UUID]:
    ids: set[UUID] = set()
    for account in db.query(ChartOfAccount).all():
        if is_cash_account(account.account_code, account.account_name, account.account_type):
            ids.add(account.id)
    mapped = (
        db.query(BankAccount.gl_account_id)
        .filter(BankAccount.gl_account_id.isnot(None))
        .all()
    )
    for (gl_id,) in mapped:
        if gl_id:
            ids.add(gl_id)
    return ids


def _cash_flow_statement(db: Session, filters: dict[str, Any]) -> dict[str, Any]:
    date_from: date = filters["_from"]
    date_to: date = filters["_to"]
    currency = filters["_currency"]
    cash_ids = _cash_account_ids(db)
    beginning = sum(
        (item.signed for item in _account_balances(db, as_of=date_from - timedelta(days=1), currency=currency) if item.account_id in cash_ids),
        ZERO,
    )
    ending = sum(
        (item.signed for item in _account_balances(db, as_of=date_to, currency=currency) if item.account_id in cash_ids),
        ZERO,
    )

    entries = (
        db.query(JournalEntry)
        .options(selectinload(JournalEntry.postings).selectinload(LedgerPosting.account))
        .filter(_posted_status_filter())
        .filter(_entry_date() >= date_from)
        .filter(_entry_date() <= date_to)
        .all()
    )
    buckets: dict[str, Decimal] = defaultdict(lambda: ZERO)
    detail_rows: list[dict[str, Any]] = []
    for entry in entries:
        cash_delta = ZERO
        others: list[tuple[str, str, str, Decimal]] = []
        for posting in entry.postings or []:
            if posting.currency and posting.currency.upper() != currency:
                continue
            account = posting.account
            code = getattr(account, "account_code", "") if account else ""
            name = getattr(account, "account_name", "") if account else ""
            atype = getattr(account, "account_type", "") if account else ""
            signed_line = money(posting.debit) - money(posting.credit)
            if posting.account_id in cash_ids or is_cash_account(code, name, atype):
                cash_delta += signed_line
            else:
                others.append((atype, code, name, signed_line))
        if cash_delta == ZERO:
            continue
        if others:
            dominant = max(others, key=lambda item: abs(item[3]))
            section = classify_counter_account(dominant[0], dominant[1], dominant[2])
        else:
            section = "operating"
        if section == "cash":
            section = "operating"
        buckets[section] += cash_delta
        detail_rows.append(
            _row(
                {
                    "label": (entry.description or "Journal")[:80],
                    "section": section.title(),
                    "amount": num(cash_delta),
                },
                indent=1,
            )
        )

    operating = money(buckets["operating"])
    investing = money(buckets["investing"])
    financing = money(buckets["financing"])
    net_change = money(operating + investing + financing)
    rows = [
        _row({"label": "Cash at beginning of period", "amount": num(beginning)}, emphasis="total"),
        _row({"label": "Cash flows from operating activities", "amount": None}, emphasis="section"),
        _row({"label": "Net cash from operations", "amount": num(operating)}, indent=1),
        _row({"label": "Cash flows from investing activities", "amount": None}, emphasis="section"),
        _row({"label": "Net cash from investing", "amount": num(investing)}, indent=1),
        _row({"label": "Cash flows from financing activities", "amount": None}, emphasis="section"),
        _row({"label": "Net cash from financing", "amount": num(financing)}, indent=1),
        _row({"label": "Net increase (decrease) in cash", "amount": num(net_change)}, emphasis="net"),
        _row({"label": "Cash at end of period", "amount": num(ending)}, emphasis="net"),
    ]
    if detail_rows:
        rows.append(_row({"label": "Journal detail", "amount": None}, emphasis="section"))
        rows.extend(detail_rows[:200])
    implied = money(beginning + net_change)
    notes = [
        "Cash is identified from cash/bank G/L accounts and bank-account mappings.",
        "Sections are classified from the counter-account on each cash journal.",
    ]
    if implied != ending:
        notes.append(
            f"Classified cash movement ({implied}) differs from G/L ending cash ({ending}) by {money(ending - implied)}."
        )
    return {
        "title": "Statement of Cash Flows",
        "subtitle": f"{date_from.isoformat()} to {date_to.isoformat()}",
        "columns": _columns(
            ("label", "Description", "left", "text"),
            ("section", "Section", "left", "text"),
            ("amount", "Amount", "right", "number"),
        ),
        "rows": rows,
        "summary": {
            "beginning_cash": num(beginning),
            "operating": num(operating),
            "investing": num(investing),
            "financing": num(financing),
            "net_change": num(net_change),
            "ending_cash": num(ending),
        },
        "notes": notes,
    }


def _payment_totals(db: Session, txn_type: str, as_of: date) -> dict[str, Decimal]:
    txn_date = cast(CashTransaction.transaction_date, Date)
    rows = (
        db.query(
            CashTransaction.reference_id,
            func.coalesce(func.sum(CashTransaction.amount), 0),
        )
        .filter(CashTransaction.type == txn_type)
        .filter(func.upper(CashTransaction.clearing_status) != "VOID")
        .filter(txn_date <= as_of)
        .group_by(CashTransaction.reference_id)
        .all()
    )
    return {ref: money(total) for ref, total in rows if ref}


def _ar_aging(db: Session, filters: dict[str, Any]) -> dict[str, Any]:
    as_of: date = filters["_as_of"]
    paid = _payment_totals(db, "Check Deposit", as_of)
    invoices = (
        db.query(ARInvoice, Customer.company_name)
        .outerjoin(Customer, Customer.customer_id == ARInvoice.customer_id)
        .filter(cast(ARInvoice.created_at, Date) <= as_of)
        .all()
    )
    totals = {key: ZERO for key in ("current", "d1_30", "d31_60", "d61_90", "d90")}
    rows: list[dict[str, Any]] = []
    grand = ZERO
    for invoice, customer_name in invoices:
        outstanding = ZERO if (invoice.status or "") == "Paid" else money(invoice.amount) - paid.get(invoice.invoice_id, ZERO)
        if outstanding <= ZERO:
            continue
        due = invoice.due_date or as_of
        bucket = aging_bucket((as_of - due).days)
        totals[bucket] += outstanding
        grand += outstanding
        cells = {
            "label": invoice.invoice_id,
            "party": customer_name or invoice.customer_id,
            "due_date": due.isoformat() if due else "",
            "status": invoice.status,
            "current": 0,
            "d1_30": 0,
            "d31_60": 0,
            "d61_90": 0,
            "d90": 0,
            "total": num(outstanding),
        }
        cells[bucket] = num(outstanding)
        rows.append(_row(cells, link=f"/accounts-receivable?invoice={invoice.invoice_id}", row_id=invoice.invoice_id))
    rows.sort(key=lambda item: str(item["cells"].get("party") or ""))
    rows.append(
        _row(
            {
                "label": "Total",
                "party": "",
                "due_date": "",
                "status": "",
                "current": num(totals["current"]),
                "d1_30": num(totals["d1_30"]),
                "d31_60": num(totals["d31_60"]),
                "d61_90": num(totals["d61_90"]),
                "d90": num(totals["d90"]),
                "total": num(grand),
            },
            emphasis="net",
        )
    )
    if len(rows) == 1:
        rows.insert(0, _row({"label": "No open receivables", "total": 0}, emphasis="section"))
    return {
        "title": "Accounts Receivable Aging",
        "subtitle": f"As of {as_of.isoformat()}",
        "columns": _columns(
            ("label", "Invoice", "left", "text"),
            ("party", "Customer", "left", "text"),
            ("due_date", "Due Date", "left", "date"),
            ("status", "Status", "left", "text"),
            ("current", "Current", "right", "number"),
            ("d1_30", "1–30", "right", "number"),
            ("d31_60", "31–60", "right", "number"),
            ("d61_90", "61–90", "right", "number"),
            ("d90", "90+", "right", "number"),
            ("total", "Total", "right", "number"),
        ),
        "rows": rows,
        "summary": {key: num(value) for key, value in totals.items()} | {"total": num(grand)},
        "notes": ["Outstanding = invoice amount less non-void deposits dated on or before the as-of date."],
    }


def _ap_aging(db: Session, filters: dict[str, Any]) -> dict[str, Any]:
    as_of: date = filters["_as_of"]
    paid = _payment_totals(db, "Check Issue", as_of)
    bills = (
        db.query(APBill, Supplier.company_name)
        .outerjoin(Supplier, Supplier.supplier_id == APBill.vendor_id)
        .filter(cast(APBill.created_at, Date) <= as_of)
        .all()
    )
    totals = {key: ZERO for key in ("current", "d1_30", "d31_60", "d61_90", "d90")}
    rows: list[dict[str, Any]] = []
    grand = ZERO
    for bill, vendor_name in bills:
        outstanding = ZERO if (bill.status or "") == "Paid" else money(bill.amount) - paid.get(bill.bill_id, ZERO)
        if outstanding <= ZERO:
            continue
        due = bill.due_date or as_of
        bucket = aging_bucket((as_of - due).days)
        totals[bucket] += outstanding
        grand += outstanding
        cells = {
            "label": bill.bill_id,
            "party": vendor_name or bill.vendor_id,
            "due_date": due.isoformat() if due else "",
            "status": bill.status,
            "current": 0,
            "d1_30": 0,
            "d31_60": 0,
            "d61_90": 0,
            "d90": 0,
            "total": num(outstanding),
        }
        cells[bucket] = num(outstanding)
        rows.append(_row(cells, link=f"/accounts-payable?bill={bill.bill_id}", row_id=bill.bill_id))
    rows.sort(key=lambda item: str(item["cells"].get("party") or ""))
    rows.append(
        _row(
            {
                "label": "Total",
                "party": "",
                "due_date": "",
                "status": "",
                "current": num(totals["current"]),
                "d1_30": num(totals["d1_30"]),
                "d31_60": num(totals["d31_60"]),
                "d61_90": num(totals["d61_90"]),
                "d90": num(totals["d90"]),
                "total": num(grand),
            },
            emphasis="net",
        )
    )
    if len(rows) == 1:
        rows.insert(0, _row({"label": "No open payables", "total": 0}, emphasis="section"))
    return {
        "title": "Accounts Payable Aging",
        "subtitle": f"As of {as_of.isoformat()}",
        "columns": _columns(
            ("label", "Bill", "left", "text"),
            ("party", "Vendor", "left", "text"),
            ("due_date", "Due Date", "left", "date"),
            ("status", "Status", "left", "text"),
            ("current", "Current", "right", "number"),
            ("d1_30", "1–30", "right", "number"),
            ("d31_60", "31–60", "right", "number"),
            ("d61_90", "61–90", "right", "number"),
            ("d90", "90+", "right", "number"),
            ("total", "Total", "right", "number"),
        ),
        "rows": rows,
        "summary": {key: num(value) for key, value in totals.items()} | {"total": num(grand)},
        "notes": ["Outstanding = bill amount less non-void issues dated on or before the as-of date."],
    }


def _trial_balance(db: Session, filters: dict[str, Any]) -> dict[str, Any]:
    as_of: date = filters["_as_of"]
    date_from: date = filters["_from"]
    date_to: date = filters["_to"]
    balances = _account_balances(db, as_of=as_of, currency=filters["_currency"])
    period_balances = _account_balances(
        db,
        date_from=date_from,
        date_to=date_to,
        currency=filters["_currency"],
        exclude_close_journals=True,
    )
    period_by_id = {item.account_id: item for item in period_balances}
    seen = {item.account_id for item in balances}
    extra_period = [item for item in period_balances if item.account_id not in seen]
    rows: list[dict[str, Any]] = []
    debit_total = ZERO
    credit_total = ZERO
    period_debit_total = ZERO
    period_credit_total = ZERO
    period_net_total = ZERO
    for account in [*balances, *extra_period]:
        period = period_by_id.get(account.account_id)
        period_debit = period.debit if period else ZERO
        period_credit = period.credit if period else ZERO
        period_net = period.signed if period else ZERO
        debit_total += account.debit
        credit_total += account.credit
        period_debit_total += period_debit
        period_credit_total += period_credit
        period_net_total += period_net
        rows.append(
            _row(
                {
                    "label": f"{account.account_code}  {account.account_name}",
                    "type": account.account_type,
                    "debit": num(account.debit),
                    "credit": num(account.credit),
                    "balance": num(account.signed),
                    "period_debit": num(period_debit),
                    "period_credit": num(period_credit),
                    "period_net": num(period_net),
                }
            )
        )
    rows.append(
        _row(
            {
                "label": "Total",
                "type": "",
                "debit": num(debit_total),
                "credit": num(credit_total),
                "balance": num(debit_total - credit_total),
                "period_debit": num(period_debit_total),
                "period_credit": num(period_credit_total),
                "period_net": num(period_net_total),
            },
            emphasis="net",
        )
    )
    difference = money(debit_total - credit_total)
    notes = [
        "Debit / Credit / Net (normal) are cumulative posted activity through the as-of date, including close journals.",
        f"Period Debit / Period Credit / Period Net are posted operating activity {date_from.isoformat()} to {date_to.isoformat()}, excluding close. Those columns match the Income Statement.",
        "Reconcile journal export to the cumulative columns by filtering Posting = Posted.",
    ]
    if difference != ZERO:
        notes.append(f"Trial balance is out of balance by {difference}.")
    return {
        "title": "Trial Balance",
        "subtitle": f"As of {as_of.isoformat()}",
        "columns": _columns(
            ("label", "Account", "left", "text"),
            ("type", "Type", "left", "text"),
            ("debit", "Debit", "right", "number"),
            ("credit", "Credit", "right", "number"),
            ("balance", "Net (normal)", "right", "number"),
            ("period_debit", "Period Debit", "right", "number"),
            ("period_credit", "Period Credit", "right", "number"),
            ("period_net", "Period Net", "right", "number"),
        ),
        "rows": rows
        or [
            _empty_row(
                "No posted activity",
                ("debit", "credit", "balance", "period_debit", "period_credit", "period_net"),
            )
        ],
        "summary": {
            "total_debit": num(debit_total),
            "total_credit": num(credit_total),
            "out_of_balance": num(difference),
            "period_debit": num(period_debit_total),
            "period_credit": num(period_credit_total),
            "period_net": num(period_net_total),
        },
        "notes": notes,
    }


def _fixed_asset_schedule(db: Session, filters: dict[str, Any]) -> dict[str, Any]:
    date_from: date = filters["_from"]
    date_to: date = filters["_to"]
    opening = {
        item.account_id: item
        for item in _account_balances(db, as_of=date_from - timedelta(days=1), currency=filters["_currency"])
    }
    movement = {
        item.account_id: item
        for item in _account_balances(
            db, date_from=date_from, date_to=date_to, currency=filters["_currency"]
        )
    }
    ending = {
        item.account_id: item
        for item in _account_balances(db, as_of=date_to, currency=filters["_currency"])
    }
    account_ids = set(opening) | set(movement) | set(ending)
    accounts = {
        account.id: account
        for account in db.query(ChartOfAccount).filter(ChartOfAccount.id.in_(account_ids)).all()
    } if account_ids else {}
    rows: list[dict[str, Any]] = []
    begin_total = add_total = disp_total = end_total = ZERO
    for account_id in sorted(account_ids, key=lambda key: (accounts.get(key).account_code if accounts.get(key) else "")):
        account = accounts.get(account_id)
        if not account or not is_fixed_asset_account(account.account_code, account.account_name, account.account_type):
            continue
        start_bal = opening.get(account_id)
        move = movement.get(account_id)
        end_bal = ending.get(account_id)
        beginning = start_bal.signed if start_bal else ZERO
        additions = money(move.debit) if move else ZERO
        disposals = money(move.credit) if move else ZERO
        if is_contra_asset(account.account_name):
            # Contra: credits increase the contra balance
            additions = money(move.credit) if move else ZERO
            disposals = money(move.debit) if move else ZERO
        ending_amt = end_bal.signed if end_bal else money(beginning + additions - disposals)
        begin_total += beginning
        add_total += additions
        disp_total += disposals
        end_total += ending_amt
        rows.append(
            _row(
                {
                    "label": f"{account.account_code}  {account.account_name}",
                    "type": "Contra" if is_contra_asset(account.account_name) else account.account_type,
                    "beginning": num(beginning),
                    "additions": num(additions),
                    "disposals": num(disposals),
                    "ending": num(ending_amt),
                }
            )
        )
    rows.append(
        _row(
            {
                "label": "Total",
                "type": "",
                "beginning": num(begin_total),
                "additions": num(add_total),
                "disposals": num(disp_total),
                "ending": num(end_total),
            },
            emphasis="net",
        )
    )
    notes = [
        "Fixed-asset accounts are inferred from G/L codes (15xx–18xx) and names (PPE, equipment, depreciation).",
        "There is no separate asset register; amounts come from posted ledger activity.",
    ]
    if len(rows) == 1:
        rows.insert(0, _row({"label": "No fixed-asset G/L accounts with activity", "ending": 0}, emphasis="section"))
    return {
        "title": "Fixed Asset Schedule",
        "subtitle": f"{date_from.isoformat()} to {date_to.isoformat()}",
        "columns": _columns(
            ("label", "Account", "left", "text"),
            ("type", "Class", "left", "text"),
            ("beginning", "Beginning", "right", "number"),
            ("additions", "Additions", "right", "number"),
            ("disposals", "Disposals / Accum.", "right", "number"),
            ("ending", "Ending", "right", "number"),
        ),
        "rows": rows,
        "summary": {
            "beginning": num(begin_total),
            "additions": num(add_total),
            "disposals": num(disp_total),
            "ending": num(end_total),
        },
        "notes": notes,
    }


def _open_ar_by_bucket(db: Session, as_of: date) -> dict[str, Decimal]:
    paid = _payment_totals(db, "Check Deposit", as_of)
    totals = {key: ZERO for key in ("overdue", "d0_30", "d31_60", "d61_90", "d90")}
    invoices = db.query(ARInvoice).filter(cast(ARInvoice.created_at, Date) <= as_of).all()
    for invoice in invoices:
        outstanding = ZERO if (invoice.status or "") == "Paid" else money(invoice.amount) - paid.get(invoice.invoice_id, ZERO)
        if outstanding <= ZERO:
            continue
        due = invoice.due_date or as_of
        days = (due - as_of).days
        if days < 0:
            totals["overdue"] += outstanding
        elif days <= 30:
            totals["d0_30"] += outstanding
        elif days <= 60:
            totals["d31_60"] += outstanding
        elif days <= 90:
            totals["d61_90"] += outstanding
        else:
            totals["d90"] += outstanding
    return totals


def _open_ap_by_bucket(db: Session, as_of: date) -> dict[str, Decimal]:
    paid = _payment_totals(db, "Check Issue", as_of)
    totals = {key: ZERO for key in ("overdue", "d0_30", "d31_60", "d61_90", "d90")}
    bills = db.query(APBill).filter(cast(APBill.created_at, Date) <= as_of).all()
    for bill in bills:
        outstanding = ZERO if (bill.status or "") == "Paid" else money(bill.amount) - paid.get(bill.bill_id, ZERO)
        if outstanding <= ZERO:
            continue
        due = bill.due_date or as_of
        days = (due - as_of).days
        if days < 0:
            totals["overdue"] += outstanding
        elif days <= 30:
            totals["d0_30"] += outstanding
        elif days <= 60:
            totals["d31_60"] += outstanding
        elif days <= 90:
            totals["d61_90"] += outstanding
        else:
            totals["d90"] += outstanding
    return totals


def _cash_flow_forecast(db: Session, filters: dict[str, Any]) -> dict[str, Any]:
    as_of: date = filters["_as_of"]
    cash_ids = _cash_account_ids(db)
    starting = sum(
        (item.signed for item in _account_balances(db, as_of=as_of, currency=filters["_currency"]) if item.account_id in cash_ids),
        ZERO,
    )
    ar = _open_ar_by_bucket(db, as_of)
    ap = _open_ap_by_bucket(db, as_of)
    labels = [
        ("overdue", "Overdue"),
        ("d0_30", "Next 30 days"),
        ("d31_60", "31–60 days"),
        ("d61_90", "61–90 days"),
        ("d90", "90+ days"),
    ]
    rows = [_row({"label": "Starting cash (book)", "inflow": num(starting), "outflow": 0, "net": num(starting)}, emphasis="total")]
    running = starting
    for key, label in labels:
        inflow = ar[key]
        outflow = ap[key]
        net = money(inflow - outflow)
        running += net
        rows.append(
            _row(
                {
                    "label": label,
                    "inflow": num(inflow),
                    "outflow": num(outflow),
                    "net": num(net),
                }
            )
        )
    rows.append(
        _row(
            {
                "label": "Projected cash",
                "inflow": num(sum(ar.values(), ZERO) + starting),
                "outflow": num(sum(ap.values(), ZERO)),
                "net": num(running),
            },
            emphasis="net",
        )
    )
    return {
        "title": "Cash Flow Forecast",
        "subtitle": f"Starting {as_of.isoformat()}",
        "columns": _columns(
            ("label", "Horizon", "left", "text"),
            ("inflow", "Expected receipts (AR)", "right", "number"),
            ("outflow", "Expected disbursements (AP)", "right", "number"),
            ("net", "Net cash", "right", "number"),
        ),
        "rows": rows,
        "summary": {
            "starting_cash": num(starting),
            "projected_cash": num(running),
            "open_ar": num(sum(ar.values(), ZERO)),
            "open_ap": num(sum(ap.values(), ZERO)),
        },
        "notes": [
            "Forecast assumes open invoices and bills clear on their due dates and that overdue items clear immediately.",
            "Starting cash is the posted cash/bank G/L balance as of the selected date.",
        ],
    }


def _budget_map(db: Session, fiscal_year: int, period: str, currency: str) -> dict[UUID, Decimal]:
    rows = (
        db.query(FinancialBudget)
        .filter(FinancialBudget.fiscal_year == fiscal_year)
        .filter(FinancialBudget.currency == currency)
        .all()
    )
    monthly: dict[UUID, Decimal] = defaultdict(lambda: ZERO)
    annual: dict[UUID, Decimal] = defaultdict(lambda: ZERO)
    for row in rows:
        amount = money(row.amount)
        if (row.period or "") == period:
            monthly[row.account_id] += amount
        elif not row.period:
            annual[row.account_id] += amount
    if monthly:
        return dict(monthly)
    # Spread annual budget across 12 months when only a year-level book exists.
    return {account_id: money(amount / Decimal("12")) for account_id, amount in annual.items()}


def _budget_vs_actual(db: Session, filters: dict[str, Any]) -> dict[str, Any]:
    date_from: date = filters["_from"]
    date_to: date = filters["_to"]
    def shift_year(value: date) -> date:
        try:
            return date(value.year - 1, value.month, value.day)
        except ValueError:
            return date(value.year - 1, value.month, 28)

    prior_from = shift_year(date_from)
    prior_to = shift_year(date_to)
    actuals = _account_balances(db, date_from=date_from, date_to=date_to, currency=filters["_currency"])
    prior = {
        item.account_id: item
        for item in _account_balances(db, date_from=prior_from, date_to=prior_to, currency=filters["_currency"])
    }
    budgets = _budget_map(db, filters["_year"], filters["_period"], filters["_currency"])
    has_budget = bool(budgets)
    pnl_accounts = [
        item
        for item in actuals
        if normalize_account_type(item.account_type, item.account_code, item.account_name)
        in {"revenue", "expense"}
    ] or [
        item
        for item in prior.values()
        if normalize_account_type(item.account_type, item.account_code, item.account_name)
        in {"revenue", "expense"}
    ]
    # Include budget-only accounts
    extra_ids = set(budgets) - {item.account_id for item in pnl_accounts}
    if extra_ids:
        extras = db.query(ChartOfAccount).filter(ChartOfAccount.id.in_(extra_ids)).all()
        for account in extras:
            if normalize_account_type(account.account_type, account.account_code, account.account_name) not in {
                "revenue",
                "expense",
            }:
                continue
            pnl_accounts.append(
                AccountBalance(account.id, account.account_code, account.account_name, account.account_type, ZERO, ZERO)
            )
    rows: list[dict[str, Any]] = []
    tot_budget = tot_actual = tot_prior = ZERO
    for account in sorted(pnl_accounts, key=lambda item: item.account_code):
        actual = account.signed
        budget = budgets.get(account.account_id)
        prior_amt = prior.get(account.account_id).signed if prior.get(account.account_id) else ZERO
        budget_amt = budget if budget is not None else prior_amt
        variance = money(actual - budget_amt)
        pct = None
        if budget_amt != ZERO:
            pct = float((variance / budget_amt * Decimal("100")).quantize(Decimal("0.1")))
        tot_budget += budget_amt
        tot_actual += actual
        tot_prior += prior_amt
        rows.append(
            _row(
                {
                    "label": f"{account.account_code}  {account.account_name}",
                    "type": account.account_type,
                    "budget": num(budget_amt),
                    "actual": num(actual),
                    "variance": num(variance),
                    "variance_pct": pct,
                    "prior": num(prior_amt),
                },
                emphasis="negative" if (account.account_type or "").lower() == "expense" and variance > ZERO else "normal",
            )
        )
    rows.append(
        _row(
            {
                "label": "Total",
                "type": "",
                "budget": num(tot_budget),
                "actual": num(tot_actual),
                "variance": num(tot_actual - tot_budget),
                "variance_pct": None,
                "prior": num(tot_prior),
            },
            emphasis="net",
        )
    )
    notes = [
        f"Actuals are posted P&L activity from {date_from.isoformat()} to {date_to.isoformat()}.",
    ]
    if has_budget:
        notes.append("Budget amounts come from the financial_budgets book for the selected year/period.")
    else:
        notes.append("No budget book rows were found; the Budget column uses prior-year actuals for the same dates.")
    return {
        "title": "Budget vs. Actual",
        "subtitle": f"{date_from.isoformat()} to {date_to.isoformat()}",
        "columns": _columns(
            ("label", "Account", "left", "text"),
            ("type", "Type", "left", "text"),
            ("budget", "Budget", "right", "number"),
            ("actual", "Actual", "right", "number"),
            ("variance", "Variance", "right", "number"),
            ("variance_pct", "Var %", "right", "percent"),
            ("prior", "Prior year", "right", "number"),
        ),
        "rows": rows or [_empty_row("No P&L activity", ("budget", "actual", "variance", "prior"))],
        "summary": {
            "budget": num(tot_budget),
            "actual": num(tot_actual),
            "variance": num(tot_actual - tot_budget),
            "has_budget_book": has_budget,
        },
        "notes": notes,
    }


def _bank_reconciliation(db: Session, filters: dict[str, Any]) -> dict[str, Any]:
    as_of: date = filters["_as_of"]
    date_from: date = filters["_from"]
    date_to: date = filters["_to"]
    banks = db.query(BankAccount).order_by(BankAccount.bank_name, BankAccount.account_name).all()
    gl_balances = {
        item.account_id: item
        for item in _account_balances(db, as_of=as_of, currency=filters["_currency"])
    }
    gl_counts: dict[Any, int] = defaultdict(int)
    for bank in banks:
        if bank.gl_account_id:
            gl_counts[bank.gl_account_id] += 1
    seen_gl: set[Any] = set()
    txn_date = cast(CashTransaction.transaction_date, Date)
    rows: list[dict[str, Any]] = []
    book_total = pending_dep = pending_iss = cleared_total = ZERO
    for bank in banks:
        gl = gl_balances.get(bank.gl_account_id) if bank.gl_account_id else None
        shared = bool(bank.gl_account_id and gl_counts.get(bank.gl_account_id, 0) > 1)
        first_for_gl = bool(bank.gl_account_id and bank.gl_account_id not in seen_gl)
        if bank.gl_account_id:
            seen_gl.add(bank.gl_account_id)
        book = gl.signed if gl and first_for_gl else ZERO
        q = db.query(CashTransaction).filter(CashTransaction.bank_account_id == bank.bank_account_id)
        pending_deposits = money(
            q.filter(CashTransaction.type == "Check Deposit")
            .filter(func.upper(CashTransaction.clearing_status) == "PENDING")
            .filter(txn_date <= as_of)
            .with_entities(func.coalesce(func.sum(CashTransaction.amount), 0))
            .scalar()
        )
        pending_issues = money(
            db.query(func.coalesce(func.sum(CashTransaction.amount), 0))
            .filter(CashTransaction.bank_account_id == bank.bank_account_id)
            .filter(CashTransaction.type == "Check Issue")
            .filter(func.upper(CashTransaction.clearing_status) == "PENDING")
            .filter(txn_date <= as_of)
            .scalar()
        )
        cleared = money(
            db.query(func.coalesce(func.sum(CashTransaction.amount), 0))
            .filter(CashTransaction.bank_account_id == bank.bank_account_id)
            .filter(func.upper(CashTransaction.clearing_status) == "CLEARED")
            .filter(txn_date >= date_from)
            .filter(txn_date <= date_to)
            .scalar()
        )
        adjusted = money(book - pending_deposits + pending_issues)
        book_total += book
        pending_dep += pending_deposits
        pending_iss += pending_issues
        cleared_total += cleared
        gl_label = ""
        if gl:
            gl_label = f"{gl.account_code} — {gl.account_name}"
            if shared and not first_for_gl:
                gl_label += " (shared)"
        rows.append(
            _row(
                {
                    "label": f"{bank.bank_name} / {bank.account_name}",
                    "gl": gl_label or "—",
                    "book": num(book),
                    "pending_deposits": num(pending_deposits),
                    "pending_issues": num(pending_issues),
                    "cleared": num(cleared),
                    "adjusted": num(adjusted),
                    "status": "Inactive" if bank.is_active is False else "Active",
                },
                link=f"/bank-accounts/{bank.bank_account_id}",
                row_id=bank.bank_account_id,
            )
        )
    rows.append(
        _row(
            {
                "label": "Total",
                "gl": "",
                "book": num(book_total),
                "pending_deposits": num(pending_dep),
                "pending_issues": num(pending_iss),
                "cleared": num(cleared_total),
                "adjusted": num(book_total - pending_dep + pending_iss),
                "status": "",
            },
            emphasis="net",
        )
    )
    if len(rows) == 1:
        rows.insert(0, _row({"label": "No bank accounts", "book": 0}, emphasis="section"))
    return {
        "title": "Bank Reconciliation Summary",
        "subtitle": f"As of {as_of.isoformat()} · cleared activity {date_from.isoformat()} to {date_to.isoformat()}",
        "columns": _columns(
            ("label", "Bank Account", "left", "text"),
            ("gl", "Mapped G/L", "left", "text"),
            ("book", "Book balance", "right", "number"),
            ("pending_deposits", "Outstanding deposits", "right", "number"),
            ("pending_issues", "Outstanding checks", "right", "number"),
            ("cleared", "Cleared in period", "right", "number"),
            ("adjusted", "Adjusted book", "right", "number"),
            ("status", "Status", "left", "text"),
        ),
        "rows": rows,
        "summary": {
            "book": num(book_total),
            "pending_deposits": num(pending_dep),
            "pending_issues": num(pending_iss),
            "cleared": num(cleared_total),
        },
        "notes": [
            "Book balance is the mapped cash G/L as of the selected date.",
            "Outstanding items are cash transactions still in PENDING status. Bank statement import is not required for this summary.",
            "When several banks map to the same G/L, the book balance is shown once on the first account so totals are not double-counted.",
        ],
    }
