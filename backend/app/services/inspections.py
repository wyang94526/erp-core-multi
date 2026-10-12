# @author: Wendy Yang
# @date: 2026-10-11

"""Inspection records for production receipts and goods receipts."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import exists, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import Company, GoodsReceipt, Inspection, InspectionResult, ProductionOrder, ProductionReceipt, User
from app.services.production import post_accepted_receipt


def canonical_inspection_status(status: str) -> str:
    """Accept the stored codes and the labels shown on the inspection list."""
    value = (status or "").strip().lower().replace(" ", "_")
    if value in {"accept"}:
        value = "accepted"
    if value in {"reject"}:
        value = "rejected"
    if value not in {"pending", "accepted", "rejected"}:
        raise HTTPException(status_code=400, detail="Inspection status must be Pending, Accepted, or Rejected")
    return value


def apply_inspection_decision(status: str) -> str:
    """Accepted production quantity can enter available stock. Rejected quantity cannot."""
    if status == "accepted":
        return "post"
    if status == "rejected":
        return "hold"
    raise HTTPException(status_code=400, detail="Inspection decision must be accepted or rejected")


def _load(db: Session, company: Company, inspection_id) -> Inspection:
    row = (
        db.query(Inspection)
        .options(selectinload(Inspection.results), joinedload(Inspection.inspector))
        .filter(Inspection.id == inspection_id, Inspection.company_id == company.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return row


def _reference_for(db: Session, source_type: str, source_id: str) -> str | None:
    if source_type == "production_receipt":
        receipt = db.get(ProductionReceipt, source_id)
        return receipt.production_order_id if receipt is not None else None
    if source_type == "goods_receipt":
        receipt = (
            db.query(GoodsReceipt)
            .filter(GoodsReceipt.receipt_number == source_id)
            .first()
        )
        return receipt.source_order_id if receipt is not None else None
    return None


def list_inspections(
    db: Session,
    company: Company,
    *,
    status: str | None = None,
    source: str | None = None,
    q: str | None = None,
) -> list[Inspection]:
    query = (
        db.query(Inspection)
        .options(selectinload(Inspection.results), joinedload(Inspection.inspector))
        .filter(Inspection.company_id == company.id)
    )
    if status and status.strip().lower() not in {"", "all"}:
        query = query.filter(Inspection.status == canonical_inspection_status(status))
    if source and source.strip().lower() not in {"", "all"}:
        source_type = source.strip().lower().replace(" ", "_")
        if source_type not in {"goods_receipt", "production_receipt"}:
            raise HTTPException(status_code=400, detail="Unknown inspection source")
        query = query.filter(Inspection.source_type == source_type)
    text = (q or "").strip()
    if text:
        like = f"%{text}%"
        query = query.filter(
            or_(
                Inspection.source_id.ilike(like),
                Inspection.reference_document.ilike(like),
                Inspection.notes.ilike(like),
                Inspection.status.ilike(like),
                exists().where(User.id == Inspection.inspector_user_id, User.full_name.ilike(like)),
            )
        )
    return query.order_by(Inspection.created_at.desc()).all()


def ensure_pending_inspection(
    db: Session,
    company_id,
    source_type: str,
    source_id: str,
    notes: str | None = None,
    reference_document: str | None = None,
) -> Inspection | None:
    """Open one pending inspection for a receipt. Goods receipts stay tracking-only."""
    if company_id is None or not (source_id or "").strip():
        return None
    source_id = source_id.strip()
    existing = (
        db.query(Inspection)
        .filter(
            Inspection.company_id == company_id,
            Inspection.source_type == source_type,
            Inspection.source_id == source_id,
            Inspection.status == "pending",
        )
        .first()
    )
    if existing is not None:
        return existing
    row = Inspection(
        company_id=company_id,
        source_type=source_type,
        source_id=source_id,
        reference_document=reference_document or _reference_for(db, source_type, source_id),
        status="pending",
        notes=notes,
    )
    db.add(row)
    return row


def list_source_documents(db: Session, company: Company, source_type: str) -> list[dict]:
    if source_type == "goods_receipt":
        rows = (
            db.query(GoodsReceipt)
            .options(joinedload(GoodsReceipt.vendor))
            .filter(GoodsReceipt.status != "CANCELLED")
            .filter(or_(GoodsReceipt.company_id == company.id, GoodsReceipt.company_id.is_(None)))
            .order_by(GoodsReceipt.receipt_date.desc(), GoodsReceipt.receipt_number.desc())
            .limit(200)
            .all()
        )
        return [
            {
                "id": row.receipt_number,
                "label": " · ".join(
                    part
                    for part in (
                        row.receipt_number,
                        row.source_order_id,
                        row.vendor.company_name if row.vendor is not None else None,
                        str(row.receipt_date),
                    )
                    if part
                ),
            }
            for row in rows
        ]
    if source_type == "production_receipt":
        rows = (
            db.query(ProductionReceipt)
            .join(ProductionOrder, ProductionReceipt.production_order_id == ProductionOrder.production_order_id)
            .filter(ProductionOrder.company_id == company.id)
            .order_by(ProductionReceipt.receipt_date.desc(), ProductionReceipt.receipt_id.desc())
            .limit(200)
            .all()
        )
        return [
            {
                "id": row.receipt_id,
                "label": f"{row.receipt_id} · {row.production_order_id} · qty {row.quantity_received} · {row.receipt_date}",
            }
            for row in rows
        ]
    raise HTTPException(status_code=400, detail="Unknown inspection source")


def open_inspection(db: Session, company: Company, payload) -> Inspection:
    source_type = payload.source_type
    source_id = payload.source_id.strip()
    if source_type == "goods_receipt":
        receipt = (
            db.query(GoodsReceipt)
            .filter(GoodsReceipt.receipt_number == source_id)
            .first()
        )
        if receipt is None:
            raise HTTPException(status_code=400, detail="Goods receipt not found")
    elif source_type == "production_receipt":
        receipt = db.get(ProductionReceipt, source_id)
        if receipt is None:
            raise HTTPException(status_code=400, detail="Production receipt not found")
    else:
        raise HTTPException(status_code=400, detail="Unknown inspection source")
    existing = (
        db.query(Inspection)
        .filter(
            Inspection.company_id == company.id,
            Inspection.source_type == source_type,
            Inspection.source_id == source_id,
            Inspection.status == "pending",
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=400, detail="An open inspection already exists for this document")
    row = Inspection(
        company_id=company.id,
        source_type=source_type,
        source_id=source_id,
        reference_document=_reference_for(db, source_type, source_id),
        status="pending",
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _record_results(inspection: Inspection, results) -> None:
    for result in results or []:
        inspection.results.append(
            InspectionResult(
                characteristic=result.characteristic.strip(),
                specification=(result.specification or "").strip() or None,
                measured_value=(result.measured_value or "").strip() or None,
                passed=bool(result.passed),
            )
        )


def decide(
    db: Session,
    company: Company,
    inspection_id,
    decision: str,
    user: User,
    results,
    notes: str | None,
) -> Inspection:
    effect = apply_inspection_decision(canonical_inspection_status(decision))
    inspection = _load(db, company, inspection_id)
    if inspection.status != "pending":
        raise HTTPException(status_code=400, detail="This inspection is already complete")
    _record_results(inspection, results)
    inspection.status = canonical_inspection_status(decision)
    inspection.updated_at = datetime.now(timezone.utc)
    inspection.inspector_user_id = user.id
    inspection.inspected_at = datetime.now(timezone.utc)
    if notes:
        inspection.notes = notes
    if effect == "post" and inspection.source_type == "production_receipt":
        receipt = db.get(ProductionReceipt, inspection.source_id)
        if receipt is None:
            raise HTTPException(status_code=400, detail="Production receipt not found")
        post_accepted_receipt(db, receipt)
    db.commit()
    db.refresh(inspection)
    return inspection
