# @author: Wendy Yang
# @date: 2026-09-19

"""Item Fulfillment API for Order-to-Cash shipping."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    ItemFulfillmentCreate,
    ItemFulfillmentLinesUpdate,
    ItemFulfillmentRead,
    ItemFulfillmentStatusUpdate,
)
from app.services import o2c

router = APIRouter(prefix="/fulfillments", tags=["fulfillments"])


@router.get("", response_model=list[ItemFulfillmentRead])
def list_fulfillments(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return o2c.list_fulfillments(db, skip=skip, limit=limit)


@router.get("/{fulfillment_id}", response_model=ItemFulfillmentRead)
def get_fulfillment(fulfillment_id: int, db: Session = Depends(get_db)):
    return o2c.serialize_fulfillment(o2c._load_fulfillment(db, fulfillment_id))


@router.post("", response_model=ItemFulfillmentRead, status_code=201)
def create_fulfillment(payload: ItemFulfillmentCreate, db: Session = Depends(get_db)):
    result = o2c.create_fulfillment(
        db,
        sales_order_id=payload.sales_order_id,
        lines=[line.model_dump() for line in payload.lines],
        carrier=payload.carrier,
        tracking_number=payload.tracking_number,
        status=payload.status,
        shipped_date=payload.shipped_date,
    )
    db.commit()
    return result


@router.patch("/{fulfillment_id}", response_model=ItemFulfillmentRead)
def update_fulfillment(
    fulfillment_id: int,
    payload: ItemFulfillmentLinesUpdate,
    db: Session = Depends(get_db),
):
    result = o2c.update_fulfillment_lines(
        db,
        fulfillment_id,
        lines=[line.model_dump() for line in payload.lines],
    )
    db.commit()
    return result


@router.patch("/{fulfillment_id}/status", response_model=ItemFulfillmentRead)
def update_fulfillment_status(
    fulfillment_id: int,
    payload: ItemFulfillmentStatusUpdate,
    db: Session = Depends(get_db),
):
    result = o2c.update_fulfillment_status(
        db,
        fulfillment_id,
        status=payload.status,
        shipped_date=payload.shipped_date,
        carrier=payload.carrier,
        tracking_number=payload.tracking_number,
    )
    db.commit()
    return result


@router.delete("/{fulfillment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fulfillment(fulfillment_id: int, db: Session = Depends(get_db)) -> None:
    o2c.delete_fulfillment(db, fulfillment_id)
    db.commit()
