# @author: Wendy Yang
# @date: 2026-09-19

"""Deprecated /products alias — prefer /api/v1/items."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Item
from app.schemas import ItemCreate, ItemRead, ItemUpdate

router = APIRouter(prefix="/products", tags=["products-deprecated"])


@router.get("", response_model=list[ItemRead], deprecated=True)
def list_products(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[Item]:
    return db.query(Item).order_by(Item.item_id).offset(skip).limit(limit).all()


@router.post("", response_model=ItemRead, status_code=status.HTTP_201_CREATED, deprecated=True)
def create_product(payload: ItemCreate, db: Session = Depends(get_db)) -> Item:
    data = payload.model_dump()
    if data.get("is_subcontract_assembly"):
        data["is_outside_processed"] = True
    elif data.get("is_outside_processed"):
        data["is_subcontract_assembly"] = True
    if db.get(Item, data["item_id"]) is not None:
        raise HTTPException(status_code=400, detail="Item ID already exists")
    item = Item(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/{item_id}", response_model=ItemRead, deprecated=True)
def get_product(item_id: str, db: Session = Depends(get_db)) -> Item:
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.patch("/{item_id}", response_model=ItemRead, deprecated=True)
def update_product(item_id: str, payload: ItemUpdate, db: Session = Depends(get_db)) -> Item:
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_subcontract_assembly") is True:
        data["is_outside_processed"] = True
    elif data.get("is_outside_processed") is True:
        data["is_subcontract_assembly"] = True
    for key, value in data.items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT, deprecated=True)
def delete_product(item_id: str, db: Session = Depends(get_db)) -> None:
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
