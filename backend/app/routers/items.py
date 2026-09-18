# @author: Wendy Yang
# @date: 2026-09-19

"""Item catalog endpoints (items table is the item master)."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Item, Supplier, VendorItemMapping
from app.services import inventory
from app.services.item_types import validate_item_master_fields
from app.schemas import (
    ItemCreate,
    ItemListPage,
    ItemRead,
    ItemUpdate,
    VendorItemMappingCreate,
    VendorItemMappingRead,
    VendorItemMappingUpdate,
)
from app.services.pagination import paginate_query, set_total_count_header

router = APIRouter(prefix="/items", tags=["items"])


def _apply_item_query(query, *, search: str | None = None, catalog: str | None = None):
    kind = (catalog or "").strip().lower()
    if kind in ("purchase", "purchase_items"):
        query = query.filter(Item.is_purchase_item.is_(True))
    elif kind in ("raw", "raw_materials"):
        query = query.filter(Item.is_raw_material.is_(True))
    elif kind in ("assembly", "assemblies", "subcontract"):
        query = query.filter(
            (Item.is_subcontract_assembly.is_(True)) | (Item.is_outside_processed.is_(True))
        )
    term = (search or "").strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            or_(
                Item.item_id.ilike(like),
                Item.customer_part_number.ilike(like),
                Item.description.ilike(like),
            )
        )
    return query


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
    q: str | None = Query(default=None, description="Search item_id, customer P/N, description"),
    db: Session = Depends(get_db),
) -> list[Item]:
    query = _apply_item_query(db.query(Item), search=q, catalog="purchase")
    items = query.order_by(Item.item_id).offset(skip).limit(limit).all()
    inventory.apply_live_on_hand(db, items)
    return items


@router.get("/raw-materials", response_model=list[ItemRead])
def list_raw_materials(
    skip: int = 0,
    limit: int = 100,
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[Item]:
    query = _apply_item_query(db.query(Item), search=q, catalog="raw")
    items = query.order_by(Item.item_id).offset(skip).limit(limit).all()
    inventory.apply_live_on_hand(db, items)
    return items


@router.get("/assemblies", response_model=list[ItemRead])
def list_subcontract_assemblies(
    skip: int = 0,
    limit: int = 100,
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[Item]:
    query = _apply_item_query(db.query(Item), search=q, catalog="assembly")
    items = query.order_by(Item.item_id).offset(skip).limit(limit).all()
    inventory.apply_live_on_hand(db, items)
    return items


@router.get("", response_model=ItemListPage)
def list_items(
    skip: int = 0,
    limit: int = 100,
    q: str | None = Query(default=None, description="Search item_id, customer P/N, description"),
    purchase_only: bool | None = Query(default=None),
    catalog: str | None = Query(
        default=None,
        description="Optional catalog filter: purchase | raw | assembly",
    ),
    response: Response = None,
    db: Session = Depends(get_db),
) -> ItemListPage:
    kind = catalog or ("purchase" if purchase_only else None)
    query = _apply_item_query(db.query(Item), search=q, catalog=kind)
    items, pagination = paginate_query(query, skip=skip, limit=limit, order_by=Item.item_id)
    inventory.apply_live_on_hand(db, items)
    set_total_count_header(response, pagination.total)
    return ItemListPage(data=items, pagination=pagination)


@router.get("/{item_id}", response_model=ItemRead)
def get_item(item_id: str, db: Session = Depends(get_db)) -> Item:
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    inventory.apply_live_on_hand(db, [item])
    return item


@router.post("", response_model=ItemRead, status_code=201)
def create_item(payload: ItemCreate, db: Session = Depends(get_db)) -> Item:
    if db.get(Item, payload.item_id) is not None:
        raise HTTPException(status_code=400, detail="Item ID already exists")
    data = _sync_assembly_flags(payload.model_dump())
    kind, unit = validate_item_master_fields(item_type=data.get("item_type"), uom=data.get("uom"))
    data["item_type"] = kind
    data["uom"] = unit
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
    if "item_type" in data or "uom" in data:
        kind, unit = validate_item_master_fields(
            item_type=data.get("item_type", item.item_type),
            uom=data["uom"] if "uom" in data else item.uom,
        )
        if "item_type" in data:
            data["item_type"] = kind
        if "uom" in data:
            data["uom"] = unit
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
