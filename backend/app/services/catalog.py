# @author: Wendy Yang
# @date: 2026-09-19

"""BOM explode + vendor lookup helpers for purchase / subcontract workflows."""

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from sqlalchemy import func

from app.models import InventoryStock, Item, ItemBOMComponent, VendorItemMapping
from app.services.bom_versions import resolve_header
from app.services.item_types import skip_inventory_movement


def required_quantity(
    quantity_per: Decimal,
    order_qty: int | Decimal,
    scrap_factor: Decimal | None = None,
    yield_loss_percentage: Decimal | None = None,
) -> Decimal:
    """Scale BOM qty by order qty, scrap allowance, and yield loss."""
    base = Decimal(str(quantity_per)) * Decimal(str(order_qty))
    scrap = Decimal(str(scrap_factor or 0))
    yield_loss = Decimal(str(yield_loss_percentage or 0))
    factor = Decimal("1") + scrap
    if yield_loss > 0:
        denom = Decimal("1") - (yield_loss / Decimal("100"))
        if denom <= 0:
            raise HTTPException(
                status_code=400,
                detail="yield_loss_percentage must be less than 100",
            )
        factor = factor / denom
    return (base * factor).quantize(Decimal("0.0001"))


def material_bom_lines(
    db: Session,
    assembly_id: str,
    bom_header_id: int | None = None,
) -> list[ItemBOMComponent]:
    header = resolve_header(db, assembly_id, bom_header_id)
    if header is None:
        return []
    return (
        db.query(ItemBOMComponent)
        .filter(
            ItemBOMComponent.bom_header_id == header.bom_header_id,
            ItemBOMComponent.item_type == "Material",
            ItemBOMComponent.component_item_id.isnot(None),
        )
        .order_by(ItemBOMComponent.bom_id)
        .all()
    )


def primary_vendor_mapping(db: Session, item_id: str) -> VendorItemMapping | None:
    return (
        db.query(VendorItemMapping)
        .filter(
            VendorItemMapping.item_id == item_id,
            VendorItemMapping.is_primary_vendor.is_(True),
        )
        .first()
    ) or (
        db.query(VendorItemMapping)
        .filter(VendorItemMapping.item_id == item_id)
        .order_by(VendorItemMapping.mapping_id)
        .first()
    )


def _stock_snapshot(db: Session, item_id: str, fallback_on_hand: int = 0) -> dict:
    row = (
        db.query(
            func.coalesce(func.sum(InventoryStock.on_hand_quantity), 0),
            func.coalesce(func.sum(InventoryStock.allocated_quantity), 0),
            func.coalesce(func.sum(InventoryStock.on_order_quantity), 0),
        )
        .filter(InventoryStock.item_id == item_id)
        .first()
    )
    if row and any(int(value or 0) for value in row):
        on_hand = int(row[0] or 0)
        allocated = int(row[1] or 0)
        on_order = int(row[2] or 0)
    else:
        on_hand = fallback_on_hand
        allocated = 0
        on_order = 0
    return {
        "on_hand_quantity": on_hand,
        "allocated_quantity": allocated,
        "on_order_quantity": on_order,
        "available_to_promise": on_hand - allocated + on_order,
    }


def explode_assembly_components(
    db: Session,
    assembly_id: str,
    quantity_ordered: int,
    bom_header_id: int | None = None,
) -> list[dict]:
    """Return calculated component requirements for an assembly qty."""
    assembly = db.get(Item, assembly_id)
    if assembly is None:
        raise HTTPException(status_code=404, detail=f"Assembly item '{assembly_id}' not found")

    lines = material_bom_lines(db, assembly_id, bom_header_id=bom_header_id)
    if not lines:
        raise HTTPException(
            status_code=400,
            detail=f"No Material BOM / subcontract kit defined for '{assembly_id}'",
        )

    result: list[dict] = []
    for line in lines:
        component = db.get(Item, line.component_item_id) if line.component_item_id else None
        qty = required_quantity(
            line.quantity_per,
            quantity_ordered,
            getattr(line, "scrap_factor", None),
            getattr(line, "yield_loss_percentage", None),
        )
        vendor = primary_vendor_mapping(db, line.component_item_id) if line.component_item_id else None
        fallback_on_hand = int(component.on_hand_quantity or 0) if component else 0
        stock = (
            _stock_snapshot(db, line.component_item_id, fallback_on_hand)
            if line.component_item_id
            else {
                "on_hand_quantity": 0,
                "allocated_quantity": 0,
                "on_order_quantity": 0,
                "available_to_promise": 0,
            }
        )
        shortfall = Decimal("0")
        if component is None or not skip_inventory_movement(component):
            shortfall = max(qty - Decimal(str(stock["available_to_promise"])), Decimal("0"))
        if skip_inventory_movement(component):
            stock = {
                **stock,
                "available_to_promise": 0,
                "on_hand_quantity": 0,
            }
        result.append(
            {
                "component_item_id": line.component_item_id,
                "description": component.description if component else None,
                "uom": (component.uom if component and component.uom else "Each"),
                "quantity_per": line.quantity_per,
                "scrap_factor": getattr(line, "scrap_factor", Decimal("0")) or Decimal("0"),
                "yield_loss_percentage": getattr(line, "yield_loss_percentage", Decimal("0"))
                or Decimal("0"),
                "quantity_required": qty,
                "quantity_issued": Decimal("0"),
                "quantity_remaining": qty,
                "on_hand_quantity": stock["on_hand_quantity"],
                "available_to_promise": stock["available_to_promise"],
                "stock_shortfall": shortfall,
                "primary_vendor_id": vendor.supplier_id if vendor else None,
                "primary_vendor_sku": vendor.vendor_sku if vendor else None,
                "unit_cost": vendor.unit_cost if vendor else None,
                "is_purchase_item": bool(getattr(component, "is_purchase_item", False)) if component else False,
                "is_raw_material": bool(getattr(component, "is_raw_material", False)) if component else False,
            }
        )
    return result
