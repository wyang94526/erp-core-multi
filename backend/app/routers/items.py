"""Item catalog endpoints (items table is the item master)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Item, Supplier, VendorItemMapping
from app.schemas import (
    ItemCreate,
    ItemRead,
    ItemUpdate,
    VendorItemMappingCreate,
    VendorItemMappingRead,
    VendorItemMappingUpdate,
)

router = APIRouter(prefix="/items", tags=["items"])


def _sync_assembly_flags(data: dict) -> dict:
    """Keep legacy is_outside_processed aligned with is_subcontract_assembly."""
    if data.get("is_subcontract_assembly") is True and "is_outside_processed" not in data:
        data["is_outside_processed"] = True
    if data.get("is_outside_processed") is True and "is_subcontract_assembly" not in data:
        data["is_subcontract_assembly"] = True
    return data


def _mapping_read(row: VendorItemMapping) -> VendorItemMappingRead:
    return VendorItemMappingRead(
        mapping_id=row.mapping_id,
        supplier_id=row.supplier_id,
        item_id=row.item_id,
        vendor_sku=row.vendor_sku,
        unit_cost=row.unit_cost,
        minimum_order_qty=row.minimum_order_qty,
        lead_time_days=row.lead_time_days,
        is_primary_vendor=row.is_primary_vendor,
        created_at=row.created_at,
        supplier_name=row.supplier.company_name if row.supplier else None,
        item_description=row.item.description if row.item else None,
    )


@router.get("/purchase-items", response_model=list[ItemRead])
def list_purchase_items(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> list[Item]:
    return (
        db.query(Item)
        .filter(Item.is_purchase_item.is_(True))
        .order_by(Item.item_id)
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/raw-materials", response_model=list[ItemRead])
def list_raw_materials(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> list[Item]:
    return (
        db.query(Item)
        .filter(Item.is_raw_material.is_(True))
        .order_by(Item.item_id)
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/assemblies", response_model=list[ItemRead])
def list_subcontract_assemblies(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> list[Item]:
    return (
        db.query(Item)
        .filter(
            (Item.is_subcontract_assembly.is_(True))
            | (Item.is_outside_processed.is_(True))
        )
        .order_by(Item.item_id)
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("", response_model=list[ItemRead])
def list_items(
    skip: int = 0,
    limit: int = 100,
    purchase_only: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[Item]:
    q = db.query(Item)
    if purchase_only:
        q = q.filter(Item.is_purchase_item.is_(True))
    return q.order_by(Item.item_id).offset(skip).limit(limit).all()


@router.get("/{item_id}", response_model=ItemRead)
def get_item(item_id: str, db: Session = Depends(get_db)) -> Item:
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.post("", response_model=ItemRead, status_code=201)
def create_item(payload: ItemCreate, db: Session = Depends(get_db)) -> Item:
    if db.get(Item, payload.item_id) is not None:
        raise HTTPException(status_code=400, detail="Item ID already exists")
    data = _sync_assembly_flags(payload.model_dump())
    item = Item(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ItemRead)
def update_item(
    item_id: str, payload: ItemUpdate, db: Session = Depends(get_db)
) -> Item:
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    data = _sync_assembly_flags(payload.model_dump(exclude_unset=True))
    for key, value in data.items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: str, db: Session = Depends(get_db)) -> None:
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()


@router.get("/{item_id}/vendors", response_model=list[VendorItemMappingRead])
def list_item_vendors(item_id: str, db: Session = Depends(get_db)) -> list[VendorItemMappingRead]:
    if db.get(Item, item_id) is None:
        raise HTTPException(status_code=404, detail="Item not found")
    rows = (
        db.query(VendorItemMapping)
        .options(joinedload(VendorItemMapping.supplier), joinedload(VendorItemMapping.item))
        .filter(VendorItemMapping.item_id == item_id)
        .order_by(VendorItemMapping.is_primary_vendor.desc(), VendorItemMapping.mapping_id)
        .all()
    )
    return [_mapping_read(r) for r in rows]


@router.post(
    "/{item_id}/vendors",
    response_model=VendorItemMappingRead,
    status_code=201,
)
def add_item_vendor(
    item_id: str,
    payload: VendorItemMappingCreate,
    db: Session = Depends(get_db),
) -> VendorItemMappingRead:
    if item_id != payload.item_id:
        raise HTTPException(status_code=400, detail="URL item_id must match payload.item_id")
    if db.get(Item, item_id) is None:
        raise HTTPException(status_code=404, detail="Item not found")
    if db.get(Supplier, payload.supplier_id) is None:
        raise HTTPException(status_code=400, detail="Supplier not found")

    existing = (
        db.query(VendorItemMapping)
        .filter(
            VendorItemMapping.supplier_id == payload.supplier_id,
            VendorItemMapping.item_id == payload.item_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Vendor mapping already exists for this item")

    if payload.is_primary_vendor:
        db.query(VendorItemMapping).filter(VendorItemMapping.item_id == item_id).update(
            {"is_primary_vendor": False}
        )

    row = VendorItemMapping(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    row = (
        db.query(VendorItemMapping)
        .options(joinedload(VendorItemMapping.supplier), joinedload(VendorItemMapping.item))
        .filter(VendorItemMapping.mapping_id == row.mapping_id)
        .one()
    )
    return _mapping_read(row)


@router.patch(
    "/{item_id}/vendors/{mapping_id}",
    response_model=VendorItemMappingRead,
)
def update_item_vendor(
    item_id: str,
    mapping_id: int,
    payload: VendorItemMappingUpdate,
    db: Session = Depends(get_db),
) -> VendorItemMappingRead:
    row = db.get(VendorItemMapping, mapping_id)
    if not row or row.item_id != item_id:
        raise HTTPException(status_code=404, detail="Vendor mapping not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary_vendor") is True:
        db.query(VendorItemMapping).filter(
            VendorItemMapping.item_id == item_id,
            VendorItemMapping.mapping_id != mapping_id,
        ).update({"is_primary_vendor": False})
    for key, value in data.items():
        setattr(row, key, value)
    db.commit()
    row = (
        db.query(VendorItemMapping)
        .options(joinedload(VendorItemMapping.supplier), joinedload(VendorItemMapping.item))
        .filter(VendorItemMapping.mapping_id == mapping_id)
        .one()
    )
    return _mapping_read(row)


@router.delete("/{item_id}/vendors/{mapping_id}", status_code=204)
def delete_item_vendor(item_id: str, mapping_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(VendorItemMapping, mapping_id)
    if not row or row.item_id != item_id:
        raise HTTPException(status_code=404, detail="Vendor mapping not found")
    db.delete(row)
    db.commit()
