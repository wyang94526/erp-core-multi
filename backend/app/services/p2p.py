"""Procure-to-Pay: goods receipts (GRNI) and supplier invoices (vendor bills)."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    APBill,
    GoodsReceipt,
    GoodsReceiptLine,
    Item,
    PurchaseOrder,
    PurchaseOrderItem,
    SubcontractOrder,
    SupplierInvoice,
    SupplierInvoiceLine,
    VendorItemMapping,
)
from app.services import finance, inventory
from app.services.po_totals import invoice_freight_default
from app.services.finance import (
    AP_ACCOUNT_CODE,
    AP_ACCOUNT_NAME,
    _parse_payment_terms_days,
    get_or_create_account,
)

INVENTORY_ACCOUNT_CODE = "1300"
INVENTORY_ACCOUNT_NAME = "Inventory Asset"
GRNI_ACCOUNT_CODE = "2105"
GRNI_ACCOUNT_NAME = "Accrued Liabilities - GRNI"
PPV_ACCOUNT_CODE = "5100"
PPV_ACCOUNT_NAME = "Purchase Price Variance"
TAX_EXPENSE_ACCOUNT_CODE = "5200"
TAX_EXPENSE_ACCOUNT_NAME = "Freight & Tax Expense"


def _next_number(db: Session, model, field: str, prefix: str) -> str:
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


def _d(value) -> Decimal:
    return Decimal(str(value or 0))


def serialize_goods_receipt(row: GoodsReceipt) -> dict:
    return {
        "id": row.id,
        "receipt_number": row.receipt_number,
        "source_type": row.source_type,
        "source_order_id": row.source_order_id,
        "vendor_id": row.vendor_id,
        "receipt_date": row.receipt_date,
        "status": row.status,
        "notes": row.notes,
        "created_at": row.created_at,
        "lines": [
            {
                "id": line.id,
                "receipt_id": line.receipt_id,
                "source_line_id": line.source_line_id,
                "item_id": line.item_id,
                "description": line.description,
                "quantity_received": line.quantity_received,
                "unit_cost": line.unit_cost,
                "line_amount": line.line_amount,
            }
            for line in (row.lines or [])
        ],
    }


def serialize_supplier_invoice(row: SupplierInvoice) -> dict:
    warnings: list[str] = []
    if row.match_warnings:
        try:
            warnings = json.loads(row.match_warnings)
        except json.JSONDecodeError:
            warnings = [row.match_warnings]
    return {
        "id": row.id,
        "invoice_number": row.invoice_number,
        "vendor_id": row.vendor_id,
        "vendor_name": row.vendor.company_name if row.vendor else None,
        "source_type": row.source_type,
        "source_order_id": row.source_order_id,
        "vendor_invoice_number": row.vendor_invoice_number,
        "invoice_date": row.invoice_date,
        "due_date": row.due_date,
        "status": row.status,
        "subtotal": row.subtotal,
        "tax_amount": row.tax_amount,
        "freight_amount": row.freight_amount,
        "total_amount": row.total_amount,
        "outstanding_balance": row.outstanding_balance,
        "currency": row.currency,
        "ap_bill_id": row.ap_bill_id,
        "match_warnings": warnings,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "lines": [
            {
                "id": line.id,
                "invoice_id": line.invoice_id,
                "source_line_id": line.source_line_id,
                "item_id": line.item_id,
                "description": line.description,
                "quantity_billed": line.quantity_billed,
                "unit_price": line.unit_price,
                "line_subtotal": line.line_subtotal,
                "goods_receipt_line_id": line.goods_receipt_line_id,
            }
            for line in (row.lines or [])
        ],
    }


def _load_invoice(db: Session, invoice_id: int) -> SupplierInvoice:
    row = (
        db.query(SupplierInvoice)
        .options(
            joinedload(SupplierInvoice.lines),
            joinedload(SupplierInvoice.vendor),
        )
        .filter(SupplierInvoice.id == invoice_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Supplier invoice not found")
    return row


def _received_qty_by_item(db: Session, source_type: str, source_order_id: str) -> dict[str, Decimal]:
    rows = (
        db.query(
            GoodsReceiptLine.item_id,
            func.coalesce(func.sum(GoodsReceiptLine.quantity_received), 0),
        )
        .join(GoodsReceipt)
        .filter(
            GoodsReceipt.source_type == source_type,
            GoodsReceipt.source_order_id == source_order_id,
            GoodsReceipt.status == "POSTED",
        )
        .group_by(GoodsReceiptLine.item_id)
        .all()
    )
    return {str(item_id): _d(qty) for item_id, qty in rows}


def _billed_qty_by_item(db: Session, source_type: str, source_order_id: str) -> dict[str, Decimal]:
    rows = (
        db.query(
            SupplierInvoiceLine.item_id,
            func.coalesce(func.sum(SupplierInvoiceLine.quantity_billed), 0),
        )
        .join(SupplierInvoice)
        .filter(
            SupplierInvoice.source_type == source_type,
            SupplierInvoice.source_order_id == source_order_id,
            SupplierInvoice.status.notin_(("CANCELLED",)),
        )
        .group_by(SupplierInvoiceLine.item_id)
        .all()
    )
    return {str(item_id): _d(qty) for item_id, qty in rows}


def _accrued_amount_for_order(db: Session, source_type: str, source_order_id: str) -> Decimal:
    total = (
        db.query(func.coalesce(func.sum(GoodsReceiptLine.line_amount), 0))
        .join(GoodsReceipt)
        .filter(
            GoodsReceipt.source_type == source_type,
            GoodsReceipt.source_order_id == source_order_id,
            GoodsReceipt.status == "POSTED",
        )
        .scalar()
    )
    return _d(total)


def _update_billing_status(db: Session, source_type: str, source_order_id: str) -> None:
    billed = _billed_qty_by_item(db, source_type, source_order_id)
    if source_type == "PURCHASE_ORDER":
        po = db.get(PurchaseOrder, source_order_id)
        if not po:
            return
        ordered = {li.sku: _d(li.quantity) for li in (po.items or [])}
        if not ordered:
            po.billing_status = "UNBILLED"
            return
        any_billed = any(billed.get(sku, 0) > 0 for sku in ordered)
        fully = all(billed.get(sku, 0) >= qty for sku, qty in ordered.items())
        po.billing_status = (
            "FULLY_BILLED" if fully and any_billed else "PARTIALLY_BILLED" if any_billed else "UNBILLED"
        )
    else:
        sco = (
            db.query(SubcontractOrder)
            .options(selectinload(SubcontractOrder.lines))
            .filter(SubcontractOrder.sco_number == source_order_id)
            .first()
        )
        if not sco:
            return
        if sco.lines:
            any_billed = False
            fully = True
            for line in sco.lines:
                qty_billed = billed.get(line.item_id, Decimal("0"))
                if qty_billed > 0:
                    any_billed = True
                if qty_billed < _d(line.quantity_ordered):
                    fully = False
            if not any_billed:
                sco.billing_status = "UNBILLED"
            elif fully:
                sco.billing_status = "FULLY_BILLED"
            else:
                sco.billing_status = "PARTIALLY_BILLED"
        else:
            qty_billed = billed.get(sco.item_id, Decimal("0"))
            if qty_billed <= 0:
                sco.billing_status = "UNBILLED"
            elif qty_billed >= _d(sco.quantity_ordered):
                sco.billing_status = "FULLY_BILLED"
            else:
                sco.billing_status = "PARTIALLY_BILLED"


def receive_purchase_order(
    db: Session,
    *,
    po_number: str,
    lines: list[dict],
    receipt_date: date | None = None,
    notes: str | None = None,
) -> dict:
    po = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items))
        .filter(PurchaseOrder.po_number == po_number)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if (po.approval_status or "").upper() != "APPROVED" and (po.status or "") != "Approved":
        raise HTTPException(status_code=400, detail="Purchase order must be APPROVED to receive")
    if not lines:
        raise HTTPException(status_code=400, detail="At least one receipt line is required")

    so_lines = {int(li.item_id): li for li in (po.items or [])}
    already = _received_qty_by_item(db, "PURCHASE_ORDER", po_number)

    receipt = GoodsReceipt(
        receipt_number=_next_number(db, GoodsReceipt, "receipt_number", "GR"),
        source_type="PURCHASE_ORDER",
        source_order_id=po.po_number,
        vendor_id=po.supplier_id,
        receipt_date=receipt_date or date.today(),
        status="POSTED",
        notes=notes,
    )
    db.add(receipt)
    db.flush()

    inventory_account = get_or_create_account(
        db, INVENTORY_ACCOUNT_CODE, INVENTORY_ACCOUNT_NAME, "Asset"
    )
    grni_account = get_or_create_account(db, GRNI_ACCOUNT_CODE, GRNI_ACCOUNT_NAME, "Liability")
    total_accrual = Decimal("0")

    for raw in lines:
        line_id = int(raw["source_line_id"])
        qty = _d(raw["quantity_received"])
        po_line = so_lines.get(line_id)
        if not po_line:
            raise HTTPException(status_code=400, detail=f"PO line {line_id} not found")
        remaining = _d(po_line.quantity) - already.get(po_line.sku, Decimal("0"))
        if qty <= 0:
            raise HTTPException(status_code=400, detail="quantity_received must be positive")
        if qty > remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Quantity {qty} exceeds remaining receivable {remaining} for {po_line.sku}",
            )
        unit_cost = _d(raw.get("unit_cost", po_line.unit_price))
        line_amount = (unit_cost * qty).quantize(Decimal("0.01"))
        total_accrual += line_amount
        db.add(
            GoodsReceiptLine(
                receipt_id=receipt.id,
                source_line_id=line_id,
                item_id=po_line.sku,
                description=po_line.sku,
                quantity_received=qty,
                unit_cost=unit_cost,
                line_amount=line_amount,
            )
        )
        # Inventory qty is integer in stock tables — round down for fractional only if needed
        qty_int = int(qty) if qty == qty.to_integral_value() else max(1, int(qty))
        if qty == qty.to_integral_value():
            inventory.receive_stock(
                db,
                item_id=po_line.sku,
                quantity=qty_int,
                reference=receipt.receipt_number,
                notes=f"PO receipt {po.po_number}",
            )
        else:
            # Still bump catalog on_hand when stock location missing fractional support
            item = db.get(Item, po_line.sku)
            if item:
                item.on_hand_quantity = int(_d(item.on_hand_quantity) + qty)

    db.flush()
    if total_accrual > 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Goods receipt {receipt.receipt_number} for PO {po.po_number}",
            debit_account=inventory_account,
            credit_account=grni_account,
            amount=total_accrual,
        )

    receipt = (
        db.query(GoodsReceipt)
        .options(joinedload(GoodsReceipt.lines))
        .filter(GoodsReceipt.id == receipt.id)
        .first()
    )
    return serialize_goods_receipt(receipt)


def accrue_subcontract_receipt(
    db: Session,
    *,
    sco: SubcontractOrder,
    quantity_received: int,
    unit_cost: Decimal | None = None,
    receipt_date: date | None = None,
    notes: str | None = None,
    external_receipt_id: str | None = None,
    item_id: str | None = None,
    source_line_id: int | None = None,
) -> dict:
    """Post GRNI accrual when finished goods are received on a subcontract order."""
    fg_item_id = item_id or sco.item_id
    cost = unit_cost if unit_cost is not None else _d(sco.unit_price)
    if cost <= 0:
        mapping = (
            db.query(VendorItemMapping)
            .filter(
                VendorItemMapping.supplier_id == sco.supplier_id,
                VendorItemMapping.item_id == fg_item_id,
            )
            .first()
        )
        if mapping and mapping.unit_cost is not None:
            cost = _d(mapping.unit_cost)

    receipt = GoodsReceipt(
        receipt_number=external_receipt_id
        or _next_number(db, GoodsReceipt, "receipt_number", "GR"),
        source_type="SUBCONTRACT_ORDER",
        source_order_id=sco.sco_number,
        vendor_id=sco.supplier_id,
        receipt_date=receipt_date or date.today(),
        status="POSTED",
        notes=notes,
    )
    db.add(receipt)
    db.flush()

    line_amount = (cost * Decimal(quantity_received)).quantize(Decimal("0.01"))
    db.add(
        GoodsReceiptLine(
            receipt_id=receipt.id,
            source_line_id=source_line_id,
            item_id=fg_item_id,
            description=f"Subcontract FG {fg_item_id}",
            quantity_received=Decimal(quantity_received),
            unit_cost=cost,
            line_amount=line_amount,
        )
    )
    db.flush()

    if line_amount > 0:
        inventory_account = get_or_create_account(
            db, INVENTORY_ACCOUNT_CODE, INVENTORY_ACCOUNT_NAME, "Asset"
        )
        grni_account = get_or_create_account(db, GRNI_ACCOUNT_CODE, GRNI_ACCOUNT_NAME, "Liability")
        finance._post_balanced_journal_entry(
            db,
            description=f"Goods receipt {receipt.receipt_number} for SCO {sco.sco_number}",
            debit_account=inventory_account,
            credit_account=grni_account,
            amount=line_amount,
        )

    receipt = (
        db.query(GoodsReceipt)
        .options(joinedload(GoodsReceipt.lines))
        .filter(GoodsReceipt.id == receipt.id)
        .first()
    )
    return serialize_goods_receipt(receipt)


def list_supplier_invoices(
    db: Session,
    *,
    skip: int = 0,
    limit: int = 100,
    source_type: str | None = None,
    status: str | None = None,
    vendor_id: str | None = None,
    source_order_id: str | None = None,
) -> list[dict]:
    def _clean(value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text or text.lower() in {"undefined", "null", "none", "all"}:
            return None
        return text

    source_type = _clean(source_type)
    status = _clean(status)
    vendor_id = _clean(vendor_id)
    source_order_id = _clean(source_order_id)

    q = (
        db.query(SupplierInvoice)
        .options(joinedload(SupplierInvoice.lines), joinedload(SupplierInvoice.vendor))
        .order_by(SupplierInvoice.created_at.desc())
    )
    if source_type:
        q = q.filter(SupplierInvoice.source_type == source_type)
    if status:
        q = q.filter(SupplierInvoice.status == status)
    if vendor_id:
        q = q.filter(SupplierInvoice.vendor_id == vendor_id)
    if source_order_id:
        q = q.filter(SupplierInvoice.source_order_id == source_order_id)
    return [serialize_supplier_invoice(r) for r in q.offset(skip).limit(limit).all()]


def create_supplier_invoice(
    db: Session,
    *,
    source_type: str,
    source_order_id: str,
    vendor_invoice_number: str | None = None,
    invoice_date: date | None = None,
    due_date: date | None = None,
    tax_amount: Decimal | None = None,
    freight_amount: Decimal | None = None,
    currency: str = "USD",
    lines: list[dict] | None = None,
) -> dict:
    if source_type not in {"PURCHASE_ORDER", "SUBCONTRACT_ORDER"}:
        raise HTTPException(status_code=400, detail="Invalid source_type")

    issue = invoice_date or date.today()
    warnings: list[str] = []
    built: list[SupplierInvoiceLine] = []

    if source_type == "PURCHASE_ORDER":
        po = (
            db.query(PurchaseOrder)
            .options(joinedload(PurchaseOrder.items))
            .filter(PurchaseOrder.po_number == source_order_id)
            .first()
        )
        if not po:
            raise HTTPException(status_code=404, detail="Purchase order not found")
        if (po.approval_status or "").upper() != "APPROVED" and (po.status or "") != "Approved":
            raise HTTPException(status_code=400, detail="Purchase order must be APPROVED")
        vendor_id = po.supplier_id
        terms = po.payment_terms
        received = _received_qty_by_item(db, source_type, source_order_id)
        billed = _billed_qty_by_item(db, source_type, source_order_id)
        if sum(received.values()) <= 0:
            raise HTTPException(
                status_code=400,
                detail="Receive goods against the purchase order before creating a supplier invoice",
            )

        po_by_id = {int(li.item_id): li for li in (po.items or [])}
        if lines:
            for raw in lines:
                line_id = int(raw["source_line_id"]) if raw.get("source_line_id") is not None else None
                po_line = po_by_id.get(line_id) if line_id is not None else None
                item_id = str(raw.get("item_id") or (po_line.sku if po_line else ""))
                qty = _d(raw["quantity_billed"])
                price = _d(raw.get("unit_price", po_line.unit_price if po_line else 0))
                if po_line and price > _d(po_line.unit_price):
                    warnings.append(
                        f"Price {price} exceeds PO unit price {_d(po_line.unit_price)} for {item_id}"
                    )
                recv = received.get(item_id, Decimal("0"))
                already = billed.get(item_id, Decimal("0"))
                if qty + already > recv:
                    warnings.append(
                        f"Invoiced qty {qty + already} exceeds received {recv} for {item_id}"
                    )
                built.append(
                    SupplierInvoiceLine(
                        source_line_id=line_id,
                        item_id=item_id,
                        description=raw.get("description") or item_id,
                        quantity_billed=qty,
                        unit_price=price,
                        line_subtotal=(price * qty).quantize(Decimal("0.01")),
                    )
                )
        else:
            for po_line in po.items or []:
                recv = received.get(po_line.sku, Decimal("0"))
                already = billed.get(po_line.sku, Decimal("0"))
                remaining = recv - already
                if remaining <= 0:
                    continue
                price = _d(po_line.unit_price)
                built.append(
                    SupplierInvoiceLine(
                        source_line_id=int(po_line.item_id),
                        item_id=po_line.sku,
                        description=po_line.sku,
                        quantity_billed=remaining,
                        unit_price=price,
                        line_subtotal=(price * remaining).quantize(Decimal("0.01")),
                    )
                )
        tax = tax_amount if tax_amount is not None else _d(po.total_tax)
        freight = (
            freight_amount
            if freight_amount is not None
            else invoice_freight_default(po.shipping_fee, getattr(po, "freight_terms", None))
        )
    else:
        sco = db.get(SubcontractOrder, source_order_id)
        if not sco:
            raise HTTPException(status_code=404, detail="Subcontract order not found")
        if (sco.approval_status or "").upper() != "APPROVED":
            raise HTTPException(status_code=400, detail="Subcontract order must be APPROVED")
        vendor_id = sco.supplier_id
        terms = "Net 30"
        received = _received_qty_by_item(db, source_type, source_order_id)
        billed = _billed_qty_by_item(db, source_type, source_order_id)
        if sum(received.values()) <= 0:
            raise HTTPException(
                status_code=400,
                detail="Receive finished goods before creating a supplier invoice",
            )
        if lines:
            for raw in lines:
                item_id = str(raw.get("item_id") or sco.item_id)
                qty = _d(raw["quantity_billed"])
                price = _d(raw.get("unit_price", sco.unit_price))
                recv = received.get(item_id, Decimal("0"))
                already = billed.get(item_id, Decimal("0"))
                if qty + already > recv:
                    warnings.append(
                        f"Invoiced qty {qty + already} exceeds received {recv} for {item_id}"
                    )
                if price > _d(sco.unit_price) > 0:
                    warnings.append(
                        f"Price {price} exceeds subcontract unit price {_d(sco.unit_price)}"
                    )
                built.append(
                    SupplierInvoiceLine(
                        source_line_id=None,
                        item_id=item_id,
                        description=raw.get("description") or item_id,
                        quantity_billed=qty,
                        unit_price=price,
                        line_subtotal=(price * qty).quantize(Decimal("0.01")),
                    )
                )
        else:
            recv = received.get(sco.item_id, Decimal("0"))
            already = billed.get(sco.item_id, Decimal("0"))
            remaining = recv - already
            if remaining <= 0:
                raise HTTPException(status_code=400, detail="No unbilled received quantity remaining")
            price = _d(sco.unit_price)
            if price <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="Set subcontract unit_price or provide invoice line unit_price",
                )
            built.append(
                SupplierInvoiceLine(
                    item_id=sco.item_id,
                    description=sco.item_id,
                    quantity_billed=remaining,
                    unit_price=price,
                    line_subtotal=(price * remaining).quantize(Decimal("0.01")),
                )
            )
        tax = tax_amount or Decimal("0")
        freight = freight_amount or Decimal("0")

    if not built:
        raise HTTPException(status_code=400, detail="Invoice requires at least one line")

    due = due_date or (issue + timedelta(days=_parse_payment_terms_days(terms)))
    invoice = SupplierInvoice(
        invoice_number=_next_number(db, SupplierInvoice, "invoice_number", "VBILL"),
        vendor_id=vendor_id,
        source_type=source_type,
        source_order_id=source_order_id,
        vendor_invoice_number=vendor_invoice_number,
        invoice_date=issue,
        due_date=due,
        status="DRAFT",
        tax_amount=_d(tax),
        freight_amount=_d(freight),
        currency=currency or "USD",
        match_warnings=json.dumps(warnings) if warnings else None,
    )
    db.add(invoice)
    db.flush()
    for line in built:
        line.invoice_id = invoice.id
        db.add(line)

    subtotal = sum((_d(line.line_subtotal) for line in built), Decimal("0"))
    invoice.subtotal = subtotal
    invoice.total_amount = (subtotal + _d(tax) + _d(freight)).quantize(Decimal("0.01"))
    invoice.outstanding_balance = invoice.total_amount
    db.flush()
    return serialize_supplier_invoice(_load_invoice(db, invoice.id))


def approve_supplier_invoice(db: Session, invoice_id: int) -> dict:
    invoice = _load_invoice(db, invoice_id)
    if invoice.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cannot approve a cancelled invoice")
    if invoice.status in {"APPROVED", "PAID"}:
        return serialize_supplier_invoice(invoice)

    grni_account = get_or_create_account(db, GRNI_ACCOUNT_CODE, GRNI_ACCOUNT_NAME, "Liability")
    ap_account = get_or_create_account(db, AP_ACCOUNT_CODE, AP_ACCOUNT_NAME, "Liability")
    ppv_account = get_or_create_account(db, PPV_ACCOUNT_CODE, PPV_ACCOUNT_NAME, "Expense")
    tax_exp = get_or_create_account(
        db, TAX_EXPENSE_ACCOUNT_CODE, TAX_EXPENSE_ACCOUNT_NAME, "Expense"
    )

    accrued = _accrued_amount_for_order(db, invoice.source_type, invoice.source_order_id)
    invoice_goods = _d(invoice.subtotal)
    tax = _d(invoice.tax_amount)
    freight = _d(invoice.freight_amount)
    total = _d(invoice.total_amount)
    if total <= 0:
        raise HTTPException(status_code=400, detail="Invoice total must be positive")

    # Clear GRNI for matched goods; PPV absorbs price variance vs accrual.
    clear_amount = min(accrued, invoice_goods)
    variance = invoice_goods - clear_amount

    if clear_amount > 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number} GRNI clear",
            debit_account=grni_account,
            credit_account=ap_account,
            amount=clear_amount,
        )
    if variance > 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number} PPV",
            debit_account=ppv_account,
            credit_account=ap_account,
            amount=variance,
        )
    elif variance < 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number} PPV favor",
            debit_account=grni_account,
            credit_account=ppv_account,
            amount=abs(variance),
        )
    if tax + freight > 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number} tax/freight",
            debit_account=tax_exp,
            credit_account=ap_account,
            amount=(tax + freight).quantize(Decimal("0.01")),
        )
    if clear_amount <= 0 and variance == 0 and (tax + freight) <= 0:
        # Fallback: recognize full AP against expense if no GRNI accrual exists
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number}",
            debit_account=ppv_account,
            credit_account=ap_account,
            amount=total,
        )

    bill = None
    if invoice.ap_bill_id:
        bill = db.get(APBill, invoice.ap_bill_id)
    if bill is None:
        bill = APBill(
            bill_id=invoice.invoice_number,
            purchase_order_id=invoice.source_order_id
            if invoice.source_type == "PURCHASE_ORDER"
            else None,
            vendor_id=invoice.vendor_id,
            supplier_invoice_id=invoice.id,
            source_type=invoice.source_type,
            source_order_id=invoice.source_order_id,
            amount=total,
            status="Unpaid",
            approval_status="APPROVED",
            due_date=invoice.due_date,
        )
        db.add(bill)
        db.flush()
        invoice.ap_bill_id = bill.bill_id

    invoice.status = "APPROVED"
    invoice.outstanding_balance = total
    invoice.updated_at = datetime.utcnow()
    _update_billing_status(db, invoice.source_type, invoice.source_order_id)
    db.flush()
    return serialize_supplier_invoice(_load_invoice(db, invoice_id))


def pay_supplier_invoice(
    db: Session,
    invoice_id: int,
    *,
    amount: Decimal | None = None,
    bank_account_id: str | None = None,
) -> dict:
    invoice = _load_invoice(db, invoice_id)
    if invoice.status not in {"APPROVED", "PAID"}:
        raise HTTPException(status_code=400, detail="Invoice must be APPROVED before payment")
    if invoice.status == "PAID" and _d(invoice.outstanding_balance) <= 0:
        return serialize_supplier_invoice(invoice)

    if not invoice.ap_bill_id:
        # Ensure AP mirror exists for cash posting helper
        approve_supplier_invoice(db, invoice_id)
        invoice = _load_invoice(db, invoice_id)

    bill = db.get(APBill, invoice.ap_bill_id)
    if not bill:
        raise HTTPException(status_code=400, detail="Linked AP bill not found")

    txn = finance.make_payment(db, bill, amount=amount, bank_account_id=bank_account_id)
    bill = db.get(APBill, invoice.ap_bill_id)
    if bill and bill.status == "Paid":
        invoice.status = "PAID"
        invoice.outstanding_balance = Decimal("0")
    elif bill:
        paid = _d(bill.amount) - (
            _d(invoice.outstanding_balance) if invoice.outstanding_balance else _d(bill.amount)
        )
        # Recompute outstanding from bill status
        if bill.status == "Partial":
            invoice.status = "APPROVED"
            # Approximate remaining as prior outstanding minus this payment
            pay_amt = _d(txn.amount)
            invoice.outstanding_balance = max(
                Decimal("0"), _d(invoice.outstanding_balance) - pay_amt
            )
        else:
            invoice.outstanding_balance = Decimal("0")
            invoice.status = "PAID"
    invoice.updated_at = datetime.utcnow()
    db.flush()
    result = serialize_supplier_invoice(_load_invoice(db, invoice_id))
    result["payment_transaction_id"] = txn.transaction_id
    return result
