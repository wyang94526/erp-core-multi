# @author: Wendy Yang
# @date: 2026-09-19

"""Concurrency-safe document number generation: {PREFIX}{YY}{MM}{XXXX}."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Final, Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import DocumentSequence

_CANONICAL_SUFFIX = re.compile(r"^(?P<yy>\d{2})(?P<mm>\d{2})(?P<seq>\d{4})$")

DOC_SALES_ORDER: Final = "SALES_ORDER"
DOC_PURCHASE_ORDER: Final = "PURCHASE_ORDER"
DOC_SUBCONTRACT_ORDER: Final = "SUBCONTRACT_ORDER"
DOC_INVOICE: Final = "INVOICE"
DOC_FULFILLMENT: Final = "FULFILLMENT"
DOC_GOODS_RECEIPT: Final = "GOODS_RECEIPT"
DOC_MATERIAL_ISSUE: Final = "MATERIAL_ISSUE"
DOC_FINISHED_GOODS_RECEIPT: Final = "FINISHED_GOODS_RECEIPT"
DOC_BILL: Final = "BILL"
DOC_JOURNAL: Final = "JOURNAL"

DOCUMENT_PREFIXES: Final[dict[str, str]] = {
    DOC_SALES_ORDER: "PU61-",
    DOC_PURCHASE_ORDER: "PU62-",
    DOC_SUBCONTRACT_ORDER: "UP23-",
    DOC_INVOICE: "USS5-",
    DOC_FULFILLMENT: "US51-",
    DOC_GOODS_RECEIPT: "PU67-",
    DOC_MATERIAL_ISSUE: "UM31-",
    DOC_FINISHED_GOODS_RECEIPT: "UP72-",
    DOC_BILL: "UX13-",
    DOC_JOURNAL: "UG11-",
}

LEGACY_SALES_ORDER_PREFIX: Final = "PUB61-"


def remap_legacy_sales_order_id(doc_id: str) -> str:
    """Correct the mistyped PUB61- sales-order prefix without changing YYMMXXXX."""
    identifier = str(doc_id or "").strip()
    if identifier.startswith(LEGACY_SALES_ORDER_PREFIX):
        return DOCUMENT_PREFIXES[DOC_SALES_ORDER] + identifier[len(LEGACY_SALES_ORDER_PREFIX) :]
    return identifier


def parse_document_date(document_date: date | datetime | str | None) -> date:
    """Use the user-selected document date; fall back to today only when omitted."""
    if document_date is None or document_date == "":
        return date.today()
    if isinstance(document_date, datetime):
        return document_date.date()
    if isinstance(document_date, date):
        return document_date
    text = str(document_date).strip()
    if not text:
        return date.today()
    return date.fromisoformat(text[:10])


def format_document_number(prefix: str, document_date: date, sequence: int) -> str:
    if sequence < 1 or sequence > 9999:
        raise ValueError(f"Sequence {sequence} is outside 0001-9999")
    return f"{prefix}{document_date:%y}{document_date:%m}{sequence:04d}"


def next_document_number(
    db: Session,
    doc_type: str,
    document_date: date | datetime | str | None = None,
    preferred: str | None = None,
) -> str:
    """Use *preferred* when it is unused and already canonical; otherwise allocate."""
    prefix = DOCUMENT_PREFIXES.get(doc_type)
    if prefix is None:
        raise ValueError(f"Unknown document type: {doc_type}")
    parsed = parse_document_date(document_date)
    candidate = str(preferred or "").strip()
    if candidate and is_canonical_for_date(candidate, prefix, parsed):
        return candidate
    return generate_document_number(db, doc_type, parsed)


def peek_document_number(
    db: Session,
    doc_type: str,
    document_date: date | datetime | str | None = None,
) -> str:
    """Return the next number without consuming the sequence."""
    prefix = DOCUMENT_PREFIXES.get(doc_type)
    if prefix is None:
        raise ValueError(f"Unknown document type: {doc_type}")
    parsed = parse_document_date(document_date)
    year_month = parsed.strftime("%Y%m")
    row = (
        db.query(DocumentSequence)
        .filter(
            DocumentSequence.doc_type == doc_type,
            DocumentSequence.year_month == year_month,
        )
        .first()
    )
    next_value = int(row.last_value or 0) + 1 if row else 1
    return format_document_number(prefix, parsed, next_value)


def generate_document_number(
    db: Session,
    doc_type: str,
    document_date: date | datetime | str | None = None,
) -> str:
    """Atomically increment the persisted counter and return the formatted number."""
    prefix = DOCUMENT_PREFIXES.get(doc_type)
    if prefix is None:
        raise ValueError(f"Unknown document type: {doc_type}")

    parsed = parse_document_date(document_date)
    year_month = parsed.strftime("%Y%m")
    next_value = _next_sequence_value(db, doc_type, year_month)
    return format_document_number(prefix, parsed, next_value)


def _next_sequence_value(db: Session, doc_type: str, year_month: str) -> int:
    row = _lock_sequence_row(db, doc_type, year_month)
    if row is None:
        try:
            with db.begin_nested():
                db.add(
                    DocumentSequence(
                        doc_type=doc_type,
                        year_month=year_month,
                        last_value=0,
                    )
                )
                db.flush()
        except IntegrityError:
            pass
        row = _lock_sequence_row(db, doc_type, year_month)
        if row is None:
            raise RuntimeError(f"Unable to lock document sequence {doc_type}/{year_month}")

    row.last_value = int(row.last_value or 0) + 1
    row.updated_at = datetime.now()
    db.flush()
    return int(row.last_value)


def match_canonical_number(doc_id: str, prefix: str) -> tuple[int, int, int] | None:
    """Return (yy, mm, seq) when *doc_id* already uses `{prefix}{YY}{MM}{XXXX}`."""
    if not doc_id.startswith(prefix):
        return None
    matched = _CANONICAL_SUFFIX.fullmatch(doc_id[len(prefix) :])
    if matched is None:
        return None
    return int(matched.group("yy")), int(matched.group("mm")), int(matched.group("seq"))


def is_canonical_for_date(doc_id: str, prefix: str, document_date: date) -> bool:
    parts = match_canonical_number(doc_id, prefix)
    if parts is None:
        return False
    yy, mm, _seq = parts
    return yy == document_date.year % 100 and mm == document_date.month


def plan_document_renames(
    records: Sequence[tuple[str, date | datetime | str | None, Any]],
    prefix: str,
) -> tuple[dict[str, str], dict[str, int]]:
    """Assign `{PREFIX}{YY}{MM}{XXXX}` from each row's document date.

    Already-canonical IDs for that year/month keep their number and reserve
    that sequence slot. Returns (old_id -> new_id, YYYYMM -> last_value).
    """
    parsed: list[tuple[str, date, Any]] = []
    for doc_id, raw_date, sort_key in records:
        identifier = str(doc_id or "").strip()
        if not identifier:
            continue
        parsed.append((identifier, parse_document_date(raw_date), sort_key))

    reserved: dict[str, set[int]] = defaultdict(set)
    keep: set[str] = set()
    for doc_id, doc_date, _sort_key in parsed:
        if is_canonical_for_date(doc_id, prefix, doc_date):
            parts = match_canonical_number(doc_id, prefix)
            assert parts is not None
            reserved[doc_date.strftime("%Y%m")].add(parts[2])
            keep.add(doc_id)

    pending = [row for row in parsed if row[0] not in keep]
    pending.sort(key=lambda row: (row[1], _sort_value(row[2]), row[0]))

    next_free: dict[str, int] = {}
    changes: dict[str, str] = {}
    last_value = {year_month: max(seqs) for year_month, seqs in reserved.items()}

    for doc_id, doc_date, _sort_key in pending:
        year_month = doc_date.strftime("%Y%m")
        used = reserved.setdefault(year_month, set())
        seq = next_free.get(year_month, 1)
        while seq in used:
            seq += 1
        if seq > 9999:
            raise ValueError(f"Sequence exhausted for {prefix}{year_month}")
        used.add(seq)
        next_free[year_month] = seq + 1
        last_value[year_month] = max(last_value.get(year_month, 0), seq)
        new_id = format_document_number(prefix, doc_date, seq)
        if new_id != doc_id:
            changes[doc_id] = new_id

    return changes, last_value


def _sort_value(value: Any) -> Any:
    if value is None:
        return datetime.min
    return value


def _lock_sequence_row(
    db: Session, doc_type: str, year_month: str
) -> DocumentSequence | None:
    return (
        db.query(DocumentSequence)
        .filter(
            DocumentSequence.doc_type == doc_type,
            DocumentSequence.year_month == year_month,
        )
        .with_for_update()
        .one_or_none()
    )
