"""Goods receipt inquiry: list and detail for PO / SCO receipts."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import GoodsReceiptRead
from app.services import p2p

router = APIRouter(prefix="/goods-receipts", tags=["goods-receipts"])


@router.get("", response_model=list[GoodsReceiptRead])
def list_goods_receipts(
    vendor_id: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    source_order_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    return p2p.list_goods_receipts(
        db,
        vendor_id=vendor_id,
        source_type=source_type,
        source_order_id=source_order_id,
        status=status,
        skip=skip,
        limit=limit,
    )


@router.get("/{receipt_key}", response_model=GoodsReceiptRead)
def get_goods_receipt(receipt_key: str, db: Session = Depends(get_db)):
    return p2p.get_goods_receipt(db, receipt_key)
