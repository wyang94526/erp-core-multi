# @author: Wendy Yang
# @date: 2026-09-30

"""Provenance fields for auto-generated journal entries."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException, status

SOURCE_GOODS_RECEIPT = "GOODS_RECEIPT"
SOURCE_SUPPLIER_INVOICE = "SUPPLIER_INVOICE"
SOURCE_SALES_INVOICE = "SALES_INVOICE"
SOURCE_SALES_CREDIT = "SALES_CREDIT"
SOURCE_AR_PAYMENT = "AR_PAYMENT"
SOURCE_AP_PAYMENT = "AP_PAYMENT"
SOURCE_BANK_TRANSFER = "BANK_TRANSFER"
SOURCE_MONTH_END_CLOSE = "MONTH_END_CLOSE"
SOURCE_YEAR_END_CLOSE = "YEAR_END_CLOSE"

SOURCE_TEXT_PATTERNS: dict[str, tuple[str, ...]] = {
    SOURCE_GOODS_RECEIPT: ("%goods receipt%",),
    SOURCE_SUPPLIER_INVOICE: ("%supplier invoice%", "%grni clear%"),
    SOURCE_SALES_INVOICE: ("%sales invoice%",),
    SOURCE_SALES_CREDIT: ("%credit memo%",),
    SOURCE_AR_PAYMENT: ("%ar payment%",),
    SOURCE_AP_PAYMENT: ("%ap payment%",),
    SOURCE_BANK_TRANSFER: ("%bank transfer%", "btr-%"),
    SOURCE_MONTH_END_CLOSE: ("%month-end close%", "mec-%"),
    SOURCE_YEAR_END_CLOSE: ("%year-end close%", "yec-%"),
}

SOURCE_DOCUMENT_TYPES = frozenset(
    {
        SOURCE_GOODS_RECEIPT,
        SOURCE_SUPPLIER_INVOICE,
        SOURCE_SALES_INVOICE,
        SOURCE_SALES_CREDIT,
        SOURCE_AR_PAYMENT,
        SOURCE_AP_PAYMENT,
        SOURCE_BANK_TRANSFER,
        SOURCE_MONTH_END_CLOSE,
        SOURCE_YEAR_END_CLOSE,
    }
)

SYSTEM_JOURNAL_IMMUTABLE_DETAIL = (
    "System-generated journal entries cannot be edited or deleted. "
    "Reverse them from the source document so the audit trail stays intact."
)
_EDITABLE_APPROVAL = frozenset({"DRAFT", "REJECTED"})


def journal_is_editable(entry: Any) -> bool:
    """Manual unposted Draft or Rejected journals can be edited. System journals stay locked."""
    if bool(getattr(entry, "is_system_generated", False)):
        return False
    approval = (getattr(entry, "approval_status", None) or "DRAFT").strip().upper()
    posting = (getattr(entry, "posting_status", None) or "").strip().lower()
    return posting != "posted" and approval in _EDITABLE_APPROVAL


def assert_journal_editable(entry: Any) -> None:
    if bool(getattr(entry, "is_system_generated", False)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=SYSTEM_JOURNAL_IMMUTABLE_DETAIL,
        )
    if journal_is_editable(entry):
        return
    approval = getattr(entry, "approval_status", None) or "DRAFT"
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"Cannot edit a journal entry with approval status {approval}",
    )


def infer_source_document_type(description: Any = None, reference: Any = None) -> str | None:
    """Guess source type from generated journal text when the column is still empty."""
    blob = f"{description or ''} {reference or ''}".lower()
    if not blob.strip():
        return None
    checks = (
        (SOURCE_MONTH_END_CLOSE, ("month-end close", "mec-")),
        (SOURCE_YEAR_END_CLOSE, ("year-end close", "yec-")),
        (SOURCE_BANK_TRANSFER, ("bank transfer", "btr-")),
        (SOURCE_GOODS_RECEIPT, ("goods receipt",)),
        (SOURCE_SUPPLIER_INVOICE, ("supplier invoice", "grni clear")),
        (SOURCE_SALES_INVOICE, ("sales invoice",)),
        (SOURCE_SALES_CREDIT, ("credit memo",)),
        (SOURCE_AR_PAYMENT, ("ar payment",)),
        (SOURCE_AP_PAYMENT, ("ap payment",)),
    )
    for kind, markers in checks:
        if any(marker in blob for marker in markers):
            return kind
    return None


def source_record_key(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def generated_journal_fields(
    *,
    source_document_type: str,
    source_record_id: Any = None,
    posting_rule_id: UUID | None = None,
) -> dict[str, Any]:
    kind = (source_document_type or "").strip().upper()
    if kind not in SOURCE_DOCUMENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unknown journal source document type {source_document_type}",
        )
    return {
        "is_system_generated": True,
        "source_document_type": kind,
        "source_record_id": source_record_key(source_record_id),
        "posting_rule_id": posting_rule_id,
    }


def rule_id(rule: Any) -> UUID | None:
    value = getattr(rule, "id", None)
    return value if value is not None else None


def assert_journal_mutable(entry: Any) -> None:
    if bool(getattr(entry, "is_system_generated", False)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=SYSTEM_JOURNAL_IMMUTABLE_DETAIL,
        )
