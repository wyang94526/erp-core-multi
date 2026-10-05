# @author: Wendy Yang
# @date: 2026-09-27

"""Same-number revision snapshots and field-level change logs for SO / PO / SCO."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.models import (
    DocumentChangeLog,
    DocumentRevision,
    PurchaseOrder,
    SalesOrder,
    SubcontractOrder,
    SubcontractOrderItem,
    User,
)

REVISABLE_TYPES = frozenset({"SALES_ORDER", "PURCHASE_ORDER", "SUBCONTRACT_ORDER"})

_SKIP_DIFF_KEYS = frozenset(
    {
        "approval_status",
        "current_approval_step",
        "revision_number",
        "amendment_number",
        "root_document_id",
        "status",
        "created_at",
        "can_recall",
        "can_revise",
        "recall_blocked_reason",
        "revise_blocked_reason",
        "has_posted_receipts",
        "has_supplier_invoices",
        "billed_amount",
        "remaining_billable_amount",
        "invoice_status",
        "quantity_received",
        "quantity_remaining_to_receive",
        "quantity_billed",
        "quantity_remaining_to_bill",
        "quantity_issued",
        "billing_status",
    }
)


def json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def flatten_snapshot(payload: Any, prefix: str = "") -> dict[str, str]:
    flat: dict[str, str] = {}
    if isinstance(payload, dict):
        for key, item in payload.items():
            if key in _SKIP_DIFF_KEYS:
                continue
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            flat.update(flatten_snapshot(item, next_prefix))
        return flat
    if isinstance(payload, list):
        for index, item in enumerate(payload):
            flat.update(flatten_snapshot(item, f"{prefix}[{index}]"))
        return flat
    rendered = "" if payload is None else str(payload)
    if prefix:
        flat[prefix] = rendered
    return flat


def diff_snapshots(before: Any, after: Any) -> list[tuple[str, str | None, str | None]]:
    old_flat = flatten_snapshot(before or {})
    new_flat = flatten_snapshot(after or {})
    fields = sorted(set(old_flat) | set(new_flat))
    changes: list[tuple[str, str | None, str | None]] = []
    for field in fields:
        old_value = old_flat.get(field)
        new_value = new_flat.get(field)
        if old_value != new_value:
            changes.append((field, old_value, new_value))
    return changes


def sales_order_snapshot(order: SalesOrder) -> dict[str, Any]:
    items = []
    for item in sorted(order.items or [], key=lambda row: (row.line_number or 0, row.so_item_id or 0)):
        items.append(
            {
                "line_number": item.line_number,
                "item_id": item.item_id,
                "customer_part_number": item.customer_part_number,
                "quantity_ordered": item.quantity_ordered,
                "unit_price": item.unit_price,
                "tax_amount": item.tax_amount,
                "total_amount": item.total_amount,
            }
        )
    return json_safe(
        {
            "sales_order_id": order.sales_order_id,
            "customer_id": order.customer_id,
            "bill_to_location_id": order.bill_to_location_id,
            "ship_to_location_id": order.ship_to_location_id,
            "customer_po_number": order.customer_po_number,
            "po_revision_number": order.po_revision_number,
            "order_date": order.order_date,
            "customer_revision_date": order.customer_revision_date,
            "payment_terms": order.payment_terms,
            "payment_term_id": order.payment_term_id,
            "freight_terms": order.freight_terms,
            "shipping_method": order.shipping_method,
            "currency": order.currency,
            "buyer_contact_name": order.buyer_contact_name,
            "buyer_contact_email": order.buyer_contact_email,
            "total_amount": order.total_amount,
            "items": items,
        }
    )


def purchase_order_snapshot(po: PurchaseOrder) -> dict[str, Any]:
    items = []
    for item in po.items or []:
        items.append(
            {
                "sku": item.sku,
                "description": item.description,
                "uom": item.uom,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "tax_rate": item.tax_rate,
                "line_subtotal": item.line_subtotal,
                "line_tax": item.line_tax,
                "line_total": item.line_total,
                "sco_component_id": item.sco_component_id,
            }
        )
    items.sort(key=lambda row: (row.get("sku") or "", str(row.get("sco_component_id") or "")))
    return json_safe(
        {
            "po_number": po.po_number,
            "supplier_id": po.supplier_id,
            "po_type": po.po_type,
            "sco_number": po.sco_number,
            "order_date": po.order_date,
            "expected_delivery_date": po.expected_delivery_date,
            "payment_terms": po.payment_terms,
            "payment_term_id": po.payment_term_id,
            "shipping_fee": po.shipping_fee,
            "discount_type": po.discount_type,
            "discount_value": po.discount_value,
            "incoterms": po.incoterms,
            "freight_terms": po.freight_terms,
            "carrier_account": po.carrier_account,
            "subtotal": po.subtotal,
            "total_tax": po.total_tax,
            "discount_amount": po.discount_amount,
            "grand_total": po.grand_total,
            "notes": po.notes,
            "items": items,
        }
    )


def subcontract_order_snapshot(sco: SubcontractOrder) -> dict[str, Any]:
    lines = []
    for line in sorted(sco.lines or [], key=lambda row: (row.line_number or 0, row.sco_line_id or 0)):
        charges = []
        for charge in sorted(line.charges or [], key=lambda row: row.line_no or 0):
            charges.append(
                {
                    "line_no": charge.line_no,
                    "name": charge.name,
                    "detail_explanation": charge.detail_explanation,
                    "labor_minutes": charge.labor_minutes,
                    "sf_rate": charge.sf_rate,
                    "cost_per_unit": charge.cost_per_unit,
                    "margin_percent": charge.margin_percent,
                    "is_margin": charge.is_margin,
                }
            )
        components = []
        for component in sorted(
            line.components or [],
            key=lambda row: (row.component_item_id or "", row.sco_component_id or 0),
        ):
            components.append(
                {
                    "component_item_id": component.component_item_id,
                    "quantity_required": component.quantity_required,
                    "quantity_required_bom": component.quantity_required_bom,
                    "is_overridden": component.is_overridden,
                    "notes": component.notes,
                }
            )
        lines.append(
            {
                "line_number": line.line_number,
                "item_id": line.item_id,
                "quantity_ordered": line.quantity_ordered,
                "unit_price": line.unit_price,
                "line_total": line.line_total,
                "charges": charges,
                "components": components,
            }
        )
    return json_safe(
        {
            "sco_number": sco.sco_number,
            "supplier_id": sco.supplier_id,
            "sales_order_id": sco.sales_order_id,
            "item_id": sco.item_id,
            "quantity_ordered": sco.quantity_ordered,
            "unit_price": sco.unit_price,
            "expected_return_date": sco.expected_return_date,
            "notes": sco.notes,
            "lines": lines,
        }
    )


def build_snapshot(canonical: str, doc: Any) -> dict[str, Any]:
    if canonical == "SALES_ORDER":
        return sales_order_snapshot(doc)
    if canonical == "PURCHASE_ORDER":
        return purchase_order_snapshot(doc)
    if canonical == "SUBCONTRACT_ORDER":
        return subcontract_order_snapshot(doc)
    raise HTTPException(status_code=404, detail=f"Revisions are not supported for {canonical}")


def document_id_of(canonical: str, doc: Any) -> str:
    if canonical == "SALES_ORDER":
        return str(doc.sales_order_id)
    if canonical == "PURCHASE_ORDER":
        return str(doc.po_number)
    if canonical == "SUBCONTRACT_ORDER":
        return str(doc.sco_number)
    raise HTTPException(status_code=404, detail=f"Revisions are not supported for {canonical}")


def load_revisable_document(db: Session, canonical: str, document_id: str) -> Any:
    if canonical == "SALES_ORDER":
        doc = (
            db.query(SalesOrder)
            .options(selectinload(SalesOrder.items))
            .filter(SalesOrder.sales_order_id == document_id)
            .first()
        )
    elif canonical == "PURCHASE_ORDER":
        doc = (
            db.query(PurchaseOrder)
            .options(selectinload(PurchaseOrder.items))
            .filter(PurchaseOrder.po_number == document_id)
            .first()
        )
    elif canonical == "SUBCONTRACT_ORDER":
        doc = (
            db.query(SubcontractOrder)
            .options(
                selectinload(SubcontractOrder.lines).selectinload(SubcontractOrderItem.charges),
                selectinload(SubcontractOrder.lines).selectinload(SubcontractOrderItem.components),
                selectinload(SubcontractOrder.components),
            )
            .filter(SubcontractOrder.sco_number == document_id)
            .first()
        )
    else:
        raise HTTPException(status_code=404, detail=f"Revisions are not supported for {canonical}")
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def freeze_current_revision(
    db: Session,
    *,
    canonical: str,
    doc: Any,
    user: User | None,
) -> DocumentRevision:
    document_id = document_id_of(canonical, doc)
    revision_number = int(getattr(doc, "revision_number", 0) or 0)
    root_id = getattr(doc, "root_document_id", None) or document_id
    existing = (
        db.query(DocumentRevision)
        .filter(
            DocumentRevision.document_type == canonical,
            DocumentRevision.document_id == document_id,
            DocumentRevision.revision_number == revision_number,
        )
        .one_or_none()
    )
    if existing is not None:
        return existing
    row = DocumentRevision(
        id=uuid4(),
        document_type=canonical,
        document_id=document_id,
        revision_number=revision_number,
        root_document_id=root_id,
        snapshot_json=build_snapshot(canonical, doc),
        created_by_user_id=getattr(user, "id", None),
    )
    db.add(row)
    db.flush()
    return row


def record_reapproval_change_logs(
    db: Session,
    *,
    canonical: str,
    doc: Any,
    user: User | None,
) -> list[DocumentChangeLog]:
    if canonical not in REVISABLE_TYPES:
        return []
    revision_number = int(getattr(doc, "revision_number", 0) or 0)
    if revision_number <= 0:
        return []
    document_id = document_id_of(canonical, doc)
    live = load_revisable_document(db, canonical, document_id)
    latest = (
        db.query(DocumentRevision)
        .filter(
            DocumentRevision.document_type == canonical,
            DocumentRevision.document_id == document_id,
        )
        .order_by(DocumentRevision.revision_number.desc())
        .first()
    )
    if latest is None:
        return []
    rows: list[DocumentChangeLog] = []
    for field_name, old_value, new_value in diff_snapshots(latest.snapshot_json, build_snapshot(canonical, live)):
        row = DocumentChangeLog(
            document_type=canonical,
            document_id=document_id,
            revision_number=revision_number,
            user_id=getattr(user, "id", None),
            field_name=field_name,
            old_value=old_value,
            new_value=new_value,
        )
        db.add(row)
        rows.append(row)
    if canonical == "SUBCONTRACT_ORDER":
        resync_sco_bom_quantities(db, live)
    db.flush()
    return rows


def list_revisions(db: Session, canonical: str, document_id: str) -> list[DocumentRevision]:
    return (
        db.query(DocumentRevision)
        .options(selectinload(DocumentRevision.created_by))
        .filter(
            DocumentRevision.document_type == canonical,
            DocumentRevision.document_id == document_id,
        )
        .order_by(DocumentRevision.revision_number.desc())
        .all()
    )


def list_change_logs(db: Session, canonical: str, document_id: str) -> list[DocumentChangeLog]:
    return (
        db.query(DocumentChangeLog)
        .options(selectinload(DocumentChangeLog.user))
        .filter(
            DocumentChangeLog.document_type == canonical,
            DocumentChangeLog.document_id == document_id,
        )
        .order_by(DocumentChangeLog.created_at.desc(), DocumentChangeLog.id.desc())
        .all()
    )


def resync_sco_bom_quantities(db: Session, sco: SubcontractOrder) -> None:
    """Re-explode Material BOM quantities when finished-good qty changes and nothing is issued."""
    from app.services.catalog import explode_assembly_components

    issued = any(
        Decimal(str(component.quantity_issued or 0)) > 0 for component in (sco.components or [])
    )
    if issued:
        return
    for line in sco.lines or []:
        qty = int(line.quantity_ordered or sco.quantity_ordered or 0)
        exploded = explode_assembly_components(
            db,
            line.item_id,
            qty,
            bom_header_id=line.bom_header_id,
            require_bom=False,
        )
        by_item = {row["component_item_id"]: row for row in exploded}
        for component in line.components or []:
            row = by_item.get(component.component_item_id)
            if row is None:
                continue
            bom_qty = Decimal(str(row["quantity_required"]))
            component.quantity_required_bom = bom_qty
            if not component.is_overridden:
                component.quantity_required = bom_qty
    db.flush()
