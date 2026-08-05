"""BOM explode + vendor lookup helpers for purchase / subcontract workflows."""

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Item, ItemBOMComponent, VendorItemMapping


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


def material_bom_lines(db: Session, assembly_id: str) -> list[ItemBOMComponent]:
    return (
        db.query(ItemBOMComponent)
        .filter(
            ItemBOMComponent.parent_item_id == assembly_id,
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


def explode_assembly_components(
    db: Session,
    assembly_id: str,
    quantity_ordered: int,
) -> list[dict]:
    """Return calculated component requirements for an assembly qty."""
    assembly = db.get(Item, assembly_id)
    if assembly is None:
        raise HTTPException(status_code=404, detail=f"Assembly item '{assembly_id}' not found")

    lines = material_bom_lines(db, assembly_id)
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
        result.append(
            {
                "component_item_id": line.component_item_id,
                "description": component.description if component else None,
                "quantity_per": line.quantity_per,
                "scrap_factor": getattr(line, "scrap_factor", Decimal("0")) or Decimal("0"),
                "yield_loss_percentage": getattr(line, "yield_loss_percentage", Decimal("0"))
                or Decimal("0"),
                "quantity_required": qty,
                "quantity_issued": Decimal("0"),
                "quantity_remaining": qty,
                "on_hand_quantity": int(component.on_hand_quantity or 0) if component else 0,
                "primary_vendor_id": vendor.supplier_id if vendor else None,
                "primary_vendor_sku": vendor.vendor_sku if vendor else None,
                "unit_cost": vendor.unit_cost if vendor else None,
                "is_purchase_item": bool(getattr(component, "is_purchase_item", False)) if component else False,
                "is_raw_material": bool(getattr(component, "is_raw_material", False)) if component else False,
            }
        )
    return result
