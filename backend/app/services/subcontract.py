# @author: Wendy Yang
# @date: 2026-09-19

"""Allocation, cost-sheet math, and SO-line helpers for subcontract orders."""

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Customer,
    Item,
    SalesOrder,
    SalesOrderItem,
    SubcontractOrder,
    SubcontractOrderItem,
    SubcontractOrderLineCharge,
)
from app.services.bom_versions import get_active_header
from app.services.catalog import material_bom_lines

MONEY_2 = Decimal("0.01")
MONEY_4 = Decimal("0.0001")
CLOSED_SO_STATUSES = {
    "CANCELLED",
    "CLOSED",
    "DELIVERED",
    "SHIPPED",
    "FULFILLED",
    "INVOICED",
}
CANCELLED_SCO = "CANCELLED"
CLOSED_SCO_STATUSES = {"COMPLETED", "CANCELLED"}
AMENDABLE_APPROVAL = "APPROVED"
SCO_KIT_MUST_BE_ISSUED_DETAIL = (
    "Cannot approve Subcontract Order: All required kit components must be "
    "fully issued to the subcontractor first."
)
SCO_MUST_BE_APPROVED_TO_ISSUE_DETAIL = (
    "Materials cannot be issued until the Subcontract Order is approved."
)
SCO_RECEIVE_REQUIRES_APPROVAL_DETAIL = (
    "Finished goods cannot be received until the Subcontract Order receives "
    "full management approval."
)
PARENT_SO_MUST_BE_APPROVED_FOR_SCO_DETAIL = (
    "The parent Sales Order must be approved before a subcontract order can be created or updated."
)


def fully_fulfilled_sco_message(sales_order_id: str) -> str:
    return (
        f"Sales Order {sales_order_id} is fully fulfilled. "
        "Subcontract orders cannot be created for completed orders."
    )


def so_is_approved_for_sco(approval_status: str | None) -> bool:
    return (approval_status or "DRAFT").upper() == AMENDABLE_APPROVAL


def assert_linked_sales_order_approved(db: Session, sales_order_id: str | None) -> SalesOrder | None:
    """Reject create/update when a linked Sales Order is not APPROVED."""
    if not sales_order_id:
        return None
    order = db.get(SalesOrder, sales_order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Sales order not found")
    if not so_is_approved_for_sco(getattr(order, "approval_status", None)):
        raise HTTPException(status_code=400, detail=PARENT_SO_MUST_BE_APPROVED_FOR_SCO_DETAIL)
    return order


def subcontract_create_gate(
    *,
    sales_order_id: str,
    status: str | None,
    remaining_total: int,
    selectable_line_count: int,
    approval_status: str | None = None,
) -> tuple[bool, str | None]:
    """Whether a new SCO can be created from this sales order."""
    if not so_is_approved_for_sco(approval_status):
        return False, PARENT_SO_MUST_BE_APPROVED_FOR_SCO_DETAIL
    eligible = so_is_eligible_status(status)
    if remaining_total <= 0 or not eligible:
        return False, fully_fulfilled_sco_message(sales_order_id)
    if selectable_line_count <= 0:
        return False, (
            f"Sales Order {sales_order_id} has remaining quantity but no Material BOM "
            "on open lines."
        )
    return True, None

DEFAULT_COST_COMPONENTS = [
    {
        "name": "Receiving, IQC and storage",
        "detail_explanation": (
            "Includes receiving, IQC, stock-in, movement, and kitting, warehouse management"
        ),
    },
    {
        "name": "Assembly Service",
        "detail_explanation": "Jig Calibration, FAI, Assembly, Packing IPQC & OQC",
    },
    {
        "name": "Inventory Management & Shipment",
        "detail_explanation": (
            "ERP/MRP maintenance and reporting, work order issuing, stock control, "
            "cycle count & shipment"
        ),
    },
    {
        "name": "Admin & Documentation",
        "detail_explanation": (
            "Order processing-covering activities from PO receipt to final invoicing, "
            "production scheduling, managing BOM system"
        ),
    },
]


def _d(value) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def default_cost_sheet() -> list[dict]:
    rows: list[dict] = []
    for index, tmpl in enumerate(DEFAULT_COST_COMPONENTS, start=1):
        rows.append(
            {
                "line_no": index,
                "name": tmpl["name"],
                "detail_explanation": tmpl["detail_explanation"],
                "labor_minutes": Decimal("0"),
                "sf_rate": Decimal("0"),
                "cost_per_unit": Decimal("0"),
                "margin_percent": None,
                "is_margin": False,
            }
        )
    rows.append(
        {
            "line_no": len(rows) + 1,
            "name": "Margin",
            "detail_explanation": "Margin (5-6%)",
            "labor_minutes": None,
            "sf_rate": None,
            "cost_per_unit": Decimal("0"),
            "margin_percent": Decimal("0"),
            "is_margin": True,
        }
    )
    return rows


def compute_cost_per_unit(minutes, sf_rate) -> Decimal | None:
    if minutes is None or sf_rate is None:
        return None
    mins = _d(minutes)
    rate = _d(sf_rate)
    if mins <= 0 or rate <= 0:
        return None
    return (mins * rate / Decimal("60")).quantize(MONEY_2)


def compute_charge_sheet(charges: list[dict], quantity_ordered: int) -> dict:
    """Normalize charge rows and return rollup totals."""
    cost_subtotal = Decimal("0")
    margin_amount = Decimal("0")
    margin_percent = Decimal("0")
    normalized: list[dict] = []

    for index, raw in enumerate(charges or [], start=1):
        is_margin = bool(raw.get("is_margin"))
        minutes = raw.get("labor_minutes")
        sf_rate = raw.get("sf_rate")
        name = (raw.get("name") or "").strip() or ("Margin" if is_margin else f"Component {index}")
        row = {
            "line_no": int(raw.get("line_no") or index),
            "name": name,
            "detail_explanation": raw.get("detail_explanation"),
            "labor_minutes": _d(minutes) if minutes not in (None, "") else None,
            "sf_rate": _d(sf_rate) if sf_rate not in (None, "") else None,
            "cost_per_unit": _d(raw.get("cost_per_unit")),
            "margin_percent": _d(raw.get("margin_percent")) if raw.get("margin_percent") is not None else None,
            "is_margin": is_margin,
        }
        if is_margin:
            if row["margin_percent"] is None:
                row["margin_percent"] = Decimal("0")
            if raw.get("cost_per_unit") not in (None, ""):
                margin_amount = _d(raw.get("cost_per_unit"))
            elif row["margin_percent"] > 0:
                margin_amount = (cost_subtotal * row["margin_percent"] / Decimal("100")).quantize(MONEY_2)
            row["cost_per_unit"] = margin_amount
            margin_percent = row["margin_percent"] or Decimal("0")
        else:
            computed = compute_cost_per_unit(row["labor_minutes"], row["sf_rate"])
            if computed is not None:
                row["cost_per_unit"] = computed
            cost_subtotal += row["cost_per_unit"]
        normalized.append(row)

    unit_price = (cost_subtotal + margin_amount).quantize(MONEY_4)
    if unit_price == 0 and not charges:
        unit_price = Decimal("0")
    line_total = (unit_price * Decimal(str(quantity_ordered))).quantize(MONEY_2)
    return {
        "charges": normalized,
        "cost_subtotal": cost_subtotal.quantize(MONEY_4),
        "margin_percent": margin_percent,
        "margin_amount": margin_amount,
        "unit_price": unit_price,
        "line_total": line_total,
    }


def previously_approved(sco) -> bool:
    return int(getattr(sco, "amendment_number", 0) or 0) > 0


def assert_can_amend_cost_sheet(sco) -> None:
    status = (getattr(sco, "status", None) or "").upper()
    if status in CLOSED_SCO_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot amend a {status.lower()} subcontract order",
        )
    approval = (getattr(sco, "approval_status", None) or "DRAFT").upper()
    if approval != AMENDABLE_APPROVAL:
        raise HTTPException(
            status_code=400,
            detail=(
                "Amend is only available after the subcontract order is approved. "
                "While Draft or Rejected, edit the cost sheet directly."
            ),
        )


def assert_sco_fulfillment_allowed(sco, action_label: str = "this action") -> None:
    """Issue materials only after the SCO is fully approved."""
    status = (getattr(sco, "status", None) or "").upper()
    if status in CLOSED_SCO_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot {action_label} on a {status.lower()} subcontract order",
        )
    approval = (getattr(sco, "approval_status", None) or "DRAFT").upper()
    if approval != AMENDABLE_APPROVAL:
        raise HTTPException(status_code=400, detail=SCO_MUST_BE_APPROVED_TO_ISSUE_DETAIL)


def assert_sco_receive_allowed(sco) -> None:
    """Finished goods may be received only after the SCO is fully approved."""
    status = (getattr(sco, "status", None) or "").upper()
    if status in CLOSED_SCO_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot receive goods on a {status.lower()} order",
        )
    approval = (getattr(sco, "approval_status", None) or "DRAFT").upper()
    if approval != AMENDABLE_APPROVAL:
        raise HTTPException(
            status_code=400,
            detail=SCO_RECEIVE_REQUIRES_APPROVAL_DETAIL,
        )


def sco_kit_remaining(component) -> Decimal:
    required = Decimal(str(getattr(component, "quantity_required", 0) or 0))
    issued = Decimal(str(getattr(component, "quantity_issued", 0) or 0))
    leftover = required - issued
    return leftover if leftover > 0 else Decimal("0")


def sco_unissued_components(sco) -> list:
    return [row for row in (getattr(sco, "components", None) or []) if sco_kit_remaining(row) > 0]


def sco_kit_is_fully_issued(sco) -> bool:
    return not sco_unissued_components(sco)


def assert_sco_kit_fully_issued(sco) -> None:
    if not sco_kit_is_fully_issued(sco):
        raise HTTPException(status_code=400, detail=SCO_KIT_MUST_BE_ISSUED_DETAIL)


def apply_line_charge_sheet(
    sco_line: SubcontractOrderItem,
    charges: list[dict],
    db: Session | None = None,
) -> dict:
    """Replace a line's vendor cost sheet and roll unit price / line total."""
    sheet = compute_charge_sheet(charges, int(sco_line.quantity_ordered or 0))
    sco_line.charges.clear()
    # Flush deletes before inserts so (sco_line_id, line_no) unique constraint is not violated.
    if db is not None:
        db.flush()
    for charge in sheet["charges"]:
        sco_line.charges.append(
            SubcontractOrderLineCharge(
                line_no=charge["line_no"],
                name=charge["name"],
                detail_explanation=charge.get("detail_explanation"),
                labor_minutes=charge.get("labor_minutes"),
                sf_rate=charge.get("sf_rate"),
                cost_per_unit=charge.get("cost_per_unit") or Decimal("0"),
                margin_percent=charge.get("margin_percent"),
                is_margin=bool(charge.get("is_margin")),
            )
        )
    sco_line.unit_price = sheet["unit_price"]
    sco_line.margin_percent = sheet["margin_percent"]
    sco_line.margin_amount = sheet["margin_amount"]
    sco_line.cost_subtotal = sheet["cost_subtotal"]
    tax = Decimal(str(sco_line.tax_amount or 0))
    sco_line.line_total = sheet["line_total"] + tax
    return sheet


def allocated_qty_for_so_line(
    db: Session,
    so_item_id: int,
    exclude_sco_number: str | None = None,
) -> int:
    query = (
        db.query(func.coalesce(func.sum(SubcontractOrderItem.quantity_ordered), 0))
        .join(SubcontractOrder)
        .filter(
            SubcontractOrderItem.so_item_id == so_item_id,
            SubcontractOrder.status != CANCELLED_SCO,
        )
    )
    if exclude_sco_number:
        query = query.filter(SubcontractOrder.sco_number != exclude_sco_number)
    return int(query.scalar() or 0)


def remaining_qty_for_so_line(
    db: Session,
    so_item: SalesOrderItem,
    exclude_sco_number: str | None = None,
) -> int:
    allocated = allocated_qty_for_so_line(db, so_item.so_item_id, exclude_sco_number)
    return max(int(so_item.quantity_ordered) - allocated, 0)


def so_is_eligible_status(status: str | None) -> bool:
    return (status or "").upper() not in CLOSED_SO_STATUSES


def so_is_eligible(order: SalesOrder) -> bool:
    return so_is_eligible_status(getattr(order, "status", None))


def assert_so_line_allocatable(
    db: Session,
    *,
    sales_order_id: str,
    so_item_id: int,
    item_id: str,
    quantity: int,
    exclude_sco_number: str | None = None,
) -> SalesOrderItem:
    so_item = (
        db.query(SalesOrderItem)
        .options(joinedload(SalesOrderItem.sales_order))
        .filter(SalesOrderItem.so_item_id == so_item_id)
        .first()
    )
    if so_item is None:
        raise HTTPException(status_code=404, detail=f"Sales order line {so_item_id} not found")
    if so_item.sales_order_id != sales_order_id:
        raise HTTPException(
            status_code=400,
            detail=f"Sales order line {so_item_id} does not belong to {sales_order_id}",
        )
    if so_item.item_id != item_id:
        raise HTTPException(
            status_code=400,
            detail=f"Item {item_id} does not match sales order line item {so_item.item_id}",
        )
    order = so_item.sales_order or db.get(SalesOrder, sales_order_id)
    if order is None:
        raise HTTPException(status_code=404, detail=f"Sales order {sales_order_id} not found")
    if not so_is_eligible(order):
        raise HTTPException(
            status_code=400,
            detail=f"Sales order {sales_order_id} is {order.status} and cannot be subcontracted",
        )
    if not so_is_approved_for_sco(getattr(order, "approval_status", None)):
        raise HTTPException(
            status_code=400,
            detail=PARENT_SO_MUST_BE_APPROVED_FOR_SCO_DETAIL,
        )
    remaining = remaining_qty_for_so_line(db, so_item, exclude_sco_number)
    if quantity > remaining:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Quantity {quantity} exceeds remaining subcontractable qty {remaining} "
                f"on {sales_order_id} line {so_item.line_number}"
            ),
        )
    return so_item


def list_eligible_sales_orders(
    db: Session,
    q: str = "",
    skip: int = 0,
    limit: int = 50,
) -> list[dict]:
    query = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.customer), joinedload(SalesOrder.items))
        .filter(~func.upper(SalesOrder.status).in_(CLOSED_SO_STATUSES))
        .filter(func.upper(func.coalesce(SalesOrder.approval_status, "DRAFT")) == AMENDABLE_APPROVAL)
        .order_by(SalesOrder.order_date.desc(), SalesOrder.sales_order_id.desc())
    )
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        query = query.outerjoin(Customer, SalesOrder.customer_id == Customer.customer_id).filter(
            SalesOrder.sales_order_id.ilike(like)
            | SalesOrder.customer_po_number.ilike(like)
            | Customer.company_name.ilike(like)
        )
    orders = query.offset(skip).limit(limit).all()
    result = []
    for order in orders:
        open_line_count = 0
        for item in order.items or []:
            if remaining_qty_for_so_line(db, item) > 0:
                open_line_count += 1
        if open_line_count <= 0:
            continue
        if not so_is_approved_for_sco(getattr(order, "approval_status", None)):
            continue
        result.append(
            {
                "sales_order_id": order.sales_order_id,
                "customer_id": order.customer_id,
                "customer_name": order.customer.company_name if order.customer else None,
                "customer_po_number": order.customer_po_number,
                "order_date": order.order_date,
                "status": order.status,
                "approval_status": order.approval_status,
                "open_line_count": open_line_count,
            }
        )
    return result


def sales_order_lines_for_subcontract(db: Session, sales_order_id: str) -> list[dict]:
    return sales_order_subcontract_availability(db, sales_order_id)["lines"]


def sales_order_subcontract_availability(db: Session, sales_order_id: str) -> dict:
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.items).joinedload(SalesOrderItem.item))
        .filter(SalesOrder.sales_order_id == sales_order_id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Sales order not found")

    rows = []
    for line in sorted(order.items or [], key=lambda item: item.line_number):
        header = get_active_header(db, line.item_id) if line.item_id else None
        material_lines = material_bom_lines(db, line.item_id) if line.item_id else []
        catalog = line.item or (db.get(Item, line.item_id) if line.item_id else None)
        remaining = remaining_qty_for_so_line(db, line)
        rows.append(
            {
                "so_item_id": line.so_item_id,
                "line_number": line.line_number,
                "item_id": line.item_id,
                "item_description": catalog.description if catalog else None,
                "customer_part_number": line.customer_part_number,
                "quantity_ordered": int(line.quantity_ordered or 0),
                "quantity_subcontracted": allocated_qty_for_so_line(db, line.so_item_id),
                "quantity_remaining": remaining,
                "has_active_bom": bool(header and material_lines),
                "active_bom_header_id": header.bom_header_id if header else None,
                "active_bom_version_no": header.version_no if header else None,
                "bom_status": header.status if header else None,
                "is_subcontract_assembly": bool(
                    getattr(catalog, "is_subcontract_assembly", False)
                )
                if catalog
                else False,
            }
        )
    remaining_total = sum(int(row["quantity_remaining"]) for row in rows)
    selectable_line_count = sum(
        1
        for row in rows
        if int(row["quantity_remaining"]) > 0 and row["has_active_bom"]
    )
    can_create, message = subcontract_create_gate(
        sales_order_id=order.sales_order_id,
        status=order.status,
        remaining_total=remaining_total,
        selectable_line_count=selectable_line_count,
        approval_status=order.approval_status,
    )
    return {
        "sales_order_id": order.sales_order_id,
        "status": order.status,
        "approval_status": order.approval_status,
        "can_create": can_create,
        "remaining_total": remaining_total,
        "message": message,
        "lines": rows,
    }
