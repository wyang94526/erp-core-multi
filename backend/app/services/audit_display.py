# @author: Wendy Yang
# @date: 2026-10-05

"""Human labels for system audit-log rows (record + user)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import AuditLog, User

TABLE_LABELS = {
    "finance_period_settings": "Period Management",
    "journal_entries": "Journal",
    "ledger_postings": "Ledger posting",
    "salesorders": "Sales order",
    "purchaseorders": "Purchase order",
    "subcontractorders": "Subcontract order",
    "sales_invoices": "Sales invoice",
    "supplier_invoices": "Supplier invoice",
    "goods_receipts": "Goods receipt",
    "item_fulfillments": "Fulfillment",
    "cash_transactions": "Payment",
    "ar_invoices": "AR invoice",
    "ap_bills": "AP bill",
    "customers": "Customer",
    "suppliers": "Vendor",
    "items": "Item",
    "users": "User",
}

ACTION_LABELS = {
    "INSERT": "Created",
    "UPDATE": "Updated",
    "DELETE": "Deleted",
}

_NUMBER_KEYS = (
    "journal_number",
    "sales_order_id",
    "po_number",
    "sco_number",
    "invoice_number",
    "receipt_number",
    "fulfillment_number",
    "transaction_id",
    "customer_id",
    "supplier_id",
    "item_id",
    "reference",
)


def table_label(table_name: str | None) -> str:
    key = (table_name or "").strip()
    return TABLE_LABELS.get(key, key.replace("_", " ").strip().title() or "Record")


def action_label(action: str | None) -> str:
    key = (action or "").strip().upper()
    return ACTION_LABELS.get(key, (action or "—").title())


def record_label(
    table_name: str | None,
    record_id: Any,
    new_data: dict[str, Any] | None = None,
    old_data: dict[str, Any] | None = None,
) -> str:
    data = new_data or {}
    prior = old_data or {}
    table = (table_name or "").strip()
    if table == "finance_period_settings":
        return _period_settings_label(data, prior)
    for key in _NUMBER_KEYS:
        value = data.get(key) or prior.get(key)
        if value:
            return str(value)
    description = data.get("description") or prior.get("description")
    if description:
        return str(description)[:80]
    return f"{table_label(table)} { _short_id(record_id)}"


def _period_settings_label(data: dict[str, Any], prior: dict[str, Any]) -> str:
    soft = data.get("soft_close_date")
    hard = data.get("hard_close_date") or data.get("current_closing_date")
    if soft or hard:
        bits = []
        bits.append(f"soft {soft}" if soft else "soft open")
        bits.append(f"hard {hard}" if hard else "hard open")
        return "Period close — " + ", ".join(bits)
    if prior.get("soft_close_date") or prior.get("hard_close_date") or prior.get("current_closing_date"):
        return "Period close — lock dates cleared"
    return "Period Management"


def _short_id(record_id: Any) -> str:
    text = str(record_id or "").strip()
    if not text:
        return "—"
    return text.split("-")[0].upper()


def enrich_audit_logs(db: Session, logs: list[AuditLog]) -> list[dict[str, Any]]:
    user_ids = {log.user_id for log in logs if log.user_id}
    users: dict[UUID, User] = {}
    if user_ids:
        users = {row.id: row for row in db.query(User).filter(User.id.in_(user_ids)).all()}
    return [enrich_audit_log(log, users.get(log.user_id) if log.user_id else None) for log in logs]


def enrich_audit_log(log: AuditLog, user: User | None = None) -> dict[str, Any]:
    return {
        "id": log.id,
        "table_name": log.table_name,
        "table_label": table_label(log.table_name),
        "record_id": log.record_id,
        "record_label": record_label(log.table_name, log.record_id, log.new_data, log.old_data),
        "action": log.action,
        "action_label": action_label(log.action),
        "old_data": log.old_data,
        "new_data": log.new_data,
        "user_id": log.user_id,
        "user_name": (user.full_name if user else None),
        "user_email": (user.email if user else None),
        "changed_at": log.changed_at,
    }
