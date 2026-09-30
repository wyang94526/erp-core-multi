# @author: Wendy Yang
# @date: 2026-09-30

"""Query helpers for General Ledger journal search."""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import String, and_, cast, not_, or_
from sqlalchemy.orm import Query

from app.models import JournalEntry, LedgerPosting, PostingRule
from app.services.journal_source import SOURCE_DOCUMENT_TYPES, SOURCE_TEXT_PATTERNS


def _text_matches_source(source: str):
    patterns = SOURCE_TEXT_PATTERNS.get(source) or ()
    if not patterns:
        return None
    return or_(
        *[JournalEntry.description.ilike(pattern) for pattern in patterns],
        *[JournalEntry.reference.ilike(pattern) for pattern in patterns],
    )


def _matches_stored_or_inferred_source(source: str):
    inferred = _text_matches_source(source)
    stored = JournalEntry.source_document_type == source
    if inferred is None:
        return stored
    return or_(stored, inferred)


def _matches_any_system_source():
    inferred = [
        clause
        for kind in SOURCE_DOCUMENT_TYPES
        if (clause := _text_matches_source(kind)) is not None
    ]
    return or_(
        JournalEntry.is_system_generated.is_(True),
        JournalEntry.source_document_type.in_(tuple(SOURCE_DOCUMENT_TYPES)),
        *inferred,
    )


def apply_journal_list_filters(
    query: Query[JournalEntry],
    *,
    q: str | None = None,
    source_document_type: str | None = None,
    origin: str | None = None,
    posting_rule_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    period: str | None = None,
    posting_status: str | None = None,
    approval_status: str | None = None,
) -> Query[JournalEntry]:
    text = (q or "").strip()
    if text:
        like = f"%{text}%"
        query = query.filter(
            or_(
                JournalEntry.journal_number.ilike(like),
                JournalEntry.description.ilike(like),
                JournalEntry.reference.ilike(like),
                JournalEntry.source_record_id.ilike(like),
                JournalEntry.source_document_type.ilike(like),
                JournalEntry.period.ilike(like),
                cast(JournalEntry.id, String).ilike(like),
                cast(JournalEntry.posting_rule_id, String).ilike(like),
                JournalEntry.postings.any(LedgerPosting.description.ilike(like)),
            )
        )

    source = (source_document_type or "").strip().upper()
    if source == "MANUAL":
        query = query.filter(not_(_matches_any_system_source()))
    elif source in SOURCE_DOCUMENT_TYPES:
        query = query.filter(_matches_stored_or_inferred_source(source))

    origin_key = (origin or "").strip().upper()
    if origin_key == "SYSTEM":
        query = query.filter(_matches_any_system_source())
    elif origin_key == "MANUAL":
        query = query.filter(not_(_matches_any_system_source()))

    rule = (posting_rule_id or "").strip()
    if rule:
        query = _filter_by_posting_rule(query, rule)

    if date_from is not None:
        query = query.filter(JournalEntry.posting_date >= date_from)
    if date_to is not None:
        query = query.filter(JournalEntry.posting_date <= date_to)

    period_key = (period or "").strip()
    if period_key:
        query = query.filter(JournalEntry.period == period_key)

    posting = (posting_status or "").strip()
    if posting:
        query = query.filter(JournalEntry.posting_status.ilike(posting))

    approval = (approval_status or "").strip().upper()
    if approval:
        query = query.filter(JournalEntry.approval_status == approval)

    return query


def infer_posting_rule_id(
    *,
    debit_account_id: Any,
    credit_account_id: Any,
    rules: list[Any],
) -> Any:
    """Match a two-sided journal to a catalog rule when posting_rule_id was never stored."""
    if not debit_account_id or not credit_account_id:
        return None
    matches = [
        rule
        for rule in rules
        if getattr(rule, "debit_account_id", None) == debit_account_id
        and getattr(rule, "credit_account_id", None) == credit_account_id
    ]
    return matches[0].id if len(matches) == 1 else None


def _filter_by_posting_rule(query: Query[JournalEntry], rule: str) -> Query[JournalEntry]:
    try:
        rule_id = UUID(rule)
    except ValueError:
        like = f"%{rule}%"
        return query.outerjoin(JournalEntry.posting_rule).filter(
            or_(
                PostingRule.rule_code.ilike(like),
                PostingRule.name.ilike(like),
                cast(JournalEntry.posting_rule_id, String).ilike(like),
            )
        )

    stored = JournalEntry.posting_rule_id == rule_id
    rule_row = query.session.get(PostingRule, rule_id)
    if rule_row is None:
        return query.filter(stored)
    inferred = [
        and_(
            JournalEntry.source_document_type.isnot(None),
            JournalEntry.postings.any(
                and_(LedgerPosting.account_id == rule_row.debit_account_id, LedgerPosting.debit > 0)
            ),
            JournalEntry.postings.any(
                and_(LedgerPosting.account_id == rule_row.credit_account_id, LedgerPosting.credit > 0)
            ),
        )
    ]
    if rule_row.event_code == "BANK_TRANSFER":
        inferred.append(JournalEntry.source_document_type == "BANK_TRANSFER")
    return query.filter(
        or_(
            stored,
            and_(JournalEntry.posting_rule_id.is_(None), or_(*inferred)),
        )
    )


def journal_list_filter_kwargs(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value not in (None, "", "ALL")}
