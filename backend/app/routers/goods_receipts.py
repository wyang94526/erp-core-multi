# @author: Wendy Yang
# @date: 2026-09-19

"""Goods receipt inquiry: list and detail for PO / SCO receipts."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.schemas import GoodsReceiptQtyAdjust, GoodsReceiptRead
from app.services import p2p

router = APIRouter(prefix="/goods-receipts", tags=["goods-receipts"])


@router.get("", response_model=list[GoodsReceiptRead])
def list_goods_receipts(
    vendor_id: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    source_order_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    unbilled_only: bool = Query(default=False),
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
        q=q,
        unbilled_only=unbilled_only,
        skip=skip,
        limit=limit,
    )


@router.get("/{receipt_key}", response_model=GoodsReceiptRead)
def get_goods_receipt(receipt_key: str, db: Session = Depends(get_db)):
    return p2p.get_goods_receipt(db, receipt_key)


@router.patch("/{receipt_key}/quantities", response_model=GoodsReceiptRead)
def adjust_goods_receipt_quantities(
    receipt_key: str,
    payload: GoodsReceiptQtyAdjust,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Correct posted PO receipt quantities; adjusts on-hand stock and GRNI."""
    result = p2p.adjust_goods_receipt_quantities(
        db,
        receipt_key=receipt_key,
        lines=[line.model_dump() for line in payload.lines],
        notes=payload.notes,
        received_by_user_id=user.id,
    )
    db.commit()
    return result
