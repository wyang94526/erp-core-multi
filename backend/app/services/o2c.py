"""Order-to-Cash: item fulfillments and sales invoices."""

from __future__ import annotations

from datetime import date, datetime, timedelta
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
)
from app.services.document_sequences import DOC_INVOICE, generate_document_number
from app.services import finance, inventory
from app.services.finance import (
    AR_ACCOUNT_CODE,
    AR_ACCOUNT_NAME,
    _parse_payment_terms_days,
    get_or_create_account,
)

REVENUE_ACCOUNT_CODE = "4000"
REVENUE_ACCOUNT_NAME = "Sales Revenue"
TAX_PAYABLE_ACCOUNT_CODE = "2100"
TAX_PAYABLE_ACCOUNT_NAME = "Sales Tax Payable"

ACTIVE_SALES_INVOICE_STATUSES = ("DRAFT", "APPROVED", "PAID")
_MONEY = Decimal("0.01")


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
        order_total = _money(order.total_amount)
        remaining = max(order_total - billed, Decimal("0.00"))
        order.billed_amount = billed
        order.remaining_billable_amount = remaining
        order.invoice_status = invoice_status_label(order_total, billed)


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


def sync_sales_order_invoice_status(db: Session, order: SalesOrder | None) -> None:
    if order is None or (order.status or "").upper() == "CANCELLED":
        return
    billed = billed_amount_for_order(db, order.sales_order_id)
    order_total = _money(order.total_amount)
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
    order.status = "FULFILLED" if shipped else "APPROVED"


def _next_number(db: Session, model, field, prefix: str) -> str:
    year = date.today().year
    like = f"{prefix}-{year}-%"
    latest = (
        db.query(getattr(model, field))
        .filter(getattr(model, field).like(like))
        .order_by(getattr(model, field).desc())
        .first()
    )
    seq = 1
    if latest and latest[0]:
        try:
            seq = int(str(latest[0]).rsplit("-", 1)[-1]) + 1
        except ValueError:
            seq = 1
    return f"{prefix}-{year}-{seq:04d}"


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


def _fulfilled_qty_by_line(db: Session, sales_order_id: str) -> dict[int, int]:
    rows = (
        db.query(
            ItemFulfillmentLine.sales_order_line_id,
            func.coalesce(func.sum(ItemFulfillmentLine.quantity_fulfilled), 0),
        )
        .join(ItemFulfillment)
        .filter(
            ItemFulfillment.sales_order_id == sales_order_id,
            ItemFulfillment.status != "DRAFT",
        )
        .group_by(ItemFulfillmentLine.sales_order_line_id)
        .all()
    )
    return {int(line_id): int(qty or 0) for line_id, qty in rows}


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

    if not lines:
        raise HTTPException(status_code=400, detail="At least one fulfillment line is required")

    so_lines = {int(li.so_item_id): li for li in (order.items or [])}
    already = _fulfilled_qty_by_line(db, sales_order_id)

    fulfillment = ItemFulfillment(
        fulfillment_number=_next_number(db, ItemFulfillment, "fulfillment_number", "FUL"),
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
        remaining = int(so_line.quantity_ordered) - already.get(line_id, 0)
        if qty <= 0:
            raise HTTPException(status_code=400, detail="quantity_fulfilled must be positive")
        if qty > remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Quantity {qty} exceeds remaining {remaining} for line {line_id}",
            )
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

    if carrier is not None:
        fulfillment.carrier = carrier
    if tracking_number is not None:
        fulfillment.tracking_number = tracking_number

    if status == "SHIPPED" and previous != "SHIPPED":
        for line in fulfillment.lines:
            inventory.issue_stock(
                db,
                item_id=line.item_id,
                quantity=int(line.quantity_fulfilled),
                reference=fulfillment.fulfillment_number,
                notes=f"Fulfillment shipment for SO {fulfillment.sales_order_id}",
            )
        fulfillment.shipped_date = shipped_date or date.today()
        order = db.get(SalesOrder, fulfillment.sales_order_id)
        if order and (order.status or "").upper() not in {"FULFILLED", "INVOICED", "CANCELLED"}:
            order.status = "FULFILLED"

    fulfillment.status = status
    fulfillment.updated_at = datetime.utcnow()
    db.flush()
    return serialize_fulfillment(_load_fulfillment(db, fulfillment_id))


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
    if already_billed >= _money(order.total_amount):
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
    if shipped == 0 and fulfillment_id is None:
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
    terms = payment_terms or order.payment_terms
    due = issue + timedelta(days=_parse_payment_terms_days(terms))

    invoice = SalesInvoice(
        invoice_number=generate_document_number(db, DOC_INVOICE, issue),
        sales_order_id=sales_order_id,
        fulfillment_id=fulfillment.id if fulfillment else None,
        customer_id=order.customer_id,
        status="DRAFT",
        issue_date=issue,
        due_date=due,
        payment_terms=terms,
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
    else:
        for so_line in order.items or []:
            unit_price = Decimal(str(so_line.unit_price))
            qty = int(so_line.quantity_ordered)
            item = so_line.item
            built_lines.append(
                SalesInvoiceLine(
                    invoice_id=invoice.id,
                    item_id=so_line.item_id,
                    description=item.description if item else so_line.item_id,
                    quantity=qty,
                    unit_price=unit_price,
                    line_subtotal=(unit_price * qty).quantize(Decimal("0.01")),
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
        order_total=Decimal(str(order.total_amount or 0)),
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

    ar_account = get_or_create_account(db, AR_ACCOUNT_CODE, AR_ACCOUNT_NAME, "Asset")
    revenue_account = get_or_create_account(
        db, REVENUE_ACCOUNT_CODE, REVENUE_ACCOUNT_NAME, "Revenue"
    )
    tax_account = get_or_create_account(
        db, TAX_PAYABLE_ACCOUNT_CODE, TAX_PAYABLE_ACCOUNT_NAME, "Liability"
    )

    # Dr AR for total; Cr Revenue for subtotal; Cr Tax Payable for tax
    total = Decimal(str(invoice.total_amount))
    subtotal = Decimal(str(invoice.subtotal))
    tax = Decimal(str(invoice.tax_amount))
    if total <= 0:
        raise HTTPException(status_code=400, detail="Invoice total must be positive")

    if tax > 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Sales invoice {invoice.invoice_number} revenue",
            debit_account=ar_account,
            credit_account=revenue_account,
            amount=subtotal,
        )
        finance._post_balanced_journal_entry(
            db,
            description=f"Sales invoice {invoice.invoice_number} tax",
            debit_account=ar_account,
            credit_account=tax_account,
            amount=tax,
        )
    else:
        finance._post_balanced_journal_entry(
            db,
            description=f"Sales invoice {invoice.invoice_number}",
            debit_account=ar_account,
            credit_account=revenue_account,
            amount=total,
        )

    # Mirror into AR invoices for payment tracking using the Sales Invoice number
    # (PU65-YYMMXXXX) so Accounts Receivable shows the same document id.
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
