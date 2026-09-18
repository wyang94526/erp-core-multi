# @author: Wendy Yang
# @date: 2026-09-19

"""Item BOM endpoints under /items/{item_id}/bom (+ deprecated /products alias)."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Item, ItemBOMComponent, ItemBOMHeader
from app.schemas import (
    ItemBOMComponentCreate,
    ItemBOMComponentRead,
    ItemBOMComponentUpdate,
    ItemBOMHeaderCreate,
    ItemBOMHeaderRead,
)
from app.services import bom_versions

router = APIRouter(tags=["item-bom"])


def _ensure_parent(db: Session, item_id: str) -> Item:
    parent = db.get(Item, item_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Item not found")
    return parent


@router.get("/items/{item_id}/bom-headers", response_model=list[ItemBOMHeaderRead])
def list_bom_headers(item_id: str, db: Session = Depends(get_db)) -> list[ItemBOMHeader]:
    _ensure_parent(db, item_id)
    return bom_versions.list_headers(db, item_id)


@router.post(
    "/items/{item_id}/bom-headers",
    response_model=ItemBOMHeaderRead,
    status_code=status.HTTP_201_CREATED,
)
def create_bom_header(
    item_id: str,
    payload: ItemBOMHeaderCreate | None = None,
    db: Session = Depends(get_db),
) -> ItemBOMHeader:
    _ensure_parent(db, item_id)
    body = payload or ItemBOMHeaderCreate()
    header = bom_versions.create_draft_version(
        db,
        item_id,
        copy_from_header_id=body.copy_from_header_id,
        notes=body.notes,
    )
    db.commit()
    db.refresh(header)
    return header


@router.post(
    "/items/{item_id}/bom-headers/{header_id}/activate",
    response_model=ItemBOMHeaderRead,
)
def activate_bom_header(
    item_id: str, header_id: int, db: Session = Depends(get_db)
) -> ItemBOMHeader:
    _ensure_parent(db, item_id)
    header = bom_versions.activate_header(db, item_id, header_id)
    db.commit()
    db.refresh(header)
    return header


@router.get("/items/{item_id}/bom", response_model=list[ItemBOMComponentRead])
@router.get("/products/{item_id}/bom", response_model=list[ItemBOMComponentRead], deprecated=True)
def list_bom_components(
    item_id: str,
    bom_header_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[ItemBOMComponent]:
    _ensure_parent(db, item_id)
    header = bom_versions.resolve_header(db, item_id, bom_header_id)
    if header is None:
        return []
    return (
        db.query(ItemBOMComponent)
        .filter(ItemBOMComponent.bom_header_id == header.bom_header_id)
        .order_by(ItemBOMComponent.bom_id)
        .all()
    )


@router.post(
    "/items/{item_id}/bom",
    response_model=ItemBOMComponentRead,
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/products/{item_id}/bom",
    response_model=ItemBOMComponentRead,
    status_code=status.HTTP_201_CREATED,
    deprecated=True,
)
def add_bom_component(
    item_id: str,
    payload: ItemBOMComponentCreate,
    bom_header_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> ItemBOMComponent:
    _ensure_parent(db, item_id)

    if payload.item_type == "Material":
        if payload.component_item_id == item_id:
            raise HTTPException(status_code=400, detail="An item cannot be a component of itself")
        component = db.get(Item, payload.component_item_id)
        if not component:
            raise HTTPException(status_code=400, detail="Component item not found")

    header = bom_versions.ensure_writable_header(db, item_id, bom_header_id)

    existing = (
        db.query(ItemBOMComponent)
        .filter(
            ItemBOMComponent.bom_header_id == header.bom_header_id,
            ItemBOMComponent.component_item_id == payload.component_item_id,
            ItemBOMComponent.component_code == payload.component_code,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This component already exists on the BOM")

    bom_line = ItemBOMComponent(
        bom_header_id=header.bom_header_id,
        parent_item_id=item_id,
        component_item_id=payload.component_item_id,
        component_code=payload.component_code,
        quantity_per=payload.quantity_per,
        item_type=payload.item_type,
        scrap_factor=payload.scrap_factor,
        yield_loss_percentage=payload.yield_loss_percentage,
    )
    db.add(bom_line)
    db.commit()
    db.refresh(bom_line)
    return bom_line


@router.patch("/items/{item_id}/bom/{bom_id}", response_model=ItemBOMComponentRead)
@router.patch(
    "/products/{item_id}/bom/{bom_id}",
    response_model=ItemBOMComponentRead,
    deprecated=True,
)
def update_bom_component(
    item_id: str, bom_id: int, payload: ItemBOMComponentUpdate, db: Session = Depends(get_db)
) -> ItemBOMComponent:
    bom_line = (
        db.query(ItemBOMComponent)
        .filter(
            ItemBOMComponent.bom_id == bom_id,
            ItemBOMComponent.parent_item_id == item_id,
        )
        .first()
    )
    if not bom_line:
        raise HTTPException(status_code=404, detail="BOM component not found")
    bom_versions.assert_line_writable(bom_line)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(bom_line, key, value)
    db.commit()
    db.refresh(bom_line)
    return bom_line


@router.delete("/items/{item_id}/bom/{bom_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete(
    "/products/{item_id}/bom/{bom_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    deprecated=True,
)
def delete_bom_component(item_id: str, bom_id: int, db: Session = Depends(get_db)) -> None:
    bom_line = (
        db.query(ItemBOMComponent)
        .filter(
            ItemBOMComponent.bom_id == bom_id,
            ItemBOMComponent.parent_item_id == item_id,
        )
        .first()
    )
    if not bom_line:
        raise HTTPException(status_code=404, detail="BOM component not found")
    bom_versions.assert_line_writable(bom_line)
    db.delete(bom_line)
    db.commit()
