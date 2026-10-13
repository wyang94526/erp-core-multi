# @author: Wendy Yang
# @date: 2026-10-13

"""ISO 9001 and GAAP gates that sit in front of stock, purchasing, and the ledger."""

from __future__ import annotations

from datetime import date


def component_lot_block(lot_number: str | None, *, consumes_material: bool) -> str | None:
    """A consumed component has to carry the lot it came from."""
    if consumes_material and not (lot_number or "").strip():
        return "Record the raw-material lot before this component can be consumed."
    return None


def shipment_trace_block(
    inspection_status: str | None,
    finished_lot: str | None,
    component_lots: list[str],
) -> str | None:
    """A finished good ships only after acceptance and a link back to component lots."""
    status = (inspection_status or "").strip().lower()
    if status != "accepted":
        return "Uninspected or rejected lots cannot be picked or shipped."
    linked = [lot.strip() for lot in component_lots if (lot or "").strip()]
    if not (finished_lot or "").strip() or not linked:
        return "A finished good cannot ship without a lot linked back to the raw-material lots."
    return None


def quality_gate_block(good_quantity: int, passed_flags: list[bool]) -> str | None:
    """Good quantity cannot leave an operation without a passing inspection."""
    if int(good_quantity or 0) <= 0:
        return None
    if not passed_flags:
        return "Record a passing quality inspection before this operation can advance."
    if not any(passed_flags):
        return "Good quantity cannot advance until a quality inspection passes."
    return None


def finished_inventory_block(inspection_status: str | None) -> str | None:
    """Unrestricted finished inventory requires an accepted inspection."""
    if (inspection_status or "").strip().lower() != "accepted":
        return "Uninspected manufacturing lots cannot be moved into finished inventory."
    return None


def vendor_list_block(status: str | None, qc_status: str | None) -> str | None:
    """Purchase orders require an active vendor on the approved vendor list."""
    if (status or "").strip().lower() != "active":
        return "The vendor must be Active on the Approved Vendor List before a purchase order can be submitted."
    if (qc_status or "").strip().lower() != "approved":
        return "The vendor is not approved on the Approved Vendor List."
    return None


def released_revision_block(status: str | None) -> str | None:
    """Released and obsolete master-data revisions are locked."""
    if (status or "").strip().lower() in {"active", "obsolete"}:
        return "This revision is locked. Create a new revision before changing the bill of materials."
    return None


def historical_journal_block(posting_status: str | None) -> str | None:
    """Posted ledger history is changed only by an offsetting reversal."""
    if (posting_status or "").strip().lower() == "posted":
        return (
            "Posted journal entries are immutable. Record an offsetting reversal "
            "with a user, timestamp, and reason instead of changing history."
        )
    return None


def journal_audit_fields(entry_id, user_id, action: str, journal_number: str | None, reason: str) -> dict:
    """Attributes a journal create, edit, or delete to the signed-in user."""
    if action not in {"CREATE", "UPDATE", "DELETE"}:
        raise ValueError("Journal audit action must be CREATE, UPDATE, or DELETE")
    payload = {"journal_number": journal_number, "reason": reason, "user_id": str(user_id)}
    fields = {
        "table_name": "journal_entries",
        "record_id": entry_id,
        "action": action,
        "user_id": user_id,
        "old_data": None,
        "new_data": None,
    }
    if action == "DELETE":
        fields["old_data"] = payload
    else:
        fields["new_data"] = payload
    return fields


def accrual_posting_date(transaction_date: date | None, cash_date: date | None) -> date | None:
    """Recognize the period of the transaction or receipt, not the later cash movement."""
    return transaction_date or cash_date


def inventory_lot_block(lot_number: str | None) -> str | None:
    """A stock movement or adjustment has to name the lot it changes."""
    if not (lot_number or "").strip():
        return "Record the lot before this inventory movement can be posted."
    return None


def assembled_release_block(
    *,
    stock_tracked: bool,
    inspection_status: str | None,
    finished_lot: str | None,
    component_lots: list[str],
) -> str | None:
    """Apply the shipment rule once the lot and inspection facts are known."""
    if not stock_tracked:
        return None
    return shipment_trace_block(inspection_status, finished_lot, component_lots)


def reversal_lines(postings: list[dict]) -> list[dict]:
    """Swap each posted debit and credit so the reversal offsets the original."""
    return [
        {
            "account_id": row["account_id"],
            "debit": row["credit"],
            "credit": row["debit"],
        }
        for row in postings
    ]


_AUDIT_ACTIONS = {"CREATE", "UPDATE", "DELETE", "VOID"}


def document_audit_fields(
    table_name: str,
    action: str,
    user_id,
    reason: str,
    *,
    record_id=None,
    document_key: str | None = None,
    detail: dict | None = None,
) -> dict:
    """Attributes a document change to a user when the key is a number, not a UUID."""
    if action not in _AUDIT_ACTIONS:
        raise ValueError("Audit action must be CREATE, UPDATE, DELETE, or VOID")
    key = (document_key or "").strip() or None
    if record_id is None and key is None:
        raise ValueError("Audit record needs a record id or document key")
    payload = {"reason": reason, "user_id": None if user_id is None else str(user_id)}
    if detail:
        payload.update(detail)
    historical = action in {"DELETE", "VOID"}
    return {
        "table_name": table_name[:50],
        "record_id": record_id,
        "document_key": key,
        "action": action,
        "user_id": user_id,
        "old_data": payload if historical else None,
        "new_data": None if historical else payload,
    }


def write_document_audit(db, table_name: str, action: str, user_id, reason: str, **kwargs) -> None:
    from app.models import AuditLog

    db.add(AuditLog(**document_audit_fields(table_name, action, user_id, reason, **kwargs)))


def assert_approved_vendor(db, supplier_id: str) -> None:
    """Purchase submit, change, and approval all require an active approved vendor."""
    from fastapi import HTTPException

    from app.models import Supplier

    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=400, detail="Supplier not found")
    blocked = vendor_list_block(supplier.status, supplier.qc_status)
    if blocked:
        raise HTTPException(status_code=400, detail=blocked)


def shipment_release_block(db, item_id: str, lot_number: str | None) -> str | None:
    """Block a stock shipment that lacks an accepted inspection and component lots."""
    from app.models import (
        GoodsReceiptLine,
        Inspection,
        ProductionMaterialBackflush,
        ProductionOrder,
        ProductionReceipt,
    )
    from app.services.item_types import catalog_item, skip_inventory_movement

    item = catalog_item(db, item_id)
    if skip_inventory_movement(item):
        return None
    lot = (lot_number or "").strip()
    status, component_lots = _trace_for_lot(db, item_id, lot, Inspection, ProductionReceipt, ProductionOrder, ProductionMaterialBackflush, GoodsReceiptLine)
    return shipment_trace_block(status, lot, component_lots)


def _latest_inspection_status(db, inspection_model, source_type: str, source_id: str) -> str | None:
    row = (
        db.query(inspection_model)
        .filter(
            inspection_model.source_type == source_type,
            inspection_model.source_id == source_id,
        )
        .order_by(inspection_model.created_at.desc())
        .first()
    )
    if row is None:
        return None
    return row.status


def _trace_for_lot(db, item_id: str, lot: str, inspection_model, receipt_model, order_model, backflush_model, goods_line_model):
    if not lot:
        return None, []
    produced = (
        db.query(receipt_model)
        .join(order_model)
        .filter(order_model.item_id == item_id, receipt_model.lot_number == lot)
        .all()
    )
    if produced:
        receipt = produced[-1]
        status = _latest_inspection_status(db, inspection_model, "production_receipt", receipt.receipt_id)
        lots = [
            row.lot_number
            for row in db.query(backflush_model)
            .filter(backflush_model.production_order_id == receipt.production_order_id)
            .all()
            if (row.lot_number or "").strip()
        ]
        return status, lots
    goods = (
        db.query(goods_line_model)
        .filter(goods_line_model.item_id == item_id, goods_line_model.lot_number == lot)
        .all()
    )
    if goods:
        line = goods[-1]
        receipt = line.receipt
        source_id = receipt.receipt_number if receipt is not None else ""
        status = _latest_inspection_status(db, inspection_model, "goods_receipt", source_id) if source_id else None
        return status, [lot]
    return None, []
