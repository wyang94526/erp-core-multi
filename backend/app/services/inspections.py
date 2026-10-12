# @author: Wendy Yang
# @date: 2026-10-11

"""Inspection records for production receipts and goods receipts."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import exists, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.deps.auth import user_role_ids
from app.models import (
    BinLocation,
    Company,
    GoodsReceipt,
    Inspection,
    InspectionPlan,
    InspectionResult,
    Item,
    ProductionOrder,
    ProductionReceipt,
    QualityAlert,
    QualityAuditNote,
    ReinspectionRequest,
    User,
    UserCompany,
    UserRole,
)
from app.services.inspection_control import (
    EMERGENCY_OVERRIDE,
    PLANT_LEADERSHIP_ROLE,
    QC_MANAGER_ROLES,
    disposition_is_terminal,
    measurement_passed,
    override_block_reason,
    plan_specification,
    receipt_is_closed,
    reopen_block_reason,
    signoff_block_reason,
)
from app.services.inventory import ensure_classified_location, ensure_quarantine_location, receive_stock, transfer_stock
from app.services.item_types import skip_inventory_movement
from app.services.production import post_accepted_receipt, production_is_covered


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
    return _annotate(db, row)


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
    prior = _closed_lot(db, company_id, source_type, source_id)
    request = None
    if prior is not None:
        request = _approved_reinspection(db, company_id, source_type, source_id)
        if request is None:
            return None
    row = Inspection(
        company_id=company_id,
        source_type=source_type,
        source_id=source_id,
        reference_document=reference_document or _reference_for(db, source_type, source_id),
        prior_inspection_id=prior.id if prior is not None else None,
        status="pending",
        notes=notes,
    )
    db.add(row)
    if request is not None:
        request.status = "consumed"
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
    prior, request = _reinspection_gate(db, company.id, source_type, source_id)
    row = Inspection(
        company_id=company.id,
        source_type=source_type,
        source_id=source_id,
        reference_document=_reference_for(db, source_type, source_id),
        prior_inspection_id=prior.id if prior is not None else None,
        status="pending",
        notes=payload.notes,
    )
    db.add(row)
    if request is not None:
        request.status = "consumed"
    db.commit()
    db.refresh(row)
    return _annotate(db, row)


def _source_rows(db: Session, company_id, source_type: str, source_id: str) -> list[Inspection]:
    return (
        db.query(Inspection)
        .filter(
            Inspection.company_id == company_id,
            Inspection.source_type == source_type,
            Inspection.source_id == source_id,
        )
        .order_by(Inspection.created_at.desc())
        .all()
    )


def _closed_lot(db: Session, company_id, source_type: str, source_id: str) -> Inspection | None:
    rows = _source_rows(db, company_id, source_type, source_id)
    if receipt_is_closed([row.status for row in rows]):
        return next(row for row in rows if row.status in {"accepted", "rejected"})
    return None


def _approved_reinspection(db: Session, company_id, source_type: str, source_id: str) -> ReinspectionRequest | None:
    return (
        db.query(ReinspectionRequest)
        .filter(
            ReinspectionRequest.company_id == company_id,
            ReinspectionRequest.source_type == source_type,
            ReinspectionRequest.source_id == source_id,
            ReinspectionRequest.status == "approved",
        )
        .order_by(ReinspectionRequest.created_at.desc())
        .first()
    )


def _reinspection_gate(db: Session, company_id, source_type: str, source_id: str):
    closed = _closed_lot(db, company_id, source_type, source_id)
    if closed is None:
        return None, None
    request = _approved_reinspection(db, company_id, source_type, source_id)
    if request is None:
        raise HTTPException(
            status_code=400,
            detail="This receipt is closed. A Quality Manager must approve a re-inspection before another inspection can be opened.",
        )
    return closed, request


def _record_results(inspection: Inspection, results) -> None:
    for result in results or []:
        inspection.results.append(
            InspectionResult(
                characteristic=result.characteristic.strip(),
                specification=(getattr(result, "specification", None) or "").strip() or None,
                measured_value=(result.measured_value or "").strip() or None,
                method=getattr(result, "method", None),
                min_value=getattr(result, "min_value", None),
                max_value=getattr(result, "max_value", None),
                unit=getattr(result, "unit", None),
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
    *,
    skip_signoff: bool = False,
    allow_missing_plan: bool = False,
) -> Inspection:
    decision = canonical_inspection_status(decision)
    effect = apply_inspection_decision(decision)
    inspection = _load(db, company, inspection_id)
    if inspection.status != "pending":
        raise HTTPException(status_code=400, detail="This inspection is already complete")
    receipt = _production_context(db, inspection)
    received_by = receipt.received_by_user_id if receipt is not None else None
    if not skip_signoff:
        blocked = signoff_block_reason(user_role_ids(user), user.id, received_by)
        if blocked:
            raise HTTPException(status_code=403, detail=blocked)
    recorded = _results_for_decision(
        db, company, inspection, receipt, results, decision, allow_missing_plan=allow_missing_plan
    )
    if decision == "accepted" and any(not row.passed for row in recorded):
        raise HTTPException(status_code=400, detail="Accept requires every characteristic to pass")
    _record_results(inspection, recorded)
    inspection.status = decision
    inspection.updated_at = datetime.now(timezone.utc)
    inspection.inspector_user_id = user.id
    inspection.inspected_at = datetime.now(timezone.utc)
    if notes:
        inspection.notes = notes
    if inspection.source_type == "production_receipt":
        if receipt is not None and disposition_is_terminal(receipt.stock_disposition):
            raise HTTPException(
                status_code=400,
                detail="Scrapped or rework quantity cannot be accepted or rejected again.",
            )
        if effect == "post":
            _release_to_stock(db, company, receipt)
        else:
            _hold_in_quarantine(db, company, receipt)
    db.commit()
    db.refresh(inspection)
    return _annotate(db, inspection)


def _plans(db: Session, company_id, item_id: str) -> list[InspectionPlan]:
    return (
        db.query(InspectionPlan)
        .filter(InspectionPlan.company_id == company_id, InspectionPlan.item_id == item_id)
        .order_by(InspectionPlan.sequence, InspectionPlan.characteristic)
        .all()
    )


def _production_context(db: Session, inspection: Inspection) -> ProductionReceipt | None:
    if inspection.source_type != "production_receipt":
        return None
    return db.get(ProductionReceipt, inspection.source_id)


def _annotate(db: Session, inspection: Inspection) -> Inspection:
    inspection.item_id = None
    inspection.received_by_user_id = None
    inspection.received_by_name = None
    inspection.stock_disposition = None
    inspection.plans = []
    inspection.audit_notes = _audit_notes(db, inspection)
    inspection.reinspection_request = (
        db.query(ReinspectionRequest)
        .filter(ReinspectionRequest.inspection_id == inspection.id)
        .order_by(ReinspectionRequest.created_at.desc())
        .first()
    )
    receipt = _production_context(db, inspection)
    if receipt is None:
        return inspection
    inspection.received_by_user_id = receipt.received_by_user_id
    inspection.stock_disposition = receipt.stock_disposition
    if receipt.received_by is not None:
        inspection.received_by_name = receipt.received_by.full_name
    order = db.get(ProductionOrder, receipt.production_order_id)
    if order is not None:
        inspection.item_id = order.item_id
        inspection.plans = _plans(db, inspection.company_id, order.item_id)
    return inspection


def _results_for_decision(db, company, inspection, receipt, submitted, decision: str, *, allow_missing_plan: bool = False):
    plans = []
    if receipt is not None:
        order = db.get(ProductionOrder, receipt.production_order_id)
        if order is not None:
            plans = _plans(db, company.id, order.item_id)
    if plans:
        supplied = {(row.characteristic or "").strip(): row for row in submitted or []}
        recorded = []
        for plan in plans:
            got = supplied.get(plan.characteristic)
            measured = (getattr(got, "measured_value", None) or "").strip() if got is not None else ""
            if not measured:
                raise HTTPException(status_code=400, detail=f"Record a measurement for {plan.characteristic}")
            try:
                passed = measurement_passed(plan.method, measured, plan.min_value, plan.max_value, plan.pass_options)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            recorded.append(
                SimpleNamespace(
                    characteristic=plan.characteristic,
                    specification=plan_specification(plan.method, plan.min_value, plan.max_value, plan.unit, plan.options),
                    measured_value=measured,
                    method=plan.method,
                    min_value=plan.min_value,
                    max_value=plan.max_value,
                    unit=plan.unit,
                    passed=passed,
                )
            )
        return recorded
    if inspection.source_type == "production_receipt" and not allow_missing_plan:
        raise HTTPException(
            status_code=400,
            detail="Define an inspection plan for this item before accepting or rejecting the lot.",
        )
    if inspection.source_type == "production_receipt" and allow_missing_plan and not submitted:
        return [
            SimpleNamespace(
                characteristic="Emergency override",
                specification=None,
                measured_value="Override",
                method=None,
                min_value=None,
                max_value=None,
                unit=None,
                passed=decision == "accepted",
            )
        ]
    if not submitted:
        raise HTTPException(status_code=400, detail="Record at least one characteristic")
    for row in submitted:
        row.passed = decision == "accepted"
    return submitted


def _order_for_receipt(db: Session, receipt: ProductionReceipt) -> ProductionOrder:
    order = db.get(ProductionOrder, receipt.production_order_id)
    if order is None:
        raise HTTPException(status_code=400, detail="Production order not found")
    return order


def _release_to_stock(db: Session, company: Company, receipt: ProductionReceipt | None) -> None:
    if receipt is None:
        raise HTTPException(status_code=400, detail="Production receipt not found")
    if disposition_is_terminal(receipt.stock_disposition):
        raise HTTPException(
            status_code=400,
            detail="Scrapped or rework quantity cannot return to unrestricted stock.",
        )
    if receipt.stock_disposition == "quarantine":
        order = _order_for_receipt(db, receipt)
        item = db.get(Item, order.item_id)
        if item is not None and not skip_inventory_movement(item):
            quarantine, quarantine_bin = ensure_quarantine_location(db, company)
            destination = (
                db.query(BinLocation)
                .filter(BinLocation.warehouse_id == order.warehouse_id, BinLocation.is_active.is_(True))
                .order_by(BinLocation.bin_code)
                .first()
            )
            if destination is None:
                raise HTTPException(status_code=400, detail="The production warehouse has no bin for released stock")
            transfer_stock(
                db,
                item_id=order.item_id,
                quantity=int(receipt.quantity_received),
                to_warehouse_id=destination.warehouse_id,
                to_bin_id=destination.bin_id,
                from_warehouse_id=quarantine.warehouse_id,
                from_bin_id=quarantine_bin.bin_id,
                notes=f"QC release {receipt.receipt_id}",
            )
        if not receipt.completion_counted:
            order.qty_completed = int(order.qty_completed or 0) + int(receipt.quantity_received)
            receipt.completion_counted = True
            if production_is_covered(order.qty_ordered, order.qty_completed, order.scrapped_qty):
                order.status = "completed"
        receipt.stock_disposition = "unrestricted"
        receipt.posted_to_stock = True
        return
    if not receipt.posted_to_stock:
        post_accepted_receipt(db, receipt)
        receipt.stock_disposition = "unrestricted"


def _hold_in_quarantine(db: Session, company: Company, receipt: ProductionReceipt | None) -> None:
    if receipt is None:
        raise HTTPException(status_code=400, detail="Production receipt not found")
    if disposition_is_terminal(receipt.stock_disposition):
        raise HTTPException(status_code=400, detail="Scrapped or rework quantity stays in its restricted warehouse.")
    if receipt.stock_disposition == "quarantine":
        return
    order = _order_for_receipt(db, receipt)
    item = db.get(Item, order.item_id)
    if item is None or skip_inventory_movement(item):
        receipt.stock_disposition = "quarantine"
        return
    quarantine, quarantine_bin = ensure_quarantine_location(db, company)
    if receipt.posted_to_stock and receipt.stock_disposition == "unrestricted":
        transfer_stock(
            db,
            item_id=order.item_id,
            quantity=int(receipt.quantity_received),
            to_warehouse_id=quarantine.warehouse_id,
            to_bin_id=quarantine_bin.bin_id,
            from_warehouse_id=order.warehouse_id,
            notes=f"QC reject {receipt.receipt_id}",
        )
    else:
        receive_stock(
            db,
            item_id=order.item_id,
            quantity=int(receipt.quantity_received),
            reference=receipt.receipt_id,
            notes=f"QC quarantine {receipt.receipt_id}",
            warehouse_id=quarantine.warehouse_id,
            bin_id=quarantine_bin.bin_id,
        )
        receipt.posted_to_stock = True
    receipt.stock_disposition = "quarantine"


def list_plans(db: Session, company: Company, item_id: str) -> list[InspectionPlan]:
    return _plans(db, company.id, item_id)


def add_plan(db: Session, company: Company, user: User, payload) -> InspectionPlan:
    if not QC_MANAGER_ROLES.intersection(user_role_ids(user)):
        raise HTTPException(status_code=403, detail="A Quality Manager maintains the inspection plan.")
    if db.get(Item, payload.item_id) is None:
        raise HTTPException(status_code=400, detail="Item not found")
    method = payload.method
    if method not in {"numeric", "attribute"}:
        raise HTTPException(status_code=400, detail="Inspection method must be numeric or attribute")
    last = (
        db.query(InspectionPlan.sequence)
        .filter(InspectionPlan.company_id == company.id, InspectionPlan.item_id == payload.item_id)
        .order_by(InspectionPlan.sequence.desc())
        .first()
    )
    row = InspectionPlan(
        company_id=company.id,
        item_id=payload.item_id,
        sequence=(int(last[0]) + 10) if last else 10,
        characteristic=payload.characteristic.strip(),
        method=method,
        min_value=payload.min_value,
        max_value=payload.max_value,
        unit=(payload.unit or "").strip() or None,
        options=(payload.options or "").strip() or None,
        pass_options=(payload.pass_options or "").strip() or ("Pass" if method == "attribute" else None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def request_reinspection(db: Session, company: Company, user: User, inspection_id, reason: str) -> ReinspectionRequest:
    inspection = _load(db, company, inspection_id)
    if inspection.status not in {"accepted", "rejected"}:
        raise HTTPException(status_code=400, detail="Request a re-inspection only after the lot is accepted or rejected")
    text = (reason or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Enter the reason for the re-inspection")
    open_request = (
        db.query(ReinspectionRequest)
        .filter(
            ReinspectionRequest.company_id == company.id,
            ReinspectionRequest.source_type == inspection.source_type,
            ReinspectionRequest.source_id == inspection.source_id,
            ReinspectionRequest.status.in_(["pending", "approved"]),
        )
        .first()
    )
    if open_request is not None:
        raise HTTPException(status_code=400, detail="A re-inspection request is already open for this receipt")
    row = ReinspectionRequest(
        company_id=company.id,
        inspection_id=inspection.id,
        source_type=inspection.source_type,
        source_id=inspection.source_id,
        reason=text,
        status="pending",
        requested_by_user_id=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def decide_reinspection(db: Session, company: Company, user: User, request_id, approved: bool) -> ReinspectionRequest:
    row = (
        db.query(ReinspectionRequest)
        .filter(ReinspectionRequest.id == request_id, ReinspectionRequest.company_id == company.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Re-inspection request not found")
    if row.status != "pending":
        raise HTTPException(status_code=400, detail="This re-inspection request is already decided")
    blocked = reopen_block_reason(user_role_ids(user), user.id, row.requested_by_user_id)
    if blocked:
        raise HTTPException(status_code=403, detail=blocked)
    row.status = "approved" if approved else "rejected"
    row.decided_by_user_id = user.id
    row.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


def _audit_notes(db: Session, inspection: Inspection) -> list[QualityAuditNote]:
    rows = (
        db.query(QualityAuditNote)
        .options(selectinload(QualityAuditNote.alerts))
        .filter(
            QualityAuditNote.company_id == inspection.company_id,
            QualityAuditNote.source_type == inspection.source_type,
            QualityAuditNote.source_id == inspection.source_id,
        )
        .order_by(QualityAuditNote.created_at.desc())
        .all()
    )
    for row in rows:
        row.alerted = bool(row.alerts)
    return rows


def _write_note(db: Session, company: Company, source_type: str, source_id: str, code: str, message: str, user: User | None) -> QualityAuditNote:
    note = QualityAuditNote(
        company_id=company.id,
        source_type=source_type,
        source_id=source_id,
        note_code=code,
        message=message,
        created_by_user_id=None if user is None else user.id,
    )
    db.add(note)
    db.flush()
    return note


def _alert_plant_leadership(db: Session, company: Company, note: QualityAuditNote, message: str) -> None:
    leaders = (
        db.query(User)
        .join(UserCompany, UserCompany.user_id == User.id)
        .join(UserRole, UserRole.user_id == User.id)
        .filter(UserCompany.company_id == company.id, UserRole.role_id == PLANT_LEADERSHIP_ROLE)
        .all()
    )
    recipients = leaders or [None]
    for leader in recipients:
        db.add(
            QualityAlert(
                company_id=company.id,
                audit_note_id=note.id,
                recipient_user_id=None if leader is None else leader.id,
                recipient_role_id=PLANT_LEADERSHIP_ROLE,
                message=message,
            )
        )


def _transfer_restricted(db: Session, company: Company, receipt: ProductionReceipt, stock_class: str, note: str) -> None:
    if receipt.stock_disposition != "quarantine":
        raise HTTPException(status_code=400, detail="Quantity must be in quarantine before it can be scrapped or sent to rework")
    order = _order_for_receipt(db, receipt)
    item = db.get(Item, order.item_id)
    if item is None or skip_inventory_movement(item):
        receipt.stock_disposition = stock_class
        return
    origin, origin_bin = ensure_quarantine_location(db, company)
    destination, destination_bin = ensure_classified_location(db, company, stock_class)
    transfer_stock(
        db,
        item_id=order.item_id,
        quantity=int(receipt.quantity_received),
        to_warehouse_id=destination.warehouse_id,
        to_bin_id=destination_bin.bin_id,
        from_warehouse_id=origin.warehouse_id,
        from_bin_id=origin_bin.bin_id,
        notes=note,
    )
    receipt.stock_disposition = stock_class
    receipt.posted_to_stock = True


def dispose_quarantine(db: Session, company: Company, user: User, inspection_id, disposition: str) -> Inspection:
    if disposition not in {"scrap", "rework"}:
        raise HTTPException(status_code=400, detail="Disposition must be scrap or rework")
    if not QC_MANAGER_ROLES.intersection(user_role_ids(user)):
        raise HTTPException(status_code=403, detail="A Quality Manager disposes quantity from quarantine.")
    inspection = _load(db, company, inspection_id)
    if inspection.status != "rejected" or inspection.source_type != "production_receipt":
        raise HTTPException(status_code=400, detail="Only a rejected production receipt can leave quarantine")
    receipt = _production_context(db, inspection)
    if receipt is None or receipt.stock_disposition != "quarantine":
        raise HTTPException(status_code=400, detail="Quantity must be in quarantine before it can be scrapped or sent to rework")
    if receipt.received_by_user_id is not None and str(receipt.received_by_user_id) == str(user.id):
        raise HTTPException(status_code=403, detail="The person who received this lot cannot dispose of it.")
    _transfer_restricted(db, company, receipt, disposition, f"QC {disposition} {receipt.receipt_id}")
    _write_note(
        db,
        company,
        inspection.source_type,
        inspection.source_id,
        "Scrap" if disposition == "scrap" else "Rework",
        f"Quality Manager moved {receipt.receipt_id} from quarantine to {disposition}.",
        user,
    )
    db.commit()
    return _load(db, company, inspection_id)


def emergency_override(db: Session, company: Company, user: User, inspection_id, payload) -> Inspection:
    blocked = override_block_reason(user_role_ids(user), payload.justification)
    if blocked:
        raise HTTPException(status_code=403, detail=blocked)
    inspection = _load(db, company, inspection_id)
    justification = payload.justification.strip()
    action = payload.action
    receipt = _production_context(db, inspection)
    if action in {"accept", "reject"}:
        if inspection.status != "pending":
            raise HTTPException(status_code=400, detail="This inspection is already complete")
        inspection = decide(
            db,
            company,
            inspection_id,
            "accepted" if action == "accept" else "rejected",
            user,
            payload.results,
            justification,
            skip_signoff=True,
            allow_missing_plan=True,
        )
    elif action == "quarantine":
        if inspection.status != "rejected" or receipt is None or receipt.stock_disposition != "unrestricted":
            raise HTTPException(
                status_code=400,
                detail="Quarantine override applies to a rejected lot that is still in unrestricted stock.",
            )
        _hold_in_quarantine(db, company, receipt)
        db.commit()
        inspection = _load(db, company, inspection_id)
    elif action in {"scrap", "rework"}:
        if receipt is None or receipt.stock_disposition != "quarantine":
            raise HTTPException(status_code=400, detail="Scrap and rework start from quarantine.")
        _transfer_restricted(db, company, receipt, action, f"Emergency {action} {receipt.receipt_id}")
        db.commit()
        inspection = _load(db, company, inspection_id)
    else:
        raise HTTPException(status_code=400, detail="Unknown emergency action")
    message = f"Emergency override on {inspection.source_id} by {user.full_name}: {justification}"
    note = _write_note(db, company, inspection.source_type, inspection.source_id, EMERGENCY_OVERRIDE, message, user)
    _alert_plant_leadership(db, company, note, message)
    db.commit()
    return _load(db, company, inspection_id)


def list_quality_alerts(db: Session, company: Company) -> list[QualityAlert]:
    return (
        db.query(QualityAlert)
        .filter(QualityAlert.company_id == company.id, QualityAlert.acknowledged_at.is_(None))
        .order_by(QualityAlert.created_at.desc())
        .limit(20)
        .all()
    )
