"""Item BOM endpoints under /items/{item_id}/bom (+ deprecated /products alias)."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Item, ItemBOMComponent
from app.schemas import ItemBOMComponentCreate, ItemBOMComponentRead, ItemBOMComponentUpdate

router = APIRouter(tags=["item-bom"])


def _ensure_parent(db: Session, item_id: str) -> Item:
    parent = db.get(Item, item_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Item not found")
    return parent


@router.get("/items/{item_id}/bom", response_model=list[ItemBOMComponentRead])
@router.get("/products/{item_id}/bom", response_model=list[ItemBOMComponentRead], deprecated=True)
def list_bom_components(item_id: str, db: Session = Depends(get_db)) -> list[ItemBOMComponent]:
    _ensure_parent(db, item_id)
    return (
        db.query(ItemBOMComponent)
        .filter(ItemBOMComponent.parent_item_id == item_id)
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
    item_id: str, payload: ItemBOMComponentCreate, db: Session = Depends(get_db)
) -> ItemBOMComponent:
    _ensure_parent(db, item_id)

    if payload.item_type == "Material":
        if payload.component_item_id == item_id:
            raise HTTPException(status_code=400, detail="An item cannot be a component of itself")
        component = db.get(Item, payload.component_item_id)
        if not component:
            raise HTTPException(status_code=400, detail="Component item not found")

    existing = (
        db.query(ItemBOMComponent)
        .filter(
            ItemBOMComponent.parent_item_id == item_id,
            ItemBOMComponent.component_item_id == payload.component_item_id,
            ItemBOMComponent.component_code == payload.component_code,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This component already exists on the BOM")

    bom_line = ItemBOMComponent(
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
    db.delete(bom_line)
    db.commit()
