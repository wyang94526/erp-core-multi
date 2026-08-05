from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import PurchaseOrder, PurchaseOrderItem, Supplier
from app.schemas import PurchaseOrderCreate, PurchaseOrderRead, PurchaseOrderUpdate

router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])


def _load_po(db: Session, po_number: str) -> PurchaseOrder | None:
    return (
        db.query(PurchaseOrder)
        .options(selectinload(PurchaseOrder.items))
        .filter(PurchaseOrder.po_number == po_number)
        .first()
    )


@router.get("", response_model=list[PurchaseOrderRead])
def list_purchase_orders(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[PurchaseOrder]:
    return (
        db.query(PurchaseOrder)
        .options(selectinload(PurchaseOrder.items))
        .order_by(PurchaseOrder.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.post("", response_model=PurchaseOrderRead, status_code=status.HTTP_201_CREATED)
def create_purchase_order(payload: PurchaseOrderCreate, db: Session = Depends(get_db)) -> PurchaseOrder:
    if db.get(PurchaseOrder, payload.po_number) is not None:
        raise HTTPException(status_code=400, detail="PO number already exists")

    if db.get(Supplier, payload.supplier_id) is None:
        raise HTTPException(status_code=400, detail="Supplier not found")

    data = payload.model_dump(exclude={"items"})
    items = payload.items

    po = PurchaseOrder(**data)
    for item in items:
        po.items.append(PurchaseOrderItem(**item.model_dump()))

    db.add(po)
    db.flush()

    # Operational Approved must go through the approval workflow.

    db.commit()
    return _load_po(db, po.po_number)


@router.get("/{po_number}", response_model=PurchaseOrderRead)
def get_purchase_order(po_number: str, db: Session = Depends(get_db)) -> PurchaseOrder:
    po = _load_po(db, po_number)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po


@router.patch("/{po_number}", response_model=PurchaseOrderRead)
def update_purchase_order(
    po_number: str, payload: PurchaseOrderUpdate, db: Session = Depends(get_db)
) -> PurchaseOrder:
    po = db.get(PurchaseOrder, po_number)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    data = payload.model_dump(exclude_unset=True, exclude={"items"})

    if "supplier_id" in data and data["supplier_id"] is not None:
        if db.get(Supplier, data["supplier_id"]) is None:
            raise HTTPException(status_code=400, detail="Supplier not found")

    for key, value in data.items():
        setattr(po, key, value)

    if payload.items is not None:
        po.items.clear()
        db.flush()
        for item in payload.items:
            po.items.append(PurchaseOrderItem(po_number=po.po_number, **item.model_dump()))

    # AP bill creation happens when approval workflow finalizes APPROVED.

    db.commit()
    return _load_po(db, po.po_number)


@router.delete("/{po_number}", status_code=status.HTTP_204_NO_CONTENT)
def delete_purchase_order(po_number: str, db: Session = Depends(get_db)) -> None:
    po = db.get(PurchaseOrder, po_number)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    db.delete(po)
    db.commit()
