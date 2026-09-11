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
OPS_ALLOWED_WHILE_AMENDING = {"DRAFT", "REJECTED", "PENDING_APPROVAL"}

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
    """Allow kit issue after the first approval, including during a cost-sheet amendment."""
    approval = (getattr(sco, "approval_status", None) or "").upper()
    if approval == AMENDABLE_APPROVAL:
        return
    if previously_approved(sco) and approval in OPS_ALLOWED_WHILE_AMENDING:
        return
    raise HTTPException(
        status_code=400,
        detail=(
            f"Subcontract order must be APPROVED before {action_label} "
            f"(current: {approval or None})"
        ),
    )


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


def so_is_eligible(order: SalesOrder) -> bool:
    status = (order.status or "").upper()
    return status not in CLOSED_SO_STATUSES


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
        result.append(
            {
                "sales_order_id": order.sales_order_id,
                "customer_id": order.customer_id,
                "customer_name": order.customer.company_name if order.customer else None,
                "customer_po_number": order.customer_po_number,
                "order_date": order.order_date,
                "status": order.status,
                "approval_status": order.approval_status,
                "open_line_count": len(order.items or []),
            }
        )
    return result


def sales_order_lines_for_subcontract(db: Session, sales_order_id: str) -> list[dict]:
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.items).joinedload(SalesOrderItem.item))
        .filter(SalesOrder.sales_order_id == sales_order_id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Sales order not found")
    if not so_is_eligible(order):
        raise HTTPException(
            status_code=400,
            detail=f"Sales order {sales_order_id} is {order.status} and cannot be subcontracted",
        )

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
                "quantity_ordered": line.quantity_ordered,
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
    return rows
