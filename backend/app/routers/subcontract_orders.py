from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import (
    ComponentIssueLog,
    FinishedGoodsReceipt,
    MaterialIssue,
    MaterialIssueLine,
    Product,
    ProductBOMComponent,
    SubcontractOrder,
    SubcontractOrderComponent,
    Supplier,
)
from app.schemas import (
    CalculateComponentsResponse,
    CalculatedComponentLine,
    FinishedGoodsReceiptCreate,
    FinishedGoodsReceiptRead,
    MaterialIssueCreate,
    MaterialIssueRead,
    SubcontractOrderCreate,
    SubcontractOrderRead,
    SubcontractOrderUpdate,
)
from app.services.approval import require_approved
from app.services.catalog import explode_assembly_components, material_bom_lines, required_quantity

router = APIRouter(prefix="/subcontract-orders", tags=["subcontract-orders"])

# Terminal/blocked statuses that should no longer accept material issues or receipts
_CLOSED_STATUSES = {"COMPLETED", "CANCELLED"}


def _load_sco(db: Session, sco_number: str) -> SubcontractOrder | None:
    return (
        db.query(SubcontractOrder)
        .options(
            selectinload(SubcontractOrder.components),
            selectinload(SubcontractOrder.material_issues).selectinload(MaterialIssue.lines),
            selectinload(SubcontractOrder.finished_goods_receipts),
        )
        .filter(SubcontractOrder.sco_number == sco_number)
        .first()
    )


@router.get("", response_model=list[SubcontractOrderRead])
def list_subcontract_orders(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[SubcontractOrder]:
    return (
        db.query(SubcontractOrder)
        .options(
            selectinload(SubcontractOrder.components),
            selectinload(SubcontractOrder.material_issues).selectinload(MaterialIssue.lines),
            selectinload(SubcontractOrder.finished_goods_receipts),
        )
        .order_by(SubcontractOrder.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.post("", response_model=SubcontractOrderRead, status_code=status.HTTP_201_CREATED)
def create_subcontract_order(
    payload: SubcontractOrderCreate, db: Session = Depends(get_db)
) -> SubcontractOrder:
    """
    Create a new Subcontract Order. Automatically populates the component list
    (quantity_required) from the finished product's Bill of Materials, scaled
    by the SCO's quantity_ordered.
    """
    if db.get(SubcontractOrder, payload.sco_number) is not None:
        raise HTTPException(status_code=400, detail="SCO number already exists")

    if db.get(Supplier, payload.supplier_id) is None:
        raise HTTPException(status_code=400, detail="Supplier not found")

    product = db.get(Product, payload.product_id)
    if product is None:
        raise HTTPException(status_code=400, detail="Product not found")

    bom_lines = material_bom_lines(db, payload.product_id)
    if not bom_lines:
        raise HTTPException(
            status_code=400,
            detail="Product has no Material Bill of Materials / subcontract kit; "
            "cannot create a subcontract order",
        )

    sco = SubcontractOrder(
        sco_number=payload.sco_number,
        supplier_id=payload.supplier_id,
        product_id=payload.product_id,
        quantity_ordered=payload.quantity_ordered,
        status="PLANNED",
        expected_return_date=payload.expected_return_date,
        notes=payload.notes,
    )
    if payload.order_date is not None:
        sco.order_date = payload.order_date

    db.add(sco)
    db.flush()

    for bom_line in bom_lines:
        quantity_required = required_quantity(
            bom_line.quantity_per,
            payload.quantity_ordered,
            getattr(bom_line, "scrap_factor", None),
            getattr(bom_line, "yield_loss_percentage", None),
        )
        sco.components.append(
            SubcontractOrderComponent(
                component_product_id=bom_line.component_product_id,
                quantity_required=quantity_required,
                quantity_issued=Decimal("0"),
            )
        )

    db.commit()
    return _load_sco(db, sco.sco_number)


@router.get("/{sco_number}", response_model=SubcontractOrderRead)
def get_subcontract_order(sco_number: str, db: Session = Depends(get_db)) -> SubcontractOrder:
    sco = _load_sco(db, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")
    return sco


@router.post(
    "/{sco_number}/calculate-components",
    response_model=CalculateComponentsResponse,
)
def calculate_components(
    sco_number: str, db: Session = Depends(get_db)
) -> CalculateComponentsResponse:
    """
    Recalculate required raw parts from the assembly Subcontract BOM kit
    (quantity × BOM, including scrap / yield loss) and merge with issued qty.
    """
    sco = _load_sco(db, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")

    exploded = explode_assembly_components(db, sco.product_id, sco.quantity_ordered)
    issued_by_component = {
        c.component_product_id: Decimal(str(c.quantity_issued or 0)) for c in sco.components
    }

    components: list[CalculatedComponentLine] = []
    for row in exploded:
        issued = issued_by_component.get(row["component_product_id"], Decimal("0"))
        required = Decimal(str(row["quantity_required"]))
        components.append(
            CalculatedComponentLine(
                component_product_id=row["component_product_id"],
                description=row.get("description"),
                quantity_per=row["quantity_per"],
                scrap_factor=row["scrap_factor"],
                yield_loss_percentage=row["yield_loss_percentage"],
                quantity_required=required,
                quantity_issued=issued,
                quantity_remaining=max(required - issued, Decimal("0")),
                on_hand_quantity=row.get("on_hand_quantity") or 0,
                primary_vendor_id=row.get("primary_vendor_id"),
                primary_vendor_sku=row.get("primary_vendor_sku"),
                unit_cost=row.get("unit_cost"),
            )
        )

    return CalculateComponentsResponse(
        sco_number=sco.sco_number,
        assembly_item_id=sco.product_id,
        quantity_ordered=sco.quantity_ordered,
        components=components,
    )


@router.patch("/{sco_number}", response_model=SubcontractOrderRead)
def update_subcontract_order(
    sco_number: str, payload: SubcontractOrderUpdate, db: Session = Depends(get_db)
) -> SubcontractOrder:
    sco = db.get(SubcontractOrder, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")

    if sco.status in _CLOSED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot modify a {sco.status.lower()} subcontract order")

    data = payload.model_dump(exclude_unset=True)

    if "supplier_id" in data and data["supplier_id"] is not None:
        if db.get(Supplier, data["supplier_id"]) is None:
            raise HTTPException(status_code=400, detail="Supplier not found")

    for key, value in data.items():
        setattr(sco, key, value)

    db.commit()
    return _load_sco(db, sco.sco_number)


@router.post(
    "/{sco_number}/issue-materials",
    response_model=SubcontractOrderRead,
    status_code=status.HTTP_201_CREATED,
)
def issue_materials(
    sco_number: str, payload: MaterialIssueCreate, db: Session = Depends(get_db)
) -> SubcontractOrder:
    """
    Record a shipment of raw materials sent out to the subcontractor.
    For each line: deducts on_hand_quantity and increments wip_quantity on the
    component Product, and increments quantity_issued on the matching
    SubcontractOrderComponent.
    """
    sco = db.get(SubcontractOrder, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")

    require_approved(sco, "Subcontract order")

    if sco.status in _CLOSED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot issue materials on a {sco.status.lower()} order")

    if db.get(MaterialIssue, payload.issue_id) is not None:
        raise HTTPException(status_code=400, detail="Material issue ID already exists")

    sco_components = {
        c.component_product_id: c
        for c in db.query(SubcontractOrderComponent).filter(
            SubcontractOrderComponent.sco_number == sco_number
        )
    }

    issue = MaterialIssue(issue_id=payload.issue_id, sco_number=sco_number, notes=payload.notes)
    if payload.issue_date is not None:
        issue.issue_date = payload.issue_date
    db.add(issue)
    db.flush()

    for line in payload.lines:
        sco_component = sco_components.get(line.component_product_id)
        if sco_component is None:
            raise HTTPException(
                status_code=400,
                detail=f"Component {line.component_product_id} is not part of this subcontract order's BOM",
            )

        product = db.get(Product, line.component_product_id)
        if product is None:
            raise HTTPException(status_code=400, detail=f"Component product {line.component_product_id} not found")

        on_hand = Decimal(product.on_hand_quantity or 0)
        if line.quantity_issued > on_hand:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient on-hand quantity for {line.component_product_id}: "
                f"available={product.on_hand_quantity}, requested={line.quantity_issued}",
            )

        product.on_hand_quantity = int(on_hand - line.quantity_issued)
        product.wip_quantity = int(Decimal(product.wip_quantity or 0) + line.quantity_issued)

        sco_component.quantity_issued = sco_component.quantity_issued + line.quantity_issued

        db.add(
            MaterialIssueLine(
                issue_id=issue.issue_id,
                component_product_id=line.component_product_id,
                quantity_issued=line.quantity_issued,
            )
        )
        db.add(
            ComponentIssueLog(
                sco_number=sco_number,
                issue_id=issue.issue_id,
                component_product_id=line.component_product_id,
                quantity_issued=line.quantity_issued,
                notes=payload.notes,
            )
        )

    # Update the SCO status: if all components are fully issued, mark as MATERIALS_ISSUED
    db.flush()
    all_components = (
        db.query(SubcontractOrderComponent)
        .filter(SubcontractOrderComponent.sco_number == sco_number)
        .all()
    )
    if all(c.quantity_issued >= c.quantity_required for c in all_components):
        sco.status = "MATERIALS_ISSUED"
    elif any(c.quantity_issued > 0 for c in all_components):
        sco.status = "PARTIALLY_ISSUED"

    db.commit()
    return _load_sco(db, sco_number)


@router.post(
    "/{sco_number}/receive-goods",
    response_model=SubcontractOrderRead,
    status_code=status.HTTP_201_CREATED,
)
def receive_goods(
    sco_number: str, payload: FinishedGoodsReceiptCreate, db: Session = Depends(get_db)
) -> SubcontractOrder:
    """
    Record receipt of finished goods back from the subcontractor.
    Deducts wip_quantity and increments on_hand_quantity on the finished
    product, and updates the SCO status accordingly.
    """
    sco = db.get(SubcontractOrder, sco_number)
    if not sco:
        raise HTTPException(status_code=404, detail="Subcontract order not found")

    if sco.status in _CLOSED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot receive goods on a {sco.status.lower()} order")

    if db.get(FinishedGoodsReceipt, payload.receipt_id) is not None:
        raise HTTPException(status_code=400, detail="Receipt ID already exists")

    product = db.get(Product, sco.product_id)
    if product is None:
        raise HTTPException(status_code=400, detail="Finished product not found")

    existing_receipts = (
        db.query(FinishedGoodsReceipt)
        .filter(FinishedGoodsReceipt.sco_number == sco_number)
        .all()
    )
    total_received_so_far = sum((r.quantity_received for r in existing_receipts), 0)
    remaining = sco.quantity_ordered - total_received_so_far
    if payload.quantity_received > remaining:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot receive more than remaining ordered quantity: remaining={remaining}",
        )

    wip = Decimal(product.wip_quantity or 0)
    deduct = min(wip, Decimal(payload.quantity_received))
    product.wip_quantity = int(wip - deduct)
    product.on_hand_quantity = int(Decimal(product.on_hand_quantity or 0) + payload.quantity_received)

    receipt = FinishedGoodsReceipt(
        receipt_id=payload.receipt_id,
        sco_number=sco_number,
        quantity_received=payload.quantity_received,
        notes=payload.notes,
    )
    if payload.receipt_date is not None:
        receipt.receipt_date = payload.receipt_date
    db.add(receipt)
    db.flush()

    new_total_received = total_received_so_far + payload.quantity_received
    if new_total_received >= sco.quantity_ordered:
        sco.status = "COMPLETED"
    else:
        sco.status = "PARTIALLY_RECEIVED"

    db.commit()
    return _load_sco(db, sco_number)
