# @author: Wendy Yang
# @date: 2026-09-23

"""Parse TIPTOP 試算表 CSVs and upsert period ending balances."""

from __future__ import annotations

import csv
import logging
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy.orm import Session

from app.models import ChartOfAccount, GlAccountBalance

DEFAULT_FILENAME = "3-4.試算表 202607_20260917_July.csv"
DEFAULT_PERIOD = "2026-07"
DEFAULT_CURRENCY = "USD"

ACCOUNT_KEYS = (
    "科目代號",
    "科目代号",
    "會計科目",
    "会计科目",
    "account_code",
    "account code",
    "accountcode",
    "aag01",
    "aao02",
    "acct_code",
    "acct code",
    "科目",
    "code",
)
NAME_KEYS = (
    "科目名稱",
    "科目名称",
    "aag02",
    "account_name",
    "account name",
    "accountname",
    "account",
    "description",
    "name",
)
ENDING_KEYS = (
    "期末餘額",
    "期末余额",
    "期末結餘",
    "期末结余",
    "期末",
    "ending_balance",
    "ending",
    "close_balance",
    "closing_balance",
    "balance",
)
ENDING_DEBIT_KEYS = (
    "期末借方",
    "期末借",
    "ending_debit",
    "close_debit",
    "debit",
)
ENDING_CREDIT_KEYS = (
    "期末貸方",
    "期末贷方",
    "期末貸",
    "期末贷",
    "ending_credit",
    "close_credit",
    "credit",
)
PERIOD_KEYS = ("年月", "期間", "期间", "year_month", "period", "yyyymm")
YEAR_KEYS = ("年度", "年", "year", "aao03")
MONTH_KEYS = ("期別", "期别", "月份", "月", "month", "aao04")
SKIP_ACCOUNT_MARKERS = ("合計", "合计", "小計", "小计", "total", "grand total")

logger = logging.getLogger(__name__)


@dataclass
class TrialBalanceRow:
    account_code: str
    account_name: str | None
    ending_debit: Decimal
    ending_credit: Decimal
    ending_balance: Decimal
    period: str
    source_line: int


@dataclass
class ImportResult:
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)


def tip_key(header: str) -> str:
    return header.split("(", 1)[0].strip()


def read_tip_csv(path: Path) -> list[dict[str, str]]:
    last_error: Exception | None = None
    rows: list[dict[str, str]] | None = None
    for encoding in ("utf-8-sig", "utf-8", "cp950", "big5"):
        try:
            with path.open(newline="", encoding=encoding) as handle:
                rows = list(csv.DictReader(handle))
            break
        except UnicodeDecodeError as exc:
            last_error = exc
    if rows is None:
        raise last_error or UnicodeDecodeError("utf-8", b"", 0, 1, "Unable to decode CSV")
    if not rows:
        return []
    keys = {src: tip_key(src) for src in rows[0].keys() if src}
    return [
        {keys[src]: (val or "").strip() for src, val in row.items() if src in keys}
        for row in rows
    ]


def blank(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _norm_header(value: str) -> str:
    return re.sub(r"[\s_\-]+", "", value).lower()


def row_first(row: dict[str, str], keys: tuple[str, ...]) -> str | None:
    lowered = {key.lower(): value for key, value in row.items()}
    collapsed = {_norm_header(key): value for key, value in row.items()}
    for key in keys:
        value = (
            blank(row.get(key))
            or blank(lowered.get(key.lower()))
            or blank(collapsed.get(_norm_header(key)))
        )
        if value:
            return value
    return None


def period_from_filename(name: str, default: str | None = DEFAULT_PERIOD) -> str | None:
    """Use the first YYYYMM token in the file name when the CSV has no period column."""
    match = re.search(r"(20\d{2})(0[1-9]|1[0-2])", name)
    if match:
        return f"{match.group(1)}-{match.group(2)}"
    return default


def parse_number(value: str | None) -> Decimal | None:
    text = blank(value)
    if text is None:
        return None
    cleaned = text.replace(",", "").replace(" ", "").replace("$", "")
    if cleaned in {"-", "—", "–"}:
        return Decimal("0")
    if cleaned.endswith("-") and cleaned[:-1].replace(".", "", 1).isdigit():
        cleaned = f"-{cleaned[:-1]}"
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = f"-{cleaned[1:-1]}"
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def normalize_period(value: str | None, default: str) -> str | None:
    text = blank(value)
    if text is None:
        return default
    digits = re.sub(r"\D", "", text)
    if len(digits) == 6:
        return f"{digits[:4]}-{digits[4:]}"
    if re.fullmatch(r"\d{4}-\d{2}", text):
        return text
    return None


def period_from_parts(year: str | None, month: str | None, default: str) -> str | None:
    year_text = blank(year)
    month_text = blank(month)
    if year_text and month_text:
        digits = re.sub(r"\D", "", month_text)
        if digits.isdigit():
            return f"{year_text[-4:]}-{int(digits):02d}"
    return normalize_period(year_text or month_text, default)


def is_skip_account(account_code: str | None) -> bool:
    if not account_code:
        return True
    lowered = account_code.strip().lower()
    return any(marker in lowered for marker in SKIP_ACCOUNT_MARKERS)


def map_row(row: dict[str, str], default_period: str, line_no: int) -> TrialBalanceRow:
    account_code = row_first(row, ACCOUNT_KEYS)
    if is_skip_account(account_code):
        raise ValueError("account identifier is missing or is a total/section row")

    year_value = row_first(row, YEAR_KEYS)
    month_value = row_first(row, MONTH_KEYS)
    if year_value and month_value:
        period = period_from_parts(year_value, month_value, default_period)
    else:
        period = normalize_period(row_first(row, PERIOD_KEYS), default_period)
    if period != default_period:
        raise ValueError(f"row period {period} is not {default_period}")

    debit = parse_number(row_first(row, ENDING_DEBIT_KEYS))
    credit = parse_number(row_first(row, ENDING_CREDIT_KEYS))
    ending = parse_number(row_first(row, ENDING_KEYS))
    if debit is None and credit is None and ending is None:
        raise ValueError("no numeric ending balance / debit / credit")

    ending_debit = debit if debit is not None else Decimal("0")
    ending_credit = credit if credit is not None else Decimal("0")
    if ending is None:
        ending_balance = ending_debit - ending_credit
    else:
        ending_balance = ending
        if debit is None and credit is None:
            if ending_balance >= 0:
                ending_debit = ending_balance
                ending_credit = Decimal("0")
            else:
                ending_debit = Decimal("0")
                ending_credit = abs(ending_balance)

    return TrialBalanceRow(
        account_code=account_code.strip(),
        account_name=row_first(row, NAME_KEYS),
        ending_debit=ending_debit,
        ending_credit=ending_credit,
        ending_balance=ending_balance,
        period=period,
        source_line=line_no,
    )


def parse_csv(path: Path, default_period: str) -> tuple[list[TrialBalanceRow], list[str]]:
    mapped: list[TrialBalanceRow] = []
    failures: list[str] = []
    raw_rows = read_tip_csv(path)
    if not raw_rows:
        raise ValueError(f"{path.name} has no data rows")
    logger.info("Detected columns: %s", ", ".join(raw_rows[0].keys()))
    for index, row in enumerate(raw_rows, start=2):
        if not any(blank(value) for value in row.values()):
            continue
        try:
            mapped.append(map_row(row, default_period, index))
        except Exception as exc:  # noqa: BLE001 — keep the job running
            message = f"line {index}: {exc}"
            failures.append(message)
            logger.warning(message)
    return mapped, failures


def upsert_rows(
    db: Session,
    rows: list[TrialBalanceRow],
    *,
    source_file: str,
    currency: str = DEFAULT_CURRENCY,
) -> ImportResult:
    result = ImportResult()
    for row in rows:
        try:
            with db.begin_nested():
                account = (
                    db.query(ChartOfAccount)
                    .filter(ChartOfAccount.account_code == row.account_code)
                    .first()
                )
                if account is None:
                    raise ValueError(f"account {row.account_code} not found in chart_of_accounts")
                existing = (
                    db.query(GlAccountBalance)
                    .filter(
                        GlAccountBalance.period == row.period,
                        GlAccountBalance.account_id == account.id,
                        GlAccountBalance.currency == currency,
                    )
                    .first()
                )
                if existing is None:
                    db.add(
                        GlAccountBalance(
                            period=row.period,
                            account_id=account.id,
                            ending_debit=row.ending_debit,
                            ending_credit=row.ending_credit,
                            ending_balance=row.ending_balance,
                            currency=currency,
                            source_file=source_file,
                        )
                    )
                    result.inserted += 1
                else:
                    existing.ending_debit = row.ending_debit
                    existing.ending_credit = row.ending_credit
                    existing.ending_balance = row.ending_balance
                    existing.source_file = source_file
                    result.updated += 1
        except Exception as exc:  # noqa: BLE001 — keep the job running
            message = f"line {row.source_line}: {exc}"
            result.failed.append(message)
            result.skipped += 1
            logger.warning(message)
    return result


def row_to_preview(row: TrialBalanceRow) -> dict:
    return {
        "account_code": row.account_code,
        "account_name": row.account_name,
        "ending_debit": str(row.ending_debit),
        "ending_credit": str(row.ending_credit),
        "ending_balance": str(row.ending_balance),
        "period": row.period,
        "source_line": row.source_line,
    }


def apply_trial_balance(
    db: Session,
    path: Path,
    period: str,
    *,
    currency: str = DEFAULT_CURRENCY,
) -> ImportResult:
    rows, parse_failures = parse_csv(path, period)
    result = upsert_rows(db, rows, source_file=path.name, currency=currency)
    result.failed.extend(parse_failures)
    result.skipped += len(parse_failures)
    return result
