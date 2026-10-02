# @author: Wendy Yang
# @date: 2026-09-19

"""Procure-to-Pay: goods receipts (GRNI) and supplier invoices (vendor bills)."""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy import and_, or_, func
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.orm.attributes import flag_modified

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
from app.services.po_totals import apply_estimated_landed_unit_costs, invoice_freight_default
from app.services.finance import (
    resolve_ap_account,
)
from app.services.document_sequences import (
    DOC_BILL,
    DOC_FINISHED_GOODS_RECEIPT,
    DOC_GOODS_RECEIPT,
    generate_document_number,
    next_document_number,
)
from app.services.journal_source import SOURCE_GOODS_RECEIPT, SOURCE_SUPPLIER_INVOICE, rule_id
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
    resolve_posting_rule,
)
from app.services.payment_terms import apply_due_date, apply_payment_term_fields
from app.services.period_close import assert_dates_open, assert_transaction_date_open
from app.services.item_types import (
    catalog_item,
    is_stock_tracked,
    skip_inventory_movement,
)
from app.services.remaining_close import (
    REMAINING_ALREADY_CLOSED_DETAIL,
    REMAINING_CLOSED_RECEIVE_DETAIL,
    assert_can_close_remaining,
    is_remaining_closed,
)

PO_MATCHED_SOURCES = {"PURCHASE_ORDER", "SUBCONTRACT_ORDER"}
INVOICE_TYPES = {"PO_MATCHED", "LANDED_COST", "EXPENSE"}
NON_PO_TYPES = {"LANDED_COST", "EXPENSE"}
EDITABLE_INVOICE_STATUSES = frozenset({"DRAFT", "REJECTED", "PENDING_APPROVAL"})
RECALLABLE_APPROVAL_STATUSES = frozenset({"APPROVED", "PENDING_APPROVAL", "SUBMITTED"})
RECALLABLE_PO_STATUSES = frozenset({"Submitted", "Approved"})
PURCHASE_ORDER_LOCKED_EDIT_DETAIL = (
    "Approved purchase orders cannot be modified directly. "
    "Use Create Revision."
)
_PO_IN_APPROVAL_EDIT_DETAIL = (
    "This purchase order is in approval. "
    "Use Create Revision to edit."
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
_PO_DELETE_HAS_RECEIPTS = (
    "Cannot delete this purchase order because posted goods receipts exist. "
    "Open Sales & Procurement → Goods Receipts to view the PU67- receipt and its journal."
)
_PO_DELETE_HAS_INVOICES = (
    "Cannot delete this purchase order because supplier invoices exist."
)
_PO_DELETE_NOT_DRAFT = (
    "Only draft purchase orders with no receipts or invoices can be deleted."
)
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


def require_approved_reference_po(db: Session, po_number: str) -> PurchaseOrder:
    po = db.get(PurchaseOrder, po_number)
    if po is None:
        raise HTTPException(status_code=400, detail="Reference purchase order not found")
    assert_po_approved_for_p2p(po, action="use as a tracking reference")
    return po


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


def purchase_order_delete_reason(db: Session, po: PurchaseOrder) -> str | None:
    has_receipts, has_invoices = po_downstream_flags(db, po.po_number)
    if has_receipts:
        return _PO_DELETE_HAS_RECEIPTS
    if has_invoices:
        return _PO_DELETE_HAS_INVOICES
    approval = _normalize_po_approval(getattr(po, "approval_status", None))
    status = getattr(po, "status", None) or ""
    if approval not in {"DRAFT", "REJECTED"} or status not in {"Draft", ""}:
        return _PO_DELETE_NOT_DRAFT
    return None


def assert_purchase_order_deletable(db: Session, po: PurchaseOrder) -> None:
    reason = purchase_order_delete_reason(db, po)
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


def assert_receipt_qty_adjustment(
    *,
    sku: str,
    old_qty: Decimal,
    new_qty: Decimal,
    ordered_qty: Decimal,
    already_received: Decimal,
    billed_qty: Decimal,
    remaining_closed: bool,
    amount_only: bool = False,
) -> None:
    """Validate a correction to one posted goods-receipt line."""
    if new_qty <= 0:
        raise HTTPException(status_code=400, detail="quantity_received must be positive")
    if new_qty == old_qty:
        return
    delta = new_qty - old_qty
    if remaining_closed and delta > 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Remaining quantity on this purchase order is closed. "
                "You can reduce a mistaken receipt but cannot receive more."
            ),
        )
    other_received = already_received - old_qty
    if other_received < 0:
        other_received = Decimal("0")
    if not amount_only and ordered_qty > 0 and other_received + new_qty > ordered_qty:
        remaining = ordered_qty - other_received
        raise HTTPException(
            status_code=400,
            detail=f"Quantity {new_qty} exceeds remaining receivable {remaining} for {sku}",
        )
    if other_received + new_qty < billed_qty:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reduce {sku} below billed quantity {billed_qty}",
        )


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
        recv_left = (
            Decimal("0")
            if is_remaining_closed(po)
            else remaining_to_receive(_d(line.quantity), already_recv, amount_only=amount_only)
        )
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
    if po.can_receive_goods:
        po.receive_blocked_reason = None
    elif is_remaining_closed(po):
        po.receive_blocked_reason = REMAINING_CLOSED_RECEIVE_DETAIL
    else:
        po.receive_blocked_reason = ALL_PO_ITEMS_RECEIVED_MESSAGE
    received_total = sum(
        (received.get(line.sku, Decimal("0")) for line in (po.items or [])),
        Decimal("0"),
    )
    po.can_close_remaining = (
        not is_remaining_closed(po)
        and (po.status or "") == "Approved"
        and remaining_recv > 0
        and received_total > 0
        and remaining_bill <= 0
    )
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


def close_purchase_order_remaining(db: Session, po_number: str) -> PurchaseOrder:
    po = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items))
        .filter(PurchaseOrder.po_number == po_number)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if is_remaining_closed(po):
        raise HTTPException(status_code=400, detail=REMAINING_ALREADY_CLOSED_DETAIL)
    if (po.status or "") == "Void":
        raise HTTPException(status_code=400, detail="Cannot cancel remaining quantity on a void purchase order.")
    if (po.status or "") != "Approved":
        raise HTTPException(status_code=400, detail="Purchase order must be Approved to cancel remaining")
    attach_po_p2p_progress(db, po)
    received_total = sum(
        (_d(getattr(line, "quantity_received", 0)) for line in (po.items or [])),
        Decimal("0"),
    )
    remaining_total = sum(
        (_d(getattr(line, "quantity_remaining_to_receive", 0)) for line in (po.items or [])),
        Decimal("0"),
    )
    unbilled_total = sum(
        (_d(getattr(line, "quantity_remaining_to_bill", 0)) for line in (po.items or [])),
        Decimal("0"),
    )
    assert_can_close_remaining(
        progressed=received_total,
        remaining=remaining_total,
        unbilled=unbilled_total,
    )
    po.remaining_closed = True
    po.remaining_closed_at = datetime.utcnow()
    db.flush()
    _update_billing_status(db, "PURCHASE_ORDER", po.po_number)
    return attach_po_p2p_progress(db, po)


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
    po.can_revise = po.can_recall
    po.revise_blocked_reason = po.recall_blocked_reason
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


def _normalize_receipt_ids(receipt_ids: list | None) -> list[str]:
    keys: list[str] = []
    for raw in receipt_ids or []:
        if raw is None:
            continue
        key = str(raw).strip()
        if key:
            keys.append(key)
    return keys


def validate_supplier_invoice_payload(
    *,
    invoice_type: str | None,
    source_type: str | None,
    source_order_id: str | None,
    vendor_id: str | None,
    distributions: list[dict] | None,
    lines: list[dict] | None,
    receipt_ids: list | None = None,
) -> tuple[str, str | None, str | None]:
    """Return (invoice_type, source_type, source_order_id). Raises HTTPException on bad input."""
    resolved_type = resolve_invoice_type(invoice_type, source_type)
    if resolved_type not in INVOICE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid invoice_type")

    source = (source_type or "").strip().upper() or None
    order_id = (source_order_id or "").strip() or None
    vendor = (vendor_id or "").strip() or None
    receipt_keys = _normalize_receipt_ids(receipt_ids)

    if resolved_type == "PO_MATCHED":
        if source and source not in PO_MATCHED_SOURCES:
            raise HTTPException(
                status_code=400,
                detail="PO-matched invoices require source_type PURCHASE_ORDER or SUBCONTRACT_ORDER",
            )
        if not order_id and not receipt_keys:
            raise HTTPException(
                status_code=400,
                detail="PO-matched invoices require receipt_ids or a source_order_id",
            )
        if source not in PO_MATCHED_SOURCES and not receipt_keys:
            raise HTTPException(
                status_code=400,
                detail="PO-matched invoices require source_type PURCHASE_ORDER or SUBCONTRACT_ORDER",
            )
        return resolved_type, source if source in PO_MATCHED_SOURCES else None, order_id

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


def apply_receipt_landed_costs(
    db: Session,
    receipt: GoodsReceipt,
    *,
    persist: bool = False,
) -> dict[int, Decimal]:
    allocations = landed_allocations_for_receipt(db, receipt)
    for line in receipt.lines or []:
        extra = allocations.get(line.id) or Decimal("0.00")
        annotate_receipt_line(line, extra)
        if persist:
            line.allocated_landed_cost = extra
            line.actual_unit_cost = getattr(line, "landed_unit_cost", None) or line.unit_cost
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
    received_by_po_line: dict[int, Decimal] = {}
    for receipt in receipts:
        allocations = apply_receipt_landed_costs(db, receipt)
        for line in receipt.lines or []:
            if line.source_line_id is None:
                continue
            key = int(line.source_line_id)
            extra_by_po_line[key] = extra_by_po_line.get(key, Decimal("0.00")) + (
                allocations.get(line.id) or Decimal("0.00")
            )
            received_by_po_line[key] = received_by_po_line.get(key, Decimal("0.00")) + _d(
                line.quantity_received
            )
    # Reset estimated extras first so a second apply does not stack actual freight.
    apply_estimated_landed_unit_costs(po)
    for item in po.items or []:
        key = int(item.item_id)
        annotate_po_line(
            item,
            extra_by_po_line.get(key, Decimal("0.00")),
            received_qty=received_by_po_line.get(key),
        )


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
        apply_receipt_landed_costs(db, receipt, persist=True)
        if (receipt.source_type or "").upper() == "PURCHASE_ORDER" and receipt.source_order_id:
            po = (
                db.query(PurchaseOrder)
                .options(selectinload(PurchaseOrder.items))
                .filter(PurchaseOrder.po_number == receipt.source_order_id)
                .first()
            )
            if po is not None:
                apply_po_actual_landed_costs(db, po)


def _receipt_billing_status(received: Decimal, invoiced: Decimal) -> str:
    if invoiced <= 0:
        return "UNBILLED"
    if invoiced >= received:
        return "FULLY_BILLED"
    return "PARTIALLY_BILLED"


def _serialize_receipt_line(
    line: GoodsReceiptLine,
    allocations: dict[int, Decimal] | None = None,
    db: Session | None = None,
    *,
    detail: bool = False,
) -> dict:
    allocations = allocations or {}
    qty_received = _d(line.quantity_received)
    if detail and db is not None and line.id:
        invoiced = _billed_qty_for_receipt_line(db, line.id)
    else:
        invoiced = _d(getattr(line, "quantity_invoiced", 0))
    unbilled = qty_received - invoiced if qty_received > invoiced else Decimal("0")
    allocated = getattr(line, "allocated_landed_amount", None)
    if allocated is None:
        allocated = getattr(line, "allocated_landed_cost", None)
    if allocated is None:
        allocated = allocations.get(line.id) or Decimal("0.00")
    unit_cost = line.unit_cost
    return {
        "id": line.id,
        "receipt_id": line.receipt_id,
        "source_line_id": line.source_line_id,
        "item_id": line.item_id,
        "description": line.description,
        "item_description": None,
        "quantity_ordered": None,
        "quantity_received": line.quantity_received,
        "unit_cost": unit_cost,
        "receipt_unit_cost": unit_cost,
        "line_amount": line.line_amount,
        "allocated_landed_amount": allocated,
        "allocated_landed_cost": getattr(line, "allocated_landed_cost", None) or allocated,
        "landed_unit_cost": getattr(line, "landed_unit_cost", unit_cost),
        "actual_unit_cost": getattr(line, "actual_unit_cost", None)
        or getattr(line, "landed_unit_cost", None)
        or unit_cost,
        "quantity_invoiced": invoiced,
        "quantity_unbilled": unbilled,
        "billing_status": _receipt_billing_status(qty_received, invoiced),
        "uom": None,
        "lot_number": None,
        "serial_number": None,
    }


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
        _serialize_receipt_line(line, allocations, db, detail=detail)
        for line in (row.lines or [])
    ]
    if db is not None:
        _apply_ordered_qty(db, row, lines_payload)
    total_amount = sum((_d(line.line_amount) for line in (row.lines or [])), Decimal("0"))
    qty_received = sum((_d(line.quantity_received) for line in (row.lines or [])), Decimal("0"))
    qty_invoiced = sum((_d(line.get("quantity_invoiced")) for line in lines_payload), Decimal("0"))
    qty_unbilled = sum((_d(line.get("quantity_unbilled")) for line in lines_payload), Decimal("0"))
    weighted_cost = (
        (sum((_d(line.unit_cost) * _d(line.quantity_received) for line in (row.lines or [])), Decimal("0")) / qty_received)
        if qty_received > 0
        else Decimal("0")
    )
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
        "quantity_received": qty_received,
        "quantity_invoiced": qty_invoiced,
        "quantity_unbilled": qty_unbilled,
        "receipt_unit_cost": weighted_cost.quantize(Decimal("0.0001")) if qty_received > 0 else None,
        "billing_status": _receipt_billing_status(qty_received, qty_invoiced),
        "can_adjust_quantities": _can_adjust_receipt_quantities(row),
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
        "journal_number": entry.journal_number,
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
        "is_system_generated": bool(entry.is_system_generated),
        "source_document_type": entry.source_document_type,
        "source_record_id": entry.source_record_id,
        "posting_rule_id": entry.posting_rule_id,
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
                and_(
                    JournalEntry.source_document_type == SOURCE_GOODS_RECEIPT,
                    JournalEntry.source_record_id == number,
                ),
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


def _apply_ordered_qty(db: Session, receipt: GoodsReceipt, lines_payload: list[dict]) -> None:
    ordered = _ordered_qty_by_source_line(db, receipt)
    sco_fallback = _fallback_sco_ordered_qty(db, receipt)
    for line, raw in zip(receipt.lines or [], lines_payload):
        if line.source_line_id is not None and int(line.source_line_id) in ordered:
            raw["quantity_ordered"] = ordered[int(line.source_line_id)]
        elif sco_fallback is not None:
            raw["quantity_ordered"] = sco_fallback


def _enrich_goods_receipt_detail(db: Session, receipt: GoodsReceipt, payload: dict) -> None:
    _apply_ordered_qty(db, receipt, payload["lines"])
    for line, raw in zip(receipt.lines or [], payload["lines"]):
        catalog = getattr(line, "item", None)
        po_uom = None
        if (receipt.source_type or "").upper() == "PURCHASE_ORDER" and line.source_line_id is not None:
            po_line = db.get(PurchaseOrderItem, int(line.source_line_id))
            po_uom = getattr(po_line, "uom", None) if po_line is not None else None
        raw["item_description"] = _line_item_description(line)
        raw["uom"] = po_uom or getattr(catalog, "uom", None) or "Each"
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
    unbilled_only: bool = False,
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
    rows = [serialize_goods_receipt(r, db) for r in query.offset(skip).limit(limit).all()]
    if unbilled_only:
        rows = [row for row in rows if _d(row.get("quantity_unbilled")) > 0]
    return rows


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
        "reference_po_number": getattr(row, "reference_po_number", None),
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
                "goods_receipt_number": getattr(
                    getattr(dist, "goods_receipt", None), "receipt_number", None
                ),
                "source_order_id": getattr(
                    getattr(dist, "goods_receipt", None), "source_order_id", None
                ),
                "goods_receipt_line_id": dist.goods_receipt_line_id,
            }
            for dist in (row.distributions or [])
        ],
    }


def _load_invoice(db: Session, invoice_id: int) -> SupplierInvoice:
    row = (
        db.query(SupplierInvoice)
        .options(
            selectinload(SupplierInvoice.lines)
            .joinedload(SupplierInvoiceLine.goods_receipt_line)
            .joinedload(GoodsReceiptLine.receipt),
            joinedload(SupplierInvoice.vendor),
            selectinload(SupplierInvoice.distributions).joinedload(
                SupplierInvoiceDistribution.gl_account
            ),
            selectinload(SupplierInvoice.distributions).joinedload(
                SupplierInvoiceDistribution.department
            ),
            selectinload(SupplierInvoice.distributions).joinedload(
                SupplierInvoiceDistribution.goods_receipt
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
        received = _received_qty_by_item(db, "PURCHASE_ORDER", source_order_id)
        cap = received if is_remaining_closed(po) else ordered
        any_billed = any(billed.get(sku, 0) > 0 for sku in ordered)
        fully = all(billed.get(sku, 0) >= cap.get(sku, Decimal("0")) for sku in ordered)
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
        receipts = (
            db.query(FinishedGoodsReceipt)
            .filter(FinishedGoodsReceipt.sco_number == source_order_id)
            .all()
        )
        received_by_line: dict[int, Decimal] = {}
        received_total = Decimal("0")
        for receipt in receipts:
            qty = _d(receipt.quantity_received)
            received_total += qty
            if receipt.sco_line_id:
                line_id = int(receipt.sco_line_id)
                received_by_line[line_id] = received_by_line.get(line_id, Decimal("0")) + qty
        if sco.lines:
            any_billed = False
            fully = True
            for line in sco.lines:
                qty_billed = billed.get(line.item_id, Decimal("0"))
                cap = (
                    received_by_line.get(int(line.sco_line_id), Decimal("0"))
                    if is_remaining_closed(sco)
                    else _d(line.quantity_ordered)
                )
                if qty_billed > 0:
                    any_billed = True
                if qty_billed < cap:
                    fully = False
            if not any_billed:
                sco.billing_status = "UNBILLED"
            elif fully:
                sco.billing_status = "FULLY_BILLED"
            else:
                sco.billing_status = "PARTIALLY_BILLED"
        else:
            qty_billed = billed.get(sco.item_id, Decimal("0"))
            cap = received_total if is_remaining_closed(sco) else _d(sco.quantity_ordered)
            if qty_billed <= 0:
                sco.billing_status = "UNBILLED"
            elif qty_billed >= cap:
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
    if is_remaining_closed(po):
        raise HTTPException(status_code=400, detail=REMAINING_CLOSED_RECEIVE_DETAIL)
    assert_transaction_date_open(
        db, receipt_date or date.today(), document="goods receipt"
    )
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
        receipt_number=generate_document_number(db, DOC_GOODS_RECEIPT, receipt_date),
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
        debit_account, grni_account, posting_rule = resolve_posting_rule(
            db,
            EVENT_GOODS_RECEIPT,
            receipt_variant("PURCHASE_ORDER", catalog),
            vendor,
        )
        pair_key = f"{debit_account.id}:{grni_account.id}"
        existing = totals_by_pair.get(pair_key)
        running = existing[2] if existing else Decimal("0")
        existing_rule_id = existing[3] if existing else None
        totals_by_pair[pair_key] = (
            debit_account,
            grni_account,
            running + line_amount,
            existing_rule_id or rule_id(posting_rule),
        )
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
                allocated_landed_cost=Decimal("0"),
                actual_unit_cost=unit_cost,
                quantity_invoiced=Decimal("0"),
                billing_status="UNBILLED",
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
    for debit_account, grni_account, total_accrual, posting_rule_id in totals_by_pair.values():
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
            source_document_type=SOURCE_GOODS_RECEIPT,
            source_record_id=receipt.receipt_number,
            posting_rule_id=posting_rule_id,
        )

    receipt = _receipt_query(db).filter(GoodsReceipt.id == receipt.id).first()
    return serialize_goods_receipt(receipt, db, detail=True)


def _can_adjust_receipt_quantities(row: GoodsReceipt) -> bool:
    return (row.status or "").upper() == "POSTED" and (row.source_type or "").upper() == "PURCHASE_ORDER"


def _billed_qty_for_receipt_line(db: Session, line_id: int) -> Decimal:
    total = (
        db.query(func.coalesce(func.sum(SupplierInvoiceLine.quantity_billed), 0))
        .join(SupplierInvoice)
        .filter(
            SupplierInvoiceLine.goods_receipt_line_id == line_id,
            SupplierInvoice.status.notin_(("CANCELLED",)),
        )
        .scalar()
    )
    return _d(total)


def _receipt_unit_cost(line: GoodsReceiptLine) -> Decimal:
    return _d(line.unit_cost)


def _receipt_billable_unit_cost(line: GoodsReceiptLine) -> Decimal:
    """AP goods price is the receipt unit cost; landed cost is billed separately."""
    landed = _d(
        getattr(line, "allocated_landed_cost", 0) or getattr(line, "allocated_landed_amount", 0)
    )
    if landed > 0:
        return _receipt_unit_cost(line)
    actual = getattr(line, "actual_unit_cost", None)
    if actual is not None and _d(actual) > 0:
        return _d(actual)
    return _receipt_unit_cost(line)


def _invoiced_qty_for_receipt_line(db: Session, line: GoodsReceiptLine) -> Decimal:
    live = (
        _billed_qty_for_receipt_line(db, line.id)
        if getattr(line, "id", None)
        else Decimal("0")
    )
    stored = _d(getattr(line, "quantity_invoiced", 0))
    return live if live > stored else stored


def _unbilled_qty_for_receipt_line(db: Session, line: GoodsReceiptLine) -> Decimal:
    leftover = _d(line.quantity_received) - _invoiced_qty_for_receipt_line(db, line)
    return leftover if leftover > 0 else Decimal("0")


def _sync_receipt_line_billing(db: Session, line: GoodsReceiptLine) -> None:
    billed = _invoiced_qty_for_receipt_line(db, line)
    line.quantity_invoiced = billed
    line.billing_status = _receipt_billing_status(_d(line.quantity_received), billed)


def _add_invoiced_qty(line: GoodsReceiptLine, qty: Decimal) -> None:
    invoiced = _d(getattr(line, "quantity_invoiced", 0)) + _d(qty)
    if invoiced < 0:
        invoiced = Decimal("0")
    line.quantity_invoiced = invoiced
    line.billing_status = _receipt_billing_status(_d(line.quantity_received), invoiced)


def _load_receipts_by_keys(db: Session, keys: list[str]) -> list[GoodsReceipt]:
    seen: set[int] = set()
    receipts: list[GoodsReceipt] = []
    for key in keys:
        row = resolve_goods_receipt(db, key)
        if row is None:
            raise HTTPException(status_code=404, detail=f"Goods receipt {key} not found")
        if row.id in seen:
            continue
        seen.add(row.id)
        if (row.status or "").upper() != "POSTED":
            raise HTTPException(
                status_code=400,
                detail=f"Goods receipt {row.receipt_number} must be posted before billing",
            )
        receipts.append(row)
    if not receipts:
        raise HTTPException(status_code=400, detail="No goods receipts selected")
    return receipts


def _posted_receipts_for_order(
    db: Session, source_type: str, source_order_id: str
) -> list[GoodsReceipt]:
    return (
        _receipt_query(db)
        .filter(
            GoodsReceipt.source_type == source_type,
            GoodsReceipt.source_order_id == source_order_id,
            GoodsReceipt.status == "POSTED",
        )
        .order_by(GoodsReceipt.receipt_date.asc(), GoodsReceipt.id.asc())
        .all()
    )


def _assert_source_orders_approved(db: Session, receipts: list[GoodsReceipt]) -> None:
    seen: set[tuple[str, str]] = set()
    for receipt in receipts:
        source = (receipt.source_type or "").upper()
        order_id = receipt.source_order_id
        key = (source, order_id)
        if key in seen:
            continue
        seen.add(key)
        if source == "PURCHASE_ORDER":
            po = db.get(PurchaseOrder, order_id)
            if not po:
                raise HTTPException(status_code=404, detail="Purchase order not found")
            assert_po_approved_for_p2p(po, action="create a supplier invoice")
        elif source == "SUBCONTRACT_ORDER":
            sco = db.get(SubcontractOrder, order_id)
            if not sco:
                raise HTTPException(status_code=404, detail="Subcontract order not found")
            if (sco.approval_status or "").upper() != "APPROVED":
                raise HTTPException(status_code=400, detail="Subcontract order must be APPROVED")


def _order_defaults_for_receipts(
    db: Session, receipts: list[GoodsReceipt]
) -> tuple[object | None, Decimal, Decimal]:
    first = receipts[0]
    source = (first.source_type or "").upper()
    if source == "PURCHASE_ORDER":
        po = (
            db.query(PurchaseOrder)
            .options(joinedload(PurchaseOrder.items))
            .filter(PurchaseOrder.po_number == first.source_order_id)
            .first()
        )
        if po is None:
            return db.get(Supplier, first.vendor_id), Decimal("0"), Decimal("0")
        return (
            po,
            _d(po.total_tax),
            invoice_freight_default(po.shipping_fee, getattr(po, "freight_terms", None)),
        )
    return db.get(Supplier, first.vendor_id), Decimal("0"), Decimal("0")


def _receipt_stock_home(db: Session, receipt: GoodsReceipt, item_id: str) -> tuple[str | None, str | None]:
    movement = (
        db.query(StockMovement)
        .filter(
            StockMovement.item_id == item_id,
            StockMovement.reference == receipt.receipt_number,
        )
        .order_by(StockMovement.movement_date.desc(), StockMovement.created_at.desc())
        .first()
    )
    if movement is None:
        return None, None
    return movement.warehouse_id, movement.bin_id


def _accrual_journals_for_receipt(db: Session, receipt: GoodsReceipt) -> list[JournalEntry]:
    return [
        entry
        for entry in _load_receipt_journals(db, receipt)
        if _journal_purpose(entry, receipt.receipt_number) == "GRNI_ACCRUAL"
    ]


def _original_grni_accrual(db: Session, receipt: GoodsReceipt) -> JournalEntry | None:
    journals = _accrual_journals_for_receipt(db, receipt)
    if not journals:
        return None
    originals = [
        entry
        for entry in journals
        if "quantity adjustment" not in (entry.description or "").lower()
    ]
    return originals[0] if originals else journals[0]


def apply_balanced_amount_to_postings(postings: list, amount: Decimal) -> bool:
    """Rewrite a two-sided journal so debit and credit both equal amount."""
    amount = _d(amount).quantize(Decimal("0.01"))
    rows = list(postings or [])
    if amount <= 0 or len(rows) < 2:
        return False
    debit_posting = next((row for row in rows if _d(row.debit) > _d(row.credit)), None)
    credit_posting = next((row for row in rows if _d(row.credit) > _d(row.debit)), None)
    if debit_posting is None or credit_posting is None or debit_posting is credit_posting:
        debit_posting, credit_posting = rows[0], rows[1]
    debit_posting.debit = amount
    debit_posting.credit = Decimal("0.0000")
    credit_posting.credit = amount
    credit_posting.debit = Decimal("0.0000")
    return True


def _set_journal_balanced_amount(entry: JournalEntry, amount: Decimal) -> bool:
    return apply_balanced_amount_to_postings(entry.postings or [], amount)


def _journal_accounts(entry: JournalEntry) -> tuple[ChartOfAccount | None, ChartOfAccount | None]:
    debit_account = None
    credit_account = None
    for posting in entry.postings or []:
        account = getattr(posting, "account", None)
        if _d(posting.debit) > 0:
            debit_account = account
        if _d(posting.credit) > 0:
            credit_account = account
    return debit_account, credit_account


def _apply_receipt_qty_stock_delta(
    db: Session,
    *,
    receipt: GoodsReceipt,
    item_id: str,
    delta: Decimal,
) -> None:
    if delta == 0:
        return
    catalog = catalog_item(db, item_id)
    if skip_inventory_movement(catalog):
        return
    warehouse_id, bin_id = _receipt_stock_home(db, receipt, item_id)
    notes = f"Quantity correction on {receipt.receipt_number}"
    if delta == delta.to_integral_value():
        inventory.adjust_stock(
            db,
            item_id=item_id,
            quantity_delta=int(delta),
            notes=notes,
            warehouse_id=warehouse_id,
            bin_id=bin_id,
            reference=receipt.receipt_number,
        )
        return
    item = db.get(Item, item_id)
    if item:
        item.on_hand_quantity = int(_d(item.on_hand_quantity) + delta)


def _sync_receipt_grni_journal(
    db: Session,
    *,
    receipt: GoodsReceipt,
    old_total: Decimal,
    new_total: Decimal,
    received_by_user_id: UUID | None,
) -> None:
    """Set the original GRNI journal debit/credit to the corrected receipt value."""
    amount = _d(new_total).quantize(Decimal("0.01"))
    entry = _original_grni_accrual(db, receipt)
    if amount <= 0:
        return
    if entry is None:
        vendor = db.get(Supplier, receipt.vendor_id)
        first_line = next(iter(receipt.lines or []), None)
        catalog = catalog_item(db, first_line.item_id) if first_line is not None else None
        debit_account, credit_account, posting_rule = resolve_posting_rule(
            db,
            EVENT_GOODS_RECEIPT,
            receipt_variant(receipt.source_type or "PURCHASE_ORDER", catalog),
            vendor,
        )
        finance._post_balanced_journal_entry(
            db,
            description=f"Goods receipt {receipt.receipt_number} for PO {receipt.source_order_id}",
            debit_account=debit_account,
            credit_account=credit_account,
            amount=amount,
            reference=receipt.receipt_number,
            posted_by_user_id=received_by_user_id,
            posting_date=receipt.receipt_date or date.today(),
            source_document_type=SOURCE_GOODS_RECEIPT,
            source_record_id=receipt.receipt_number,
            posting_rule_id=rule_id(posting_rule),
        )
        return
    postings = db.query(LedgerPosting).filter(LedgerPosting.entry_id == entry.id).all()
    if not apply_balanced_amount_to_postings(postings, amount):
        raise HTTPException(
            status_code=400,
            detail="Could not recalculate GRNI journal debit/credit for this receipt.",
        )
    for posting in postings:
        flag_modified(posting, "debit")
        flag_modified(posting, "credit")
    db.flush()
    extras = [
        extra
        for extra in _accrual_journals_for_receipt(db, receipt)
        if extra.id != entry.id
        and "quantity adjustment" in (extra.description or "").lower()
        and (extra.posting_status or "").lower() != "posted"
        and (extra.approval_status or "").upper() == "DRAFT"
    ]
    for extra in extras:
        db.query(LedgerPosting).filter(LedgerPosting.entry_id == extra.id).delete()
        db.delete(extra)
    db.flush()


def adjust_goods_receipt_quantities(
    db: Session,
    *,
    receipt_key: str,
    lines: list[dict],
    notes: str | None = None,
    received_by_user_id: UUID | None = None,
) -> dict:
    receipt = resolve_goods_receipt(db, receipt_key)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Goods receipt not found")
    receipt = _receipt_query(db).filter(GoodsReceipt.id == receipt.id).first()
    if receipt is None:
        raise HTTPException(status_code=404, detail="Goods receipt not found")
    if (receipt.status or "").upper() != "POSTED":
        raise HTTPException(status_code=400, detail="Only posted goods receipts can be corrected")
    if (receipt.source_type or "").upper() != "PURCHASE_ORDER":
        raise HTTPException(
            status_code=400,
            detail="Correct finished-goods quantity from the subcontract order, not this receipt.",
        )
    assert_transaction_date_open(db, receipt.receipt_date, document="goods receipt")
    if not lines:
        raise HTTPException(status_code=400, detail="At least one receipt line is required")

    po = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items))
        .filter(PurchaseOrder.po_number == receipt.source_order_id)
        .first()
    )
    if po is None:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    by_id = {int(line.id): line for line in (receipt.lines or []) if line.id is not None}
    po_lines = {int(item.item_id): item for item in (po.items or [])}
    already = _received_qty_by_item(db, "PURCHASE_ORDER", po.po_number)
    billed = _billed_qty_by_item(db, "PURCHASE_ORDER", po.po_number)
    remaining_closed = is_remaining_closed(po)
    old_total = sum((_d(line.line_amount) for line in (receipt.lines or [])), Decimal("0"))

    updates: list[tuple[GoodsReceiptLine, Decimal, Decimal]] = []
    seen: set[int] = set()
    for raw in lines:
        line_id = int(raw["id"])
        if line_id in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate receipt line {line_id}")
        seen.add(line_id)
        line = by_id.get(line_id)
        if line is None:
            raise HTTPException(status_code=400, detail=f"Receipt line {line_id} not found")
        new_qty = _d(raw.get("quantity_received"))
        old_qty = _d(line.quantity_received)
        po_line = po_lines.get(int(line.source_line_id)) if line.source_line_id is not None else None
        catalog = catalog_item(db, line.item_id)
        ordered_qty = _d(po_line.quantity) if po_line is not None else Decimal("0")
        amount_only = skip_inventory_movement(catalog) and ordered_qty <= 0
        line_billed = max(billed.get(line.item_id, Decimal("0")), _billed_qty_for_receipt_line(db, line_id))
        assert_receipt_qty_adjustment(
            sku=line.item_id,
            old_qty=old_qty,
            new_qty=new_qty,
            ordered_qty=ordered_qty,
            already_received=already.get(line.item_id, Decimal("0")),
            billed_qty=line_billed,
            remaining_closed=remaining_closed,
            amount_only=amount_only,
        )
        if new_qty == old_qty:
            continue
        already[line.item_id] = already.get(line.item_id, Decimal("0")) - old_qty + new_qty
        updates.append((line, old_qty, new_qty))

    if not updates:
        raise HTTPException(status_code=400, detail="No quantity changes to save")

    for line, old_qty, new_qty in updates:
        unit_cost = _d(line.unit_cost)
        line.quantity_received = new_qty
        line.line_amount = (unit_cost * new_qty).quantize(Decimal("0.01"))
        _apply_receipt_qty_stock_delta(
            db,
            receipt=receipt,
            item_id=line.item_id,
            delta=new_qty - old_qty,
        )

    db.flush()
    new_total = sum((_d(line.line_amount) for line in (receipt.lines or [])), Decimal("0"))
    _sync_receipt_grni_journal(
        db,
        receipt=receipt,
        old_total=old_total,
        new_total=new_total,
        received_by_user_id=received_by_user_id,
    )
    if notes and notes.strip():
        existing = (receipt.notes or "").strip()
        addition = notes.strip()
        receipt.notes = f"{existing}\n{addition}".strip() if existing else addition

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
        receipt_number=receipt_number
        or next_document_number(db, DOC_FINISHED_GOODS_RECEIPT, receipt_date),
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
            allocated_landed_cost=Decimal("0"),
            actual_unit_cost=cost,
            quantity_invoiced=Decimal("0"),
            billing_status="UNBILLED",
        )
    )
    db.flush()

    if line_amount > 0:
        vendor = db.get(Supplier, sco.supplier_id)
        debit_account, grni_account, posting_rule = resolve_posting_rule(
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
            source_document_type=SOURCE_GOODS_RECEIPT,
            source_record_id=receipt.receipt_number,
            posting_rule_id=rule_id(posting_rule),
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
    source_type: str | None = None,
    source_order_id: str | None = None,
    unbilled_only: bool = False,
    q: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict]:
    return list_goods_receipts(
        db,
        vendor_id=vendor_id,
        source_type=source_type,
        source_order_id=source_order_id,
        unbilled_only=unbilled_only,
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
    receipt_ids: list | None = None,
    reference_po_number: str | None = None,
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
        receipt_ids=receipt_ids,
    )
    assert_transaction_date_open(
        db, invoice_date or date.today(), document="supplier invoice"
    )
    if resolved_type in NON_PO_TYPES:
        return _create_non_po_invoice(
            db,
            invoice_type=resolved_type,
            source_type=source_type or "NON_PO",
            source_order_id=source_order_id,
            reference_po_number=reference_po_number,
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

    receipt_keys = _normalize_receipt_ids(receipt_ids)
    if receipt_keys:
        receipts = _load_receipts_by_keys(db, receipt_keys)
    elif source_order_id and source_type in PO_MATCHED_SOURCES:
        receipts = _posted_receipts_for_order(db, source_type, source_order_id)
        if not receipts:
            raise HTTPException(
                status_code=400,
                detail="Receive goods against the source document before creating a supplier invoice",
            )
    else:
        raise HTTPException(status_code=400, detail="PO-matched invoices require receipt_ids")

    vendors = {receipt.vendor_id for receipt in receipts}
    if len(vendors) != 1:
        raise HTTPException(status_code=400, detail="Selected goods receipts must share the same vendor")
    source_types = {(receipt.source_type or "").upper() for receipt in receipts}
    if len(source_types) != 1:
        raise HTTPException(
            status_code=400,
            detail="Selected goods receipts must be the same source type",
        )
    source_type = source_types.pop()
    if source_type not in PO_MATCHED_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid source_type")
    _assert_source_orders_approved(db, receipts)
    order_ids = {receipt.source_order_id for receipt in receipts if receipt.source_order_id}
    source_order_id = next(iter(order_ids)) if len(order_ids) == 1 else receipts[0].source_order_id
    vendor_id = receipts[0].vendor_id
    fallback, default_tax, default_freight = _order_defaults_for_receipts(db, receipts)

    issue = invoice_date or date.today()
    warnings: list[str] = []
    built: list[SupplierInvoiceLine] = []
    receipt_line_by_id: dict[int, tuple[GoodsReceipt, GoodsReceiptLine]] = {}
    for receipt in receipts:
        apply_receipt_landed_costs(db, receipt)
        for gr_line in receipt.lines or []:
            receipt_line_by_id[int(gr_line.id)] = (receipt, gr_line)

    if lines:
        for raw in lines:
            gr_line_id = raw.get("goods_receipt_line_id")
            if gr_line_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="Invoice lines must include goods_receipt_line_id",
                )
            pair = receipt_line_by_id.get(int(gr_line_id))
            if pair is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Receipt line {gr_line_id} is not in the selected goods receipts",
                )
            _receipt, gr_line = pair
            unbilled = _unbilled_qty_for_receipt_line(db, gr_line)
            qty = _d(raw.get("quantity_billed", unbilled))
            if qty <= 0:
                continue
            if qty > unbilled:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Quantity {qty} exceeds unbilled received quantity {unbilled} "
                        f"on receipt line {gr_line.id}"
                    ),
                )
            default_price = _receipt_billable_unit_cost(gr_line)
            price = _d(raw["unit_price"]) if raw.get("unit_price") is not None else default_price
            provided = raw.get("line_subtotal")
            built.append(
                SupplierInvoiceLine(
                    source_line_id=gr_line.source_line_id,
                    item_id=gr_line.item_id,
                    description=raw.get("description") or gr_line.description or gr_line.item_id,
                    quantity_billed=qty,
                    unit_price=price,
                    line_subtotal=_line_bill_amount(
                        qty, price, _d(provided) if provided is not None else None
                    ),
                    goods_receipt_line_id=gr_line.id,
                )
            )
    else:
        for _receipt, gr_line in receipt_line_by_id.values():
            remaining = _unbilled_qty_for_receipt_line(db, gr_line)
            if remaining <= 0:
                continue
            price = _receipt_billable_unit_cost(gr_line)
            if price <= 0:
                warnings.append(f"Receipt line {gr_line.id} has a zero unit cost")
            built.append(
                SupplierInvoiceLine(
                    source_line_id=gr_line.source_line_id,
                    item_id=gr_line.item_id,
                    description=gr_line.description or gr_line.item_id,
                    quantity_billed=remaining,
                    unit_price=price,
                    line_subtotal=(price * remaining).quantize(Decimal("0.01")),
                    goods_receipt_line_id=gr_line.id,
                )
            )

    if not built:
        raise HTTPException(status_code=400, detail="No unbilled received quantity remaining")

    tax = tax_amount if tax_amount is not None else default_tax
    freight = freight_amount if freight_amount is not None else default_freight

    due, term = apply_due_date(
        db,
        invoice_date=issue,
        due_date=due_date,
        payment_term_id=payment_term_id,
        payment_terms=payment_terms,
        fallback=fallback,
    )
    invoice = SupplierInvoice(
        invoice_number=generate_document_number(db, DOC_BILL, issue),
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
    db.flush()
    for line in built:
        if not line.goods_receipt_line_id:
            continue
        pair = receipt_line_by_id.get(int(line.goods_receipt_line_id))
        if pair is None:
            continue
        _add_invoiced_qty(pair[1], _d(line.quantity_billed))

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
    reference_po_number: str | None = None,
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
    reference_po = (reference_po_number or "").strip() or None
    if reference_po:
        require_approved_reference_po(db, reference_po)
        source_order_id = source_order_id or reference_po
    if source_order_id:
        po = db.get(PurchaseOrder, source_order_id)
        sco = (
            db.query(SubcontractOrder)
            .filter(SubcontractOrder.sco_number == source_order_id)
            .first()
        )
        if po is None and sco is None:
            raise HTTPException(status_code=400, detail="Source order not found")
        if reference_po is None and po is not None:
            reference_po = source_order_id

    issue = invoice_date or date.today()
    tax = _d(tax_amount)
    freight = _d(freight_amount)
    built_dist, built_lines = _build_non_po_distributions(
        db,
        invoice_type=invoice_type,
        distributions=distributions,
        allocate_to_goods_receipt_id=allocate_to_goods_receipt_id,
    )

    if invoice_type == "LANDED_COST" and not source_order_id:
        linked_receipt_id = next((dist.goods_receipt_id for dist in built_dist if dist.goods_receipt_id), None)
        if linked_receipt_id is not None:
            linked_receipt = db.get(GoodsReceipt, linked_receipt_id)
            if linked_receipt is not None:
                source_order_id = linked_receipt.source_order_id
                if reference_po is None and linked_receipt.source_order_id:
                    linked_po = db.get(PurchaseOrder, linked_receipt.source_order_id)
                    if linked_po is not None and (linked_po.approval_status or "").upper() == "APPROVED":
                        reference_po = linked_receipt.source_order_id

    due, term = apply_due_date(
        db,
        invoice_date=issue,
        due_date=due_date,
        payment_term_id=payment_term_id,
        payment_terms=payment_terms,
        fallback=vendor,
    )
    invoice = SupplierInvoice(
        invoice_number=generate_document_number(db, DOC_BILL, issue),
        vendor_id=vendor_id,
        invoice_type=invoice_type,
        source_type=source_type,
        source_order_id=source_order_id,
        reference_po_number=reference_po,
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


def _build_non_po_distributions(
    db: Session,
    *,
    invoice_type: str,
    distributions: list[dict],
    allocate_to_goods_receipt_id: int | None = None,
) -> tuple[list[SupplierInvoiceDistribution], list[SupplierInvoiceLine]]:
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
    return built_dist, built_lines


def _assert_invoice_editable(invoice: SupplierInvoice) -> None:
    status = (invoice.status or "").upper()
    if status not in EDITABLE_INVOICE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only draft, rejected, or pending Non-PO supplier invoices can be edited "
                f"(current: {status or 'DRAFT'})."
            ),
        )
    kind = getattr(invoice, "invoice_type", None) or "PO_MATCHED"
    if kind not in NON_PO_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Only Non-PO supplier invoices can be edited after they are saved.",
        )


def update_supplier_invoice(
    db: Session,
    invoice_id: int,
    *,
    invoice_type: str | None = None,
    reference_po_number: str | None = None,
    vendor_id: str | None = None,
    vendor_invoice_number: str | None = None,
    invoice_date: date | None = None,
    due_date: date | None = None,
    tax_amount: Decimal | None = None,
    freight_amount: Decimal | None = None,
    currency: str | None = None,
    distributions: list[dict] | None = None,
    payment_term_id=None,
    payment_terms: str | None = None,
    allocate_to_goods_receipt_id: int | None = None,
) -> dict:
    invoice = _load_invoice(db, invoice_id)
    _assert_invoice_editable(invoice)
    assert_dates_open(
        db,
        invoice.invoice_date,
        invoice_date,
        document="supplier invoice",
    )
    resolved_type, source_type, source_order_id = validate_supplier_invoice_payload(
        invoice_type=invoice_type or invoice.invoice_type,
        source_type="NON_PO",
        source_order_id=None,
        vendor_id=vendor_id or invoice.vendor_id,
        distributions=distributions,
        lines=None,
    )
    if distributions is None:
        raise HTTPException(
            status_code=400,
            detail="Non-PO invoices require at least one GL distribution line",
        )

    vendor = db.get(Supplier, vendor_id or invoice.vendor_id)
    if vendor is None:
        raise HTTPException(status_code=400, detail="Vendor not found")
    if reference_po_number is None:
        reference_po = getattr(invoice, "reference_po_number", None)
        source_order_id = invoice.source_order_id
    else:
        reference_po = reference_po_number.strip() or None
        if reference_po:
            require_approved_reference_po(db, reference_po)
            source_order_id = reference_po
        else:
            source_order_id = None

    previous_receipt_ids = {
        dist.goods_receipt_id
        for dist in (invoice.distributions or [])
        if dist.goods_receipt_id
    }
    built_dist, built_lines = _build_non_po_distributions(
        db,
        invoice_type=resolved_type,
        distributions=distributions,
        allocate_to_goods_receipt_id=allocate_to_goods_receipt_id,
    )
    if resolved_type == "LANDED_COST" and not source_order_id:
        linked_receipt_id = next((dist.goods_receipt_id for dist in built_dist if dist.goods_receipt_id), None)
        if linked_receipt_id is not None:
            linked_receipt = db.get(GoodsReceipt, linked_receipt_id)
            if linked_receipt is not None:
                source_order_id = linked_receipt.source_order_id
                if reference_po is None and linked_receipt.source_order_id:
                    linked_po = db.get(PurchaseOrder, linked_receipt.source_order_id)
                    if linked_po is not None and (linked_po.approval_status or "").upper() == "APPROVED":
                        reference_po = linked_receipt.source_order_id

    issue = invoice_date or invoice.invoice_date or date.today()
    tax = _d(tax_amount if tax_amount is not None else invoice.tax_amount)
    freight = _d(freight_amount if freight_amount is not None else invoice.freight_amount)
    due, term = apply_due_date(
        db,
        invoice_date=issue,
        due_date=due_date,
        payment_term_id=payment_term_id,
        payment_terms=payment_terms,
        fallback=vendor,
    )

    invoice.vendor_id = vendor.supplier_id
    invoice.invoice_type = resolved_type
    invoice.source_type = source_type or "NON_PO"
    invoice.source_order_id = source_order_id
    invoice.reference_po_number = reference_po
    invoice.vendor_invoice_number = vendor_invoice_number
    invoice.invoice_date = issue
    invoice.due_date = due
    invoice.tax_amount = tax
    invoice.freight_amount = freight
    invoice.currency = (currency or invoice.currency or "USD")[:3]
    invoice.updated_at = datetime.utcnow()
    apply_payment_term_fields(
        db,
        invoice,
        payment_term_id=payment_term_id or (term.id if term else None),
        payment_terms=payment_terms,
        fallback=vendor,
    )

    invoice.lines.clear()
    invoice.distributions.clear()
    db.flush()
    for line in built_lines:
        line.invoice_id = invoice.id
        invoice.lines.append(line)
    for dist in built_dist:
        dist.invoice_id = invoice.id
        invoice.distributions.append(dist)

    subtotal = sum((dist.amount for dist in built_dist), Decimal("0"))
    invoice.subtotal = subtotal
    invoice.total_amount = (subtotal + tax + freight).quantize(Decimal("0.01"))
    invoice.outstanding_balance = invoice.total_amount
    db.flush()
    refresh_ids = previous_receipt_ids | {
        dist.goods_receipt_id for dist in built_dist if dist.goods_receipt_id
    }
    if resolved_type == "LANDED_COST" or previous_receipt_ids:
        _apply_landed_cost_to_linked_receipts(db, invoice)
        for receipt_id in refresh_ids:
            receipt = (
                db.query(GoodsReceipt)
                .options(selectinload(GoodsReceipt.lines))
                .filter(GoodsReceipt.id == receipt_id)
                .first()
            )
            if receipt is not None:
                apply_receipt_landed_costs(db, receipt)
    return serialize_supplier_invoice(_load_invoice(db, invoice.id))


def reject_supplier_invoice(db: Session, invoice_id: int) -> dict:
    invoice = _load_invoice(db, invoice_id)
    status = (invoice.status or "").upper()
    if status == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cannot reject a cancelled invoice")
    if status in {"APPROVED", "PAID"}:
        raise HTTPException(status_code=400, detail="Cannot reject an approved invoice")
    if status != "PENDING_APPROVAL":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reject from status {status or 'DRAFT'}",
        )
    invoice.status = "REJECTED"
    invoice.updated_at = datetime.utcnow()
    try:
        with db.begin_nested():
            db.flush()
    except IntegrityError:
        # chk_supplier_invoice_status may not include REJECTED until 0051.
        invoice.status = "DRAFT"
        invoice.updated_at = datetime.utcnow()
        db.flush()
    return serialize_supplier_invoice(_load_invoice(db, invoice_id))


def _journal_is_mutable_draft(entry: JournalEntry) -> bool:
    posting = (entry.posting_status or "").strip().lower()
    approval = (entry.approval_status or "").strip().upper()
    return posting == "draft" and approval in {"", "DRAFT"}


def _delete_journal_entry(db: Session, entry: JournalEntry) -> None:
    for row in list(entry.postings or []):
        db.delete(row)
    db.delete(entry)


def _reverse_posted_invoice_journal(
    db: Session, entry: JournalEntry, invoice: SupplierInvoice
) -> None:
    debit_row = next((row for row in (entry.postings or []) if _d(row.debit) > 0), None)
    credit_row = next((row for row in (entry.postings or []) if _d(row.credit) > 0), None)
    if debit_row is None or credit_row is None:
        return
    amount = _d(debit_row.debit) or _d(credit_row.credit)
    if amount <= 0:
        return
    debit_account = db.get(ChartOfAccount, credit_row.account_id)
    credit_account = db.get(ChartOfAccount, debit_row.account_id)
    if debit_account is None or credit_account is None:
        raise HTTPException(status_code=400, detail="Cannot reverse AP posting: GL account missing")
    finance._post_balanced_journal_entry(
        db,
        description=f"Rescind {entry.description}",
        debit_account=debit_account,
        credit_account=credit_account,
        amount=amount,
        reference=invoice.invoice_number,
        source_document_type=SOURCE_SUPPLIER_INVOICE,
        source_record_id=f"{invoice.invoice_number}#RESCIND",
        posting_rule_id=getattr(entry, "posting_rule_id", None),
    )
    entry.source_record_id = f"{invoice.invoice_number}#RESCINDED"


def _unwind_supplier_invoice_journals(db: Session, invoice: SupplierInvoice) -> None:
    entries = (
        db.query(JournalEntry)
        .options(selectinload(JournalEntry.postings))
        .filter(
            JournalEntry.source_document_type == SOURCE_SUPPLIER_INVOICE,
            JournalEntry.source_record_id == invoice.invoice_number,
        )
        .all()
    )
    for entry in entries:
        if _journal_is_mutable_draft(entry):
            _delete_journal_entry(db, entry)
        else:
            _reverse_posted_invoice_journal(db, entry, invoice)


def rescind_supplier_invoice(db: Session, invoice_id: int) -> dict:
    invoice = _load_invoice(db, invoice_id)
    kind = getattr(invoice, "invoice_type", None) or "PO_MATCHED"
    status = (invoice.status or "").upper()
    if kind not in NON_PO_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Only Non-PO supplier invoices can be rescinded after approval.",
        )
    if status == "PAID":
        raise HTTPException(
            status_code=400,
            detail="Paid invoices cannot be rescinded. Reverse the payment first.",
        )
    if status != "APPROVED":
        raise HTTPException(
            status_code=400,
            detail=f"Only approved invoices can be rescinded (current: {status or 'DRAFT'}).",
        )

    bill = db.get(APBill, invoice.ap_bill_id) if invoice.ap_bill_id else None
    if bill is not None:
        if (bill.status or "") in {"Partial", "Paid"}:
            raise HTTPException(
                status_code=400,
                detail="Cannot rescind a bill that already has payments.",
            )
        already_paid = finance._cash_applied_total(
            db, finance._ap_reference_ids(bill, invoice), "Check Issue"
        )
        if already_paid > 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot rescind a bill that already has payments.",
            )

    previous_receipt_ids = {
        dist.goods_receipt_id
        for dist in (invoice.distributions or [])
        if dist.goods_receipt_id
    }
    _unwind_supplier_invoice_journals(db, invoice)

    bill_id = invoice.ap_bill_id
    invoice.ap_bill_id = None
    db.flush()
    if bill_id:
        linked_bill = db.get(APBill, bill_id)
        if linked_bill is not None:
            db.delete(linked_bill)

    invoice.status = "DRAFT"
    invoice.updated_at = datetime.utcnow()
    db.flush()
    if kind == "LANDED_COST" or previous_receipt_ids:
        _apply_landed_cost_to_linked_receipts(db, invoice)
        for receipt_id in previous_receipt_ids:
            receipt = (
                db.query(GoodsReceipt)
                .options(selectinload(GoodsReceipt.lines))
                .filter(GoodsReceipt.id == receipt_id)
                .first()
            )
            if receipt is not None:
                apply_receipt_landed_costs(db, receipt)
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
        tracking_po = (
            getattr(invoice, "reference_po_number", None)
            or invoice.source_order_id
        )
        linked_po = (
            tracking_po
            if tracking_po and db.get(PurchaseOrder, tracking_po) is not None
            else None
        )
        bill = APBill(
            bill_id=invoice.invoice_number,
            purchase_order_id=invoice.source_order_id
            if invoice.source_type == "PURCHASE_ORDER"
            or linked_po
            else None,
            vendor_id=invoice.vendor_id,
            supplier_invoice_id=invoice.id,
            source_type=invoice.source_type,
            source_order_id=invoice.source_order_id,
            reference_po_number=getattr(invoice, "reference_po_number", None) or linked_po,
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
    order_keys = {(invoice.source_type, invoice.source_order_id)}
    for line in invoice.lines or []:
        receipt = getattr(getattr(line, "goods_receipt_line", None), "receipt", None)
        if receipt is not None:
            order_keys.add((receipt.source_type, receipt.source_order_id))
        if line.goods_receipt_line is not None:
            _sync_receipt_line_billing(db, line.goods_receipt_line)
    for source, order_id in order_keys:
        _update_billing_status(db, source, order_id)
    db.flush()
    return serialize_supplier_invoice(_load_invoice(db, invoice_id))


def _post_non_po_approval(db: Session, invoice: SupplierInvoice, ap_account, total: Decimal) -> None:
    inventory_account, _ap, landed_rule = resolve_posting_rule(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_LANDED_COST, invoice.vendor
    )
    tax_exp, _tax_ap, tax_rule = resolve_posting_rule(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_TAX, invoice.vendor
    )
    dists = list(invoice.distributions or [])
    if not dists:
        raise HTTPException(status_code=400, detail="Non-PO invoice is missing GL distributions")
    invoice_source = {
        "source_document_type": SOURCE_SUPPLIER_INVOICE,
        "source_record_id": invoice.invoice_number,
    }
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
            reference=receipt_number or invoice.invoice_number,
            posting_rule_id=rule_id(landed_rule),
            **invoice_source,
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
            reference=invoice.invoice_number,
            posting_rule_id=rule_id(tax_rule),
            **invoice_source,
        )


def _grni_clear_groups(db: Session, invoice: SupplierInvoice) -> list[dict]:
    """Group GRNI-clear amounts by goods receipt so each posts on the receipt date."""
    groups: dict[int | None, dict] = {}
    linked = False
    for line in invoice.lines or []:
        gr_line = getattr(line, "goods_receipt_line", None)
        if gr_line is None and line.goods_receipt_line_id:
            gr_line = db.get(GoodsReceiptLine, line.goods_receipt_line_id)
        receipt = getattr(gr_line, "receipt", None) if gr_line is not None else None
        if receipt is None and gr_line is not None:
            receipt = db.get(GoodsReceipt, gr_line.receipt_id)
        if receipt is not None:
            linked = True
        key = receipt.id if receipt is not None else None
        bucket = groups.setdefault(
            key,
            {
                "receipt": receipt,
                "stock_billed": Decimal("0"),
                "stock_clear": Decimal("0"),
                "non_stock": Decimal("0"),
            },
        )
        billed = _d(line.line_subtotal)
        if skip_inventory_movement(catalog_item(db, line.item_id)):
            bucket["non_stock"] += billed
            continue
        bucket["stock_billed"] += billed
        if gr_line is not None:
            bucket["stock_clear"] += (_d(gr_line.unit_cost) * _d(line.quantity_billed)).quantize(
                Decimal("0.01")
            )
        else:
            bucket["stock_clear"] += billed

    if not linked:
        accrued = (
            _accrued_amount_for_order(db, invoice.source_type, invoice.source_order_id)
            if invoice.source_order_id
            else Decimal("0")
        )
        invoice_goods = _d(invoice.subtotal)
        non_stock = sum((bucket["non_stock"] for bucket in groups.values()), Decimal("0"))
        stock_goods = max(invoice_goods - non_stock, Decimal("0"))
        stock_clear = min(accrued, stock_goods)
        return [
            {
                "receipt": None,
                "posting_date": invoice.invoice_date,
                "clear_amount": min(accrued, invoice_goods),
                "variance": stock_goods - stock_clear,
                "non_stock": max(non_stock - max(accrued - stock_clear, Decimal("0")), Decimal("0")),
                "receipt_number": None,
            }
        ]

    result: list[dict] = []
    for bucket in groups.values():
        receipt = bucket["receipt"]
        result.append(
            {
                "receipt": receipt,
                "posting_date": receipt.receipt_date if receipt is not None else invoice.invoice_date,
                "clear_amount": bucket["stock_clear"],
                "variance": bucket["stock_billed"] - bucket["stock_clear"],
                "non_stock": bucket["non_stock"],
                "receipt_number": getattr(receipt, "receipt_number", None),
            }
        )
    return result


def _post_po_matched_approval(db: Session, invoice: SupplierInvoice, ap_account, total: Decimal) -> None:
    vendor = invoice.vendor
    grni_account, _clear_ap, grni_rule = resolve_posting_rule(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_GRNI_CLEAR, vendor
    )
    ppv_account, _ppv_ap, ppv_rule = resolve_posting_rule(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_PPV_UNFAVORABLE, vendor
    )
    fav_grni, fav_ppv, fav_rule = resolve_posting_rule(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_PPV_FAVORABLE, vendor
    )
    tax_exp, _tax_ap, tax_rule = resolve_posting_rule(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_TAX, vendor
    )
    expense_account, _exp_ap, expense_rule = resolve_posting_rule(
        db, EVENT_SUPPLIER_INVOICE, VARIANT_EXPENSE, vendor
    )
    invoice_source = {
        "reference": invoice.invoice_number,
        "source_document_type": SOURCE_SUPPLIER_INVOICE,
        "source_record_id": invoice.invoice_number,
    }
    tax = _d(invoice.tax_amount)
    freight = _d(invoice.freight_amount)
    posted_any = False
    for group in _grni_clear_groups(db, invoice):
        posting_date = group["posting_date"]
        clear_amount = _d(group["clear_amount"])
        variance = _d(group["variance"])
        non_stock = _d(group["non_stock"])
        receipt_number = group.get("receipt_number")
        suffix = f" for {receipt_number}" if receipt_number else ""
        if clear_amount > 0:
            finance._post_balanced_journal_entry(
                db,
                description=f"Supplier invoice {invoice.invoice_number} GRNI clear{suffix}",
                debit_account=grni_account,
                credit_account=ap_account,
                amount=clear_amount,
                posting_date=posting_date,
                posting_rule_id=rule_id(grni_rule),
                **invoice_source,
            )
            posted_any = True
        if variance > 0:
            finance._post_balanced_journal_entry(
                db,
                description=f"Supplier invoice {invoice.invoice_number} PPV{suffix}",
                debit_account=ppv_account,
                credit_account=ap_account,
                amount=variance,
                posting_date=posting_date,
                posting_rule_id=rule_id(ppv_rule),
                **invoice_source,
            )
            posted_any = True
        elif variance < 0:
            finance._post_balanced_journal_entry(
                db,
                description=f"Supplier invoice {invoice.invoice_number} PPV favor{suffix}",
                debit_account=fav_grni,
                credit_account=fav_ppv,
                amount=abs(variance),
                posting_date=posting_date,
                posting_rule_id=rule_id(fav_rule),
                **invoice_source,
            )
            posted_any = True
        if non_stock > 0:
            finance._post_balanced_journal_entry(
                db,
                description=f"Supplier invoice {invoice.invoice_number} non-inventory expense{suffix}",
                debit_account=expense_account,
                credit_account=ap_account,
                amount=non_stock.quantize(Decimal("0.01")),
                posting_date=posting_date,
                posting_rule_id=rule_id(expense_rule),
                **invoice_source,
            )
            posted_any = True
    if tax + freight > 0:
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number} tax/freight",
            debit_account=tax_exp,
            credit_account=ap_account,
            amount=(tax + freight).quantize(Decimal("0.01")),
            posting_date=invoice.invoice_date,
            posting_rule_id=rule_id(tax_rule),
            **invoice_source,
        )
        posted_any = True
    if not posted_any:
        finance._post_balanced_journal_entry(
            db,
            description=f"Supplier invoice {invoice.invoice_number}",
            debit_account=ppv_account,
            credit_account=ap_account,
            amount=total,
            posting_date=invoice.invoice_date,
            posting_rule_id=rule_id(ppv_rule),
            **invoice_source,
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
    result = serialize_supplier_invoice(_load_invoice(db, invoice_id))
    result["payment_transaction_id"] = txn.transaction_id
    return result
