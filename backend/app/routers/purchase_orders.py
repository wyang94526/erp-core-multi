from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Item, PurchaseOrder, PurchaseOrderItem, SubcontractOrder, SubcontractOrderComponent, Supplier
from app.schemas import (
    GoodsReceiptCreate,
    GoodsReceiptRead,
    PurchaseOrderCreate,
    PurchaseOrderRead,
    PurchaseOrderUpdate,
)
from app.services import p2p
from app.services.document_sequences import DOC_PURCHASE_ORDER, generate_document_number
from app.services.po_totals import apply_po_totals, requires_carrier_account
from app.services.payment_terms import apply_payment_term_fields
from app.services.item_types import catalog_item, validate_line_quantity


router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])

_CLOSED_SCO_STATUSES = {"COMPLETED", "CANCELLED"}


def _po_integrity_message(exc: IntegrityError) -> str:
    raw = str(getattr(exc, "orig", exc)).lower()
    if "sco_component" in raw:
        return (
            "An imported component is no longer on the linked subcontract order. "
            "Re-import the lines and try again."
        )
    if "sco_number" in raw or "subcontract" in raw:
        return "The linked subcontract order is invalid or was removed."
    if "purchaseorderitems" in raw:
        return "Could not save PO line items. Check SKU, quantity, and imported component links."
    return "Could not save the purchase order. Check vendor, lines, and the linked subcontract order."


def _blank_to_none(value: str | None) -> str | None:
    if value is None or not str(value).strip():
        return None
    return str(value).strip()


def _validate_po_links(db: Session, po_type: str | None, sco_number: str | None, items) -> None:
    if sco_number:
        sco = db.get(SubcontractOrder, sco_number)
        if sco is None:
            raise HTTPException(status_code=400, detail=f"Subcontract order '{sco_number}' not found")
        if (sco.status or "").upper() in _CLOSED_SCO_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Subcontract order '{sco_number}' is {sco.status} and cannot be linked",
            )
    if (po_type or "MATERIAL") == "SUBCONTRACT" and items:
        for item in items or []:
            sku = item.get("sku") if isinstance(item, dict) else getattr(item, "sku", None)
            if not sku:
                continue
            catalog = db.get(Item, sku)
            if catalog is None:
                raise HTTPException(status_code=400, detail=f"Item '{sku}' not found")
            if not (catalog.is_subcontract_assembly or catalog.is_outside_processed or catalog.is_purchase_item):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Item '{sku}' is not flagged as a subcontract assembly or purchase item. "
                        "Mark it on the item master before adding it to a subcontract PO."
                    ),
                )
    if not items:
        return
    for item in items or []:
        component_id = (
            item.get("sco_component_id")
            if isinstance(item, dict)
            else getattr(item, "sco_component_id", None)
        )
        if not component_id:
            continue
        if not sco_number:
            raise HTTPException(
                status_code=400,
                detail="sco_component_id requires a linked subcontract order",
            )
        component = db.get(SubcontractOrderComponent, component_id)
        if component is None or component.sco_number != sco_number:
            raise HTTPException(
                status_code=400,
                detail=f"Component {component_id} does not belong to subcontract order '{sco_number}'",
            )


def _validate_po_quantities(db: Session, items) -> None:
    if not items:
        return
    for item in items:
        sku = item.get("sku") if isinstance(item, dict) else getattr(item, "sku", None)
        if not sku:
            continue
        qty = item.get("quantity") if isinstance(item, dict) else getattr(item, "quantity", 0)
        amount = (
            item.get("line_subtotal") if isinstance(item, dict) else getattr(item, "line_subtotal", 0)
        )
        price = item.get("unit_price") if isinstance(item, dict) else getattr(item, "unit_price", 0)
        validate_line_quantity(
            sku=sku,
            quantity=qty,
            amount=amount,
            unit_price=price,
            item=catalog_item(db, sku),
        )


def _validate_freight(freight_terms: str | None, carrier_account: str | None, status_value: str | None) -> None:
    if (status_value or "Draft") == "Draft":
        return
    if requires_carrier_account(freight_terms) and not _blank_to_none(carrier_account):
        raise HTTPException(
            status_code=400,
            detail="Carrier / 3PL account is required for 3rd-party or routing freight terms",
        )


def _load_po(db: Session, po_number: str) -> PurchaseOrder | None:
    return (
        db.query(PurchaseOrder)
        .options(selectinload(PurchaseOrder.items))
        .filter(PurchaseOrder.po_number == po_number)
        .first()
    )


@router.get("", response_model=list[PurchaseOrderRead])
def list_purchase_orders(
    skip: int = 0,
    limit: int = 100,
    sco_number: str | None = None,
    db: Session = Depends(get_db),
) -> list[PurchaseOrder]:
    query = db.query(PurchaseOrder).options(selectinload(PurchaseOrder.items))
    if sco_number and sco_number.strip():
        query = query.filter(PurchaseOrder.sco_number == sco_number.strip())
    return (
        query.order_by(PurchaseOrder.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.post("", response_model=PurchaseOrderRead, status_code=status.HTTP_201_CREATED)
def create_purchase_order(payload: PurchaseOrderCreate, db: Session = Depends(get_db)) -> PurchaseOrder:
    if db.get(Supplier, payload.supplier_id) is None:
        raise HTTPException(status_code=400, detail="Supplier not found")

    _validate_po_links(db, payload.po_type, payload.sco_number, payload.items)
    _validate_po_quantities(db, payload.items)
    _validate_freight(payload.freight_terms, payload.carrier_account, payload.status)

    data = payload.model_dump(exclude={"items"})
    data["sco_number"] = _blank_to_none(data.get("sco_number"))
    data["carrier_account"] = _blank_to_none(data.get("carrier_account"))
    data["incoterms"] = _blank_to_none(data.get("incoterms"))
    order_date = data.get("order_date") or date.today()
    data["order_date"] = order_date
    data["po_number"] = generate_document_number(db, DOC_PURCHASE_ORDER, order_date)
    items = payload.items

    po = PurchaseOrder(**data)
    supplier = db.get(Supplier, payload.supplier_id)
    apply_payment_term_fields(
        db,
        po,
        payment_term_id=data.get("payment_term_id"),
        payment_terms=data.get("payment_terms"),
        fallback=supplier,
    )
    for item in items:
        row = item.model_dump()
        if not row.get("sco_component_id"):
            row["sco_component_id"] = None
        if row.get("description"):
            row["description"] = str(row["description"])[:255]
        po.items.append(PurchaseOrderItem(**row))

    apply_po_totals(po)
    db.add(po)
    db.flush()

    # Operational Approved must go through the approval workflow.

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=_po_integrity_message(exc)) from exc
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

    if "sco_number" in data:
        data["sco_number"] = _blank_to_none(data.get("sco_number"))
    if "carrier_account" in data:
        data["carrier_account"] = _blank_to_none(data.get("carrier_account"))
    if "incoterms" in data:
        data["incoterms"] = _blank_to_none(data.get("incoterms"))

    po_type = data.get("po_type", po.po_type)
    sco_number = data.get("sco_number", po.sco_number)
    _validate_po_links(db, po_type, sco_number, payload.items)
    if payload.items is not None:
        _validate_po_quantities(db, payload.items)
    _validate_freight(
        data.get("freight_terms", po.freight_terms),
        data.get("carrier_account", po.carrier_account),
        data.get("status", po.status),
    )

    for key, value in data.items():
        setattr(po, key, value)

    if "payment_term_id" in data or "payment_terms" in data or "supplier_id" in data:
        supplier = db.get(Supplier, po.supplier_id)
        apply_payment_term_fields(
            db,
            po,
            payment_term_id=data.get("payment_term_id", po.payment_term_id),
            payment_terms=data.get("payment_terms", po.payment_terms),
            fallback=supplier if "payment_term_id" not in data and "payment_terms" not in data else None,
        )

    if payload.items is not None:
        po.items.clear()
        db.flush()
        for item in payload.items:
            row = item.model_dump()
            if not row.get("sco_component_id"):
                row["sco_component_id"] = None
            if row.get("description"):
                row["description"] = str(row["description"])[:255]
            po.items.append(PurchaseOrderItem(po_number=po.po_number, **row))

    apply_po_totals(po)

    # AP bill creation happens when approval workflow finalizes APPROVED.

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=_po_integrity_message(exc)) from exc
    return _load_po(db, po.po_number)


@router.post("/{po_number}/receive", response_model=GoodsReceiptRead, status_code=status.HTTP_201_CREATED)
def receive_purchase_order_goods(
    po_number: str, payload: GoodsReceiptCreate, db: Session = Depends(get_db)
):
    """Record PO goods receipt: inventory + GRNI accrual (Dr Inventory / Cr GRNI)."""
    result = p2p.receive_purchase_order(
        db,
        po_number=po_number,
        lines=[line.model_dump() for line in payload.lines],
        receipt_date=payload.receipt_date,
        notes=payload.notes,
    )
    db.commit()
    return result


@router.delete("/{po_number}", status_code=status.HTTP_204_NO_CONTENT)
def delete_purchase_order(po_number: str, db: Session = Depends(get_db)) -> None:
    po = db.get(PurchaseOrder, po_number)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    db.delete(po)
    db.commit()
