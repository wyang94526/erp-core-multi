"""Subcontract BOM / assembly kit management (Material lines on ItemBOMComponents)."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Item, ItemBOMComponent
from app.schemas import (
    SubcontractBOMLineCreate,
    SubcontractBOMLineRead,
    SubcontractBOMRead,
)
from app.services.catalog import material_bom_lines, primary_vendor_mapping
from app.services.bom_versions import assert_line_writable, ensure_writable_header, resolve_header

router = APIRouter(prefix="/subcontract-boms", tags=["subcontract-boms"])


def _line_read(db: Session, line: ItemBOMComponent) -> SubcontractBOMLineRead:
    component = db.get(Item, line.component_item_id) if line.component_item_id else None
    vendor = (
        primary_vendor_mapping(db, line.component_item_id)
        if line.component_item_id
        else None
    )
    return SubcontractBOMLineRead(
        bom_id=line.bom_id,
        assembly_item_id=line.parent_item_id,
        component_item_id=line.component_item_id,
        quantity_required=line.quantity_per,
        scrap_factor=getattr(line, "scrap_factor", 0) or 0,
        yield_loss_percentage=getattr(line, "yield_loss_percentage", 0) or 0,
        component_description=component.description if component else None,
        is_purchase_item=bool(getattr(component, "is_purchase_item", False)) if component else None,
        is_raw_material=bool(getattr(component, "is_raw_material", False)) if component else None,
        primary_vendor_id=vendor.supplier_id if vendor else None,
        primary_vendor_sku=vendor.vendor_sku if vendor else None,
        unit_cost=vendor.unit_cost if vendor else None,
    )


def _bom_read(
    db: Session, assembly_id: str, bom_header_id: int | None = None
) -> SubcontractBOMRead:
    assembly = db.get(Item, assembly_id)
    if assembly is None:
        raise HTTPException(status_code=404, detail="Assembly item not found")
    header = resolve_header(db, assembly_id, bom_header_id)
    lines = material_bom_lines(db, assembly_id, bom_header_id=bom_header_id)
    return SubcontractBOMRead(
        assembly_item_id=assembly_id,
        assembly_description=assembly.description,
        is_subcontract_assembly=bool(
            getattr(assembly, "is_subcontract_assembly", False)
            or assembly.is_outside_processed
        ),
        bom_header_id=header.bom_header_id if header else None,
        bom_version_no=header.version_no if header else None,
        bom_status=header.status if header else None,
        components=[_line_read(db, line) for line in lines],
    )


@router.get("/{assembly_id}", response_model=SubcontractBOMRead)
def get_subcontract_bom(
    assembly_id: str,
    bom_header_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> SubcontractBOMRead:
    return _bom_read(db, assembly_id, bom_header_id)


@router.post("/", response_model=SubcontractBOMLineRead, status_code=status.HTTP_201_CREATED)
def create_subcontract_bom_line(
    payload: SubcontractBOMLineCreate, db: Session = Depends(get_db)
) -> SubcontractBOMLineRead:
    assembly = db.get(Item, payload.assembly_item_id)
    if assembly is None:
        raise HTTPException(status_code=400, detail="Assembly item not found")
    component = db.get(Item, payload.component_item_id)
    if component is None:
        raise HTTPException(status_code=400, detail="Component item not found")
    if payload.assembly_item_id == payload.component_item_id:
        raise HTTPException(status_code=400, detail="Assembly cannot reference itself")

    # Mark parent as subcontract assembly when kit lines are defined
    if not assembly.is_subcontract_assembly and not assembly.is_outside_processed:
        assembly.is_subcontract_assembly = True
        assembly.is_outside_processed = True

    header = ensure_writable_header(db, payload.assembly_item_id)

    existing = (
        db.query(ItemBOMComponent)
        .filter(
            ItemBOMComponent.bom_header_id == header.bom_header_id,
            ItemBOMComponent.component_item_id == payload.component_item_id,
            ItemBOMComponent.item_type == "Material",
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Component already on this assembly kit")

    line = ItemBOMComponent(
        bom_header_id=header.bom_header_id,
        parent_item_id=payload.assembly_item_id,
        component_item_id=payload.component_item_id,
        quantity_per=payload.quantity_required,
        item_type="Material",
        scrap_factor=payload.scrap_factor,
        yield_loss_percentage=payload.yield_loss_percentage,
    )
    db.add(line)
    db.commit()
    db.refresh(line)
    return _line_read(db, line)


@router.delete("/{assembly_id}/components/{bom_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subcontract_bom_line(
    assembly_id: str, bom_id: int, db: Session = Depends(get_db)
) -> None:
    line = db.get(ItemBOMComponent, bom_id)
    if not line or line.parent_item_id != assembly_id:
        raise HTTPException(status_code=404, detail="BOM line not found")
    assert_line_writable(line)
    db.delete(line)
    db.commit()
