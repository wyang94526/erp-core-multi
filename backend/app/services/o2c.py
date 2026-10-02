# @author: Wendy Yang
# @date: 2026-09-19

"""Order-to-Cash: item fulfillments and sales invoices."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models import (
    ARInvoice,
    Item,
    ItemFulfillment,
    ItemFulfillmentLine,
    SalesInvoice,
    SalesInvoiceLine,
    SalesOrder,
    SalesOrderItem,
    SubcontractOrder,
    SubcontractOrderItem,
)
from app.services.document_sequences import (
    DOC_FULFILLMENT,
    DOC_INVOICE,
    generate_document_number,
)
from app.services import finance, inventory
from app.services.journal_source import SOURCE_SALES_INVOICE, rule_id
from app.services.posting_rules import (
    EVENT_SALES_INVOICE,
    VARIANT_REVENUE,
    VARIANT_TAX,
    resolve_posting_rule,
)
from app.services.payment_terms import apply_due_date, apply_payment_term_fields
from app.services.period_close import assert_transaction_date_open
from app.services.item_types import catalog_item, skip_inventory_movement
from app.services.remaining_close import (
    NO_OPEN_REMAINING_DETAIL,
    REMAINING_ALREADY_CLOSED_DETAIL,
    REMAINING_CLOSED_FULFILL_DETAIL,
    assert_can_close_remaining,
    is_remaining_closed,
)

ACTIVE_SALES_INVOICE_STATUSES = ("DRAFT", "APPROVED", "PAID")
_MONEY = Decimal("0.01")
SALES_ORDER_LOCKED_EDIT_DETAIL = (
    "Approved or invoiced orders cannot be modified directly. "
    "Use Create Revision to reopen this sales order."
)
_COMMITTED_FULFILLMENT_STATUSES = frozenset({"PICKED", "PACKED", "SHIPPED"})
_EDITABLE_APPROVAL = frozenset({"DRAFT", "REJECTED"})
_LOCKED_STATUS = frozenset({"SHIPPED", "INVOICED", "FULFILLED", "PARTIALLY_FULFILLED"})


def _normalize_so_flag(value: str | None) -> str:
    return (value or "").strip().upper().replace(" ", "_").replace("-", "_")


def sales_order_is_editable(order: SalesOrder) -> bool:
    approval = _normalize_so_flag(getattr(order, "approval_status", None) or "DRAFT")
    status = _normalize_so_flag(getattr(order, "status", None))
    invoice_status = _normalize_so_flag(getattr(order, "invoice_status", None))
    if status in _LOCKED_STATUS or invoice_status == "FULLY_BILLED":
        return False
    return approval in _EDITABLE_APPROVAL


def require_sales_order_editable(order: SalesOrder) -> None:
    if not sales_order_is_editable(order):
        raise HTTPException(status_code=409, detail=SALES_ORDER_LOCKED_EDIT_DETAIL)


def sales_order_revise_blocker(order: SalesOrder) -> str | None:
    approval = _normalize_so_flag(getattr(order, "approval_status", None) or "DRAFT")
    status = _normalize_so_flag(getattr(order, "status", None))
    invoice_status = _normalize_so_flag(getattr(order, "invoice_status", None))
    if approval != "APPROVED":
        return "Create Revision is only available after the sales order is approved."
    if status in _LOCKED_STATUS or invoice_status == "FULLY_BILLED":
        return "Cannot revise a shipped, fulfilled, or fully billed sales order."
    return None


def sales_order_can_revise(order: SalesOrder) -> bool:
    return sales_order_revise_blocker(order) is None


def assert_can_revise_sales_order(order: SalesOrder) -> None:
    reason = sales_order_revise_blocker(order)
    if reason:
        raise HTTPException(status_code=409, detail=reason)


def attach_sales_order_revise_flags(orders: list[SalesOrder]) -> None:
    for order in orders:
        reason = sales_order_revise_blocker(order)
        order.can_revise = reason is None
        order.revise_blocked_reason = reason


def _money(value: Decimal | int | float | str | None) -> Decimal:
    return Decimal(str(value or 0)).quantize(_MONEY)


def invoice_status_label(order_total: Decimal, billed_amount: Decimal) -> str:
    order_total = _money(order_total)
    billed_amount = _money(billed_amount)
    if billed_amount <= 0:
        return "UNBILLED"
    if billed_amount >= order_total:
        return "FULLY_BILLED"
    return "PARTIALLY_BILLED"


def billed_amount_for_order(db: Session, sales_order_id: str) -> Decimal:
    db.flush()
    total = (
        db.query(func.coalesce(func.sum(SalesInvoice.total_amount), 0))
        .filter(
            SalesInvoice.sales_order_id == sales_order_id,
            SalesInvoice.status.in_(ACTIVE_SALES_INVOICE_STATUSES),
        )
        .scalar()
    )
    return _money(total)


def attach_sales_order_billing(db: Session, orders: list[SalesOrder]) -> None:
    """Set live billed / remaining / invoice_status on sales-order objects."""
    if not orders:
        return
    db.flush()
    ids = [order.sales_order_id for order in orders]
    rows = (
        db.query(
            SalesInvoice.sales_order_id,
            func.coalesce(func.sum(SalesInvoice.total_amount), 0),
        )
        .filter(
            SalesInvoice.sales_order_id.in_(ids),
            SalesInvoice.status.in_(ACTIVE_SALES_INVOICE_STATUSES),
        )
        .group_by(SalesInvoice.sales_order_id)
        .all()
    )
    billed_by = {sales_order_id: _money(amount) for sales_order_id, amount in rows}
    for order in orders:
        billed = billed_by.get(order.sales_order_id, Decimal("0.00"))
        order_total = _billable_order_total(db, order)
        remaining = max(order_total - billed, Decimal("0.00"))
        order.billed_amount = billed
        order.remaining_billable_amount = remaining
        order.invoice_status = invoice_status_label(order_total, billed)
        order.can_close_remaining = sales_order_can_close_remaining(db, order)
    attach_sales_order_revise_flags(orders)


def assert_new_invoice_within_order_balance(
    *,
    sales_order_id: str,
    order_total: Decimal,
    billed_amount: Decimal,
    new_invoice_amount: Decimal,
) -> None:
    order_total = _money(order_total)
    billed_amount = _money(billed_amount)
    new_invoice_amount = _money(new_invoice_amount)
    if billed_amount >= order_total:
        raise HTTPException(
            status_code=400,
            detail=f"Sales Order {sales_order_id} is already fully invoiced.",
        )
    remaining = _money(order_total - billed_amount)
    if new_invoice_amount > remaining:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invoice amount {new_invoice_amount} exceeds remaining unbilled "
                f"balance {remaining} for Sales Order {sales_order_id}."
            ),
        )


def _billable_order_total(db: Session, order: SalesOrder) -> Decimal:
    if is_remaining_closed(order) and getattr(order, "closed_billable_amount", None) is not None:
        return _money(order.closed_billable_amount)
    return _money(order.total_amount)


def sync_sales_order_invoice_status(db: Session, order: SalesOrder | None) -> None:
    if order is None or (order.status or "").upper() == "CANCELLED":
        return
    billed = billed_amount_for_order(db, order.sales_order_id)
    order_total = _billable_order_total(db, order)
    if billed >= order_total and order_total > 0:
        order.status = "INVOICED"
        return
    if (order.status or "").upper() != "INVOICED":
        return
    shipped = (
        db.query(ItemFulfillment)
        .filter(
            ItemFulfillment.sales_order_id == order.sales_order_id,
            ItemFulfillment.status == "SHIPPED",
        )
        .count()
    )
    if not shipped:
        order.status = "APPROVED"
        return
    if not order.items:
        order = (
            db.query(SalesOrder)
            .options(joinedload(SalesOrder.items))
            .filter(SalesOrder.sales_order_id == order.sales_order_id)
            .first()
        ) or order
    remaining = _remaining_fulfillment_qty(db, order)
    order.status = "FULFILLED" if remaining <= 0 else "PARTIALLY_FULFILLED"


def _load_fulfillment(db: Session, fulfillment_id: int) -> ItemFulfillment:
    row = (
        db.query(ItemFulfillment)
        .options(
            joinedload(ItemFulfillment.lines),
            joinedload(ItemFulfillment.sales_order),
            joinedload(ItemFulfillment.customer),
        )
        .filter(ItemFulfillment.id == fulfillment_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Fulfillment not found")
    return row


def _load_sales_invoice(db: Session, invoice_id: int) -> SalesInvoice:
    row = (
        db.query(SalesInvoice)
        .options(
            joinedload(SalesInvoice.lines),
            joinedload(SalesInvoice.sales_order),
            joinedload(SalesInvoice.customer),
            joinedload(SalesInvoice.fulfillment),
        )
        .filter(SalesInvoice.id == invoice_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Sales invoice not found")
    return row


def over_fulfillment_detail(item_id: str, ordered: int) -> str:
    return (
        f"Total fulfillment quantity cannot exceed the ordered quantity of {ordered} "
        f"for item {item_id}."
    )


def over_sco_receipt_detail(item_id: str, received: int, sco_numbers: list[str] | None = None) -> str:
    sources = ", ".join(sco_numbers or [])
    origin = f"subcontract {sources}" if sources else "the linked subcontract"
    return (
        f"Cannot fulfill more than the {received} received on {origin} for item {item_id}. "
        "Ship the received quantity now; remaining quantity can be fulfilled after the next receipt."
    )


def subcontract_receipt_caps(
    db: Session, sales_order_id: str
) -> dict[int, tuple[int, list[str]]]:
    """SO line id -> (finished-goods received, SCO numbers) for subcontracted lines."""
    scos = (
        db.query(SubcontractOrder)
        .options(
            joinedload(SubcontractOrder.lines),
            joinedload(SubcontractOrder.finished_goods_receipts),
        )
        .filter(
            SubcontractOrder.sales_order_id == sales_order_id,
            SubcontractOrder.status != "CANCELLED",
        )
        .all()
    )
    if not scos:
        return {}

    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.items))
        .filter(SalesOrder.sales_order_id == sales_order_id)
        .first()
    )
    so_items = list(order.items or []) if order else []
    so_lines_by_item: dict[str, list[int]] = {}
    for item in so_items:
        so_lines_by_item.setdefault(item.item_id, []).append(int(item.so_item_id))

    caps: dict[int, tuple[int, list[str]]] = {}

    def _add(line_id: int | None, qty: int, sco_number: str) -> None:
        if line_id is None:
            return
        received, numbers = caps.get(line_id, (0, []))
        if sco_number not in numbers:
            numbers = [*numbers, sco_number]
        caps[line_id] = (received + qty, numbers)

    for sco in scos:
        receipts = list(sco.finished_goods_receipts or [])
        by_sco_line: dict[int, int] = {}
        header_qty = 0
        for receipt in receipts:
            qty = int(receipt.quantity_received or 0)
            if receipt.sco_line_id:
                by_sco_line[int(receipt.sco_line_id)] = by_sco_line.get(int(receipt.sco_line_id), 0) + qty
            else:
                header_qty += qty

        lines = list(sco.lines or [])
        if lines:
            for line in lines:
                qty = by_sco_line.get(int(line.sco_line_id), 0)
                if line.so_item_id:
                    _add(int(line.so_item_id), qty, sco.sco_number)
                else:
                    for so_line_id in so_lines_by_item.get(line.item_id, []):
                        _add(so_line_id, qty, sco.sco_number)
            if header_qty:
                for so_line_id in so_lines_by_item.get(sco.item_id, []):
                    _add(so_line_id, header_qty, sco.sco_number)
        else:
            total = header_qty + sum(by_sco_line.values())
            for so_line_id in so_lines_by_item.get(sco.item_id, []):
                _add(so_line_id, total, sco.sco_number)

    return caps


def assert_fulfillment_qty_within_sco_received(
    *,
    item_id: str,
    received: int | None,
    already: int,
    qty: int,
    sco_numbers: list[str] | None = None,
) -> None:
    if received is None:
        return
    if already + qty > received:
        raise HTTPException(
            status_code=400,
            detail=over_sco_receipt_detail(item_id, received, sco_numbers),
        )


def assert_fulfillment_qty_within_ordered(
    *,
    item_id: str,
    ordered: int,
    already: int,
    qty: int,
) -> None:
    if qty <= 0:
        raise HTTPException(status_code=400, detail="quantity_fulfilled must be positive")
    if already + qty > ordered:
        raise HTTPException(
            status_code=400,
            detail=over_fulfillment_detail(item_id, ordered),
        )


def _fulfilled_qty_by_line(
    db: Session,
    sales_order_id: str,
    *,
    exclude_fulfillment_id: int | None = None,
    statuses: set[str] | None = None,
) -> dict[int, int]:
    """Cumulative fulfilled qty per SO line, including draft fulfillments.

    Drafts are counted so overlapping unsaved shipments cannot exceed the
    ordered quantity when they are later picked or shipped.
    """
    query = (
        db.query(
            ItemFulfillmentLine.sales_order_line_id,
            func.coalesce(func.sum(ItemFulfillmentLine.quantity_fulfilled), 0),
        )
        .join(ItemFulfillment)
        .filter(ItemFulfillment.sales_order_id == sales_order_id)
    )
    if exclude_fulfillment_id is not None:
        query = query.filter(ItemFulfillment.id != exclude_fulfillment_id)
    if statuses is not None:
        query = query.filter(ItemFulfillment.status.in_(statuses))
    rows = query.group_by(ItemFulfillmentLine.sales_order_line_id).all()
    return {int(line_id): int(qty or 0) for line_id, qty in rows}


def _remaining_fulfillment_qty(
    db: Session, order: SalesOrder, *, already: dict[int, int] | None = None
) -> int:
    if is_remaining_closed(order):
        return 0
    done = already if already is not None else _fulfilled_qty_by_line(db, order.sales_order_id)
    remaining = 0
    for so_line in order.items or []:
        remaining += max(
            0,
            int(so_line.quantity_ordered) - done.get(int(so_line.so_item_id), 0),
        )
    return remaining


def _shipped_billable_total(db: Session, order: SalesOrder) -> Decimal:
    shipped = _fulfilled_qty_by_line(db, order.sales_order_id, statuses={"SHIPPED"})
    total = Decimal("0.00")
    for so_line in order.items or []:
        ordered = int(so_line.quantity_ordered or 0)
        if ordered <= 0:
            continue
        shipped_qty = min(shipped.get(int(so_line.so_item_id), 0), ordered)
        if shipped_qty <= 0:
            continue
        total += _money(so_line.total_amount) * Decimal(shipped_qty) / Decimal(ordered)
    return _money(total)


def invoice_quantity_for_so_line(
    *,
    quantity_ordered: int,
    shipped_qty: int,
    remaining_closed: bool,
    amount_only: bool,
) -> int:
    """Invoice shipped qty after a partial ship; leftover cancelled qty stays off the bill."""
    ordered = int(quantity_ordered or 0)
    shipped = max(0, int(shipped_qty or 0))
    if remaining_closed or shipped > 0:
        if ordered > 0:
            return min(shipped, ordered)
        return shipped
    if amount_only:
        return ordered
    return 0


def sales_order_can_close_remaining(db: Session, order: SalesOrder) -> bool:
    status = _normalize_so_flag(getattr(order, "status", None))
    if is_remaining_closed(order) or status in {"CANCELLED", "INVOICED", "FULFILLED"}:
        return False
    if _normalize_so_flag(getattr(order, "approval_status", None)) != "APPROVED":
        return False
    shipped = sum(_fulfilled_qty_by_line(db, order.sales_order_id, statuses={"SHIPPED"}).values())
    remaining = _remaining_fulfillment_qty(db, order)
    return shipped > 0 and remaining > 0


def close_sales_order_remaining(db: Session, sales_order_id: str) -> SalesOrder:
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.items))
        .filter(SalesOrder.sales_order_id == sales_order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")
    if is_remaining_closed(order):
        raise HTTPException(status_code=400, detail=REMAINING_ALREADY_CLOSED_DETAIL)
    status = _normalize_so_flag(getattr(order, "status", None))
    if status in {"CANCELLED", "INVOICED"}:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel remaining quantity on a {status.lower()} sales order.",
        )
    if _normalize_so_flag(getattr(order, "approval_status", None)) != "APPROVED":
        raise HTTPException(status_code=400, detail="Sales order must be APPROVED to cancel remaining")
    shipped = sum(_fulfilled_qty_by_line(db, order.sales_order_id, statuses={"SHIPPED"}).values())
    remaining = _remaining_fulfillment_qty(db, order)
    assert_can_close_remaining(progressed=shipped, remaining=remaining)
    if remaining <= 0:
        raise HTTPException(status_code=400, detail=NO_OPEN_REMAINING_DETAIL)
    order.remaining_closed = True
    order.remaining_closed_at = datetime.utcnow()
    order.closed_billable_amount = _shipped_billable_total(db, order)
    if status not in {"INVOICED", "CANCELLED"}:
        order.status = "FULFILLED"
    db.flush()
    attach_sales_order_billing(db, [order])
    return order


def _assert_fulfillment_record_within_ordered(db: Session, fulfillment: ItemFulfillment) -> None:
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.items))
        .filter(SalesOrder.sales_order_id == fulfillment.sales_order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")
    so_lines = {int(li.so_item_id): li for li in (order.items or [])}
    already = _fulfilled_qty_by_line(
        db,
        fulfillment.sales_order_id,
        exclude_fulfillment_id=fulfillment.id,
    )
    sco_caps = subcontract_receipt_caps(db, fulfillment.sales_order_id)
    pending: dict[int, int] = {}
    for line in fulfillment.lines or []:
        line_id = int(line.sales_order_line_id)
        qty = int(line.quantity_fulfilled)
        so_line = so_lines.get(line_id)
        if not so_line:
            raise HTTPException(
                status_code=400,
                detail=f"Sales order line {line_id} not found on {fulfillment.sales_order_id}",
            )
        prior = already.get(line_id, 0) + pending.get(line_id, 0)
        assert_fulfillment_qty_within_ordered(
            item_id=so_line.item_id,
            ordered=int(so_line.quantity_ordered),
            already=prior,
            qty=qty,
        )
        if line_id in sco_caps:
            received, sco_numbers = sco_caps[line_id]
            assert_fulfillment_qty_within_sco_received(
                item_id=so_line.item_id,
                received=received,
                already=prior,
                qty=qty,
                sco_numbers=sco_numbers,
            )
        pending[line_id] = pending.get(line_id, 0) + qty


def serialize_fulfillment(row: ItemFulfillment) -> dict:
    return {
        "id": row.id,
        "fulfillment_number": row.fulfillment_number,
        "sales_order_id": row.sales_order_id,
        "customer_id": row.customer_id,
        "customer_name": row.customer.company_name if row.customer else None,
        "status": row.status,
        "shipped_date": row.shipped_date,
        "carrier": row.carrier,
        "tracking_number": row.tracking_number,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "lines": [
            {
                "id": line.id,
                "fulfillment_id": line.fulfillment_id,
                "sales_order_line_id": line.sales_order_line_id,
                "item_id": line.item_id,
                "quantity_fulfilled": line.quantity_fulfilled,
            }
            for line in (row.lines or [])
        ],
    }


def serialize_sales_invoice(row: SalesInvoice) -> dict:
    return {
        "id": row.id,
        "invoice_number": row.invoice_number,
        "sales_order_id": row.sales_order_id,
        "fulfillment_id": row.fulfillment_id,
        "customer_id": row.customer_id,
        "customer_name": row.customer.company_name if row.customer else None,
        "status": row.status,
        "issue_date": row.issue_date,
        "due_date": row.due_date,
        "payment_terms": row.payment_terms,
        "payment_term_id": getattr(row, "payment_term_id", None),
        "subtotal": row.subtotal,
        "tax_amount": row.tax_amount,
        "total_amount": row.total_amount,
        "outstanding_balance": row.outstanding_balance,
        "ar_invoice_id": row.ar_invoice_id,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "lines": [
            {
                "id": line.id,
                "invoice_id": line.invoice_id,
                "item_id": line.item_id,
                "description": line.description,
                "quantity": line.quantity,
                "unit_price": line.unit_price,
                "line_subtotal": line.line_subtotal,
            }
            for line in (row.lines or [])
        ],
    }


def list_fulfillments(db: Session, skip: int = 0, limit: int = 100) -> list[dict]:
    rows = (
        db.query(ItemFulfillment)
        .options(
            joinedload(ItemFulfillment.lines),
            joinedload(ItemFulfillment.customer),
        )
        .order_by(ItemFulfillment.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [serialize_fulfillment(r) for r in rows]


def create_fulfillment(
    db: Session,
    *,
    sales_order_id: str,
    lines: list[dict],
    carrier: str | None = None,
    tracking_number: str | None = None,
    status: str = "DRAFT",
) -> dict:
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.items))
        .filter(SalesOrder.sales_order_id == sales_order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")
    if (order.approval_status or "").upper() != "APPROVED":
        raise HTTPException(status_code=400, detail="Sales order must be APPROVED to fulfill")
    if is_remaining_closed(order):
        raise HTTPException(status_code=400, detail=REMAINING_CLOSED_FULFILL_DETAIL)

    if not lines:
        raise HTTPException(status_code=400, detail="At least one fulfillment line is required")

    so_lines = {int(li.so_item_id): li for li in (order.items or [])}
    already = _fulfilled_qty_by_line(db, sales_order_id)
    sco_caps = subcontract_receipt_caps(db, sales_order_id)
    pending: dict[int, int] = {}

    fulfillment = ItemFulfillment(
        fulfillment_number=generate_document_number(db, DOC_FULFILLMENT),
        sales_order_id=order.sales_order_id,
        customer_id=order.customer_id,
        status="DRAFT",
        carrier=carrier,
        tracking_number=tracking_number,
    )
    db.add(fulfillment)
    db.flush()

    for raw in lines:
        line_id = int(raw["sales_order_line_id"])
        qty = int(raw["quantity_fulfilled"])
        so_line = so_lines.get(line_id)
        if not so_line:
            raise HTTPException(
                status_code=400,
                detail=f"Sales order line {line_id} not found on {sales_order_id}",
            )
        prior = already.get(line_id, 0) + pending.get(line_id, 0)
        assert_fulfillment_qty_within_ordered(
            item_id=so_line.item_id,
            ordered=int(so_line.quantity_ordered),
            already=prior,
            qty=qty,
        )
        if line_id in sco_caps:
            received, sco_numbers = sco_caps[line_id]
            assert_fulfillment_qty_within_sco_received(
                item_id=so_line.item_id,
                received=received,
                already=prior,
                qty=qty,
                sco_numbers=sco_numbers,
            )
        pending[line_id] = pending.get(line_id, 0) + qty
        db.add(
            ItemFulfillmentLine(
                fulfillment_id=fulfillment.id,
                sales_order_line_id=line_id,
                item_id=so_line.item_id,
                quantity_fulfilled=qty,
            )
        )

    db.flush()
    if status and status != "DRAFT":
        return update_fulfillment_status(
            db,
            fulfillment.id,
            status=status,
            shipped_date=date.today() if status == "SHIPPED" else None,
            carrier=carrier,
            tracking_number=tracking_number,
        )

    fulfillment = _load_fulfillment(db, fulfillment.id)
    return serialize_fulfillment(fulfillment)


def update_fulfillment_status(
    db: Session,
    fulfillment_id: int,
    *,
    status: str,
    shipped_date: date | None = None,
    carrier: str | None = None,
    tracking_number: str | None = None,
) -> dict:
    fulfillment = _load_fulfillment(db, fulfillment_id)
    allowed = {"DRAFT", "PICKED", "PACKED", "SHIPPED"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid status {status}")

    previous = fulfillment.status
    if previous == "SHIPPED" and status != "SHIPPED":
        raise HTTPException(status_code=400, detail="Shipped fulfillments cannot be reverted")

    if status in _COMMITTED_FULFILLMENT_STATUSES:
        _assert_fulfillment_record_within_ordered(db, fulfillment)

    if carrier is not None:
        fulfillment.carrier = carrier
    if tracking_number is not None:
        fulfillment.tracking_number = tracking_number

    if status == "SHIPPED" and previous != "SHIPPED":
        assert_transaction_date_open(
            db, shipped_date or date.today(), document="item fulfillment"
        )
        for line in fulfillment.lines:
            if skip_inventory_movement(catalog_item(db, line.item_id)):
                continue
            if int(line.quantity_fulfilled) <= 0:
                continue
            inventory.issue_stock(
                db,
                item_id=line.item_id,
                quantity=int(line.quantity_fulfilled),
                reference=fulfillment.fulfillment_number,
                notes=f"Fulfillment shipment for SO {fulfillment.sales_order_id}",
            )
        fulfillment.shipped_date = shipped_date or date.today()
        order = (
            db.query(SalesOrder)
            .options(joinedload(SalesOrder.items))
            .filter(SalesOrder.sales_order_id == fulfillment.sales_order_id)
            .first()
        )
        if order and (order.status or "").upper() not in {"INVOICED", "CANCELLED"}:
            remaining = _remaining_fulfillment_qty(db, order)
            order.status = "FULFILLED" if remaining <= 0 else "PARTIALLY_FULFILLED"

    fulfillment.status = status
    fulfillment.updated_at = datetime.utcnow()
    db.flush()
    return serialize_fulfillment(_load_fulfillment(db, fulfillment_id))


def assert_fulfillment_can_be_deleted(fulfillment: ItemFulfillment) -> None:
    status = (getattr(fulfillment, "status", None) or "").upper()
    if status != "DRAFT":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Only draft fulfillments can be deleted "
                f"(current: {status}). Picked, packed, and shipped records cannot be removed."
            ),
        )


def update_fulfillment_lines(
    db: Session,
    fulfillment_id: int,
    lines: list[dict],
) -> dict:
    fulfillment = _load_fulfillment(db, fulfillment_id)
    if (fulfillment.status or "").upper() != "DRAFT":
        raise HTTPException(
            status_code=400,
            detail="Only draft fulfillments can change shipment quantities.",
        )
    if not lines:
        raise HTTPException(status_code=400, detail="At least one fulfillment line is required")
    by_so_line = {int(line.sales_order_line_id): line for line in fulfillment.lines or []}
    for raw in lines:
        line_id = int(raw["sales_order_line_id"])
        qty = int(raw["quantity_fulfilled"])
        row = by_so_line.get(line_id)
        if row is None:
            raise HTTPException(
                status_code=400,
                detail=f"Fulfillment line for sales order line {line_id} was not found",
            )
        row.quantity_fulfilled = qty
    db.flush()
    _assert_fulfillment_record_within_ordered(db, _load_fulfillment(db, fulfillment_id))
    fulfillment.updated_at = datetime.utcnow()
    db.flush()
    return serialize_fulfillment(_load_fulfillment(db, fulfillment_id))


def delete_fulfillment(db: Session, fulfillment_id: int) -> None:
    fulfillment = _load_fulfillment(db, fulfillment_id)
    assert_fulfillment_can_be_deleted(fulfillment)
    linked_invoice = (
        db.query(SalesInvoice.id)
        .filter(SalesInvoice.fulfillment_id == fulfillment.id)
        .first()
    )
    if linked_invoice is not None:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a fulfillment that has a sales invoice",
        )
    for line in list(fulfillment.lines or []):
        db.delete(line)
    db.flush()
    db.delete(fulfillment)
    db.flush()


def list_sales_invoices(db: Session, skip: int = 0, limit: int = 100) -> list[dict]:
    rows = (
        db.query(SalesInvoice)
        .options(
            joinedload(SalesInvoice.lines),
            joinedload(SalesInvoice.customer),
        )
        .order_by(SalesInvoice.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [serialize_sales_invoice(r) for r in rows]


def create_sales_invoice(
    db: Session,
    *,
    sales_order_id: str,
    fulfillment_id: int | None = None,
    issue_date: date | None = None,
    payment_terms: str | None = None,
    payment_term_id=None,
    line_overrides: list[dict] | None = None,
) -> dict:
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.items).joinedload(SalesOrderItem.item))
        .filter(SalesOrder.sales_order_id == sales_order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")
    if (order.approval_status or "").upper() != "APPROVED":
        raise HTTPException(status_code=400, detail="Sales order must be APPROVED")

    already_billed = billed_amount_for_order(db, sales_order_id)
    if already_billed >= _billable_order_total(db, order):
        raise HTTPException(
            status_code=400,
            detail=f"Sales Order {sales_order_id} is already fully invoiced.",
        )

    shipped = (
        db.query(ItemFulfillment)
        .filter(
            ItemFulfillment.sales_order_id == sales_order_id,
            ItemFulfillment.status == "SHIPPED",
        )
        .count()
    )
    stock_lines = [
        li
        for li in (order.items or [])
        if not skip_inventory_movement(catalog_item(db, li.item_id))
    ]
    if shipped == 0 and fulfillment_id is None and stock_lines:
        raise HTTPException(
            status_code=400,
            detail="Create a shipped fulfillment before invoicing this sales order",
        )

    fulfillment = None
    if fulfillment_id is not None:
        fulfillment = _load_fulfillment(db, fulfillment_id)
        if fulfillment.sales_order_id != sales_order_id:
            raise HTTPException(status_code=400, detail="Fulfillment does not belong to sales order")
        if fulfillment.status != "SHIPPED":
            raise HTTPException(status_code=400, detail="Fulfillment must be SHIPPED before invoicing")

    issue = issue_date or date.today()
    assert_transaction_date_open(db, issue, document="sales invoice")
    due, term = apply_due_date(
        db,
        invoice_date=issue,
        payment_term_id=payment_term_id,
        payment_terms=payment_terms,
        fallback=order,
    )

    invoice = SalesInvoice(
        invoice_number=generate_document_number(db, DOC_INVOICE, issue),
        sales_order_id=sales_order_id,
        fulfillment_id=fulfillment.id if fulfillment else None,
        customer_id=order.customer_id,
        status="DRAFT",
        issue_date=issue,
        due_date=due,
        payment_terms=payment_terms or order.payment_terms,
        payment_term_id=payment_term_id,
    )
    apply_payment_term_fields(
        db,
        invoice,
        payment_term_id=payment_term_id or (term.id if term else None),
        payment_terms=payment_terms,
        fallback=order,
    )
    db.add(invoice)
    db.flush()

    so_lines = {int(li.so_item_id): li for li in (order.items or [])}
    built_lines: list[SalesInvoiceLine] = []

    if line_overrides:
        for raw in line_overrides:
            item_id = raw["item_id"]
            qty = int(raw["quantity"])
            unit_price = Decimal(str(raw.get("unit_price", 0)))
            description = raw.get("description")
            item = db.get(Item, item_id)
            line_subtotal = (unit_price * qty).quantize(Decimal("0.01"))
            built_lines.append(
                SalesInvoiceLine(
                    invoice_id=invoice.id,
                    item_id=item_id,
                    description=description or (item.description if item else item_id),
                    quantity=qty,
                    unit_price=unit_price,
                    line_subtotal=line_subtotal,
                )
            )
    elif fulfillment:
        for fl in fulfillment.lines:
            so_line = so_lines.get(int(fl.sales_order_line_id))
            unit_price = Decimal(str(so_line.unit_price)) if so_line else Decimal("0")
            qty = int(fl.quantity_fulfilled)
            item = db.get(Item, fl.item_id)
            built_lines.append(
                SalesInvoiceLine(
                    invoice_id=invoice.id,
                    item_id=fl.item_id,
                    description=item.description if item else fl.item_id,
                    quantity=qty,
                    unit_price=unit_price,
                    line_subtotal=(unit_price * qty).quantize(Decimal("0.01")),
                )
            )
        fulfilled_ids = {int(fl.sales_order_line_id) for fl in fulfillment.lines}
        for so_line in order.items or []:
            if int(so_line.so_item_id) in fulfilled_ids:
                continue
            if not skip_inventory_movement(catalog_item(db, so_line.item_id)):
                continue
            unit_price = Decimal(str(so_line.unit_price))
            qty = int(so_line.quantity_ordered)
            item = so_line.item
            if qty == 0:
                line_subtotal = _money(so_line.total_amount) - _money(so_line.tax_amount)
            else:
                line_subtotal = (unit_price * qty).quantize(Decimal("0.01"))
            built_lines.append(
                SalesInvoiceLine(
                    invoice_id=invoice.id,
                    item_id=so_line.item_id,
                    description=item.description if item else so_line.item_id,
                    quantity=qty,
                    unit_price=unit_price,
                    line_subtotal=line_subtotal,
                )
            )
    else:
        shipped_by_line = _fulfilled_qty_by_line(db, sales_order_id, statuses={"SHIPPED"})
        remaining_closed = is_remaining_closed(order)
        for so_line in order.items or []:
            amount_only = skip_inventory_movement(catalog_item(db, so_line.item_id))
            qty = invoice_quantity_for_so_line(
                quantity_ordered=int(so_line.quantity_ordered or 0),
                shipped_qty=shipped_by_line.get(int(so_line.so_item_id), 0),
                remaining_closed=remaining_closed,
                amount_only=amount_only,
            )
            unit_price = Decimal(str(so_line.unit_price))
            item = so_line.item
            if qty == 0:
                if not amount_only:
                    continue
                line_subtotal = _money(so_line.total_amount) - _money(so_line.tax_amount)
            else:
                line_subtotal = (unit_price * qty).quantize(Decimal("0.01"))
            built_lines.append(
                SalesInvoiceLine(
                    invoice_id=invoice.id,
                    item_id=so_line.item_id,
                    description=item.description if item else so_line.item_id,
                    quantity=qty,
                    unit_price=unit_price,
                    line_subtotal=line_subtotal,
                )
            )

    if not built_lines:
        raise HTTPException(status_code=400, detail="Invoice requires at least one line")

    for line in built_lines:
        db.add(line)

    subtotal = sum((line.line_subtotal for line in built_lines), Decimal("0"))
    # Allocate tax proportionally from SO line taxes when available
    tax_amount = Decimal("0")
    if order.items:
        ordered_total = sum(Decimal(str(li.total_amount or 0)) for li in order.items) or Decimal("1")
        so_tax = sum(Decimal(str(li.tax_amount or 0)) for li in order.items)
        tax_amount = (so_tax * (subtotal / ordered_total)).quantize(Decimal("0.01"))

    invoice.subtotal = subtotal
    invoice.tax_amount = tax_amount
    invoice.total_amount = (subtotal + tax_amount).quantize(Decimal("0.01"))
    invoice.outstanding_balance = invoice.total_amount
    assert_new_invoice_within_order_balance(
        sales_order_id=sales_order_id,
        order_total=_billable_order_total(db, order),
        billed_amount=already_billed,
        new_invoice_amount=invoice.total_amount,
    )
    db.flush()
    return serialize_sales_invoice(_load_sales_invoice(db, invoice.id))


def approve_sales_invoice(db: Session, invoice_id: int) -> dict:
    invoice = _load_sales_invoice(db, invoice_id)
    if invoice.status == "VOID":
        raise HTTPException(status_code=400, detail="Cannot approve a void invoice")
    if invoice.status == "APPROVED":
        return serialize_sales_invoice(invoice)
    if invoice.status == "PAID":
        raise HTTPException(status_code=400, detail="Invoice is already paid")

    ar_account, revenue_account, revenue_rule = resolve_posting_rule(
        db, EVENT_SALES_INVOICE, VARIANT_REVENUE, None
    )
    _tax_ar, tax_account, tax_rule = resolve_posting_rule(
        db, EVENT_SALES_INVOICE, VARIANT_TAX, None
    )

    # Dr AR for total; Cr Revenue for subtotal; Cr Tax Payable for tax
    total = Decimal(str(invoice.total_amount))
    subtotal = Decimal(str(invoice.subtotal))
    tax = Decimal(str(invoice.tax_amount))
    if total <= 0:
        raise HTTPException(status_code=400, detail="Invoice total must be positive")

    invoice_source = {
        "reference": invoice.invoice_number,
        "source_document_type": SOURCE_SALES_INVOICE,
        "source_record_id": invoice.invoice_number,
    }
    if tax > 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Sales invoice {invoice.invoice_number} revenue",
            debit_account=ar_account,
            credit_account=revenue_account,
            amount=subtotal,
            posting_rule_id=rule_id(revenue_rule),
            **invoice_source,
        )
        finance._post_balanced_journal_entry(
            db,
            description=f"Sales invoice {invoice.invoice_number} tax",
            debit_account=ar_account,
            credit_account=tax_account,
            amount=tax,
            posting_rule_id=rule_id(tax_rule),
            **invoice_source,
        )
    else:
        finance._post_balanced_journal_entry(
            db,
            description=f"Sales invoice {invoice.invoice_number}",
            debit_account=ar_account,
            credit_account=revenue_account,
            amount=total,
            posting_rule_id=rule_id(revenue_rule),
            **invoice_source,
        )

    # Mirror into AR invoices for payment tracking using the Sales Invoice number
    # (USS5-YYMMXXXX) so Accounts Receivable shows the same document id.
    ar = db.get(ARInvoice, invoice.invoice_number)
    if ar is None and invoice.ar_invoice_id:
        ar = db.get(ARInvoice, invoice.ar_invoice_id)
    if ar is None:
        ar = ARInvoice(
            invoice_id=invoice.invoice_number,
            sales_order_id=invoice.sales_order_id,
            customer_id=invoice.customer_id,
            amount=total,
            status="Unpaid",
            approval_status="APPROVED",
            due_date=invoice.due_date,
        )
        db.add(ar)
        db.flush()
    elif ar.invoice_id != invoice.invoice_number:
        # Normalize older random ARINV-* rows onto the INV-* identity.
        canonical = ARInvoice(
            invoice_id=invoice.invoice_number,
            sales_order_id=invoice.sales_order_id,
            customer_id=invoice.customer_id,
            amount=total,
            status=ar.status if ar.status in ("Unpaid", "Partial", "Paid") else "Unpaid",
            approval_status="APPROVED",
            due_date=invoice.due_date,
        )
        db.add(canonical)
        db.flush()
        old_id = ar.invoice_id
        ar = canonical
        # Drop the superseded unpaid random AR if nothing else references it.
        still_linked = (
            db.query(SalesInvoice)
            .filter(SalesInvoice.ar_invoice_id == old_id, SalesInvoice.id != invoice.id)
            .count()
        )
        if still_linked == 0:
            obsolete = db.get(ARInvoice, old_id)
            if obsolete is not None and obsolete.status == "Unpaid":
                db.delete(obsolete)

    ar.amount = total
    ar.due_date = invoice.due_date
    ar.approval_status = "APPROVED"
    if ar.status not in ("Paid", "Partial"):
        ar.status = "Unpaid"
    invoice.ar_invoice_id = ar.invoice_id

    # Clean legacy unpaid duplicates for this SO (from auto-AR-on-SO-approve).
    legacy_dupes = (
        db.query(ARInvoice)
        .filter(
            ARInvoice.sales_order_id == invoice.sales_order_id,
            ARInvoice.invoice_id != invoice.invoice_number,
            ARInvoice.status == "Unpaid",
        )
        .all()
    )
    for dupe in legacy_dupes:
        if Decimal(str(dupe.amount)) != total:
            continue
        linked = (
            db.query(SalesInvoice)
            .filter(SalesInvoice.ar_invoice_id == dupe.invoice_id)
            .count()
        )
        if linked == 0:
            db.delete(dupe)

    invoice.status = "APPROVED"
    invoice.outstanding_balance = total
    invoice.updated_at = datetime.utcnow()
    sync_sales_order_invoice_status(db, db.get(SalesOrder, invoice.sales_order_id))

    db.flush()
    return serialize_sales_invoice(_load_sales_invoice(db, invoice_id))


def void_sales_invoice(db: Session, invoice_id: int) -> dict:
    invoice = _load_sales_invoice(db, invoice_id)
    if invoice.status == "PAID":
        raise HTTPException(status_code=400, detail="Paid invoices cannot be voided")
    invoice.status = "VOID"
    invoice.outstanding_balance = Decimal("0")
    invoice.updated_at = datetime.utcnow()
    sync_sales_order_invoice_status(db, db.get(SalesOrder, invoice.sales_order_id))
    db.flush()
    return serialize_sales_invoice(invoice)
