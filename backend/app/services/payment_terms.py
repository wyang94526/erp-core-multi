# @author: Wendy Yang
# @date: 2026-09-19

"""Payment-term master lookup, snapshot sync, and due-date calculation."""

from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import PaymentTerm

DEFAULT_DUE_DAYS = 30

# Canonical codes seeded by migration. Aliases cover legacy vendor/customer strings
# and TIPTOP import codes (T000/T010/T020/T030/M020).
PAYMENT_TERM_ALIASES: dict[str, str] = {
    "NET30": "NET30",
    "N30": "NET30",
    "NET030": "NET30",
    "T010": "NET30",
    "T10": "NET30",
    "M020": "NET30",
    "NET15": "NET15",
    "N15": "NET15",
    "NET015": "NET15",
    "NET60": "NET60",
    "N60": "NET60",
    "NET060": "NET60",
    "T020": "NET60",
    "T20": "NET60",
    "NET90": "NET90",
    "N90": "NET90",
    "NET090": "NET90",
    "T030": "NET90",
    "T30": "NET90",
    "DUEONRECEIPT": "DUE_ON_RECEIPT",
    "DUEONRCPT": "DUE_ON_RECEIPT",
    "COD": "DUE_ON_RECEIPT",
    "CIA": "DUE_ON_RECEIPT",
    "T000": "DUE_ON_RECEIPT",
    "T00": "DUE_ON_RECEIPT",
    "P02": "P02",
    "P2": "P02",
    "P10": "P10",
    "ADVANCE": "ADVANCE",
    "PREPAID": "ADVANCE",
}


def normalize_term_key(raw: str | None) -> str:
    if not raw:
        return ""
    return re.sub(r"[^A-Z0-9]", "", str(raw).upper())


def canonical_code(raw: str | None) -> str | None:
    key = normalize_term_key(raw)
    if not key:
        return None
    return PAYMENT_TERM_ALIASES.get(key)


def due_days_from_string(raw: str | None, default: int = DEFAULT_DUE_DAYS) -> int:
    if not raw:
        return default
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    if digits:
        try:
            return max(0, int(digits))
        except ValueError:
            pass
    return default


def compute_due_date(invoice_date: date, due_days: int | None) -> date:
    return invoice_date + timedelta(days=int(due_days or 0))


def get_payment_term(db: Session, term_id: UUID | str | None) -> PaymentTerm | None:
    if term_id is None or term_id == "":
        return None
    try:
        uid = term_id if isinstance(term_id, UUID) else UUID(str(term_id))
    except (TypeError, ValueError):
        return None
    return db.get(PaymentTerm, uid)


def find_payment_term(
    db: Session,
    *,
    payment_term_id: UUID | str | None = None,
    payment_terms: str | None = None,
    include_inactive: bool = True,
) -> PaymentTerm | None:
    term = get_payment_term(db, payment_term_id)
    if term is not None:
        if term.is_active or include_inactive:
            return term
        return None

    raw = (payment_terms or "").strip()
    if not raw:
        return None

    code = canonical_code(raw) or raw.upper()
    query = db.query(PaymentTerm)
    if not include_inactive:
        query = query.filter(PaymentTerm.is_active.is_(True))
    match = query.filter(func.upper(PaymentTerm.code) == code.upper()).first()
    if match:
        return match

    match = query.filter(func.upper(PaymentTerm.description) == raw.upper()).first()
    if match:
        return match

    key = normalize_term_key(raw)
    for row in query.all():
        if normalize_term_key(row.code) == key or normalize_term_key(row.description) == key:
            return row
    return None


def due_days_for(
    db: Session,
    *,
    payment_term_id: UUID | str | None = None,
    payment_terms: str | None = None,
    fallback_term_id: UUID | str | None = None,
    fallback_payment_terms: str | None = None,
) -> int:
    term = find_payment_term(db, payment_term_id=payment_term_id, payment_terms=payment_terms)
    if term is None:
        term = find_payment_term(
            db,
            payment_term_id=fallback_term_id,
            payment_terms=fallback_payment_terms,
        )
    if term is not None:
        return int(term.due_days or 0)
    return due_days_from_string(payment_terms or fallback_payment_terms)


def snapshot_code(term: PaymentTerm | None, payment_terms: str | None = None) -> str | None:
    if term is not None:
        return term.code
    raw = (payment_terms or "").strip()
    return raw or None


def apply_payment_term_fields(
    db: Session,
    obj,
    *,
    payment_term_id: UUID | str | None = None,
    payment_terms: str | None = None,
    fallback: object | None = None,
) -> PaymentTerm | None:
    """Set payment_term_id and string snapshot on a mapped object."""
    fallback_id = getattr(fallback, "payment_term_id", None) if fallback is not None else None
    fallback_terms = getattr(fallback, "payment_terms", None) if fallback is not None else None
    term = find_payment_term(db, payment_term_id=payment_term_id, payment_terms=payment_terms)
    if term is None and payment_term_id is None and not (payment_terms or "").strip():
        term = find_payment_term(
            db,
            payment_term_id=fallback_id,
            payment_terms=fallback_terms,
        )
        payment_terms = payment_terms or fallback_terms
    if hasattr(obj, "payment_term_id"):
        obj.payment_term_id = term.id if term is not None else None
    if hasattr(obj, "payment_terms"):
        obj.payment_terms = snapshot_code(term, payment_terms)
    return term


def apply_due_date(
    db: Session,
    *,
    invoice_date: date,
    due_date: date | None = None,
    payment_term_id: UUID | str | None = None,
    payment_terms: str | None = None,
    fallback: object | None = None,
) -> tuple[date, PaymentTerm | None]:
    fallback_id = getattr(fallback, "payment_term_id", None) if fallback is not None else None
    fallback_terms = getattr(fallback, "payment_terms", None) if fallback is not None else None
    term = find_payment_term(db, payment_term_id=payment_term_id, payment_terms=payment_terms)
    if term is None:
        term = find_payment_term(
            db,
            payment_term_id=fallback_id,
            payment_terms=fallback_terms,
        )
    days = int(term.due_days) if term is not None else due_days_from_string(
        payment_terms or fallback_terms
    )
    computed = compute_due_date(invoice_date, days)
    return (due_date or computed, term)


def list_payment_terms(db: Session, *, include_inactive: bool = False) -> list[PaymentTerm]:
    query = db.query(PaymentTerm)
    if not include_inactive:
        query = query.filter(PaymentTerm.is_active.is_(True))
    return query.order_by(PaymentTerm.code.asc()).all()


def _normalize_code(code: str) -> str:
    cleaned = (code or "").strip().upper()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Payment term code is required")
    if len(cleaned) > 20:
        raise HTTPException(status_code=400, detail="Payment term code must be 20 characters or fewer")
    return cleaned


def create_payment_term(
    db: Session,
    *,
    code: str,
    description: str,
    due_days: int,
    discount_days: int | None = None,
    discount_percentage: Decimal | None = None,
    is_active: bool = True,
) -> PaymentTerm:
    term = PaymentTerm(
        code=_normalize_code(code),
        description=(description or "").strip() or _normalize_code(code),
        due_days=int(due_days),
        discount_days=discount_days,
        discount_percentage=discount_percentage,
        is_active=is_active,
    )
    db.add(term)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Payment term code '{term.code}' already exists",
        ) from exc
    db.refresh(term)
    return term


def update_payment_term(db: Session, term_id: UUID, payload: dict) -> PaymentTerm:
    term = db.get(PaymentTerm, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="Payment term not found")
    if "code" in payload and payload["code"] is not None:
        payload["code"] = _normalize_code(payload["code"])
    if "description" in payload and payload["description"] is not None:
        payload["description"] = str(payload["description"]).strip()
    for key, value in payload.items():
        setattr(term, key, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Payment term code '{term.code}' already exists",
        ) from exc
    db.refresh(term)
    return term


def deactivate_payment_term(db: Session, term_id: UUID) -> PaymentTerm:
    term = db.get(PaymentTerm, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="Payment term not found")
    term.is_active = False
    db.commit()
    db.refresh(term)
    return term
