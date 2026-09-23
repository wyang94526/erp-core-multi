# @author: Wendy Yang
# @date: 2026-09-19

"""Procure-to-Pay: goods receipts (GRNI) and supplier invoices (vendor bills)."""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_, func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    APBill,
    ChartOfAccount,
    Department,
    FinishedGoodsReceipt,
    GoodsReceipt,
    GoodsReceiptLine,
    Item,
    JournalEntry,
    LedgerPosting,
    PurchaseOrder,
    PurchaseOrderItem,
    StockMovement,
    SubcontractOrder,
    SubcontractOrderItem,
    Supplier,
    SupplierInvoice,
    SupplierInvoiceDistribution,
    SupplierInvoiceLine,
    VendorItemMapping,
)
from app.services import finance, inventory
from app.services.landed_cost import (
    LANDED_COST_ACTIVE_STATUSES,
    allocate_amount_by_weights,
    allocation_weight,
    annotate_po_line,
    annotate_receipt_line,
)
from app.services.po_totals import invoice_freight_default
from app.services.finance import (
    resolve_ap_account,
)
from app.services.posting_rules import (
    EVENT_GOODS_RECEIPT,
    EVENT_SUPPLIER_INVOICE,
    VARIANT_EXPENSE,
    VARIANT_GRNI_CLEAR,
    VARIANT_LANDED_COST,
    VARIANT_PPV_FAVORABLE,
    VARIANT_PPV_UNFAVORABLE,
    VARIANT_TAX,
    receipt_variant,
    resolve_posting_pair,
)
from app.services.payment_terms import apply_due_date, apply_payment_term_fields
from app.services.item_types import (
    catalog_item,
    is_stock_tracked,
    skip_inventory_movement,
)

PO_MATCHED_SOURCES = {"PURCHASE_ORDER", "SUBCONTRACT_ORDER"}
INVOICE_TYPES = {"PO_MATCHED", "LANDED_COST", "EXPENSE"}
NON_PO_TYPES = {"LANDED_COST", "EXPENSE"}
RECALLABLE_APPROVAL_STATUSES = frozenset({"APPROVED", "PENDING_APPROVAL", "SUBMITTED"})
RECALLABLE_PO_STATUSES = frozenset({"Submitted", "Approved"})
PURCHASE_ORDER_LOCKED_EDIT_DETAIL = (
    "Approved purchase orders cannot be modified directly. "
    "Use Recall / Reopen for Revision."
)
_PO_IN_APPROVAL_EDIT_DETAIL = (
    "This purchase order is in approval. "
    "Use Recall / Reopen for Revision to edit."
)
_PO_RECEIPTS_EDIT_DETAIL = (
    "Posted goods receipts exist for this purchase order. "
    "Header and line items cannot be edited."
)
_PO_INVOICES_EDIT_DETAIL = (
    "Supplier invoices exist for this purchase order. "
    "Header and line items cannot be edited."
)
_PO_VOID_EDIT_DETAIL = "Voided purchase orders cannot be edited."
ALL_PO_ITEMS_RECEIVED_MESSAGE = (
    "All items on this purchase order have been fully received"
)
PO_FULLY_INVOICED_MESSAGE = "This purchase order is fully invoiced"
ALL_RECEIVED_QTY_BILLED_MESSAGE = (
    "All received quantities have already been billed"
)
RECEIVE_GOODS_BEFORE_BILL_MESSAGE = (
    "Receive goods before creating a supplier invoice"
)
RECEIPT_STATUS_LABELS = {
    "DRAFT": "Draft",
    "POSTED": "Posted",
    "CANCELLED": "Voided",
}


def receipt_status_label(status: str | None) -> str:
    key = (status or "POSTED").upper()
    return RECEIPT_STATUS_LABELS.get(key, status or "Posted")


_RECEIPT_LOAD = (
    selectinload(GoodsReceipt.lines).selectinload(GoodsReceiptLine.item),
    joinedload(GoodsReceipt.vendor),
)


def _receipt_query(db: Session):
    return db.query(GoodsReceipt).options(*_RECEIPT_LOAD)


def assert_po_approved_for_p2p(po: PurchaseOrder, *, action: str) -> None:
    current = (getattr(po, "approval_status", None) or "DRAFT").upper()
    if current != "APPROVED":
        raise HTTPException(
            status_code=400,
            detail=f"Purchase order must be APPROVED to {action} (current: {current})",
        )


def po_downstream_flags(db: Session, po_number: str) -> tuple[bool, bool]:
    has_receipts = (
        db.query(GoodsReceipt.id)
        .filter(
            GoodsReceipt.source_type == "PURCHASE_ORDER",
            GoodsReceipt.source_order_id == po_number,
            GoodsReceipt.status == "POSTED",
        )
        .first()
        is not None
    )
    has_invoices = (
        db.query(SupplierInvoice.id)
        .filter(
            SupplierInvoice.source_type == "PURCHASE_ORDER",
            SupplierInvoice.source_order_id == po_number,
            SupplierInvoice.status != "CANCELLED",
        )
        .first()
        is not None
    )
    return has_receipts, has_invoices


def _normalize_po_approval(value: str | None) -> str:
    return (value or "DRAFT").strip().upper().replace(" ", "_").replace("-", "_")


def purchase_order_lock_reason(po: PurchaseOrder) -> str | None:
    if (getattr(po, "status", None) or "") == "Void":
        return _PO_VOID_EDIT_DETAIL
    if getattr(po, "has_posted_receipts", False):
        return _PO_RECEIPTS_EDIT_DETAIL
    if getattr(po, "has_supplier_invoices", False):
        return _PO_INVOICES_EDIT_DETAIL
    approval = _normalize_po_approval(getattr(po, "approval_status", None))
    status = getattr(po, "status", None) or ""
    if approval in RECALLABLE_APPROVAL_STATUSES or status in RECALLABLE_PO_STATUSES:
        if approval in {"PENDING_APPROVAL", "SUBMITTED"} or status == "Submitted":
            return _PO_IN_APPROVAL_EDIT_DETAIL
        return PURCHASE_ORDER_LOCKED_EDIT_DETAIL
    return None


def purchase_order_is_editable(po: PurchaseOrder) -> bool:
    return purchase_order_lock_reason(po) is None


def assert_purchase_order_editable(po: PurchaseOrder) -> None:
    reason = purchase_order_lock_reason(po)
    if reason:
        raise HTTPException(status_code=409, detail=reason)


def recall_status_blocker(po: PurchaseOrder) -> str | None:
    if (getattr(po, "status", None) or "") == "Void":
        return "Cannot recall a voided purchase order"
    approval = (getattr(po, "approval_status", None) or "DRAFT").upper().replace(" ", "_")
    status = getattr(po, "status", None) or ""
    if approval in RECALLABLE_APPROVAL_STATUSES or status in RECALLABLE_PO_STATUSES:
        return None
    return f"Cannot recall from approval status {approval}"


def remaining_to_receive(
    ordered: Decimal,
    already_received: Decimal,
    *,
    amount_only: bool,
) -> Decimal:
    if amount_only and ordered <= 0:
        return Decimal("0") if already_received > 0 else Decimal("1")
    leftover = ordered - already_received
    return leftover if leftover > 0 else Decimal("0")


def remaining_to_bill(
    received: Decimal,
    billed: Decimal,
    *,
    ordered: Decimal,
    billed_amount: Decimal,
    line_amount: Decimal,
    amount_only: bool,
) -> Decimal:
    if amount_only and ordered <= 0:
        leftover = line_amount - billed_amount
        return leftover if leftover > 0 else Decimal("0")
    leftover = received - billed
    return leftover if leftover > 0 else Decimal("0")


def attach_po_p2p_progress(db: Session, po: PurchaseOrder) -> PurchaseOrder:
    received = _received_qty_by_item(db, "PURCHASE_ORDER", po.po_number)
    billed = _billed_qty_by_item(db, "PURCHASE_ORDER", po.po_number)
    billed_amt = _billed_amount_by_item(db, "PURCHASE_ORDER", po.po_number)
    remaining_recv = Decimal("0")
    remaining_bill = Decimal("0")
    for line in po.items or []:
        catalog = catalog_item(db, line.sku)
        amount_only = skip_inventory_movement(catalog) and _d(line.quantity) <= 0
        already_recv = received.get(line.sku, Decimal("0"))
        already_billed = billed.get(line.sku, Decimal("0"))
        recv_left = remaining_to_receive(_d(line.quantity), already_recv, amount_only=amount_only)
        bill_left = remaining_to_bill(
            already_recv,
            already_billed,
            ordered=_d(line.quantity),
            billed_amount=billed_amt.get(line.sku, Decimal("0")),
            line_amount=_d(getattr(line, "line_subtotal", 0)),
            amount_only=amount_only,
        )
        line.quantity_received = already_recv
        line.quantity_remaining_to_receive = recv_left
        line.quantity_billed = already_billed
        line.quantity_remaining_to_bill = bill_left
        remaining_recv += recv_left
        remaining_bill += bill_left

    po.can_receive_goods = remaining_recv > 0
    po.receive_blocked_reason = None if po.can_receive_goods else ALL_PO_ITEMS_RECEIVED_MESSAGE
    po.can_create_bill = remaining_bill > 0
    if po.can_create_bill:
        po.bill_blocked_reason = None
    elif remaining_recv > 0:
        po.bill_blocked_reason = ALL_RECEIVED_QTY_BILLED_MESSAGE
    elif getattr(po, "has_supplier_invoices", False) or (po.billing_status or "").upper() == "FULLY_BILLED":
        po.bill_blocked_reason = PO_FULLY_INVOICED_MESSAGE
    else:
        po.bill_blocked_reason = RECEIVE_GOODS_BEFORE_BILL_MESSAGE
    return po


def apply_po_recall_flags(
    po: PurchaseOrder,
    has_receipts: bool,
    has_invoices: bool,
) -> PurchaseOrder:
    status_reason = recall_status_blocker(po)
    blocked = status_reason
    if not blocked and has_receipts:
        blocked = "Cannot recall: posted goods receipts exist for this purchase order"
    elif not blocked and has_invoices:
        blocked = "Cannot recall: supplier invoices exist for this purchase order"
    po.has_posted_receipts = has_receipts
    po.has_supplier_invoices = has_invoices
    po.can_recall = blocked is None
    po.recall_blocked_reason = None if po.can_recall else blocked
    return po


def attach_po_recall_flags(db: Session, po: PurchaseOrder | None) -> PurchaseOrder | None:
    if po is None:
        return None
    has_receipts, has_invoices = po_downstream_flags(db, po.po_number)
    apply_po_recall_flags(po, has_receipts, has_invoices)
    attach_po_p2p_progress(db, po)
    apply_po_actual_landed_costs(db, po)
    return po


def attach_po_recall_flags_many(db: Session, rows: list[PurchaseOrder]) -> list[PurchaseOrder]:
    if not rows:
        return rows
    numbers = [po.po_number for po in rows]
    receipt_ids = {
        row[0]
        for row in db.query(GoodsReceipt.source_order_id)
        .filter(
            GoodsReceipt.source_type == "PURCHASE_ORDER",
            GoodsReceipt.source_order_id.in_(numbers),
            GoodsReceipt.status == "POSTED",
        )
        .distinct()
        .all()
    }
    invoice_ids = {
        row[0]
        for row in db.query(SupplierInvoice.source_order_id)
        .filter(
            SupplierInvoice.source_type == "PURCHASE_ORDER",
            SupplierInvoice.source_order_id.in_(numbers),
            SupplierInvoice.status != "CANCELLED",
        )
        .distinct()
        .all()
    }
    for po in rows:
        apply_po_recall_flags(
            po,
            po.po_number in receipt_ids,
            po.po_number in invoice_ids,
        )
    return rows


def recall_blockers(db: Session, po: PurchaseOrder) -> str | None:
    return apply_po_recall_flags(po, *po_downstream_flags(db, po.po_number)).recall_blocked_reason


def assert_can_recall_purchase_order(db: Session, po: PurchaseOrder) -> None:
    reason = recall_blockers(db, po)
    if reason:
        raise HTTPException(status_code=409, detail=reason)


def resolve_invoice_type(
    invoice_type: str | None,
    source_type: str | None,
) -> str:
    raw = (invoice_type or "").strip().upper()
    if raw:
        return raw
    source = (source_type or "").strip().upper()
    if source in PO_MATCHED_SOURCES:
        return "PO_MATCHED"
    if source == "NON_PO":
        return "EXPENSE"
    return "PO_MATCHED"


def validate_supplier_invoice_payload(
    *,
    invoice_type: str | None,
    source_type: str | None,
    source_order_id: str | None,
    vendor_id: str | None,
    distributions: list[dict] | None,
    lines: list[dict] | None,
) -> tuple[str, str | None, str | None]:
    """Return (invoice_type, source_type, source_order_id). Raises HTTPException on bad input."""
    resolved_type = resolve_invoice_type(invoice_type, source_type)
    if resolved_type not in INVOICE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid invoice_type")

    source = (source_type or "").strip().upper() or None
    order_id = (source_order_id or "").strip() or None
    vendor = (vendor_id or "").strip() or None

    if resolved_type == "PO_MATCHED":
        if source not in PO_MATCHED_SOURCES:
            raise HTTPException(
                status_code=400,
                detail="PO-matched invoices require source_type PURCHASE_ORDER or SUBCONTRACT_ORDER",
            )
        if not order_id:
            raise HTTPException(status_code=400, detail="PO-matched invoices require a source_order_id")
        return resolved_type, source, order_id

    if not vendor:
        raise HTTPException(status_code=400, detail="Non-PO invoices require vendor_id")
    if not distributions:
        raise HTTPException(
            status_code=400,
            detail="Non-PO invoices require at least one GL distribution line",
        )
    if source and source not in PO_MATCHED_SOURCES | {"NON_PO"}:
        raise HTTPException(status_code=400, detail="Invalid source_type")
    # Optional PO/SCO on landed-cost or expense bills must not switch source to
    # PO_MATCHED; otherwise 3-way billing_status would count synthetic qty=1 lines.
    source = "NON_PO"
    if lines:
        raise HTTPException(
            status_code=400,
            detail="Non-PO invoices use distributions[], not PO match lines[]",
        )
    return resolved_type, source, order_id


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


def _merchandise_receipt_lines(db: Session, receipt: GoodsReceipt) -> list[GoodsReceiptLine]:
    merch: list[GoodsReceiptLine] = []
    for line in receipt.lines or []:
        catalog = catalog_item(db, line.item_id) or getattr(line, "item", None)
        if skip_inventory_movement(catalog):
            continue
        merch.append(line)
    return merch or list(receipt.lines or [])


def _allocate_amount_to_receipt_lines(
    db: Session,
    receipt: GoodsReceipt,
    amount: Decimal,
    *,
    goods_receipt_line_id: int | None = None,
) -> dict[int, Decimal]:
    shares: dict[int, Decimal] = {}
    if amount <= 0:
        return shares
    if goods_receipt_line_id is not None:
        target = next((line for line in (receipt.lines or []) if line.id == goods_receipt_line_id), None)
        if target is not None:
            shares[target.id] = amount
        return shares
    merch = _merchandise_receipt_lines(db, receipt)
    if not merch:
        return shares
    weights = [
        allocation_weight(line.quantity_received, line.line_amount)
        for line in merch
    ]
    for line, share in zip(merch, allocate_amount_by_weights(weights, amount)):
        if share > 0:
            shares[line.id] = share
    return shares


def _active_landed_distributions(db: Session, receipt_ids: list[int]) -> list[SupplierInvoiceDistribution]:
    if not receipt_ids:
        return []
    line_ids = [
        line_id
        for (line_id,) in db.query(GoodsReceiptLine.id)
        .filter(GoodsReceiptLine.receipt_id.in_(receipt_ids))
        .all()
        if line_id is not None
    ]
    filters = [SupplierInvoiceDistribution.goods_receipt_id.in_(receipt_ids)]
    if line_ids:
        filters.append(SupplierInvoiceDistribution.goods_receipt_line_id.in_(line_ids))
    return (
        db.query(SupplierInvoiceDistribution)
        .join(SupplierInvoice, SupplierInvoiceDistribution.invoice_id == SupplierInvoice.id)
        .filter(
            or_(*filters),
            SupplierInvoice.invoice_type == "LANDED_COST",
            SupplierInvoice.status.in_(LANDED_COST_ACTIVE_STATUSES),
        )
        .all()
    )


def landed_allocations_for_receipt(db: Session, receipt: GoodsReceipt) -> dict[int, Decimal]:
    totals: dict[int, Decimal] = {line.id: Decimal("0.00") for line in (receipt.lines or []) if line.id}
    if receipt.id is None:
        return totals
    for dist in _active_landed_distributions(db, [receipt.id]):
        amount = _d(dist.amount).quantize(Decimal("0.01"))
        # Receipt-level allocation always spreads. A line id is used only when
        # the distribution is pinned to that line and has no receipt header.
        pinned_line_id = None if dist.goods_receipt_id else dist.goods_receipt_line_id
        for target_line_id, share in _allocate_amount_to_receipt_lines(
            db,
            receipt,
            amount,
            goods_receipt_line_id=pinned_line_id,
        ).items():
            totals[target_line_id] = (totals.get(target_line_id) or Decimal("0.00")) + share
    return totals


def apply_receipt_landed_costs(db: Session, receipt: GoodsReceipt) -> dict[int, Decimal]:
    allocations = landed_allocations_for_receipt(db, receipt)
    for line in receipt.lines or []:
        annotate_receipt_line(line, allocations.get(line.id) or Decimal("0.00"))
    return allocations


def apply_po_actual_landed_costs(db: Session, po: PurchaseOrder) -> None:
    receipts = (
        db.query(GoodsReceipt)
        .options(selectinload(GoodsReceipt.lines))
        .filter(
            GoodsReceipt.source_type == "PURCHASE_ORDER",
            GoodsReceipt.source_order_id == po.po_number,
            GoodsReceipt.status != "CANCELLED",
        )
        .all()
    )
    extra_by_po_line: dict[int, Decimal] = {}
    for receipt in receipts:
        allocations = apply_receipt_landed_costs(db, receipt)
        for line in receipt.lines or []:
            if line.source_line_id is None:
                continue
            extra_by_po_line[int(line.source_line_id)] = (
                extra_by_po_line.get(int(line.source_line_id), Decimal("0.00"))
                + (allocations.get(line.id) or Decimal("0.00"))
            )
    for item in po.items or []:
        annotate_po_line(item, extra_by_po_line.get(int(item.item_id), Decimal("0.00")))


def _apply_landed_cost_to_linked_receipts(db: Session, invoice: SupplierInvoice) -> None:
    receipt_ids = {
        dist.goods_receipt_id
        for dist in (invoice.distributions or [])
        if dist.goods_receipt_id
    }
    for receipt_id in receipt_ids:
        receipt = (
            db.query(GoodsReceipt)
            .options(selectinload(GoodsReceipt.lines))
            .filter(GoodsReceipt.id == receipt_id)
            .first()
        )
        if receipt is None:
            continue
        apply_receipt_landed_costs(db, receipt)
        if (receipt.source_type or "").upper() == "PURCHASE_ORDER" and receipt.source_order_id:
            po = (
                db.query(PurchaseOrder)
                .options(selectinload(PurchaseOrder.items))
                .filter(PurchaseOrder.po_number == receipt.source_order_id)
                .first()
            )
            if po is not None:
                from app.services.po_totals import apply_estimated_landed_unit_costs

                apply_estimated_landed_unit_costs(po)
                apply_po_actual_landed_costs(db, po)


def serialize_goods_receipt(
    row: GoodsReceipt,
    db: Session | None = None,
    *,
    detail: bool = False,
) -> dict:
    vendor = getattr(row, "vendor", None)
    vendor_name = getattr(vendor, "company_name", None) if vendor is not None else None
    allocations = apply_receipt_landed_costs(db, row) if db is not None else {}
    lines_payload = [
        {
            "id": line.id,
            "receipt_id": line.receipt_id,
            "source_line_id": line.source_line_id,
            "item_id": line.item_id,
            "description": line.description,
            "item_description": None,
            "quantity_ordered": None,
            "quantity_received": line.quantity_received,
            "unit_cost": line.unit_cost,
            "line_amount": line.line_amount,
            "allocated_landed_amount": getattr(line, "allocated_landed_amount", allocations.get(line.id) or Decimal("0.00")),
            "landed_unit_cost": getattr(line, "landed_unit_cost", line.unit_cost),
            "actual_unit_cost": getattr(line, "actual_unit_cost", line.unit_cost),
            "uom": None,
            "lot_number": None,
            "serial_number": None,
        }
        for line in (row.lines or [])
    ]
    total_amount = sum((_d(line.line_amount) for line in (row.lines or [])), Decimal("0"))
    payload = {
        "id": row.id,
        "receipt_number": row.receipt_number,
        "source_type": row.source_type,
        "source_order_id": row.source_order_id,
        "vendor_id": row.vendor_id,
        "vendor_name": vendor_name,
        "receipt_date": row.receipt_date,
        "status": row.status,
        "status_label": receipt_status_label(row.status),
        "notes": row.notes,
        "created_at": row.created_at,
        "warehouse_id": None,
        "warehouse_code": None,
        "warehouse_name": None,
        "bin_id": None,
        "bin_code": None,
        "received_by": None,
        "operational_receipt_id": None,
        "total_amount": total_amount,
        "lines": lines_payload,
        "journals": [],
        "related_invoices": [],
    }
    if detail and db is not None:
        _enrich_goods_receipt_detail(db, row, payload)
    return payload


def _line_item_description(line: GoodsReceiptLine) -> str | None:
    catalog = getattr(line, "item", None)
    catalog_desc = (getattr(catalog, "description", None) or "").strip() or None
    stored = (line.description or "").strip() or None
    if catalog_desc:
        return catalog_desc
    if stored and stored != line.item_id:
        return stored
    return stored or catalog_desc


def _ordered_qty_by_source_line(db: Session, receipt: GoodsReceipt) -> dict[int, Decimal]:
    line_ids = [
        int(line.source_line_id)
        for line in (receipt.lines or [])
        if line.source_line_id is not None
    ]
    if not line_ids:
        return {}
    source_type = (receipt.source_type or "").upper()
    if source_type == "PURCHASE_ORDER":
        rows = (
            db.query(PurchaseOrderItem.item_id, PurchaseOrderItem.quantity)
            .filter(PurchaseOrderItem.item_id.in_(line_ids))
            .all()
        )
        return {int(item_id): _d(qty) for item_id, qty in rows}
    rows = (
        db.query(SubcontractOrderItem.sco_line_id, SubcontractOrderItem.quantity_ordered)
        .filter(SubcontractOrderItem.sco_line_id.in_(line_ids))
        .all()
    )
    return {int(sco_line_id): _d(qty) for sco_line_id, qty in rows}


def _fallback_sco_ordered_qty(db: Session, receipt: GoodsReceipt) -> Decimal | None:
    if (receipt.source_type or "").upper() != "SUBCONTRACT_ORDER":
        return None
    sco = db.get(SubcontractOrder, receipt.source_order_id)
    if sco is None:
        return None
    return _d(sco.quantity_ordered)


def _serialize_receipt_journal(entry: JournalEntry, *, purpose: str) -> dict:
    user = getattr(entry, "user", None)
    posted_by_name = None
    if user is not None:
        posted_by_name = (user.full_name or "").strip() or (user.email or "").strip() or None
    postings = []
    for posting in entry.postings or []:
        account = getattr(posting, "account", None)
        postings.append(
            {
                "id": posting.id,
                "account_id": posting.account_id,
                "account_code": getattr(account, "account_code", None),
                "account_name": getattr(account, "account_name", None),
                "description": posting.description,
                "debit": posting.debit,
                "credit": posting.credit,
                "currency": posting.currency,
            }
        )
    return {
        "id": entry.id,
        "created_at": entry.created_at,
        "description": entry.description,
        "posted_by_user_id": entry.posted_by_user_id,
        "posted_by_name": posted_by_name,
        "period": entry.period,
        "posting_date": entry.posting_date,
        "reference": entry.reference,
        "posting_status": entry.posting_status,
        "approval_status": entry.approval_status,
        "purpose": purpose,
        "postings": postings,
    }


def _journal_purpose(entry: JournalEntry, receipt_number: str) -> str:
    text = f"{entry.description or ''} {entry.reference or ''}".upper()
    if "GRNI CLEAR" in text:
        return "GRNI_CLEAR"
    if receipt_number and receipt_number.upper() in text:
        return "GRNI_ACCRUAL"
    if "GOODS RECEIPT" in text:
        return "GRNI_ACCRUAL"
    return "OTHER"


def _load_receipt_journals(db: Session, receipt: GoodsReceipt) -> list[JournalEntry]:
    number = receipt.receipt_number
    query = (
        db.query(JournalEntry)
        .options(
            selectinload(JournalEntry.postings).selectinload(LedgerPosting.account),
            joinedload(JournalEntry.user),
        )
        .filter(
            or_(
                JournalEntry.reference == number,
                JournalEntry.description.ilike(f"%{number}%"),
            )
        )
        .order_by(JournalEntry.created_at.asc())
    )
    return query.all()


def _related_invoices_for_receipt(db: Session, receipt: GoodsReceipt) -> list[dict]:
    line_ids = [line.id for line in (receipt.lines or []) if line.id is not None]
    invoice_ids: set[int] = set()
    if line_ids:
        invoice_ids.update(
            inv_id
            for (inv_id,) in db.query(SupplierInvoiceLine.invoice_id)
            .filter(SupplierInvoiceLine.goods_receipt_line_id.in_(line_ids))
            .all()
            if inv_id is not None
        )
        invoice_ids.update(
            inv_id
            for (inv_id,) in db.query(SupplierInvoiceDistribution.invoice_id)
            .filter(
                or_(
                    SupplierInvoiceDistribution.goods_receipt_id == receipt.id,
                    SupplierInvoiceDistribution.goods_receipt_line_id.in_(line_ids),
                )
            )
            .all()
            if inv_id is not None
        )
    if receipt.source_order_id:
        invoice_ids.update(
            inv_id
            for (inv_id,) in db.query(SupplierInvoice.id)
            .filter(
                SupplierInvoice.source_type == receipt.source_type,
                SupplierInvoice.source_order_id == receipt.source_order_id,
                SupplierInvoice.status != "CANCELLED",
            )
            .all()
            if inv_id is not None
        )
    if not invoice_ids:
        return []
    rows = (
        db.query(SupplierInvoice)
        .options(
            selectinload(SupplierInvoice.lines),
            selectinload(SupplierInvoice.distributions),
        )
        .filter(SupplierInvoice.id.in_(invoice_ids))
        .order_by(SupplierInvoice.id.asc())
        .all()
    )
    payload = []
    for invoice in rows:
        linked_line = any(
            line.goods_receipt_line_id in line_ids for line in (invoice.lines or []) if line.goods_receipt_line_id
        )
        linked_dist = any(
            (dist.goods_receipt_id == receipt.id)
            or (dist.goods_receipt_line_id in line_ids if dist.goods_receipt_line_id else False)
            for dist in (invoice.distributions or [])
        )
        payload.append(
            {
                "id": invoice.id,
                "invoice_number": invoice.invoice_number,
                "ap_bill_id": invoice.ap_bill_id,
                "status": invoice.status,
                "invoice_date": invoice.invoice_date,
                "total_amount": invoice.total_amount,
                "link_type": "RECEIPT_MATCH" if (linked_line or linked_dist) else "SOURCE_ORDER",
            }
        )
    return payload


def _load_clearing_journals(db: Session, invoices: list[dict]) -> list[JournalEntry]:
    numbers = [row["invoice_number"] for row in invoices if row.get("invoice_number")]
    if not numbers:
        return []
    filters = [
        JournalEntry.description.ilike(f"%{number}%")
        for number in numbers
    ]
    return (
        db.query(JournalEntry)
        .options(
            selectinload(JournalEntry.postings).selectinload(LedgerPosting.account),
            joinedload(JournalEntry.user),
        )
        .filter(or_(*filters))
        .filter(JournalEntry.description.ilike("%GRNI%"))
        .order_by(JournalEntry.created_at.asc())
        .all()
    )


def _operational_receipt_id(db: Session, receipt: GoodsReceipt) -> str | None:
    if (receipt.source_type or "").upper() != "SUBCONTRACT_ORDER":
        return None
    exact = db.get(FinishedGoodsReceipt, receipt.receipt_number)
    if exact is not None and exact.sco_number == receipt.source_order_id:
        return exact.receipt_id
    fgr_rows = (
        db.query(FinishedGoodsReceipt)
        .filter(FinishedGoodsReceipt.sco_number == receipt.source_order_id)
        .order_by(FinishedGoodsReceipt.created_at.asc())
        .all()
    )
    qty_targets = {_d(line.quantity_received) for line in (receipt.lines or [])}
    for fgr in fgr_rows:
        if fgr.receipt_date == receipt.receipt_date and _d(fgr.quantity_received) in qty_targets:
            return fgr.receipt_id
    if len(fgr_rows) == 1:
        return fgr_rows[0].receipt_id
    return None


def _warehouse_from_movements(db: Session, receipt: GoodsReceipt, operational_id: str | None) -> dict:
    refs = {receipt.receipt_number}
    if operational_id:
        refs.add(operational_id)
    movement = (
        db.query(StockMovement)
        .options(joinedload(StockMovement.warehouse), joinedload(StockMovement.bin_location))
        .filter(
            StockMovement.movement_type == "Receipt",
            StockMovement.reference.in_(list(refs)),
        )
        .order_by(StockMovement.created_at.asc())
        .first()
    )
    if movement is None:
        return {}
    warehouse = getattr(movement, "warehouse", None)
    bin_location = getattr(movement, "bin_location", None)
    return {
        "warehouse_id": movement.warehouse_id,
        "warehouse_code": getattr(warehouse, "code", None),
        "warehouse_name": getattr(warehouse, "name", None),
        "bin_id": movement.bin_id,
        "bin_code": getattr(bin_location, "bin_code", None) or getattr(bin_location, "code", None),
    }


def _enrich_goods_receipt_detail(db: Session, receipt: GoodsReceipt, payload: dict) -> None:
    ordered = _ordered_qty_by_source_line(db, receipt)
    sco_fallback = _fallback_sco_ordered_qty(db, receipt)
    for line, raw in zip(receipt.lines or [], payload["lines"]):
        catalog = getattr(line, "item", None)
        po_uom = None
        if (receipt.source_type or "").upper() == "PURCHASE_ORDER" and line.source_line_id is not None:
            po_line = db.get(PurchaseOrderItem, int(line.source_line_id))
            po_uom = getattr(po_line, "uom", None) if po_line is not None else None
        raw["item_description"] = _line_item_description(line)
        raw["uom"] = po_uom or getattr(catalog, "uom", None) or "Each"
        if line.source_line_id is not None and int(line.source_line_id) in ordered:
            raw["quantity_ordered"] = ordered[int(line.source_line_id)]
        elif sco_fallback is not None:
            raw["quantity_ordered"] = sco_fallback
        raw["lot_number"] = None
        raw["serial_number"] = None

    operational_id = _operational_receipt_id(db, receipt)
    payload["operational_receipt_id"] = operational_id
    payload.update(_warehouse_from_movements(db, receipt, operational_id))

    invoices = _related_invoices_for_receipt(db, receipt)
    payload["related_invoices"] = invoices

    journals_by_id: dict[str, dict] = {}
    for entry in _load_receipt_journals(db, receipt):
        journals_by_id[str(entry.id)] = _serialize_receipt_journal(
            entry, purpose=_journal_purpose(entry, receipt.receipt_number)
        )
    for entry in _load_clearing_journals(db, invoices):
        journals_by_id.setdefault(
            str(entry.id),
            _serialize_receipt_journal(entry, purpose=_journal_purpose(entry, receipt.receipt_number)),
        )
    payload["journals"] = list(journals_by_id.values())

    received_by = next(
        (row["posted_by_name"] for row in payload["journals"] if row.get("posted_by_name")),
        None,
    )
    payload["received_by"] = received_by


def _goods_receipt_for_finished_goods(db: Session, fgr: FinishedGoodsReceipt) -> GoodsReceipt | None:
    rows = (
        _receipt_query(db)
        .filter(
            GoodsReceipt.source_type == "SUBCONTRACT_ORDER",
            GoodsReceipt.source_order_id == fgr.sco_number,
        )
        .order_by(GoodsReceipt.id.asc())
        .all()
    )
    if not rows:
        return None
    by_number = next((row for row in rows if row.receipt_number == fgr.receipt_id), None)
    if by_number is not None:
        return by_number
    qty = _d(fgr.quantity_received)
    dated = [row for row in rows if row.receipt_date == fgr.receipt_date]
    candidates = dated or rows
    qty_matches = []
    for row in candidates:
        if any(_d(line.quantity_received) == qty for line in (row.lines or [])):
            qty_matches.append(row)
    if len(qty_matches) == 1:
        return qty_matches[0]
    if len(candidates) == 1:
        return candidates[0]
    if qty_matches:
        return qty_matches[-1]
    return candidates[-1] if candidates else None


def resolve_goods_receipt(db: Session, receipt_key: str) -> GoodsReceipt | None:
    key = (receipt_key or "").strip()
    if not key:
        return None
    row = _receipt_query(db).filter(GoodsReceipt.receipt_number == key).first()
    if row is not None:
        return row
    if key.isdigit():
        row = _receipt_query(db).filter(GoodsReceipt.id == int(key)).first()
        if row is not None:
            return row
    fgr = db.get(FinishedGoodsReceipt, key)
    if fgr is not None:
        return _goods_receipt_for_finished_goods(db, fgr)
    return None


def get_goods_receipt(db: Session, receipt_key: str) -> dict:
    row = resolve_goods_receipt(db, receipt_key)
    if row is None:
        raise HTTPException(status_code=404, detail="Goods receipt not found")
    return serialize_goods_receipt(row, db, detail=True)


def list_goods_receipts(
    db: Session,
    *,
    vendor_id: str | None = None,
    source_type: str | None = None,
    source_order_id: str | None = None,
    status: str | None = None,
    q: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict]:
    query = _receipt_query(db).order_by(GoodsReceipt.id.desc())
    if vendor_id:
        query = query.filter(GoodsReceipt.vendor_id == vendor_id)
    if source_type:
        query = query.filter(GoodsReceipt.source_type == source_type.upper())
    if source_order_id:
        query = query.filter(GoodsReceipt.source_order_id == source_order_id)
    if status:
        query = query.filter(GoodsReceipt.status == status.upper())
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        vendor_ids = db.query(Supplier.supplier_id).filter(Supplier.company_name.ilike(like))
        query = query.filter(
            GoodsReceipt.receipt_number.ilike(like)
            | GoodsReceipt.source_order_id.ilike(like)
            | GoodsReceipt.vendor_id.ilike(like)
            | GoodsReceipt.vendor_id.in_(vendor_ids)
        )
    return [serialize_goods_receipt(r, db) for r in query.offset(skip).limit(limit).all()]


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
        "invoice_type": getattr(row, "invoice_type", None) or "PO_MATCHED",
        "source_type": row.source_type,
        "source_order_id": row.source_order_id,
        "vendor_invoice_number": row.vendor_invoice_number,
        "invoice_date": row.invoice_date,
        "due_date": row.due_date,
        "payment_term_id": getattr(row, "payment_term_id", None),
        "payment_terms": getattr(row, "payment_terms", None),
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
        "distributions": [
            {
                "id": dist.id,
                "invoice_id": dist.invoice_id,
                "gl_account_id": dist.gl_account_id,
                "gl_account_code": dist.gl_account.account_code if dist.gl_account else None,
                "gl_account_name": dist.gl_account.account_name if dist.gl_account else None,
                "department_id": dist.department_id,
                "department_name": dist.department.name if dist.department else None,
                "amount": dist.amount,
                "description": dist.description,
                "goods_receipt_id": dist.goods_receipt_id,
                "goods_receipt_line_id": dist.goods_receipt_line_id,
            }
            for dist in (row.distributions or [])
        ],
    }


def _load_invoice(db: Session, invoice_id: int) -> SupplierInvoice:
    row = (
        db.query(SupplierInvoice)
        .options(
            joinedload(SupplierInvoice.lines),
            joinedload(SupplierInvoice.vendor),
            selectinload(SupplierInvoice.distributions).joinedload(
                SupplierInvoiceDistribution.gl_account
            ),
            selectinload(SupplierInvoice.distributions).joinedload(
                SupplierInvoiceDistribution.department
            ),
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


def _billed_amount_by_item(db: Session, source_type: str, source_order_id: str) -> dict[str, Decimal]:
    rows = (
        db.query(
            SupplierInvoiceLine.item_id,
            func.coalesce(func.sum(SupplierInvoiceLine.line_subtotal), 0),
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
    return {str(item_id): _d(amt) for item_id, amt in rows}


def _line_bill_amount(qty: Decimal, price: Decimal, provided: Decimal | None = None) -> Decimal:
    if qty == 0:
        amount = _d(provided) if provided is not None else price
        return amount.quantize(Decimal("0.01"))
    return (price * qty).quantize(Decimal("0.01"))


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


def _update_billing_status(db: Session, source_type: str | None, source_order_id: str | None) -> None:
    if source_type not in PO_MATCHED_SOURCES or not source_order_id:
        return
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
    received_by_user_id: UUID | None = None,
) -> dict:
    po = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items))
        .filter(PurchaseOrder.po_number == po_number)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    assert_po_approved_for_p2p(po, action="receive")
    if not lines:
        raise HTTPException(status_code=400, detail="At least one receipt line is required")

    so_lines = {int(li.item_id): li for li in (po.items or [])}
    already = _received_qty_by_item(db, "PURCHASE_ORDER", po_number)

    receipt_lines: list[dict] = []
    for raw in lines:
        line_id = int(raw["source_line_id"])
        po_line = so_lines.get(line_id)
        if not po_line:
            raise HTTPException(status_code=400, detail=f"PO line {line_id} not found")
        receipt_lines.append(raw)

    if not receipt_lines:
        raise HTTPException(status_code=400, detail="At least one receipt line is required")

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

    vendor = db.get(Supplier, po.supplier_id)
    totals_by_pair: dict[str, tuple[ChartOfAccount, ChartOfAccount, Decimal]] = {}

    for raw in receipt_lines:
        line_id = int(raw["source_line_id"])
        qty = _d(raw.get("quantity_received"))
        po_line = so_lines.get(line_id)
        if not po_line:
            raise HTTPException(status_code=400, detail=f"PO line {line_id} not found")
        catalog = catalog_item(db, po_line.sku)
        expense_line = skip_inventory_movement(catalog)
        po_qty = _d(po_line.quantity)
        already_qty = already.get(po_line.sku, Decimal("0"))
        unit_cost = _d(raw.get("unit_cost", po_line.unit_price))
        if expense_line and po_qty <= 0:
            if already_qty > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Expense line {po_line.sku} has already been received",
                )
            if qty <= 0:
                qty = Decimal("1")
            if unit_cost <= 0:
                unit_cost = _d(getattr(po_line, "line_subtotal", 0) or po_line.unit_price)
        else:
            remaining = po_qty - already_qty
            if qty <= 0:
                raise HTTPException(status_code=400, detail="quantity_received must be positive")
            if qty > remaining:
                raise HTTPException(
                    status_code=400,
                    detail=f"Quantity {qty} exceeds remaining receivable {remaining} for {po_line.sku}",
                )
        line_amount = (unit_cost * qty).quantize(Decimal("0.01"))
        already[po_line.sku] = already_qty + qty
        debit_account, grni_account = resolve_posting_pair(
            db,
            EVENT_GOODS_RECEIPT,
            receipt_variant("PURCHASE_ORDER", catalog),
            vendor,
        )
        pair_key = f"{debit_account.id}:{grni_account.id}"
        running = totals_by_pair.get(pair_key, (debit_account, grni_account, Decimal("0")))[2]
        totals_by_pair[pair_key] = (debit_account, grni_account, running + line_amount)
        line_description = (po_line.description or "").strip() or None
        if not line_description:
            catalog_row = db.get(Item, po_line.sku)
            line_description = (
                (getattr(catalog_row, "description", None) or "").strip() or po_line.sku
            )
        db.add(
            GoodsReceiptLine(
                receipt_id=receipt.id,
                source_line_id=line_id,
                item_id=po_line.sku,
                description=line_description,
                quantity_received=qty,
                unit_cost=unit_cost,
                line_amount=line_amount,
            )
        )
        if expense_line:
            continue
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
            item = db.get(Item, po_line.sku)
            if item:
                item.on_hand_quantity = int(_d(item.on_hand_quantity) + qty)

    db.flush()
    for debit_account, grni_account, total_accrual in totals_by_pair.values():
        if total_accrual <= 0:
            continue
        finance._post_balanced_journal_entry(
            db,
            description=f"Goods receipt {receipt.receipt_number} for PO {po.po_number}",
            debit_account=debit_account,
            credit_account=grni_account,
            amount=total_accrual,
            reference=receipt.receipt_number,
            posted_by_user_id=received_by_user_id,
            posting_date=receipt.receipt_date,
        )

    receipt = _receipt_query(db).filter(GoodsReceipt.id == receipt.id).first()
    return serialize_goods_receipt(receipt, db, detail=True)


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
    received_by_user_id: UUID | None = None,
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

    preferred = (external_receipt_id or "").strip() or None
    receipt_number = preferred
    if receipt_number:
        exists = (
            db.query(GoodsReceipt.id)
            .filter(GoodsReceipt.receipt_number == receipt_number)
            .first()
        )
        if exists is not None:
            receipt_number = None
    receipt = GoodsReceipt(
        receipt_number=receipt_number or _next_number(db, GoodsReceipt, "receipt_number", "GR"),
        source_type="SUBCONTRACT_ORDER",
        source_order_id=sco.sco_number,
        vendor_id=sco.supplier_id,
        receipt_date=receipt_date or date.today(),
        status="POSTED",
        notes=notes,
    )
    db.add(receipt)
    db.flush()

    catalog_row = db.get(Item, fg_item_id)
    line_description = (
        (getattr(catalog_row, "description", None) or "").strip()
        or f"Subcontract FG {fg_item_id}"
    )
    line_amount = (cost * Decimal(quantity_received)).quantize(Decimal("0.01"))
    db.add(
        GoodsReceiptLine(
            receipt_id=receipt.id,
            source_line_id=source_line_id,
            item_id=fg_item_id,
            description=line_description,
            quantity_received=Decimal(quantity_received),
            unit_cost=cost,
            line_amount=line_amount,
        )
    )
    db.flush()

    if line_amount > 0:
        vendor = db.get(Supplier, sco.supplier_id)
        debit_account, grni_account = resolve_posting_pair(
            db,
            EVENT_GOODS_RECEIPT,
            receipt_variant("SUBCONTRACT_ORDER", catalog_row),
            vendor,
        )
        finance._post_balanced_journal_entry(
            db,
            description=f"Goods receipt {receipt.receipt_number} for SCO {sco.sco_number}",
            debit_account=debit_account,
            credit_account=grni_account,
            amount=line_amount,
            reference=receipt.receipt_number,
            posted_by_user_id=received_by_user_id,
            posting_date=receipt.receipt_date,
        )

    receipt = _receipt_query(db).filter(GoodsReceipt.id == receipt.id).first()
    return serialize_goods_receipt(receipt, db, detail=True)


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
        .options(
            joinedload(SupplierInvoice.lines),
            joinedload(SupplierInvoice.vendor),
            selectinload(SupplierInvoice.distributions).joinedload(
                SupplierInvoiceDistribution.gl_account
            ),
            selectinload(SupplierInvoice.distributions).joinedload(
                SupplierInvoiceDistribution.department
            ),
        )
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


def list_posted_goods_receipts(
    db: Session,
    *,
    vendor_id: str | None = None,
    q: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict]:
    return list_goods_receipts(
        db,
        vendor_id=vendor_id,
        q=q,
        status="POSTED",
        skip=skip,
        limit=limit,
    )


def list_departments(db: Session) -> list[dict]:
    rows = db.query(Department).order_by(Department.name.asc()).all()
    return [{"id": row.id, "name": row.name} for row in rows]


def create_supplier_invoice(
    db: Session,
    *,
    source_type: str | None = None,
    source_order_id: str | None = None,
    vendor_id: str | None = None,
    invoice_type: str | None = None,
    vendor_invoice_number: str | None = None,
    invoice_date: date | None = None,
    due_date: date | None = None,
    tax_amount: Decimal | None = None,
    freight_amount: Decimal | None = None,
    currency: str = "USD",
    lines: list[dict] | None = None,
    distributions: list[dict] | None = None,
    payment_term_id=None,
    payment_terms: str | None = None,
    allocate_to_goods_receipt_id: int | None = None,
) -> dict:
    resolved_type, source_type, source_order_id = validate_supplier_invoice_payload(
        invoice_type=invoice_type,
        source_type=source_type,
        source_order_id=source_order_id,
        vendor_id=vendor_id,
        distributions=distributions,
        lines=lines,
    )
    if resolved_type in NON_PO_TYPES:
        return _create_non_po_invoice(
            db,
            invoice_type=resolved_type,
            source_type=source_type or "NON_PO",
            source_order_id=source_order_id,
            vendor_id=vendor_id or "",
            vendor_invoice_number=vendor_invoice_number,
            invoice_date=invoice_date,
            due_date=due_date,
            tax_amount=tax_amount,
            freight_amount=freight_amount,
            currency=currency,
            distributions=distributions or [],
            payment_term_id=payment_term_id,
            payment_terms=payment_terms,
            allocate_to_goods_receipt_id=allocate_to_goods_receipt_id,
        )

    if source_type not in PO_MATCHED_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid source_type")

    issue = invoice_date or date.today()
    warnings: list[str] = []
    built: list[SupplierInvoiceLine] = []
    fallback = None

    if source_type == "PURCHASE_ORDER":
        po = (
            db.query(PurchaseOrder)
            .options(joinedload(PurchaseOrder.items))
            .filter(PurchaseOrder.po_number == source_order_id)
            .first()
        )
        if not po:
            raise HTTPException(status_code=404, detail="Purchase order not found")
        assert_po_approved_for_p2p(po, action="create a supplier invoice")
        vendor_id = po.supplier_id
        fallback = po
        received = _received_qty_by_item(db, source_type, source_order_id)
        billed = _billed_qty_by_item(db, source_type, source_order_id)
        billed_amt = _billed_amount_by_item(db, source_type, source_order_id)
        stock_skus = {
            po_line.sku
            for po_line in (po.items or [])
            if is_stock_tracked(catalog_item(db, po_line.sku))
        }
        stock_received = sum((received.get(sku, Decimal("0")) for sku in stock_skus), Decimal("0"))
        if stock_skus and stock_received <= 0:
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
                catalog = catalog_item(db, item_id)
                if po_line and is_stock_tracked(catalog) and price > _d(po_line.unit_price):
                    warnings.append(
                        f"Price {price} exceeds PO unit price {_d(po_line.unit_price)} for {item_id}"
                    )
                recv = received.get(item_id, Decimal("0"))
                already = billed.get(item_id, Decimal("0"))
                if is_stock_tracked(catalog) and qty + already > recv:
                    warnings.append(
                        f"Invoiced qty {qty + already} exceeds received {recv} for {item_id}"
                    )
                provided = raw.get("line_subtotal")
                built.append(
                    SupplierInvoiceLine(
                        source_line_id=line_id,
                        item_id=item_id,
                        description=raw.get("description") or item_id,
                        quantity_billed=qty,
                        unit_price=price,
                        line_subtotal=_line_bill_amount(
                            qty, price, _d(provided) if provided is not None else None
                        ),
                    )
                )
        else:
            for po_line in po.items or []:
                catalog = catalog_item(db, po_line.sku)
                price = _d(po_line.unit_price)
                if skip_inventory_movement(catalog):
                    remaining_amt = _d(po_line.line_subtotal) - billed_amt.get(po_line.sku, Decimal("0"))
                    if remaining_amt <= 0:
                        continue
                    qty = _d(po_line.quantity)
                    built.append(
                        SupplierInvoiceLine(
                            source_line_id=int(po_line.item_id),
                            item_id=po_line.sku,
                            description=po_line.sku,
                            quantity_billed=qty,
                            unit_price=price if qty > 0 else remaining_amt,
                            line_subtotal=remaining_amt.quantize(Decimal("0.01")),
                        )
                    )
                    continue
                recv = received.get(po_line.sku, Decimal("0"))
                already = billed.get(po_line.sku, Decimal("0"))
                remaining = recv - already
                if remaining <= 0:
                    continue
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
        fallback = db.get(Supplier, vendor_id)
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

    due, term = apply_due_date(
        db,
        invoice_date=issue,
        due_date=due_date,
        payment_term_id=payment_term_id,
        payment_terms=payment_terms,
        fallback=fallback,
    )
    invoice = SupplierInvoice(
        invoice_number=_next_number(db, SupplierInvoice, "invoice_number", "VBILL"),
        vendor_id=vendor_id,
        invoice_type="PO_MATCHED",
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
    apply_payment_term_fields(
        db,
        invoice,
        payment_term_id=payment_term_id or (term.id if term else None),
        payment_terms=payment_terms,
        fallback=fallback,
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


def _create_non_po_invoice(
    db: Session,
    *,
    invoice_type: str,
    source_type: str,
    source_order_id: str | None,
    vendor_id: str,
    vendor_invoice_number: str | None,
    invoice_date: date | None,
    due_date: date | None,
    tax_amount: Decimal | None,
    freight_amount: Decimal | None,
    currency: str,
    distributions: list[dict],
    payment_term_id=None,
    payment_terms: str | None = None,
    allocate_to_goods_receipt_id: int | None = None,
) -> dict:
    vendor = db.get(Supplier, vendor_id)
    if vendor is None:
        raise HTTPException(status_code=400, detail="Vendor not found")
    if source_order_id:
        po = db.get(PurchaseOrder, source_order_id)
        sco = (
            db.query(SubcontractOrder)
            .filter(SubcontractOrder.sco_number == source_order_id)
            .first()
        )
        if po is None and sco is None:
            raise HTTPException(status_code=400, detail="Source order not found")

    issue = invoice_date or date.today()
    tax = _d(tax_amount)
    freight = _d(freight_amount)
    built_dist: list[SupplierInvoiceDistribution] = []
    built_lines: list[SupplierInvoiceLine] = []

    for raw in distributions:
        account_id = raw.get("gl_account_id")
        try:
            account_uuid = account_id if isinstance(account_id, UUID) else UUID(str(account_id))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid gl_account_id") from exc
        account = db.get(ChartOfAccount, account_uuid)
        if account is None:
            raise HTTPException(status_code=400, detail="GL account not found")
        dept_id = (raw.get("department_id") or "").strip() or None
        if dept_id and db.get(Department, dept_id) is None:
            raise HTTPException(status_code=400, detail=f"Department '{dept_id}' not found")
        amount = _d(raw.get("amount")).quantize(Decimal("0.01"))
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Distribution amount must be positive")
        receipt_id = raw.get("goods_receipt_id")
        if receipt_id is None and allocate_to_goods_receipt_id is not None and invoice_type == "LANDED_COST":
            receipt_id = allocate_to_goods_receipt_id
        receipt_line_id = raw.get("goods_receipt_line_id")
        if receipt_id is not None and db.get(GoodsReceipt, int(receipt_id)) is None:
            raise HTTPException(status_code=400, detail="Goods receipt not found")
        if receipt_line_id is not None and db.get(GoodsReceiptLine, int(receipt_line_id)) is None:
            raise HTTPException(status_code=400, detail="Goods receipt line not found")
        description = raw.get("description") or account.account_name
        built_dist.append(
            SupplierInvoiceDistribution(
                gl_account_id=account_uuid,
                department_id=dept_id,
                amount=amount,
                description=description,
                goods_receipt_id=int(receipt_id) if receipt_id is not None else None,
                goods_receipt_line_id=int(receipt_line_id) if receipt_line_id is not None else None,
            )
        )
        built_lines.append(
            SupplierInvoiceLine(
                item_id=None,
                description=description,
                quantity_billed=Decimal("1"),
                unit_price=amount,
                line_subtotal=amount,
                goods_receipt_line_id=int(receipt_line_id) if receipt_line_id is not None else None,
            )
        )

    if invoice_type == "LANDED_COST" and not source_order_id:
        linked_receipt_id = next((dist.goods_receipt_id for dist in built_dist if dist.goods_receipt_id), None)
        if linked_receipt_id is not None:
            linked_receipt = db.get(GoodsReceipt, linked_receipt_id)
            if linked_receipt is not None:
                source_order_id = linked_receipt.source_order_id

    due, term = apply_due_date(
        db,
        invoice_date=issue,
        due_date=due_date,
        payment_term_id=payment_term_id,
        payment_terms=payment_terms,
        fallback=vendor,
    )
    invoice = SupplierInvoice(
        invoice_number=_next_number(db, SupplierInvoice, "invoice_number", "VBILL"),
        vendor_id=vendor_id,
        invoice_type=invoice_type,
        source_type=source_type,
        source_order_id=source_order_id,
        vendor_invoice_number=vendor_invoice_number,
        invoice_date=issue,
        due_date=due,
        status="DRAFT",
        tax_amount=tax,
        freight_amount=freight,
        currency=currency or "USD",
    )
    apply_payment_term_fields(
        db,
        invoice,
        payment_term_id=payment_term_id or (term.id if term else None),
        payment_terms=payment_terms,
        fallback=vendor,
    )
    db.add(invoice)
    db.flush()
    for line in built_lines:
        line.invoice_id = invoice.id
        db.add(line)
    for dist in built_dist:
        dist.invoice_id = invoice.id
        db.add(dist)

    subtotal = sum((dist.amount for dist in built_dist), Decimal("0"))
    invoice.subtotal = subtotal
    invoice.total_amount = (subtotal + tax + freight).quantize(Decimal("0.01"))
    invoice.outstanding_balance = invoice.total_amount
    db.flush()
    if invoice_type == "LANDED_COST":
        _apply_landed_cost_to_linked_receipts(db, invoice)
    return serialize_supplier_invoice(_load_invoice(db, invoice.id))


def submit_supplier_invoice(db: Session, invoice_id: int) -> dict:
    invoice = _load_invoice(db, invoice_id)
    if invoice.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cannot submit a cancelled invoice")
    if invoice.status in {"APPROVED", "PAID"}:
        raise HTTPException(status_code=400, detail="Invoice is already approved")
    invoice.status = "PENDING_APPROVAL"
    invoice.updated_at = datetime.utcnow()
    db.flush()
    return serialize_supplier_invoice(_load_invoice(db, invoice_id))


def approve_supplier_invoice(db: Session, invoice_id: int) -> dict:
    invoice = _load_invoice(db, invoice_id)
    if invoice.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cannot approve a cancelled invoice")
    if invoice.status in {"APPROVED", "PAID"}:
        return serialize_supplier_invoice(invoice)

    invoice_kind = getattr(invoice, "invoice_type", None) or "PO_MATCHED"
    ap_account = resolve_ap_account(db, invoice.vendor)
    total = _d(invoice.total_amount)
    if total <= 0:
        raise HTTPException(status_code=400, detail="Invoice total must be positive")

    if invoice_kind in NON_PO_TYPES:
        _post_non_po_approval(db, invoice, ap_account, total)
    else:
        _post_po_matched_approval(db, invoice, ap_account, total)

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
            payment_term_id=getattr(invoice, "payment_term_id", None),
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


def _post_non_po_approval(db: Session, invoice: SupplierInvoice, ap_account, total: Decimal) -> None:
    inventory_account, _ap = resolve_posting_pair(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_LANDED_COST, invoice.vendor
    )
    tax_exp, _tax_ap = resolve_posting_pair(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_TAX, invoice.vendor
    )
    dists = list(invoice.distributions or [])
    if not dists:
        raise HTTPException(status_code=400, detail="Non-PO invoice is missing GL distributions")
    for dist in dists:
        debit_account = dist.gl_account or db.get(ChartOfAccount, dist.gl_account_id)
        if debit_account is None:
            raise HTTPException(status_code=400, detail="GL account not found for distribution")
        receipt = None
        if invoice.invoice_type == "LANDED_COST" and dist.goods_receipt_id:
            receipt = db.get(GoodsReceipt, dist.goods_receipt_id)
            debit_account = inventory_account
        receipt_number = getattr(receipt, "receipt_number", None)
        finance._post_balanced_journal_entry(
            db,
            description=(
                f"Supplier invoice {invoice.invoice_number} landed cost"
                + (f" for {receipt_number}" if receipt_number else "")
                + f" {dist.description or debit_account.account_name}"
            ),
            debit_account=debit_account,
            credit_account=ap_account,
            amount=_d(dist.amount),
            reference=receipt_number,
        )
    if invoice.invoice_type == "LANDED_COST":
        _apply_landed_cost_to_linked_receipts(db, invoice)
    extra = _d(invoice.tax_amount) + _d(invoice.freight_amount)
    if extra > 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number} tax/freight",
            debit_account=tax_exp,
            credit_account=ap_account,
            amount=extra.quantize(Decimal("0.01")),
        )


def _post_po_matched_approval(db: Session, invoice: SupplierInvoice, ap_account, total: Decimal) -> None:
    vendor = invoice.vendor
    grni_account, _clear_ap = resolve_posting_pair(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_GRNI_CLEAR, vendor
    )
    ppv_account, _ppv_ap = resolve_posting_pair(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_PPV_UNFAVORABLE, vendor
    )
    fav_grni, fav_ppv = resolve_posting_pair(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_PPV_FAVORABLE, vendor
    )
    tax_exp, _tax_ap = resolve_posting_pair(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_TAX, vendor
    )
    expense_account, _exp_ap = resolve_posting_pair(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_EXPENSE, vendor
    )
    accrued = (
        _accrued_amount_for_order(db, invoice.source_type, invoice.source_order_id)
        if invoice.source_order_id
        else Decimal("0")
    )
    invoice_goods = _d(invoice.subtotal)
    tax = _d(invoice.tax_amount)
    freight = _d(invoice.freight_amount)
    non_stock = Decimal("0")
    for line in invoice.lines or []:
        if skip_inventory_movement(catalog_item(db, line.item_id)):
            non_stock += _d(line.line_subtotal)
    stock_goods = max(invoice_goods - non_stock, Decimal("0"))

    clear_amount = min(accrued, invoice_goods)
    stock_clear = min(accrued, stock_goods)
    variance = stock_goods - stock_clear
    accrued_expense = max(accrued - stock_clear, Decimal("0"))
    non_stock_unaccrued = max(non_stock - accrued_expense, Decimal("0"))

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
            debit_account=fav_grni,
            credit_account=fav_ppv,
            amount=abs(variance),
        )
    if non_stock_unaccrued > 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number} non-inventory expense",
            debit_account=expense_account,
            credit_account=ap_account,
            amount=non_stock_unaccrued.quantize(Decimal("0.01")),
        )
    if tax + freight > 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number} tax/freight",
            debit_account=tax_exp,
            credit_account=ap_account,
            amount=(tax + freight).quantize(Decimal("0.01")),
        )
    if clear_amount <= 0 and variance == 0 and non_stock <= 0 and (tax + freight) <= 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number}",
            debit_account=ppv_account,
            credit_account=ap_account,
            amount=total,
        )


def pay_supplier_invoice(
    db: Session,
    invoice_id: int,
    *,
    amount: Decimal | None = None,
    bank_account_id: str | None = None,
    payment_method: str | None = None,
    instrument_ref_no: str | None = None,
    payment_date: date | datetime | None = None,
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

    txn = finance.make_payment(
        db,
        bill,
        amount=amount,
        bank_account_id=bank_account_id,
        payment_method=payment_method,
        instrument_ref_no=instrument_ref_no,
        payment_date=payment_date,
    )
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
