# @author: Wendy Yang
# @date: 2026-10-11

"""In-house production orders, BOM explosion, component issue, and finished-goods receipt."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.models import (
    BomRoutingOperation,
    Company,
    Inspection,
    Item,
    ItemBOMComponent,
    ItemBOMHeader,
    ProductionIssue,
    ProductionIssueLine,
    ProductionOrder,
    ProductionOrderMaterial,
    ProductionOrderRouting,
    ProductionReceipt,
    SalesOrder,
    WorkCenter,
)
from app.services.catalog import required_quantity
from app.services.document_sequences import (
    DOC_PRODUCTION_ISSUE,
    DOC_PRODUCTION_ORDER,
    DOC_PRODUCTION_RECEIPT,
    next_document_number,
)
from app.services.exchange_rates import base_amount, normalize_currency, rate_on
from app.services.inventory import issue_stock, receive_stock
from app.services.item_types import skip_inventory_movement


def build_material_requirements(lines: list, qty_ordered: int) -> list[dict]:
    """Explode BOM lines for a production quantity, including scrap and yield."""
    requirements: list[dict] = []
    for line in lines:
        requirements.append(
            {
                "component_item_id": getattr(line, "component_item_id", None),
                "component_code": getattr(line, "component_code", None),
                "item_type": getattr(line, "item_type", None) or "Material",
                "quantity_required": required_quantity(
                    getattr(line, "quantity_per", 0),
                    qty_ordered,
                    getattr(line, "scrap_factor", None),
                    getattr(line, "yield_loss_percentage", None),
                ),
            }
        )
    return requirements


def receipt_posts_immediately(requires_inspection: bool) -> bool:
    """Inspected items stay out of available stock until the inspection is accepted."""
    return not requires_inspection


def open_receipt_quantity(qty_ordered: int, qty_completed: int, scrapped_qty: int) -> int:
    """Finished goods still allowed. Scrap has already consumed part of the order."""
    return max(int(qty_ordered) - int(qty_completed or 0) - int(scrapped_qty or 0), 0)


def production_is_covered(qty_ordered: int, qty_completed: int, scrapped_qty: int) -> bool:
    """True when received goods plus scrap account for the planned quantity."""
    return int(qty_completed or 0) + int(scrapped_qty or 0) >= int(qty_ordered or 0)


STATUS_ALIASES = {"in_progress": "in_process"}
TRANSITIONS = {
    "draft": {"released", "cancelled"},
    "released": {"in_process", "closed"},
    "in_process": {"completed", "closed"},
    "completed": {"closed"},
    "closed": set(),
    "cancelled": set(),
}


def canonical_status(status: str) -> str:
    value = (status or "").strip().lower()
    return STATUS_ALIASES.get(value, value)


def next_status(current: str, requested: str) -> str:
    """Return the stored status when the requested transition is allowed."""
    target = canonical_status(requested)
    if target not in TRANSITIONS.get(current, set()):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot change a {current.replace('_', ' ')} production order to {target.replace('_', ' ')}",
        )
    return target


def component_is_short(on_hand, required, tracks_inventory: bool) -> bool:
    """True when a stocked component cannot cover the exploded requirement."""
    if not tracks_inventory:
        return False
    return Decimal(str(required or 0)) > Decimal(str(on_hand or 0))


def _whole_number(quantity: Decimal, label: str) -> int:
    qty = Decimal(str(quantity))
    if qty != qty.to_integral_value() or qty <= 0:
        raise HTTPException(status_code=400, detail=f"{label} must be a positive whole number")
    return int(qty)


def _order_for_company(db: Session, company: Company, order_id: str) -> ProductionOrder:
    order = (
        db.query(ProductionOrder)
        .options(
            joinedload(ProductionOrder.materials),
            joinedload(ProductionOrder.operations),
            joinedload(ProductionOrder.item),
            joinedload(ProductionOrder.receipts),
        )
        .filter(
            ProductionOrder.production_order_id == order_id,
            ProductionOrder.company_id == company.id,
        )
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Production order not found")
    return order


def _active_header(db: Session, item_id: str) -> ItemBOMHeader:
    header = (
        db.query(ItemBOMHeader)
        .filter(ItemBOMHeader.parent_item_id == item_id, ItemBOMHeader.status == "active")
        .first()
    )
    if header is None:
        raise HTTPException(
            status_code=400,
            detail="Release requires an active BOM header for this item",
        )
    return header


def _sales_order_for_company(db: Session, company: Company, sales_order_id: str | None) -> None:
    if not sales_order_id:
        return
    sales_order = db.get(SalesOrder, sales_order_id)
    if sales_order is None or (sales_order.company_id and sales_order.company_id != company.id):
        raise HTTPException(status_code=400, detail="Sales order not found in this company")


def routing_snapshot(step, company_id, order_id: str) -> dict:
    """Freeze one template operation onto a production order.

    Later edits to the template object do not change the returned values.
    """
    return {
        "company_id": company_id,
        "production_order_id": order_id,
        "operation_sequence": step.sequence,
        "work_center_id": step.work_center_id,
        "operation_name": step.name,
        "setup_time": step.setup_minutes,
        "run_time": step.run_minutes_per_unit,
        "status": "pending",
    }


def _copy_templates(db: Session, order: ProductionOrder) -> None:
    """Copy the active BOM and routing onto the draft as a snapshot."""
    header = (
        db.query(ItemBOMHeader)
        .filter(ItemBOMHeader.parent_item_id == order.item_id, ItemBOMHeader.status == "active")
        .first()
    )
    if header is None:
        order.master_routing_id = None
        order.routing_code = None
        order.routing_version_no = None
        return
    order.master_routing_id = header.applied_master_routing_id
    order.routing_code = header.applied_routing_code
    order.routing_version_no = header.applied_routing_version
    lines = (
        db.query(ItemBOMComponent)
        .filter(ItemBOMComponent.bom_header_id == header.bom_header_id)
        .order_by(ItemBOMComponent.bom_id)
        .all()
    )
    order.bom_header_id = header.bom_header_id
    for requirement in build_material_requirements(lines, order.qty_ordered):
        db.add(
            ProductionOrderMaterial(
                production_order_id=order.production_order_id,
                component_item_id=requirement["component_item_id"],
                component_code=requirement["component_code"],
                item_type=requirement["item_type"],
                quantity_required=requirement["quantity_required"],
                quantity_issued=Decimal("0"),
                warehouse_id=order.warehouse_id,
                lot_serial_tracking_required=False,
            )
        )
    for step in list_routing(db, header.bom_header_id):
        db.add(ProductionOrderRouting(**routing_snapshot(step, order.company_id, order.production_order_id)))


def _replace_snapshot(db: Session, order: ProductionOrder) -> None:
    for row in list(order.materials):
        db.delete(row)
    for row in list(order.operations):
        db.delete(row)
    db.flush()
    _copy_templates(db, order)


def _assert_release_ready(db: Session, order: ProductionOrder) -> None:
    if int(order.qty_ordered or 0) <= 0:
        raise HTTPException(status_code=400, detail="Planned quantity must be greater than zero")
    if not order.materials:
        raise HTTPException(status_code=400, detail="The active BOM has no components")
    template_steps = list_routing(db, order.bom_header_id) if order.bom_header_id else []
    if template_steps and not order.operations:
        raise HTTPException(status_code=400, detail="Release requires the routing steps from the active BOM")
    shortages: list[str] = []
    for material in order.materials:
        if not material.component_item_id:
            continue
        item = db.get(Item, material.component_item_id)
        if item is None:
            raise HTTPException(status_code=400, detail=f"Component item {material.component_item_id} not found")
        if component_is_short(item.on_hand_quantity, material.quantity_required, not skip_inventory_movement(item)):
            shortages.append(item.item_id)
    if shortages:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient on-hand quantity for {', '.join(shortages)}",
        )


def create_order(db: Session, company: Company, payload) -> ProductionOrder:
    item = db.get(Item, payload.item_id)
    if item is None or item.company_id != company.id:
        raise HTTPException(status_code=400, detail="Item not found in this company")
    if payload.warehouse_id:
        from app.models import Warehouse

        warehouse = db.get(Warehouse, payload.warehouse_id)
        if warehouse is None or warehouse.company_id != company.id:
            raise HTTPException(status_code=400, detail="Warehouse not found in this company")
    _sales_order_for_company(db, company, getattr(payload, "sales_order_id", None))
    currency = normalize_currency(payload.transaction_currency or company.base_currency)
    order_id = next_document_number(db, DOC_PRODUCTION_ORDER, payload.order_date)
    due_date = getattr(payload, "due_date", None) or payload.planned_end
    order = ProductionOrder(
        production_order_id=order_id,
        company_id=company.id,
        item_id=item.item_id,
        sales_order_id=getattr(payload, "sales_order_id", None),
        warehouse_id=payload.warehouse_id,
        qty_ordered=payload.qty_ordered,
        qty_completed=0,
        scrapped_qty=0,
        status="draft",
        order_date=payload.order_date,
        planned_start=payload.planned_start,
        planned_end=payload.planned_end or due_date,
        due_date=due_date,
        transaction_currency=currency,
        transaction_amount=payload.transaction_amount or Decimal("0"),
        notes=payload.notes,
    )
    db.add(order)
    db.flush()
    if getattr(payload, "explode_bom", True):
        _copy_templates(db, order)
    db.commit()
    db.refresh(order)
    return order


def update_order(db: Session, company: Company, order_id: str, payload) -> ProductionOrder:
    order = _order_for_company(db, company, order_id)
    if order.status != "draft":
        raise HTTPException(status_code=400, detail="Only a draft production order can be edited")
    data = payload.model_dump(exclude_unset=True)
    if "sales_order_id" in data:
        _sales_order_for_company(db, company, data["sales_order_id"])
        order.sales_order_id = data["sales_order_id"] or None
    if "item_id" in data and data["item_id"]:
        item = db.get(Item, data["item_id"])
        if item is None or item.company_id != company.id:
            raise HTTPException(status_code=400, detail="Item not found in this company")
        order.item_id = item.item_id
    if "warehouse_id" in data:
        if data["warehouse_id"]:
            from app.models import Warehouse

            warehouse = db.get(Warehouse, data["warehouse_id"])
            if warehouse is None or warehouse.company_id != company.id:
                raise HTTPException(status_code=400, detail="Warehouse not found in this company")
        order.warehouse_id = data["warehouse_id"] or None
    if "qty_ordered" in data and data["qty_ordered"] is not None:
        order.qty_ordered = data["qty_ordered"]
    if "order_date" in data and data["order_date"] is not None:
        order.order_date = data["order_date"]
    if "planned_start" in data:
        order.planned_start = data["planned_start"]
    if "planned_end" in data:
        order.planned_end = data["planned_end"]
    if "due_date" in data:
        order.due_date = data["due_date"]
    if "transaction_currency" in data and data["transaction_currency"]:
        order.transaction_currency = normalize_currency(data["transaction_currency"])
    if "transaction_amount" in data and data["transaction_amount"] is not None:
        order.transaction_amount = data["transaction_amount"]
    if "notes" in data:
        order.notes = data["notes"]
    if "scrapped_qty" in data and data["scrapped_qty"] is not None:
        order.scrapped_qty = data["scrapped_qty"]
    if any(key in data for key in ("item_id", "qty_ordered", "warehouse_id")):
        _replace_snapshot(db, order)
    db.commit()
    db.refresh(order)
    return order


def cancel_order(db: Session, company: Company, order_id: str) -> ProductionOrder:
    order = _order_for_company(db, company, order_id)
    next_status(order.status, "cancelled")
    order.status = "cancelled"
    db.commit()
    db.refresh(order)
    return order


def release_order(db: Session, company: Company, order_id: str) -> ProductionOrder:
    order = _order_for_company(db, company, order_id)
    if order.status != "draft":
        raise HTTPException(status_code=400, detail="Only a draft production order can be released")
    if not order.materials:
        header = _active_header(db, order.item_id)
        order.bom_header_id = header.bom_header_id
        _copy_templates(db, order)
        db.flush()
    _assert_release_ready(db, order)
    rate = rate_on(db, company, order.transaction_currency, order.order_date)
    order.exchange_rate = rate
    order.rate_date = order.order_date
    order.base_amount = base_amount(order.transaction_amount or 0, rate)
    order.status = "released"
    parent = db.get(Item, order.item_id)
    if parent is not None:
        parent.wip_quantity = int(parent.wip_quantity or 0) + int(order.qty_ordered)
    db.commit()
    db.refresh(order)
    return order


def _consume_component(db: Session, item: Item, quantity: int, reference: str, notes: str, warehouse_id: str | None) -> None:
    if skip_inventory_movement(item):
        return
    try:
        issue_stock(
            db,
            item_id=item.item_id,
            quantity=quantity,
            reference=reference,
            notes=notes,
            warehouse_id=warehouse_id,
        )
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        on_hand = int(item.on_hand_quantity or 0)
        if quantity > on_hand:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient on-hand quantity for {item.item_id}",
            ) from exc
        item.on_hand_quantity = on_hand - quantity
    item.wip_quantity = int(item.wip_quantity or 0) + quantity


def issue_materials(db: Session, company: Company, order_id: str, payload) -> ProductionIssue:
    order = _order_for_company(db, company, order_id)
    if order.status not in {"released", "in_process"}:
        raise HTTPException(status_code=400, detail="Materials can be issued only after release")
    materials = {row.id: row for row in order.materials}
    issue = ProductionIssue(
        issue_id=next_document_number(db, DOC_PRODUCTION_ISSUE, payload.issue_date or date.today()),
        production_order_id=order.production_order_id,
        issue_date=payload.issue_date or date.today(),
        notes=payload.notes,
    )
    db.add(issue)
    db.flush()
    if not payload.lines:
        raise HTTPException(status_code=400, detail="Add at least one component to issue")
    for line in payload.lines:
        material = materials.get(line.material_id)
        if material is None or not material.component_item_id:
            raise HTTPException(status_code=400, detail="Material line not found on this order")
        qty = _whole_number(line.quantity, material.component_item_id)
        remaining = Decimal(material.quantity_required or 0) - Decimal(material.quantity_issued or 0)
        if Decimal(qty) > remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Issue quantity exceeds the remaining requirement for {material.component_item_id}",
            )
        component = db.get(Item, material.component_item_id)
        if component is None:
            raise HTTPException(status_code=400, detail="Component item not found")
        _consume_component(
            db,
            component,
            qty,
            issue.issue_id,
            payload.notes or f"Issued to production order {order.production_order_id}",
            order.warehouse_id,
        )
        material.quantity_issued = Decimal(material.quantity_issued or 0) + Decimal(qty)
        db.add(
            ProductionIssueLine(
                issue_id=issue.issue_id,
                material_id=material.id,
                component_item_id=component.item_id,
                quantity_issued=Decimal(qty),
            )
        )
    order.status = "in_process"
    db.commit()
    db.refresh(issue)
    return issue


def _post_finished_goods(db: Session, order: ProductionOrder, quantity: int, reference: str, notes: str | None) -> None:
    parent = db.get(Item, order.item_id)
    if parent is None:
        raise HTTPException(status_code=400, detail="Finished item not found")
    try:
        receive_stock(
            db,
            item_id=parent.item_id,
            quantity=quantity,
            reference=reference,
            notes=notes or f"Production receipt {reference}",
            warehouse_id=order.warehouse_id,
        )
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        parent.on_hand_quantity = int(parent.on_hand_quantity or 0) + quantity
    parent.wip_quantity = max(int(parent.wip_quantity or 0) - quantity, 0)
    order.qty_completed = int(order.qty_completed or 0) + quantity
    if production_is_covered(order.qty_ordered, order.qty_completed, order.scrapped_qty):
        order.status = "completed"
    elif order.status == "released":
        order.status = "in_process"


def receive_finished_goods(db: Session, company: Company, order_id: str, payload, _user_id=None) -> ProductionReceipt:
    order = _order_for_company(db, company, order_id)
    if order.status not in {"released", "in_process"}:
        raise HTTPException(status_code=400, detail="Finished goods can be received only after release")
    quantity = _whole_number(Decimal(payload.quantity_received), "Receipt quantity")
    remaining = open_receipt_quantity(order.qty_ordered, order.qty_completed, order.scrapped_qty)
    if quantity > remaining:
        if remaining <= 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No quantity remains to receive. "
                    f"Completed {int(order.qty_completed or 0)} and scrapped {int(order.scrapped_qty or 0)} "
                    f"cover the planned quantity of {int(order.qty_ordered)}"
                ),
            )
        raise HTTPException(status_code=400, detail="Receipt quantity exceeds the open production quantity")
    parent = db.get(Item, order.item_id)
    receipt = ProductionReceipt(
        receipt_id=next_document_number(db, DOC_PRODUCTION_RECEIPT, payload.receipt_date or date.today()),
        production_order_id=order.production_order_id,
        quantity_received=quantity,
        receipt_date=payload.receipt_date or date.today(),
        posted_to_stock=False,
        notes=payload.notes,
    )
    db.add(receipt)
    db.flush()
    if receipt_posts_immediately(bool(parent and parent.requires_inspection)):
        _post_finished_goods(db, order, quantity, receipt.receipt_id, payload.notes)
        receipt.posted_to_stock = True
    else:
        db.add(
            Inspection(
                company_id=company.id,
                source_type="production_receipt",
                source_id=receipt.receipt_id,
                status="pending",
                inspector_user_id=None,
                notes="Opened from production receipt",
            )
        )
    db.commit()
    db.refresh(receipt)
    return receipt


def post_accepted_receipt(db: Session, receipt: ProductionReceipt) -> None:
    if receipt.posted_to_stock:
        return
    order = db.get(ProductionOrder, receipt.production_order_id)
    if order is None:
        raise HTTPException(status_code=400, detail="Production order not found")
    _post_finished_goods(
        db,
        order,
        int(receipt.quantity_received),
        receipt.receipt_id,
        "Accepted inspection",
    )
    receipt.posted_to_stock = True


def list_routing(db: Session, bom_header_id: int) -> list[BomRoutingOperation]:
    return (
        db.query(BomRoutingOperation)
        .filter(BomRoutingOperation.bom_header_id == bom_header_id)
        .order_by(BomRoutingOperation.sequence)
        .all()
    )


def add_routing_operation(db: Session, header: ItemBOMHeader, payload) -> BomRoutingOperation:
    if payload.work_center_id and db.get(WorkCenter, payload.work_center_id) is None:
        raise HTTPException(status_code=400, detail="Work center not found")
    row = BomRoutingOperation(
        bom_header_id=header.bom_header_id,
        sequence=payload.sequence,
        work_center_id=payload.work_center_id,
        name=payload.name.strip(),
        setup_minutes=payload.setup_minutes,
        run_minutes_per_unit=payload.run_minutes_per_unit,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def change_status(db: Session, company: Company, order_id: str, requested: str) -> ProductionOrder:
    order = _order_for_company(db, company, order_id)
    target = next_status(order.status, requested)
    if target == "released":
        return release_order(db, company, order_id)
    if target == "cancelled":
        return cancel_order(db, company, order_id)
    if target == "closed":
        return close_order(db, company, order_id)
    if target == "completed" and not production_is_covered(order.qty_ordered, order.qty_completed, order.scrapped_qty):
        raise HTTPException(status_code=400, detail="Receive the planned quantity before completing the order")
    order.status = target
    db.commit()
    db.refresh(order)
    return order


def set_operation_status(db: Session, company: Company, order_id: str, operation_id: int, requested: str) -> ProductionOrderRouting:
    order = _order_for_company(db, company, order_id)
    if order.status not in {"released", "in_process"}:
        raise HTTPException(status_code=400, detail="Routing progress starts after the order is released")
    target = canonical_status(requested)
    if target not in {"pending", "running", "completed"}:
        raise HTTPException(status_code=400, detail="Routing status must be pending, running, or completed")
    operation = next((row for row in order.operations if row.id == operation_id), None)
    if operation is None:
        raise HTTPException(status_code=404, detail="Routing step not found")
    operation.status = target
    if target == "running" and order.status == "released":
        order.status = "in_process"
    if order.operations and all(row.status == "completed" for row in order.operations) and order.status == "in_process":
        if production_is_covered(order.qty_ordered, order.qty_completed, order.scrapped_qty):
            order.status = "completed"
    db.commit()
    db.refresh(operation)
    return operation


def close_order(db: Session, company: Company, order_id: str) -> ProductionOrder:
    order = _order_for_company(db, company, order_id)
    if order.status == "cancelled":
        raise HTTPException(status_code=400, detail="A cancelled production order cannot be closed")
    if order.status == "draft":
        raise HTTPException(status_code=400, detail="Release the order before closing it")
    if order.status == "closed":
        raise HTTPException(status_code=400, detail="This production order is already closed")
    pending = (
        db.query(Inspection)
        .filter(
            Inspection.company_id == company.id,
            Inspection.source_type == "production_receipt",
            Inspection.status == "pending",
            Inspection.source_id.in_([row.receipt_id for row in order.receipts]),
        )
        .first()
        if order.receipts
        else None
    )
    if pending is not None:
        raise HTTPException(status_code=400, detail="Accept or reject open inspections before closing")
    order.status = "closed"
    db.commit()
    db.refresh(order)
    return order
