"""Material-PO demand against subcontract-order component requirements."""

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Item,
    PurchaseOrder,
    PurchaseOrderItem,
    SubcontractOrder,
    SubcontractOrderComponent,
    Supplier,
    VendorItemMapping,
)
from app.services.po_totals import remaining_to_buy

_CLOSED_SCO_STATUSES = {"COMPLETED", "CANCELLED"}


def list_eligible_for_material_po(
    db: Session,
    q: str = "",
    skip: int = 0,
    limit: int = 40,
) -> list[dict]:
    query = (
        db.query(SubcontractOrder)
        .options(
            selectinload(SubcontractOrder.supplier),
            selectinload(SubcontractOrder.item),
            selectinload(SubcontractOrder.components),
        )
        .filter(~func.upper(SubcontractOrder.status).in_(tuple(_CLOSED_SCO_STATUSES)))
    )
    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        query = query.outerjoin(Supplier, Supplier.supplier_id == SubcontractOrder.supplier_id).filter(
            or_(
                SubcontractOrder.sco_number.ilike(like),
                SubcontractOrder.item_id.ilike(like),
                SubcontractOrder.supplier_id.ilike(like),
                Supplier.company_name.ilike(like),
            )
        )
    rows = (
        query.order_by(SubcontractOrder.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_eligible_row(sco) for sco in rows]


def _eligible_row(sco: SubcontractOrder) -> dict:
    supplier = sco.supplier
    item = sco.item
    return {
        "sco_number": sco.sco_number,
        "supplier_id": sco.supplier_id,
        "supplier_name": supplier.company_name if supplier is not None else None,
        "item_id": sco.item_id,
        "fg_description": (item.description if item is not None else None),
        "expected_return_date": sco.expected_return_date,
        "status": sco.status,
        "quantity_ordered": sco.quantity_ordered,
        "open_component_line_count": len(sco.components or []),
    }


def ordered_qty_by_component(
    db: Session,
    sco_number: str,
    exclude_po_number: str | None = None,
) -> tuple[dict[int, Decimal], dict[int, Decimal]]:
    """Return (all non-void qty, draft-only qty) keyed by sco_component_id."""
    query = (
        db.query(
            PurchaseOrderItem.sco_component_id,
            PurchaseOrder.status,
            func.coalesce(func.sum(PurchaseOrderItem.quantity), 0),
        )
        .join(PurchaseOrder, PurchaseOrder.po_number == PurchaseOrderItem.po_number)
        .filter(
            PurchaseOrder.sco_number == sco_number,
            PurchaseOrder.po_type == "MATERIAL",
            PurchaseOrder.status != "Void",
            PurchaseOrderItem.sco_component_id.isnot(None),
        )
        .group_by(PurchaseOrderItem.sco_component_id, PurchaseOrder.status)
    )
    if exclude_po_number:
        query = query.filter(PurchaseOrder.po_number != exclude_po_number)

    total: dict[int, Decimal] = {}
    draft: dict[int, Decimal] = {}
    for component_id, status, qty in query.all():
        if component_id is None:
            continue
        key = int(component_id)
        amount = Decimal(str(qty or 0))
        total[key] = total.get(key, Decimal("0")) + amount
        if status == "Draft":
            draft[key] = draft.get(key, Decimal("0")) + amount
    return total, draft


def _positive_cost(value) -> Decimal | None:
    if value is None:
        return None
    amount = Decimal(str(value))
    if amount <= 0:
        return None
    return amount


def _mapping_cost(
    db: Session, item_id: str, supplier_id: str | None = None
) -> VendorItemMapping | None:
    query = db.query(VendorItemMapping).filter(
        or_(
            VendorItemMapping.item_id == item_id,
            VendorItemMapping.vendor_sku == item_id,
        ),
        VendorItemMapping.unit_cost.isnot(None),
        VendorItemMapping.unit_cost > 0,
    )
    if supplier_id:
        query = query.filter(VendorItemMapping.supplier_id == supplier_id)
    return query.order_by(
        VendorItemMapping.is_primary_vendor.desc(),
        VendorItemMapping.mapping_id,
    ).first()


def _last_purchase_price(
    db: Session, item_id: str, supplier_id: str | None = None
) -> Decimal | None:
    query = (
        db.query(PurchaseOrderItem.unit_price)
        .join(PurchaseOrder, PurchaseOrder.po_number == PurchaseOrderItem.po_number)
        .filter(
            PurchaseOrderItem.sku == item_id,
            PurchaseOrder.status != "Void",
            PurchaseOrderItem.unit_price > 0,
        )
        .order_by(PurchaseOrder.order_date.desc(), PurchaseOrder.created_at.desc())
    )
    if supplier_id:
        query = query.filter(PurchaseOrder.supplier_id == supplier_id)
    row = query.first()
    return _positive_cost(row[0]) if row is not None else None


def resolve_purchase_unit_price(
    db: Session, item_id: str, supplier_id: str | None = None, catalog: Item | None = None
) -> tuple[Decimal | None, str]:
    """Vendor master → last PO price → item catalog price."""
    if supplier_id:
        mapping = _mapping_cost(db, item_id, supplier_id)
        cost = _positive_cost(mapping.unit_cost) if mapping is not None else None
        if cost is not None:
            return cost, "VENDOR_MAPPING"

    mapping = _mapping_cost(db, item_id)
    cost = _positive_cost(mapping.unit_cost) if mapping is not None else None
    if cost is not None:
        return cost, "PRIMARY_VENDOR"

    if supplier_id:
        last_vendor = _last_purchase_price(db, item_id, supplier_id)
        if last_vendor is not None:
            return last_vendor, "LAST_PO_VENDOR"

    last_any = _last_purchase_price(db, item_id)
    if last_any is not None:
        return last_any, "LAST_PO"

    if catalog is None:
        catalog = db.get(Item, item_id)
    catalog_price = _positive_cost(catalog.unit_price) if catalog is not None else None
    if catalog_price is not None:
        return catalog_price, "CATALOG"

    return None, "NONE"


def unfulfilled_components(
    db: Session,
    sco_number: str,
    supplier_id: str | None = None,
    exclude_po_number: str | None = None,
    include_fully_covered: bool = False,
) -> list[dict]:
    sco = (
        db.query(SubcontractOrder)
        .options(
            selectinload(SubcontractOrder.components).selectinload(
                SubcontractOrderComponent.component_item
            )
        )
        .filter(SubcontractOrder.sco_number == sco_number)
        .first()
    )
    if sco is None:
        raise HTTPException(status_code=404, detail=f"Subcontract order '{sco_number}' not found")
    if (sco.status or "").upper() in _CLOSED_SCO_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Subcontract order '{sco_number}' is {sco.status} and cannot be purchased against",
        )

    ordered, draft_ordered = ordered_qty_by_component(
        db, sco_number, exclude_po_number=exclude_po_number
    )
    lines: list[dict] = []
    for component in sco.components or []:
        catalog = component.component_item or db.get(Item, component.component_item_id)
        already = ordered.get(int(component.sco_component_id), Decimal("0"))
        remaining = remaining_to_buy(component.quantity_required, already)
        if remaining <= 0 and not include_fully_covered:
            continue
        unit_cost, price_source = resolve_purchase_unit_price(
            db, component.component_item_id, supplier_id, catalog
        )
        description = (catalog.description if catalog is not None else None) or component.component_item_id
        if description and len(description) > 255:
            description = description[:255]
        lines.append(
            {
                "sco_component_id": component.sco_component_id,
                "sco_line_id": component.sco_line_id,
                "component_item_id": component.component_item_id,
                "description": description,
                "uom": (catalog.uom if catalog is not None else None) or "Each",
                "quantity_required": component.quantity_required,
                "quantity_already_ordered": already,
                "quantity_on_draft_pos": draft_ordered.get(int(component.sco_component_id), Decimal("0")),
                "quantity_remaining": remaining,
                "unit_cost": unit_cost,
                "price_source": price_source,
            }
        )
    return lines
