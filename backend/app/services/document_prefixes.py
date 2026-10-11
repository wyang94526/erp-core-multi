# @author: Wendy Yang
# @date: 2026-10-11

"""Company-defined prefixes for document numbers. Existing numbers stay as they are."""

from __future__ import annotations

import re
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Company, CompanyDocumentPrefix
from app.services.document_sequences import (
    DOCUMENT_PREFIXES,
    document_prefix,
    format_document_number,
    peek_document_number,
)

_PREFIX = re.compile(r"^[A-Z0-9]{1,12}-$")

DOCUMENT_TYPE_LABELS: dict[str, str] = {
    "SALES_ORDER": "Sales order",
    "PURCHASE_ORDER": "Purchase order",
    "FULFILLMENT": "Item fulfillment",
    "GOODS_RECEIPT": "Goods receipt",
    "JOURNAL": "Journal entry",
    "INVOICE": "Sales invoice",
    "BILL": "Supplier bill",
    "SUBCONTRACT_ORDER": "Subcontract order",
    "MATERIAL_ISSUE": "Subcontract material issue",
    "FINISHED_GOODS_RECEIPT": "Subcontract finished-goods receipt",
    "PRODUCTION_ORDER": "Production order",
    "PRODUCTION_ISSUE": "Production material issue",
    "PRODUCTION_RECEIPT": "Production receipt",
}


def normalize_prefix(value: str) -> str:
    text = str(value or "").strip().upper()
    if text and not text.endswith("-"):
        text += "-"
    if _PREFIX.fullmatch(text) is None:
        raise HTTPException(
            status_code=400,
            detail="A prefix is 1–12 letters or digits and ends with a hyphen, for example SO-",
        )
    return text


def ensure_document_prefixes(db: Session, company: Company) -> None:
    """Give a company the built-in prefixes until someone edits them."""
    existing = {
        row.doc_type
        for row in db.query(CompanyDocumentPrefix)
        .filter(CompanyDocumentPrefix.company_id == company.id)
        .all()
    }
    for doc_type, prefix in DOCUMENT_PREFIXES.items():
        if doc_type not in existing:
            db.add(
                CompanyDocumentPrefix(
                    company_id=company.id,
                    doc_type=doc_type,
                    prefix=prefix,
                )
            )


def list_document_prefixes(db: Session, company: Company) -> list[dict]:
    ensure_document_prefixes(db, company)
    db.flush()
    rows = []
    today = date.today()
    for doc_type, label in DOCUMENT_TYPE_LABELS.items():
        prefix = document_prefix(db, doc_type, company.id)
        rows.append(
            {
                "doc_type": doc_type,
                "label": label,
                "prefix": prefix,
                "sample": format_document_number(prefix, today, 1),
                "next_number": peek_document_number(db, doc_type, today, company.id),
            }
        )
    return rows


def update_document_prefixes(db: Session, company: Company, items: list) -> list[dict]:
    ensure_document_prefixes(db, company)
    db.flush()
    incoming: dict[str, str] = {}
    for item in items:
        doc_type = str(item.doc_type or "").strip()
        if doc_type not in DOCUMENT_PREFIXES:
            raise HTTPException(status_code=400, detail=f"Unknown document type {doc_type}")
        incoming[doc_type] = normalize_prefix(item.prefix)
    if len(incoming) != len(items):
        raise HTTPException(status_code=400, detail="Each document type can be saved once")
    stored = (
        db.query(CompanyDocumentPrefix)
        .filter(CompanyDocumentPrefix.company_id == company.id)
        .all()
    )
    by_type = {row.doc_type: row for row in stored}
    resulting = {doc_type: row.prefix for doc_type, row in by_type.items()}
    resulting.update(incoming)
    seen: dict[str, str] = {}
    for doc_type, prefix in resulting.items():
        other = seen.get(prefix)
        if other is not None:
            raise HTTPException(
                status_code=400,
                detail=f"{DOCUMENT_TYPE_LABELS[doc_type]} and {DOCUMENT_TYPE_LABELS[other]} cannot share {prefix}",
            )
        seen[prefix] = doc_type
    for doc_type, prefix in incoming.items():
        by_type[doc_type].prefix = prefix
    db.flush()
    return list_document_prefixes(db, company)
