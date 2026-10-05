# @author: Wendy Yang
# @date: 2026-09-19

"""Read-only LangChain tools for live ERP lookups across all modules."""

from __future__ import annotations

import json
import re
from calendar import monthrange
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from langchain_core.tools import tool
from sqlalchemy import distinct, func, or_
from sqlalchemy.orm import joinedload, selectinload

from app.ai.context import get_ai_context
from app.deps.auth import user_is_admin, user_permission_codes
from app.models import (
    APBill,
    ARInvoice,
    BankAccount,
    BinLocation,
    CashTransaction,
    ChartOfAccount,
    Customer,
    GoodsReceipt,
    GoodsReceiptLine,
    Item,
    ItemBOMComponent,
    ItemBOMHeader,
    ItemFulfillment,
    JournalEntry,
    LedgerPosting,
    MaterialIssue,
    MaterialIssueLine,
    PurchaseOrder,
    PurchaseOrderItem,
    SalesInvoice,
    SalesOrder,
    SubcontractOrder,
    Supplier,
    SupplierInvoice,
    User,
    Warehouse,
    WorkCenter,
)
from app.services.inventory import list_stock_overview


def _json(data: Any) -> str:
    return json.dumps(data, default=str, indent=2)


def _require_any(user: User, *codes: str) -> str | None:
    if user_is_admin(user) or not codes:
        return None
    have = user_permission_codes(user)
    if any(code in have for code in codes):
        return None
    needed = ", ".join(codes)
    return f"Permission denied: missing '{needed}'"


def _allowed(user: User, *codes: str) -> bool:
    return _require_any(user, *codes) is None


def _limit(limit: int) -> int:
    return max(1, min(int(limit or 20), 50))


ENTITY_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    (
        "items_with_bom",
        (
            "bom items",
            "bom item",
            "items with bom",
            "item with bom",
            "with bom",
            "bom detail",
            "bom details",
            "bills of material",
            "bill of materials",
            "bill of material",
            "boms",
        ),
    ),
    ("bom_headers", ("bom header", "bom version")),
    ("customers", ("customer",)),
    ("vendors", ("vendor", "supplier")),
    ("items", ("item", "sku", "product", "catalog")),
    ("work_centers", ("work center", "workcentre", "workcentre")),
    ("sales_orders", ("sales order", "customer order", " so ")),
    ("purchase_orders", ("purchase order", "purchases", "procurement", " po ", " pos ")),
    ("subcontract_orders", ("subcontract", " sco ")),
    ("material_issues", ("material issue", "materials issue", "kit issue", "component issue")),
    ("inventory", ("inventory", "stock", "on hand", "atp", "warehouse bin")),
    ("warehouses", ("warehouse", "bin")),
    ("fulfillments", ("fulfillment", "shipment", "shipped", "delivery")),
    ("goods_receipts", ("goods receipt", "grn", "receiving", "receipt of goods")),
    ("ar_invoices", ("ar invoice", "accounts receivable", "account receivable", "ar aging", "receivable")),
    ("ap_bills", ("ap bill", "accounts payable", "account payable", "ap aging", "payable", "vendor bill")),
    ("supplier_invoices", ("supplier invoice", "vendor invoice", "purchase invoice", "supplier bill")),
    ("sales_invoices", ("sales invoice", "customer invoice", "invoices", "invoice")),
    ("cash", ("cash", "check issue", "check deposit", "treasury")),
    ("journals", ("journal", "general ledger", "gl ")),
    ("accounts", ("chart of account", "coa", "gl account")),
    ("users", ("user", "role")),
]


def format_count_answer(raw: str) -> str:
    """Turn get_erp_counts JSON into a short Markdown reply."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    entity = str(data.get("entity") or "")
    labels = {
        "customers": "customers",
        "vendors": "vendors",
        "items": "items",
        "items_with_bom": "items with BOM details",
        "bom_headers": "BOM headers",
        "work_centers": "work centers",
        "sales_orders": "sales orders",
        "purchase_orders": "purchase orders",
        "subcontract_orders": "subcontract orders",
        "material_issues": "material issues",
        "inventory": "stocked items",
        "warehouses": "warehouses",
        "fulfillments": "fulfillments",
        "goods_receipts": "goods receipts",
        "ar_invoices": "AR invoices",
        "ap_bills": "AP bills",
        "sales_invoices": "sales invoices",
        "supplier_invoices": "supplier invoices",
        "cash": "cash transactions",
        "cash_transactions": "cash transactions",
        "journals": "journal entries",
        "journal_entries": "journal entries",
        "accounts": "GL accounts",
        "chart_of_accounts": "GL accounts",
        "users": "users",
    }

    if entity == "all":
        lines = ["Live counts from the ERP database:", ""]
        for name, info in (data.get("modules") or {}).items():
            n = info.get("count") if isinstance(info, dict) else info
            label = labels.get(name, name.replace("_", " "))
            lines.append(f"- **{label}:** {n}")
        skipped = data.get("skipped_no_permission") or []
        if skipped:
            lines.append("")
            lines.append("Skipped (no permission): " + ", ".join(skipped))
        return "\n".join(lines)

    label = labels.get(entity, entity.replace("_", " ") or "records")
    count = data.get("count")
    lines = [f"**{count}** {label}."]
    if entity == "items_with_bom":
        lines = [
            f"**{data.get('items_with_bom_lines', count)}** items have BOM component lines.",
            f"- Items with a BOM header: **{data.get('items_with_bom_header')}**",
            f"- Items with an active BOM: **{data.get('items_with_active_bom')}**",
            f"- BOM headers (all versions): **{data.get('bom_headers')}**",
        ]
        by_status = data.get("bom_headers_by_status") or {}
        if by_status:
            lines.append(
                "- Headers by status: "
                + ", ".join(f"{k} {v}" for k, v in by_status.items())
            )
        return "\n".join(lines)

    if data.get("filter_status"):
        lines[0] = f"**{count}** {label} with status `{data['filter_status']}`."

    for key, heading in (
        ("by_status", "By status"),
        ("by_vendor_type", "By vendor type"),
        ("by_type", "By type"),
        ("by_posting_status", "By posting status"),
    ):
        breakdown = data.get(key)
        if isinstance(breakdown, dict) and breakdown:
            lines.append("")
            lines.append(f"{heading}:")
            for name, n in breakdown.items():
                lines.append(f"- {name}: **{n}**")

    extra = {
        "purchase_items": "Purchase items",
        "raw_materials": "Raw materials",
        "subcontract_assemblies": "Subcontract assemblies",
        "active": "Active",
        "bins": "Bins",
    }
    extras = [f"- {title}: **{data[field]}**" for field, title in extra.items() if field in data]
    if extras:
        lines.append("")
        lines.extend(extras)
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


def is_below_threshold_wording(question: str) -> bool:
    """True for reorder-alert phrasing (on hand ≤ reorder point)."""
    text = f" {_normalize_question(question)} "
    if re.search(r"\bapproval\b.{0,20}\bthreshold\b", text):
        return False
    if re.search(
        r"\b(under|below|beneath|at or below)\b.{0,40}\b"
        r"(threshold|reorder|safety stock|min(?:imum)?\s+stock)\b",
        text,
    ):
        return True
    if re.search(r"\b(reorder point|reorder alerts?|safety stock)\b", text):
        return True
    if re.search(r"\bneed(?:s|ed)? (?:to )?reorder\b", text):
        return True
    return "inventory threshold" in text or "stock threshold" in text


def infer_inventory_status(question: str) -> str:
    """Low Stock / Out of Stock filter from wording. Threshold uses the flag instead."""
    text = f" {_normalize_question(question)} "
    if is_below_threshold_wording(question):
        return ""
    if re.search(r"\blow stock\b", text):
        return "Low Stock"
    if re.search(r"\bout of stock\b", text):
        return "Out of Stock"
    return ""


def _stock_below_threshold(row: Any) -> bool:
    return int(getattr(row, "on_hand_quantity", 0) or 0) <= int(
        getattr(row, "reorder_point", 0) or 0
    )


def infer_entity_and_status(question: str) -> tuple[str, str]:
    """Map a natural-language question onto a count entity + optional status."""
    text = f" {question.lower()} "
    status = ""
    if re.search(r"\bactive\b", text):
        status = "ACTIVE"
    elif re.search(r"\binactive\b", text):
        status = "INACTIVE"
    elif re.search(r"\bon[_\s-]?hold\b", text):
        status = "ON_HOLD"
    elif re.search(r"\bdraft\b", text):
        status = "DRAFT"
    elif re.search(r"\bapproved\b", text):
        status = "APPROVED"
    elif re.search(r"\bunpaid\b", text):
        status = "Unpaid"
    elif re.search(r"\bpaid\b", text):
        status = "Paid"
    elif is_below_threshold_wording(question):
        status = "below_threshold"
    elif re.search(r"\blow stock\b", text):
        status = "Low Stock"
    elif re.search(r"\bout of stock\b", text):
        status = "Out of Stock"

    stock_lookup = bool(
        re.search(
            r"\b(inventory|on hand|atp|reorder|threshold|low stock|out of stock)\b",
            text,
        )
    ) or (" stock " in text)

    for entity, needles in ENTITY_ALIASES:
        if entity == "items" and stock_lookup:
            continue
        if any(n in text for n in needles):
            return entity, status
    if re.search(r"\bbom\b", text):
        if "header" in text:
            return "bom_headers", status
        return "items_with_bom", status
    return "", status


def _customer_query(db, status: str = "", q: str = ""):
    query = db.query(Customer)
    if status.strip():
        query = query.filter(Customer.status.ilike(status.strip()))
    if q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Customer.customer_id.ilike(term),
                Customer.company_name.ilike(term),
                Customer.customer_number_ext.ilike(term),
                Customer.tax_id.ilike(term),
            )
        )
    return query


def _vendor_status(status: str) -> str:
    raw = status.strip()
    if raw.upper() == "ACTIVE":
        return "Active"
    if raw.upper() == "INACTIVE":
        return "Inactive"
    return raw


def _counts_for_entity(db, user: User, entity: str, status: str) -> dict[str, Any] | str:
    entity = (entity or "").strip().lower()
    st = status.strip()

    if entity in ("customer", "customers"):
        q = _customer_query(db, st)
        breakdown = dict(db.query(Customer.status, func.count()).group_by(Customer.status).all())
        return {
            "entity": "customers",
            "count": int(q.count()),
            "filter_status": st or None,
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("vendor", "vendors", "supplier", "suppliers"):
        q = db.query(Supplier)
        vendor_status = _vendor_status(st) if st else ""
        if vendor_status:
            q = q.filter(Supplier.status.ilike(vendor_status))
        breakdown = dict(db.query(Supplier.status, func.count()).group_by(Supplier.status).all())
        type_break = dict(db.query(Supplier.vendor_type, func.count()).group_by(Supplier.vendor_type).all())
        return {
            "entity": "vendors",
            "count": int(q.count()),
            "filter_status": vendor_status or None,
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
            "by_vendor_type": {str(k): int(v) for k, v in type_break.items()},
        }

    if entity in ("item", "items", "sku", "product", "products"):
        q = db.query(Item)
        return {
            "entity": "items",
            "count": int(q.count()),
            "purchase_items": int(db.query(Item).filter(Item.is_purchase_item.is_(True)).count()),
            "raw_materials": int(db.query(Item).filter(Item.is_raw_material.is_(True)).count()),
            "subcontract_assemblies": int(
                db.query(Item).filter(Item.is_subcontract_assembly.is_(True)).count()
            ),
        }

    if entity in ("items_with_bom", "bom", "boms"):
        with_header = int(db.query(func.count(distinct(ItemBOMHeader.parent_item_id))).scalar() or 0)
        with_active = int(
            db.query(func.count(distinct(ItemBOMHeader.parent_item_id)))
            .filter(ItemBOMHeader.status == "active")
            .scalar()
            or 0
        )
        with_lines = int(db.query(func.count(distinct(ItemBOMComponent.parent_item_id))).scalar() or 0)
        header_break = dict(
            db.query(ItemBOMHeader.status, func.count()).group_by(ItemBOMHeader.status).all()
        )
        return {
            "entity": "items_with_bom",
            "count": with_lines,
            "items_with_bom_lines": with_lines,
            "items_with_bom_header": with_header,
            "items_with_active_bom": with_active,
            "bom_headers": int(db.query(ItemBOMHeader).count()),
            "bom_headers_by_status": {str(k): int(v) for k, v in header_break.items()},
            "note": "count is distinct items that have at least one BOM component line.",
        }

    if entity in ("bom_headers", "bom_header"):
        q = db.query(ItemBOMHeader)
        if st:
            q = q.filter(ItemBOMHeader.status.ilike(st))
        breakdown = dict(db.query(ItemBOMHeader.status, func.count()).group_by(ItemBOMHeader.status).all())
        return {
            "entity": "bom_headers",
            "count": int(q.count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("work_center", "work_centers"):
        q = db.query(WorkCenter)
        if st.upper() == "ACTIVE":
            q = q.filter(WorkCenter.is_active.is_(True))
        elif st.upper() == "INACTIVE":
            q = q.filter(WorkCenter.is_active.is_(False))
        return {
            "entity": "work_centers",
            "count": int(q.count()),
            "active": int(db.query(WorkCenter).filter(WorkCenter.is_active.is_(True)).count()),
        }

    if entity in ("sales_order", "sales_orders"):
        denied = _require_any(user, "sales_order:view")
        if denied:
            return denied
        q = db.query(SalesOrder)
        if st:
            q = q.filter(or_(SalesOrder.status.ilike(st), SalesOrder.approval_status.ilike(st)))
        breakdown = dict(db.query(SalesOrder.status, func.count()).group_by(SalesOrder.status).all())
        return {
            "entity": "sales_orders",
            "count": int(q.count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("purchase_order", "purchase_orders"):
        denied = _require_any(user, "po:view")
        if denied:
            return denied
        q = db.query(PurchaseOrder)
        if st:
            q = q.filter(PurchaseOrder.status.ilike(st))
        breakdown = dict(db.query(PurchaseOrder.status, func.count()).group_by(PurchaseOrder.status).all())
        return {
            "entity": "purchase_orders",
            "count": int(q.count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("subcontract_order", "subcontract_orders"):
        denied = _require_any(user, "subcontract:view")
        if denied:
            return denied
        q = db.query(SubcontractOrder)
        if st:
            q = q.filter(SubcontractOrder.status.ilike(st))
        breakdown = dict(db.query(SubcontractOrder.status, func.count()).group_by(SubcontractOrder.status).all())
        return {
            "entity": "subcontract_orders",
            "count": int(q.count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("material_issue", "material_issues"):
        denied = _require_any(user, "subcontract:view")
        if denied:
            return denied
        count = int(db.query(func.count(func.distinct(MaterialIssue.issue_id))).scalar() or 0)
        qty = db.query(func.coalesce(func.sum(MaterialIssueLine.quantity_issued), 0)).scalar()
        return {
            "entity": "material_issues",
            "count": count,
            "quantity_issued": str(qty or 0),
            "note": "Distinct subcontract material-issue documents.",
        }

    if entity in ("inventory", "stock"):
        overview = list_stock_overview(db)
        if st.lower() in ("below_threshold", "below reorder", "reorder"):
            overview = [r for r in overview if _stock_below_threshold(r)]
        elif st:
            overview = [r for r in overview if (r.status or "").lower() == st.lower()]
        by_status: dict[str, int] = {}
        for row in list_stock_overview(db):
            by_status[row.status] = by_status.get(row.status, 0) + 1
        return {
            "entity": "inventory",
            "count": len(overview),
            "filter_status": (
                "at or below reorder point"
                if st.lower() in ("below_threshold", "below reorder", "reorder")
                else (st or None)
            ),
            "by_status": by_status,
        }

    if entity in ("warehouse", "warehouses"):
        q = db.query(Warehouse)
        if st.upper() == "ACTIVE":
            q = q.filter(Warehouse.is_active.is_(True))
        return {
            "entity": "warehouses",
            "count": int(q.count()),
            "bins": int(db.query(BinLocation).count()),
        }

    if entity in ("fulfillment", "fulfillments"):
        denied = _require_any(user, "sales_order:view")
        if denied:
            return denied
        q = db.query(ItemFulfillment)
        if st:
            q = q.filter(ItemFulfillment.status.ilike(st))
        breakdown = dict(db.query(ItemFulfillment.status, func.count()).group_by(ItemFulfillment.status).all())
        return {
            "entity": "fulfillments",
            "count": int(q.count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("goods_receipt", "goods_receipts", "grn"):
        denied = _require_any(user, "po:view", "subcontract:view")
        if denied:
            return denied
        q = db.query(GoodsReceipt)
        if st:
            q = q.filter(GoodsReceipt.status.ilike(st))
        breakdown = dict(db.query(GoodsReceipt.status, func.count()).group_by(GoodsReceipt.status).all())
        return {
            "entity": "goods_receipts",
            "count": int(q.count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("ar_invoice", "ar_invoices"):
        denied = _require_any(user, "ar_invoice:view")
        if denied:
            return denied
        q = db.query(ARInvoice)
        if st:
            q = q.filter(or_(ARInvoice.status.ilike(st), ARInvoice.approval_status.ilike(st)))
        breakdown = dict(db.query(ARInvoice.status, func.count()).group_by(ARInvoice.status).all())
        return {
            "entity": "ar_invoices",
            "count": int(q.count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("ap_bill", "ap_bills"):
        denied = _require_any(user, "ap_bill:view")
        if denied:
            return denied
        q = db.query(APBill)
        if st:
            q = q.filter(or_(APBill.status.ilike(st), APBill.approval_status.ilike(st)))
        breakdown = dict(db.query(APBill.status, func.count()).group_by(APBill.status).all())
        return {
            "entity": "ap_bills",
            "count": int(q.count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("sales_invoice", "sales_invoices"):
        denied = _require_any(user, "sales_order:view")
        if denied:
            return denied
        q = db.query(SalesInvoice)
        if st:
            q = q.filter(SalesInvoice.status.ilike(st))
        breakdown = dict(db.query(SalesInvoice.status, func.count()).group_by(SalesInvoice.status).all())
        return {
            "entity": "sales_invoices",
            "count": int(q.count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("supplier_invoice", "supplier_invoices"):
        denied = _require_any(user, "ap_bill:view")
        if denied:
            return denied
        q = db.query(SupplierInvoice)
        if st:
            q = q.filter(SupplierInvoice.status.ilike(st))
        breakdown = dict(
            db.query(SupplierInvoice.status, func.count()).group_by(SupplierInvoice.status).all()
        )
        return {
            "entity": "supplier_invoices",
            "count": int(q.count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("cash", "cash_transactions"):
        denied = _require_any(user, "cash:view")
        if denied:
            return denied
        q = db.query(CashTransaction)
        breakdown = dict(db.query(CashTransaction.type, func.count()).group_by(CashTransaction.type).all())
        return {
            "entity": "cash_transactions",
            "count": int(q.count()),
            "by_type": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("journal", "journals", "journal_entries"):
        denied = _require_any(user, "journal:view")
        if denied:
            return denied
        q = db.query(JournalEntry)
        if st:
            q = q.filter(
                or_(JournalEntry.posting_status.ilike(st), JournalEntry.approval_status.ilike(st))
            )
        breakdown = dict(
            db.query(JournalEntry.posting_status, func.count()).group_by(JournalEntry.posting_status).all()
        )
        return {
            "entity": "journal_entries",
            "count": int(q.count()),
            "by_posting_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("account", "accounts", "chart_of_accounts"):
        denied = _require_any(user, "journal:view")
        if denied:
            return denied
        breakdown = dict(
            db.query(ChartOfAccount.account_type, func.count()).group_by(ChartOfAccount.account_type).all()
        )
        return {
            "entity": "chart_of_accounts",
            "count": int(db.query(ChartOfAccount).count()),
            "by_type": {str(k): int(v) for k, v in breakdown.items()},
        }

    if entity in ("user", "users"):
        denied = _require_any(user, "admin:manage")
        if denied:
            return denied
        breakdown = dict(db.query(User.status, func.count()).group_by(User.status).all())
        return {
            "entity": "users",
            "count": int(db.query(User).count()),
            "by_status": {str(k): int(v) for k, v in breakdown.items()},
        }

    return {
        "error": f"Unknown entity '{entity}'",
        "supported": [name for name, _ in ENTITY_ALIASES],
    }


def _full_summary(db, user: User) -> dict[str, Any]:
    modules = [
        "customers",
        "vendors",
        "items",
        "items_with_bom",
        "work_centers",
        "sales_orders",
        "purchase_orders",
        "subcontract_orders",
        "inventory",
        "warehouses",
        "fulfillments",
        "goods_receipts",
        "ar_invoices",
        "ap_bills",
        "sales_invoices",
        "supplier_invoices",
        "cash",
        "journals",
        "accounts",
    ]
    out: dict[str, Any] = {"entity": "all", "modules": {}}
    skipped: list[str] = []
    for name in modules:
        result = _counts_for_entity(db, user, name, "")
        if isinstance(result, str):
            skipped.append(name)
            continue
        out["modules"][name] = {"count": result.get("count"), **{k: v for k, v in result.items() if k not in ("entity", "count", "note")}}
    if skipped:
        out["skipped_no_permission"] = skipped
    return out


def _money(value: Any) -> str:
    amt = Decimal(str(value or 0)).quantize(Decimal("0.01"))
    return f"${amt:,.2f}"


def _qty(value: Any) -> str:
    amt = Decimal(str(value or 0))
    if amt == amt.to_integral_value():
        return f"{int(amt):,}"
    return format(amt.quantize(Decimal("0.0001")), ",f").rstrip("0").rstrip(".")


def _fill_month_gaps(months: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Insert zero months between the first and last so a trend chart is continuous."""
    keys: list[tuple[int, int]] = []
    by_key: dict[str, dict[str, Any]] = {}
    for row in months:
        raw = str(row.get("month") or "")
        try:
            year, month = int(raw[:4]), int(raw[5:7])
        except (TypeError, ValueError):
            continue
        if year <= 0 or month < 1 or month > 12:
            continue
        keys.append((year, month))
        by_key[f"{year:04d}-{month:02d}"] = row
    if not keys:
        return months
    start, end = min(keys), max(keys)
    span = (end[0] - start[0]) * 12 + (end[1] - start[1]) + 1
    if span <= 1 or span > 24:
        return months
    filled: list[dict[str, Any]] = []
    year, month = start
    while (year, month) <= end:
        key = f"{year:04d}-{month:02d}"
        row = by_key.get(key)
        if row:
            filled.append(row)
        else:
            filled.append(
                {
                    "month": key,
                    "label": date(year, month, 1).strftime("%b %Y"),
                    "order_count": 0,
                    "total_amount": "0.00",
                }
            )
        month += 1
        if month > 12:
            month = 1
            year += 1
    return filled


def format_period_answer(raw: str) -> str:
    """Turn get_orders_by_month JSON into a Markdown table plus an ai-chart series."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    title = str(data.get("title") or "Totals by month")
    count_label = str(data.get("count_label") or "Orders")
    party_label = str(data.get("party_label") or "")
    grain = str(data.get("grain") or "month")
    amount_format = str(data.get("amount_format") or "money")
    amount_fn = _qty if amount_format == "quantity" else _money
    period_label = {"quarter": "Quarter", "week": "Week"}.get(grain, "Month")
    amount_heading = "Qty issued" if amount_format == "quantity" else "Amount"
    months = data.get("months") or []
    lines = [f"## {title}", ""]
    if not months:
        lines.append(f"No {count_label.lower()} found for this grouping.")
        return "\n".join(lines)

    has_party = bool(party_label) and any(row.get("party") or row.get("party_id") for row in months)
    is_profit = str(data.get("kind") or "") == "gl_profit" or any(
        row.get("net_income") is not None for row in months
    )
    chart_rows = months if grain in {"quarter", "week"} or has_party else _fill_month_gaps(months)
    chart_points: list[dict[str, Any]] = []
    if is_profit:
        for row in chart_rows:
            chart_points.append(
                {
                    "label": row.get("label") or row.get("month"),
                    "orders": 0,
                    "amount": float(Decimal(str(row.get("net_income") or row.get("total_amount") or 0))),
                }
            )
        chart = {
            "type": "month_trend",
            "title": title,
            "countLabel": count_label,
            "amountLabel": "Net Income" if amount_format != "quantity" else amount_heading,
            "seriesLabel": None,
            "points": chart_points,
        }
        lines.append("```ai-chart")
        lines.append(json.dumps(chart, separators=(",", ":")))
        lines.append("```")
        lines.append("")
        lines.append(f"| {period_label} | Revenue | Expenses | Net Income |")
        lines.append("| :--- | ---: | ---: | ---: |")
        total_revenue = Decimal("0.00")
        total_expense = Decimal("0.00")
        total_profit = Decimal("0.00")
        for row in months:
            revenue = Decimal(str(row.get("revenue") or 0))
            expense = Decimal(str(row.get("expense") or 0))
            profit = Decimal(str(row.get("net_income") or row.get("total_amount") or 0))
            total_revenue += revenue
            total_expense += expense
            total_profit += profit
            lines.append(
                f"| {row.get('label') or row.get('month')} | {_money(revenue)} | "
                f"{_money(expense)} | {_money(profit)} |"
            )
        lines.append(
            f"| Total | {_money(total_revenue)} | {_money(total_expense)} | {_money(total_profit)} |"
        )
        lines.append("")
        lines.append(
            f"Posted profit for this grouping is {_money(total_profit)} "
            f"(revenue {_money(total_revenue)} − expenses {_money(total_expense)})."
        )
        if data.get("note"):
            lines.append("")
            lines.append(str(data["note"]))
        return "\n".join(lines)
    is_compare = str(data.get("kind") or "") == "sales_vs_purchases"
    if is_compare:
        chart_rows = months if grain in {"quarter", "week"} else _fill_month_gaps(months)
        for row in chart_rows:
            label = row.get("label") or row.get("month")
            chart_points.append(
                {
                    "label": label,
                    "orders": int(row.get("sales_count") or 0),
                    "amount": float(Decimal(str(row.get("sales_amount") or 0))),
                    "series": "Sales",
                }
            )
            chart_points.append(
                {
                    "label": label,
                    "orders": int(row.get("purchase_count") or 0),
                    "amount": float(Decimal(str(row.get("purchase_amount") or 0))),
                    "series": "Purchasing",
                }
            )
        chart = {
            "type": "month_trend",
            "title": title,
            "compare": True,
            "countLabel": count_label,
            "amountLabel": amount_heading,
            "seriesLabel": None,
            "points": chart_points,
        }
        lines.append("```ai-chart")
        lines.append(json.dumps(chart, separators=(",", ":")))
        lines.append("```")
        lines.append("")
        lines.append(
            f"| {period_label} | Sales orders | Sales | Purchase orders | Purchasing |"
        )
        lines.append("| :--- | ---: | ---: | ---: | ---: |")
        total_sales_count = 0
        total_purchase_count = 0
        total_sales_amount = Decimal("0.00")
        total_purchase_amount = Decimal("0.00")
        for row in months:
            sales_count = int(row.get("sales_count") or 0)
            purchase_count = int(row.get("purchase_count") or 0)
            sales_amount = Decimal(str(row.get("sales_amount") or 0))
            purchase_amount = Decimal(str(row.get("purchase_amount") or 0))
            total_sales_count += sales_count
            total_purchase_count += purchase_count
            total_sales_amount += sales_amount
            total_purchase_amount += purchase_amount
            lines.append(
                f"| {row.get('label') or row.get('month')} | {sales_count} | "
                f"{_money(sales_amount)} | {purchase_count} | {_money(purchase_amount)} |"
            )
        lines.append(
            f"| Total | {total_sales_count} | {_money(total_sales_amount)} | "
            f"{total_purchase_count} | {_money(total_purchase_amount)} |"
        )
        lines.append("")
        lines.append(
            f"{total_sales_count} sales orders totaling {_money(total_sales_amount)}. "
            f"{total_purchase_count} purchase orders totaling {_money(total_purchase_amount)}."
        )
        if data.get("note"):
            lines.append("")
            lines.append(str(data["note"]))
        return "\n".join(lines)
    if has_party:
        for row in months:
            chart_points.append(
                {
                    "label": row.get("label") or row.get("month"),
                    "orders": int(row.get("order_count") or 0),
                    "amount": float(Decimal(str(row.get("total_amount") or 0))),
                    "series": row.get("party") or row.get("party_id") or "Unknown",
                }
            )
    else:
        for row in chart_rows:
            chart_points.append(
                {
                    "label": row.get("label") or row.get("month"),
                    "orders": int(row.get("order_count") or 0),
                    "amount": float(Decimal(str(row.get("total_amount") or 0))),
                }
            )
    chart = {
        "type": "month_trend",
        "title": title,
        "countLabel": count_label,
        "amountLabel": amount_heading,
        "seriesLabel": party_label or None,
        "points": chart_points,
    }
    lines.append("```ai-chart")
    lines.append(json.dumps(chart, separators=(",", ":")))
    lines.append("```")
    lines.append("")

    if has_party:
        lines.append(f"| {period_label} | {party_label} | {count_label} | {amount_heading} |")
        lines.append("| :--- | :--- | ---: | ---: |")
        for row in months:
            party = row.get("party") or row.get("party_id") or "—"
            lines.append(
                f"| {row.get('label') or row.get('month')} | {party} | "
                f"{row.get('order_count', 0)} | {amount_fn(row.get('total_amount'))} |"
            )
        lines.append(
            f"| Total |  | {data.get('order_count', 0)} | {amount_fn(data.get('total_amount'))} |"
        )
        party_totals: dict[str, dict[str, Any]] = {}
        for row in months:
            key = str(row.get("party") or row.get("party_id") or "Unknown")
            bucket = party_totals.setdefault(key, {"count": 0, "amount": Decimal("0.00")})
            bucket["count"] += int(row.get("order_count") or 0)
            bucket["amount"] += Decimal(str(row.get("total_amount") or 0))
        lines.append("")
        lines.append(f"### Totals by {party_label.lower()}")
        lines.append("")
        lines.append(f"| {party_label} | {count_label} | {amount_heading} |")
        lines.append("| :--- | ---: | ---: |")
        for name, bucket in sorted(
            party_totals.items(), key=lambda item: item[1]["amount"], reverse=True
        ):
            lines.append(
                f"| {name} | {bucket['count']} | {amount_fn(bucket['amount'])} |"
            )
        lines.append(
            f"| Total | {data.get('order_count', 0)} | {amount_fn(data.get('total_amount'))} |"
        )
    else:
        lines.append(f"| {period_label} | {count_label} | {amount_heading} |")
        lines.append("| :--- | ---: | ---: |")
        for row in months:
            lines.append(
                f"| {row.get('label') or row.get('month')} | {row.get('order_count', 0)} | {amount_fn(row.get('total_amount'))} |"
            )
        lines.append(
            f"| Total | {data.get('order_count', 0)} | {amount_fn(data.get('total_amount'))} |"
        )

    lines.append("")
    lines.append(
        f"{data.get('order_count', 0)} {count_label.lower()} totaling {amount_fn(data.get('total_amount'))}."
    )
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


def infer_period_kind(question: str) -> str:
    text = _normalize_question(question)
    if is_sales_vs_purchase_wording(text):
        return "sales_vs_purchases"
    if is_material_issue_wording(text):
        return "material_issues"
    if is_ap_wording(text):
        return "ap_bills"
    if is_ar_wording(text):
        return "ar_invoices"
    if is_supplier_invoice_wording(text):
        return "supplier_invoices"
    if is_sales_invoice_wording(text):
        return "sales_invoices"
    if re.search(r"\bcash\b", text):
        return "cash"
    if is_purchase_wording(text):
        return "purchase_orders"
    if "subcontract" in text or re.search(r"\bsco\b", text):
        return "subcontract_orders"
    if is_revenue_wording(text):
        return "gl_revenue"
    if is_expense_wording(text):
        return "gl_expense"
    if is_profit_wording(text):
        return "gl_profit"
    if re.search(r"\binvoices?\b", text):
        return "sales_invoices"
    if re.search(r"\bbills?\b", text):
        return "ap_bills"
    return "sales_orders"


def infer_period_breakdown(question: str) -> str:
    """Optional second grouping: vendor or customer."""
    text = question.lower()
    if re.search(r"\b(by|per|across)\s+(vendors?|suppliers?)\b", text) or (
        ("by month" in text or "monthly" in text)
        and re.search(r"\b(vendors?|suppliers?)\b", text)
    ):
        return "vendor"
    if re.search(r"\b(by|per|across)\s+customers?\b", text) or (
        ("by month" in text or "monthly" in text) and re.search(r"\bcustomers?\b", text)
    ):
        return "customer"
    return ""


@tool
def get_erp_counts(entity: str = "", status: str = "", question: str = "") -> str:
    """Count live ERP records from the database. ALWAYS use this instead of search_erp_knowledge
    for "how many", "count", or "number of" questions. Returns Markdown already formatted for
    the user — present it verbatim, do not wrap in a code fence or convert to JSON.

    Examples:
    - "How many active customers?" → entity=customers, status=ACTIVE
    - "How many bom items?" / "How many items with BOM details?" → entity=items_with_bom
    - "How many unpaid AR invoices?" → entity=ar_invoices, status=Unpaid

    entity (optional): customers, vendors, items, items_with_bom, bom_headers, work_centers,
    sales_orders, purchase_orders, subcontract_orders, inventory, warehouses, fulfillments,
    goods_receipts, ar_invoices, ap_bills, sales_invoices, supplier_invoices, cash, journals,
    accounts, users. Leave empty and pass question= the user's wording to infer the entity.
    status (optional): ACTIVE, DRAFT, Approved, Low Stock, Unpaid, etc.
    """
    ctx = get_ai_context()
    ent = entity.strip()
    st = status.strip()
    if question.strip() and not ent:
        ent, inferred = infer_entity_and_status(question)
        if not st:
            st = inferred
    if not ent:
        return format_count_answer(_json(_full_summary(ctx.db, ctx.user)))
    result = _counts_for_entity(ctx.db, ctx.user, ent, st)
    if isinstance(result, str):
        return result
    return format_count_answer(_json(result))


def _operating_pnl_filter():
    from app.services.financial_reports import pnl_operating_journal_filter

    return pnl_operating_journal_filter()


def _gl_totals_by_month(db, user: User, kind_key: str, year_filter: int, grain: str = "month") -> str:
    """Posted G/L Revenue or Expense totals grouped by journal period."""
    from app.services.financial_reports import signed_balance

    denied = _require_any(user, "report:view", "journal:view")
    if denied:
        return denied

    account_type = "revenue" if kind_key == "gl_revenue" else "expense"
    grain_label = "quarter" if grain == "quarter" else "month"
    title = f"Revenue by {grain_label}" if kind_key == "gl_revenue" else f"Expenses by {grain_label}"
    note = (
        "Posted journals only. Amounts are G/L Revenue accounts, not sales-order totals."
        if kind_key == "gl_revenue"
        else "Posted journals only. Amounts are G/L Expense accounts."
    )
    query = (
        db.query(
            JournalEntry.period,
            func.coalesce(func.sum(LedgerPosting.debit), 0),
            func.coalesce(func.sum(LedgerPosting.credit), 0),
            func.count(func.distinct(JournalEntry.id)),
        )
        .join(LedgerPosting, LedgerPosting.entry_id == JournalEntry.id)
        .join(ChartOfAccount, ChartOfAccount.id == LedgerPosting.account_id)
        .filter(func.lower(func.coalesce(JournalEntry.posting_status, "Posted")) == "posted")
        .filter(func.lower(ChartOfAccount.account_type) == account_type)
        .filter(JournalEntry.period.isnot(None))
        .filter(_operating_pnl_filter())
    )
    if year_filter:
        query = query.filter(JournalEntry.period.like(f"{year_filter:04d}-%"))
        title = f"{title} ({year_filter})"
    rows = query.group_by(JournalEntry.period).order_by(JournalEntry.period).all()

    by_key: dict[str, dict[str, Any]] = {}
    total_count = 0
    total_amount = Decimal("0.00")
    for period, debit, credit, count in rows:
        key = str(period or "")
        if len(key) < 7:
            continue
        amount = signed_balance(account_type, debit, credit)
        total_count += int(count or 0)
        total_amount += amount
        try:
            label = date(int(key[:4]), int(key[5:7]), 1).strftime("%b %Y")
        except (TypeError, ValueError):
            label = key
        by_key[key] = {
            "month": key,
            "label": label,
            "order_count": int(count or 0),
            "total_amount": str(amount.quantize(Decimal("0.01"))),
        }

    if year_filter:
        months = [
            by_key.get(
                f"{year_filter:04d}-{month:02d}",
                {
                    "month": f"{year_filter:04d}-{month:02d}",
                    "label": date(year_filter, month, 1).strftime("%b %Y"),
                    "order_count": 0,
                    "total_amount": "0.00",
                },
            )
            for month in range(1, 13)
        ]
    else:
        months = list(by_key.values())
    months = _apply_period_grain(months, grain, year_filter)

    return format_period_answer(
        _json(
            {
                "kind": kind_key,
                "title": title,
                "count_label": "Journals",
                "grain": grain_label,
                "year": year_filter or None,
                "order_count": total_count,
                "total_amount": str(total_amount.quantize(Decimal("0.01"))),
                "months": months,
                "note": note,
            }
        )
    )


def _gl_profit_by_month(db, user: User, year_filter: int, grain: str = "month") -> str:
    """Posted G/L net income (revenue − expense) grouped by journal period."""
    denied = _require_any(user, "report:view", "journal:view")
    if denied:
        return denied

    by_key = {str(row["period"]): row for row in posted_pnl_months(db)}
    grain_label = "quarter" if grain == "quarter" else "month"
    title = f"Profit by {grain_label}"
    if year_filter:
        title = f"{title} ({year_filter})"
        months = []
        for month in range(1, 13):
            key = f"{year_filter:04d}-{month:02d}"
            existing = by_key.get(key)
            if existing:
                months.append(
                    {
                        "month": key,
                        "label": existing["label"],
                        "revenue": str(Decimal(str(existing["revenue"])).quantize(Decimal("0.01"))),
                        "expense": str(Decimal(str(existing["expense"])).quantize(Decimal("0.01"))),
                        "net_income": str(Decimal(str(existing["net_income"])).quantize(Decimal("0.01"))),
                        "total_amount": str(Decimal(str(existing["net_income"])).quantize(Decimal("0.01"))),
                        "order_count": 0,
                    }
                )
            else:
                months.append(
                    {
                        "month": key,
                        "label": date(year_filter, month, 1).strftime("%b %Y"),
                        "revenue": "0.00",
                        "expense": "0.00",
                        "net_income": "0.00",
                        "total_amount": "0.00",
                        "order_count": 0,
                    }
                )
    else:
        months = [
            {
                "month": row["period"],
                "label": row["label"],
                "revenue": str(Decimal(str(row["revenue"])).quantize(Decimal("0.01"))),
                "expense": str(Decimal(str(row["expense"])).quantize(Decimal("0.01"))),
                "net_income": str(Decimal(str(row["net_income"])).quantize(Decimal("0.01"))),
                "total_amount": str(Decimal(str(row["net_income"])).quantize(Decimal("0.01"))),
                "order_count": 0,
            }
            for row in by_key.values()
        ]
    months = _apply_period_grain(months, grain, year_filter, pnl=True)

    total_profit = sum((Decimal(str(row["net_income"])) for row in months), Decimal("0.00"))
    return format_period_answer(
        _json(
            {
                "kind": "gl_profit",
                "title": title,
                "count_label": "Quarters" if grain == "quarter" else "Months",
                "grain": grain_label,
                "year": year_filter or None,
                "order_count": len([row for row in months if Decimal(str(row["net_income"])) != 0]),
                "total_amount": str(total_profit.quantize(Decimal("0.01"))),
                "months": months,
                "note": "Posted journals only. Profit is G/L Revenue minus Expense (Net Income).",
            }
        )
    )


def _week_label(year: int, week: int) -> str:
    try:
        start = date.fromisocalendar(year, week, 1)
    except ValueError:
        return f"{year:04d}-W{week:02d}"
    end = start + timedelta(days=6)
    if start.month == end.month and start.year == end.year:
        return f"{start.strftime('%b')} {start.day}–{end.day}, {start.year}"
    if start.year == end.year:
        return f"{start.strftime('%b')} {start.day} – {end.strftime('%b')} {end.day}, {start.year}"
    return f"{start.strftime('%b')} {start.day}, {start.year} – {end.strftime('%b')} {end.day}, {end.year}"


def _material_issues_by_period(db, user: User, year_filter: int, grain: str) -> str:
    """SCO material issues grouped by week, month, or quarter."""
    denied = _require_any(user, "subcontract:view")
    if denied:
        return denied

    date_col = MaterialIssue.issue_date
    if grain == "week":
        year_expr = func.extract("isoyear", date_col)
        part_expr = func.extract("week", date_col)
        title = "Material issues by week"
    elif grain == "quarter":
        year_expr = func.extract("year", date_col)
        part_expr = func.extract("quarter", date_col)
        title = "Material issues by quarter"
    else:
        year_expr = func.extract("year", date_col)
        part_expr = func.extract("month", date_col)
        title = "Material issues by month"

    query = (
        db.query(
            year_expr,
            part_expr,
            func.count(func.distinct(MaterialIssue.issue_id)),
            func.coalesce(func.sum(MaterialIssueLine.quantity_issued), 0),
        )
        .select_from(MaterialIssue)
        .outerjoin(MaterialIssueLine, MaterialIssueLine.issue_id == MaterialIssue.issue_id)
        .filter(date_col.isnot(None))
    )
    if year_filter:
        query = query.filter(func.extract("year", date_col) == year_filter)
        title = f"{title} ({year_filter})"
    rows = query.group_by(year_expr, part_expr).order_by(year_expr, part_expr).all()

    months: list[dict[str, Any]] = []
    total_count = 0
    total_qty = Decimal("0")
    for year_val, part_val, count, qty in rows:
        year = int(year_val or 0)
        part = int(part_val or 0)
        if year <= 0 or part <= 0:
            continue
        amount = Decimal(str(qty or 0))
        total_count += int(count or 0)
        total_qty += amount
        if grain == "week":
            key, label = f"{year:04d}-W{part:02d}", _week_label(year, part)
        elif grain == "quarter":
            key, label = f"{year:04d}-Q{part}", f"Q{part} {year}"
        else:
            key = f"{year:04d}-{part:02d}"
            try:
                label = date(year, part, 1).strftime("%b %Y")
            except ValueError:
                label = key
        months.append(
            {
                "month": key,
                "label": label,
                "order_count": int(count or 0),
                "total_amount": str(amount.quantize(Decimal("0.0001"))),
            }
        )

    return format_period_answer(
        _json(
            {
                "kind": "material_issues",
                "title": title,
                "count_label": "Issues",
                "grain": grain if grain in {"week", "quarter"} else "month",
                "amount_format": "quantity",
                "year": year_filter or None,
                "order_count": total_count,
                "total_amount": str(total_qty.quantize(Decimal("0.0001"))),
                "months": months,
                "note": "Subcontract material issues by issue date. Qty is components issued to WIP.",
            }
        )
    )


def _order_month_buckets(db, date_col, amount_col, year_filter: int) -> dict[str, dict[str, Any]]:
    """Count + amount grouped by calendar month for one order table."""
    year_expr = func.extract("year", date_col)
    month_expr = func.extract("month", date_col)
    query = db.query(
        year_expr,
        month_expr,
        func.count(),
        func.coalesce(func.sum(amount_col), 0),
    ).filter(date_col.isnot(None))
    if year_filter:
        query = query.filter(year_expr == year_filter)
    buckets: dict[str, dict[str, Any]] = {}
    for year_val, month_val, count, amount in query.group_by(year_expr, month_expr).all():
        year = int(year_val or 0)
        month = int(month_val or 0)
        if year <= 0 or month < 1 or month > 12:
            continue
        key = f"{year:04d}-{month:02d}"
        buckets[key] = {
            "count": int(count or 0),
            "amount": Decimal(str(amount or 0)),
        }
    return buckets


def _sales_vs_purchases_by_period(
    db, user: User, year_filter: int, grain: str = "month", question: str = ""
) -> str:
    """Dashboard-style sales-order vs purchase-order totals by period."""
    sales_denied = _require_any(user, "sales_order:view")
    purchase_denied = _require_any(user, "po:view")
    if sales_denied and purchase_denied:
        return sales_denied

    bounds = period_date_bounds(question) if question.strip() else {}
    named_month = str(bounds.get("period") or "").strip()
    if re.match(r"^\d{4}-(0[1-9]|1[0-2])$", named_month):
        year_filter = year_filter or int(named_month[:4])

    grain_label = {"quarter": "quarter", "week": "week"}.get(grain, "month")
    title = f"Purchasing vs sales by {grain_label}"
    sales_buckets = (
        {}
        if sales_denied
        else _order_month_buckets(db, SalesOrder.order_date, SalesOrder.total_amount, year_filter)
    )
    purchase_buckets = (
        {}
        if purchase_denied
        else _order_month_buckets(
            db, PurchaseOrder.order_date, PurchaseOrder.grand_total, year_filter
        )
    )
    if named_month:
        keys = [named_month]
        title = f"Purchasing vs sales — {bounds.get('period_label') or named_month}"
    else:
        keys = sorted(set(sales_buckets) | set(purchase_buckets))
    months: list[dict[str, Any]] = []
    sales_count = 0
    purchase_count = 0
    sales_amount = Decimal("0.00")
    purchase_amount = Decimal("0.00")
    for key in keys:
        year, month = int(key[:4]), int(key[5:7])
        sales = sales_buckets.get(key) or {"count": 0, "amount": Decimal("0.00")}
        purchases = purchase_buckets.get(key) or {"count": 0, "amount": Decimal("0.00")}
        sales_count += int(sales["count"])
        purchase_count += int(purchases["count"])
        sales_amount += Decimal(str(sales["amount"]))
        purchase_amount += Decimal(str(purchases["amount"]))
        months.append(
            {
                "month": key,
                "label": date(year, month, 1).strftime("%b %Y"),
                "sales_count": int(sales["count"]),
                "sales_amount": str(Decimal(str(sales["amount"])).quantize(Decimal("0.01"))),
                "purchase_count": int(purchases["count"]),
                "purchase_amount": str(Decimal(str(purchases["amount"])).quantize(Decimal("0.01"))),
                "order_count": int(sales["count"]) + int(purchases["count"]),
                "total_amount": str(
                    (Decimal(str(sales["amount"])) + Decimal(str(purchases["amount"]))).quantize(
                        Decimal("0.01")
                    )
                ),
            }
        )
    if grain == "quarter":
        title = title.replace("by month", "by quarter")
        months = _apply_period_grain(months, grain, year_filter, compare=True)
    elif grain == "week":
        title = title.replace("by month", "by week")
    elif months and not named_month:
        months = _fill_month_gaps(months)
        for row in months:
            row["sales_count"] = int(row.get("sales_count") or 0)
            row["purchase_count"] = int(row.get("purchase_count") or 0)
            row["sales_amount"] = str(
                Decimal(str(row.get("sales_amount") or 0)).quantize(Decimal("0.01"))
            )
            row["purchase_amount"] = str(
                Decimal(str(row.get("purchase_amount") or 0)).quantize(Decimal("0.01"))
            )
    if year_filter and not named_month:
        title = f"{title} ({year_filter})"
    notes = [
        "Sales is sales-order totals by order date. Purchasing is purchase-order totals by order date (same as the dashboard chart)."
    ]
    if sales_denied:
        notes.append("Sales orders were omitted (missing sales_order:view).")
    if purchase_denied:
        notes.append("Purchase orders were omitted (missing po:view).")
    markdown = format_period_answer(
        _json(
            {
                "kind": "sales_vs_purchases",
                "title": title,
                "count_label": "Orders",
                "grain": grain if grain in {"week", "quarter"} else "month",
                "year": year_filter or None,
                "sales_count": sales_count,
                "sales_amount": str(sales_amount.quantize(Decimal("0.01"))),
                "purchase_count": purchase_count,
                "purchase_amount": str(purchase_amount.quantize(Decimal("0.01"))),
                "order_count": sales_count + purchase_count,
                "total_amount": str((sales_amount + purchase_amount).quantize(Decimal("0.01"))),
                "months": months,
                "note": " ".join(notes),
            }
        )
    )
    if named_month and question.strip():
        parts = [markdown]
        if not sales_denied:
            parts.append(
                get_transactions.invoke(
                    {"kind": "sales_orders", "limit": 40, "question": question}
                )
            )
        if not purchase_denied:
            parts.append(
                get_transactions.invoke(
                    {"kind": "purchase_orders", "limit": 40, "question": question}
                )
            )
        return "\n\n".join(parts)
    return markdown


@tool
def get_orders_by_month(
    kind: str = "sales_orders",
    year: int = 0,
    question: str = "",
    group_by: str = "",
) -> str:
    """Summarize records by calendar month (count + amount). Returns a Markdown table plus an
    ```ai-chart JSON fence for the UI trend chart. Copy both verbatim — do not wrap the
    table in a code fence or convert the answer to JSON.

    Use for "Sales Order by Month", "Account Receivable by Month", "Accounts Payable by Month",
    "Account Payable by Month by Vendor", "cash by month". Never use get_finance_records
    or get_sales_orders for by-month questions — those only list recent rows.

    Use for "revenue by month" / "compare revenue by quarter" (kind=gl_revenue, posted G/L),
    "profit by month" (kind=gl_profit, posted net income), "sales by month"
    (kind=sales_orders), and "purchasing vs sales by month" (kind=sales_vs_purchases).
    Never use search_erp_knowledge for those.

    kind: sales_orders | purchase_orders | sales_vs_purchases | subcontract_orders |
    ap_bills | ar_invoices | sales_invoices | supplier_invoices | cash | gl_revenue |
    gl_expense | gl_profit
    group_by: optional vendor | customer (also inferred from question, e.g. "by vendor").
    year: optional 4-digit year filter (0 = all years).
    Pass question= the user's wording so the kind and grouping can be inferred.
    """
    ctx = get_ai_context()
    kind_key = kind.strip().lower()
    if question.strip():
        kind_key = infer_period_kind(question)
    aliases = {
        "sales": "sales_orders",
        "so": "sales_orders",
        "sales_order": "sales_orders",
        "purchase": "purchase_orders",
        "po": "purchase_orders",
        "purchase_order": "purchase_orders",
        "subcontract": "subcontract_orders",
        "sco": "subcontract_orders",
        "subcontract_order": "subcontract_orders",
        "material_issue": "material_issues",
        "material_issues": "material_issues",
        "materials_issues": "material_issues",
        "ap": "ap_bills",
        "ap_bill": "ap_bills",
        "payable": "ap_bills",
        "payables": "ap_bills",
        "ar": "ar_invoices",
        "ar_invoice": "ar_invoices",
        "receivable": "ar_invoices",
        "receivables": "ar_invoices",
        "sales_invoice": "sales_invoices",
        "supplier_invoice": "supplier_invoices",
        "cash_transactions": "cash",
        "revenue": "gl_revenue",
        "turnover": "gl_revenue",
        "gl_revenue": "gl_revenue",
        "expense": "gl_expense",
        "expenses": "gl_expense",
        "opex": "gl_expense",
        "spending": "gl_expense",
        "gl_expense": "gl_expense",
        "procurement": "purchase_orders",
        "purchases": "purchase_orders",
        "invoices": "sales_invoices",
        "bills": "ap_bills",
        "profit": "gl_profit",
        "profits": "gl_profit",
        "profitability": "gl_profit",
        "net_profit": "gl_profit",
        "net_income": "gl_profit",
        "earnings": "gl_profit",
        "net_earnings": "gl_profit",
        "bottom_line": "gl_profit",
        "pnl": "gl_profit",
        "gl_profit": "gl_profit",
        "sales_vs_purchases": "sales_vs_purchases",
        "purchasing_vs_sales": "sales_vs_purchases",
        "purchases_vs_sales": "sales_vs_purchases",
        "sales_vs_purchasing": "sales_vs_purchases",
    }
    kind_key = aliases.get(kind_key, kind_key)

    year_filter = int(year or 0)
    if not year_filter and question.strip():
        ym = re.search(r"\b(20\d{2})\b", question)
        if ym:
            year_filter = int(ym.group(1))

    grain = infer_period_grain(question) if question.strip() else "month"

    if kind_key in ("gl_revenue", "gl_expense"):
        return _gl_totals_by_month(ctx.db, ctx.user, kind_key, year_filter, grain)
    if kind_key == "gl_profit":
        return _gl_profit_by_month(ctx.db, ctx.user, year_filter, grain)
    if kind_key == "material_issues":
        return _material_issues_by_period(ctx.db, ctx.user, year_filter, grain)
    if kind_key == "sales_vs_purchases":
        return _sales_vs_purchases_by_period(
            ctx.db, ctx.user, year_filter, grain, question
        )

    join_supplier_invoice = False
    count_col = None
    note = ""
    if kind_key == "purchase_orders":
        denied = _require_any(ctx.user, "po:view")
        if denied:
            return denied
        date_col = PurchaseOrder.order_date
        amount_col = PurchaseOrder.grand_total
        title = "Purchase orders by month"
        count_label = "Orders"
    elif kind_key == "subcontract_orders":
        denied = _require_any(ctx.user, "subcontract:view")
        if denied:
            return denied
        date_col = SubcontractOrder.order_date
        amount_col = SubcontractOrder.quantity_ordered * SubcontractOrder.unit_price
        title = "Subcontract orders by month"
        count_label = "Orders"
    elif kind_key == "ap_bills":
        denied = _require_any(ctx.user, "ap_bill:view")
        if denied:
            return denied
        date_col = func.coalesce(SupplierInvoice.invoice_date, APBill.due_date)
        amount_col = APBill.amount
        title = "Accounts payable by month"
        count_label = "Bills"
        count_col = APBill.bill_id
        join_supplier_invoice = True
        note = "Grouped by supplier invoice date when linked, otherwise due date."
    elif kind_key == "ar_invoices":
        denied = _require_any(ctx.user, "ar_invoice:view")
        if denied:
            return denied
        date_col = ARInvoice.due_date
        amount_col = ARInvoice.amount
        title = "Accounts receivable by month"
        count_label = "Invoices"
        count_col = ARInvoice.invoice_id
        note = "Grouped by due date."
    elif kind_key == "sales_invoices":
        denied = _require_any(ctx.user, "sales_order:view")
        if denied:
            return denied
        date_col = SalesInvoice.issue_date
        amount_col = SalesInvoice.total_amount
        title = "Sales invoices by month"
        count_label = "Invoices"
    elif kind_key == "supplier_invoices":
        denied = _require_any(ctx.user, "ap_bill:view")
        if denied:
            return denied
        date_col = SupplierInvoice.invoice_date
        amount_col = SupplierInvoice.total_amount
        title = "Supplier invoices by month"
        count_label = "Invoices"
    elif kind_key == "cash":
        denied = _require_any(ctx.user, "cash:view")
        if denied:
            return denied
        date_col = CashTransaction.transaction_date
        amount_col = CashTransaction.amount
        title = "Cash transactions by month"
        count_label = "Transactions"
    else:
        denied = _require_any(ctx.user, "sales_order:view")
        if denied:
            return denied
        date_col = SalesOrder.order_date
        amount_col = SalesOrder.total_amount
        title = "Sales orders by month"
        count_label = "Orders"
        kind_key = "sales_orders"

    breakdown = (group_by or "").strip().lower()
    if question.strip() and not breakdown:
        breakdown = infer_period_breakdown(question)
    if breakdown in ("supplier", "suppliers", "vendors"):
        breakdown = "vendor"
    if breakdown in ("customers",):
        breakdown = "customer"
    vendor_kinds = ("ap_bills", "purchase_orders", "supplier_invoices", "subcontract_orders")
    customer_kinds = ("ar_invoices", "sales_orders", "sales_invoices")
    if breakdown == "vendor" and kind_key in customer_kinds:
        breakdown = "customer"
        note = ((note + " ") if note else "") + "Receivables are grouped by customer."
    elif breakdown == "customer" and kind_key in vendor_kinds:
        breakdown = "vendor"
        note = ((note + " ") if note else "") + "Payables are grouped by vendor."
    elif breakdown not in ("vendor", "customer"):
        breakdown = ""

    party_id_col = None
    party_name_col = None
    party_join = None
    party_label = ""
    if breakdown == "vendor":
        party_label = "Vendor"
        title = f"{title} by vendor"
        if kind_key == "ap_bills":
            party_id_col = APBill.vendor_id
            party_name_col = func.coalesce(Supplier.company_name, APBill.vendor_id)
            party_join = (Supplier, APBill.vendor_id == Supplier.supplier_id)
        elif kind_key == "purchase_orders":
            party_id_col = PurchaseOrder.supplier_id
            party_name_col = func.coalesce(Supplier.company_name, PurchaseOrder.supplier_id)
            party_join = (Supplier, PurchaseOrder.supplier_id == Supplier.supplier_id)
        elif kind_key == "supplier_invoices":
            party_id_col = SupplierInvoice.vendor_id
            party_name_col = func.coalesce(Supplier.company_name, SupplierInvoice.vendor_id)
            party_join = (Supplier, SupplierInvoice.vendor_id == Supplier.supplier_id)
        elif kind_key == "subcontract_orders":
            party_id_col = SubcontractOrder.supplier_id
            party_name_col = func.coalesce(Supplier.company_name, SubcontractOrder.supplier_id)
            party_join = (Supplier, SubcontractOrder.supplier_id == Supplier.supplier_id)
        else:
            party_label = ""
            breakdown = ""
    elif breakdown == "customer":
        party_label = "Customer"
        title = f"{title} by customer"
        if kind_key == "ar_invoices":
            party_id_col = ARInvoice.customer_id
            party_name_col = func.coalesce(Customer.company_name, ARInvoice.customer_id)
            party_join = (Customer, ARInvoice.customer_id == Customer.customer_id)
        elif kind_key == "sales_orders":
            party_id_col = SalesOrder.customer_id
            party_name_col = func.coalesce(Customer.company_name, SalesOrder.customer_id)
            party_join = (Customer, SalesOrder.customer_id == Customer.customer_id)
        elif kind_key == "sales_invoices":
            party_id_col = SalesInvoice.customer_id
            party_name_col = func.coalesce(Customer.company_name, SalesInvoice.customer_id)
            party_join = (Customer, SalesInvoice.customer_id == Customer.customer_id)
        else:
            party_label = ""
            breakdown = ""

    year_expr = func.extract("year", date_col)
    month_expr = func.extract("month", date_col)
    count_expr = func.count(count_col) if count_col is not None else func.count()
    select_cols = [year_expr, month_expr]
    if party_id_col is not None:
        select_cols.extend([party_id_col, party_name_col])
    select_cols.extend([count_expr, func.coalesce(func.sum(amount_col), 0)])
    query = ctx.db.query(*select_cols)
    if join_supplier_invoice:
        query = query.select_from(APBill).outerjoin(
            SupplierInvoice, APBill.supplier_invoice_id == SupplierInvoice.id
        )
    elif kind_key == "ar_invoices":
        query = query.select_from(ARInvoice)
    if party_join is not None:
        query = query.outerjoin(party_join[0], party_join[1])
    query = query.filter(date_col.isnot(None))
    if year_filter:
        query = query.filter(year_expr == year_filter)
        title = f"{title} ({year_filter})"
    group_cols = [year_expr, month_expr]
    order_cols = [year_expr, month_expr]
    if party_id_col is not None:
        group_cols.extend([party_id_col, party_name_col])
        order_cols.extend([party_name_col])
    rows = query.group_by(*group_cols).order_by(*order_cols).all()

    months = []
    total_count = 0
    total_amount = Decimal("0.00")
    for row in rows:
        if party_id_col is not None:
            year_val, month_val, party_id, party_name, count, amount = row
        else:
            year_val, month_val, count, amount = row
            party_id, party_name = None, None
        y = int(year_val or 0)
        m = int(month_val or 0)
        if y <= 0 or m <= 0:
            continue
        amt = Decimal(str(amount or 0))
        total_count += int(count or 0)
        total_amount += amt
        item = {
            "month": f"{y:04d}-{m:02d}",
            "label": date(y, m, 1).strftime("%b %Y"),
            "order_count": int(count or 0),
            "total_amount": str(amt.quantize(Decimal("0.01"))),
        }
        if party_id_col is not None:
            item["party_id"] = str(party_id or "")
            name = str(party_name or party_id or "Unknown").strip()
            item["party"] = name
        months.append(item)
    if grain == "quarter":
        title = title.replace("by month", "by quarter")
        months = _apply_period_grain(months, grain, year_filter)
    elif grain == "week":
        title = title.replace("by month", "by week")
    return format_period_answer(
        _json(
            {
                "kind": kind_key,
                "title": title,
                "count_label": count_label,
                "party_label": party_label or None,
                "grain": grain,
                "year": year_filter or None,
                "order_count": total_count,
                "total_amount": str(total_amount.quantize(Decimal("0.01"))),
                "months": months,
                "note": note or None,
            }
        )
    )


MONTH_NAMES = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sept": 9,
    "sep": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}

REPORT_TYPE_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("cash-flow-forecast", ("cash flow forecast", "cash forecast")),
    (
        "income-statement",
        (
            "income statement",
            "profit and loss",
            "profit & loss",
            "p and l",
            "p & l",
            "p& l",
            "p &l",
            "p&l",
            "p/l",
            "pnl",
        ),
    ),
    ("balance-sheet", ("balance sheet", "statement of financial position")),
    ("cash-flow", ("cash flow statement", "statement of cash flows", "cashflow statement", "cash flow")),
    ("ar-aging", ("ar aging", "receivable aging", "accounts receivable aging")),
    ("ap-aging", ("ap aging", "payable aging", "accounts payable aging")),
    ("trial-balance", ("trial balance",)),
    ("fixed-asset-schedule", ("fixed asset", "fixed-asset", "asset schedule")),
    ("budget-vs-actual", ("budget vs", "budget versus", "budget vs actual")),
    ("bank-reconciliation", ("bank rec", "bank reconciliation")),
]


_GROUPED_TOTALS_PHRASES = (
    "by month",
    "per month",
    "monthly",
    "by quarter",
    "per quarter",
    "quarterly",
    "quarter by quarter",
    "by qtr",
    "per qtr",
    "by week",
    "per week",
    "weekly",
    "week by week",
    "by year",
    "per year",
    "month by month",
    "by vendor",
    "by customer",
    "by account",
    "by supplier",
)

_DOCUMENT_LIST_HINTS = (
    "purchase order",
    "sales order",
    "subcontract",
    "invoice",
    "bill",
    "customer",
    "vendor",
    "supplier",
    "item",
    "sku",
    "bom",
    "warehouse",
    "journal",
    "receipt",
    "fulfillment",
    "shipment",
    "payment",
    "cash",
    "material issue",
)


def _levenshtein(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    prev = list(range(len(right) + 1))
    for i, left_ch in enumerate(left, 1):
        curr = [i]
        for j, right_ch in enumerate(right, 1):
            curr.append(
                min(
                    prev[j] + 1,
                    curr[j - 1] + 1,
                    prev[j - 1] + (left_ch != right_ch),
                )
            )
        prev = curr
    return prev[-1]


def _has_near_word(text: str, *targets: str, max_dist: int = 2) -> bool:
    """True when a token matches a target exactly or within a small edit distance."""
    for token in re.findall(r"[a-z]+", text):
        for target in targets:
            if token == target:
                return True
            if len(token) < 5 or abs(len(token) - len(target)) > max_dist:
                continue
            if _levenshtein(token, target) <= max_dist:
                return True
    return False


def _normalize_question(question: str) -> str:
    text = re.sub(r"&\s*", "&", (question or "").lower())
    return re.sub(r"\s+", " ", text).strip()


_MONTHLY_GROUP_PHRASES = (
    "by month",
    "per month",
    "monthly",
    "month by month",
    "by quarter",
    "per quarter",
    "quarterly",
    "quarter by quarter",
    "by qtr",
    "per qtr",
    "by week",
    "per week",
    "weekly",
    "week by week",
    "this month",
    "this quarter",
    "this week",
    "by year",
    "per year",
)

_PROFIT_WORDING_RE = re.compile(
    r"(?:"
    r"\bnet income\b|"
    r"\bnet profits?\b|"
    r"\bnet earnings\b|"
    r"\bgross profit\b|"
    r"\bprofitability\b|"
    r"\bprofits?\b|"
    r"\bearnings\b|"
    r"\bbottom line\b|"
    r"\bprofit and loss\b|"
    r"\bprofit & loss\b|"
    r"\bp\s*&\s*l\b|"
    r"\bp\s+and\s+l\b|"
    r"\bpnl\b|"
    r"\bp/l\b"
    r")",
    re.I,
)


def is_monthly_group_question(question: str) -> bool:
    text = _normalize_question(question)
    return any(phrase in text for phrase in _MONTHLY_GROUP_PHRASES)


def infer_period_grain(question: str) -> str:
    """month (default), quarter, or week."""
    text = _normalize_question(question)
    if any(
        phrase in text
        for phrase in (
            "by week",
            "per week",
            "weekly",
            "week by week",
            "this week",
        )
    ):
        return "week"
    if any(
        phrase in text
        for phrase in (
            "by quarter",
            "per quarter",
            "quarterly",
            "quarter by quarter",
            "by qtr",
            "per qtr",
            "this quarter",
        )
    ):
        return "quarter"
    return "month"


def _quarter_key(period: str) -> tuple[str, str] | None:
    raw = str(period or "")
    named = re.match(r"^(\d{4})-Q([1-4])$", raw, re.I)
    if named:
        year, qtr = int(named.group(1)), int(named.group(2))
        return f"{year:04d}-Q{qtr}", f"Q{qtr} {year}"
    try:
        year, month = int(raw[:4]), int(raw[5:7])
    except (TypeError, ValueError):
        return None
    if year <= 0 or month < 1 or month > 12:
        return None
    qtr = (month - 1) // 3 + 1
    return f"{year:04d}-Q{qtr}", f"Q{qtr} {year}"


def _empty_quarter_row(
    year: int, qtr: int, *, pnl: bool = False, compare: bool = False
) -> dict[str, Any]:
    key, label = f"{year:04d}-Q{qtr}", f"Q{qtr} {year}"
    row: dict[str, Any] = {
        "month": key,
        "label": label,
        "order_count": 0,
        "total_amount": "0.00",
    }
    if pnl:
        row["revenue"] = "0.00"
        row["expense"] = "0.00"
        row["net_income"] = "0.00"
    if compare:
        row["sales_count"] = 0
        row["sales_amount"] = "0.00"
        row["purchase_count"] = 0
        row["purchase_amount"] = "0.00"
    return row


def _roll_up_to_quarters(months: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for row in months:
        parsed = _quarter_key(str(row.get("month") or ""))
        if parsed is None:
            continue
        key, label = parsed
        bucket = buckets.get(key)
        if bucket is None:
            bucket = {
                "month": key,
                "label": label,
                "order_count": 0,
                "total_amount": Decimal("0.00"),
                "revenue": Decimal("0.00"),
                "expense": Decimal("0.00"),
                "net_income": Decimal("0.00"),
                "sales_count": 0,
                "sales_amount": Decimal("0.00"),
                "purchase_count": 0,
                "purchase_amount": Decimal("0.00"),
                "has_pnl": False,
                "has_compare": False,
            }
            buckets[key] = bucket
            order.append(key)
        bucket["order_count"] += int(row.get("order_count") or 0)
        bucket["total_amount"] += Decimal(str(row.get("total_amount") or 0))
        if row.get("revenue") is not None or row.get("net_income") is not None:
            bucket["has_pnl"] = True
            bucket["revenue"] += Decimal(str(row.get("revenue") or 0))
            bucket["expense"] += Decimal(str(row.get("expense") or 0))
            bucket["net_income"] += Decimal(str(row.get("net_income") or row.get("total_amount") or 0))
        if row.get("sales_amount") is not None or row.get("purchase_amount") is not None:
            bucket["has_compare"] = True
            bucket["sales_count"] += int(row.get("sales_count") or 0)
            bucket["sales_amount"] += Decimal(str(row.get("sales_amount") or 0))
            bucket["purchase_count"] += int(row.get("purchase_count") or 0)
            bucket["purchase_amount"] += Decimal(str(row.get("purchase_amount") or 0))
    out: list[dict[str, Any]] = []
    for key in order:
        bucket = buckets[key]
        item = {
            "month": bucket["month"],
            "label": bucket["label"],
            "order_count": bucket["order_count"],
            "total_amount": str(bucket["total_amount"].quantize(Decimal("0.01"))),
        }
        if bucket["has_pnl"]:
            item["revenue"] = str(bucket["revenue"].quantize(Decimal("0.01")))
            item["expense"] = str(bucket["expense"].quantize(Decimal("0.01")))
            item["net_income"] = str(bucket["net_income"].quantize(Decimal("0.01")))
        if bucket["has_compare"]:
            item["sales_count"] = bucket["sales_count"]
            item["sales_amount"] = str(bucket["sales_amount"].quantize(Decimal("0.01")))
            item["purchase_count"] = bucket["purchase_count"]
            item["purchase_amount"] = str(bucket["purchase_amount"].quantize(Decimal("0.01")))
        out.append(item)
    return out


def _apply_period_grain(
    months: list[dict[str, Any]],
    grain: str,
    year_filter: int = 0,
    *,
    pnl: bool = False,
    compare: bool = False,
) -> list[dict[str, Any]]:
    if grain != "quarter":
        return months
    rolled = _roll_up_to_quarters(months)
    if not year_filter:
        return rolled
    by_key = {row["month"]: row for row in rolled}
    return [
        by_key.get(
            f"{year_filter:04d}-Q{qtr}",
            _empty_quarter_row(year_filter, qtr, pnl=pnl, compare=compare),
        )
        for qtr in range(1, 5)
    ]


def is_profit_wording(question: str) -> bool:
    """True for profit / net income / P&L wording, not EBIT or operating profit."""
    text = _normalize_question(question)
    if re.search(r"\b(ebitda|ebit|operating profit|operating income)\b", text):
        return False
    return bool(_PROFIT_WORDING_RE.search(text))


def is_expense_wording(question: str) -> bool:
    """G/L expense wording. Not COGS or item/unit cost."""
    text = _normalize_question(question)
    if re.search(r"\b(cogs|cost of goods|unit cost|item cost)\b", text):
        return False
    return bool(
        re.search(
            r"\b(operating expenses?|opex|expenses?|spending|spend|overhead)\b",
            text,
        )
    )


def is_revenue_wording(question: str) -> bool:
    text = _normalize_question(question)
    return bool(re.search(r"\b(revenues?|sales revenue|turnover|top line)\b", text))


def is_ap_wording(question: str) -> bool:
    text = _normalize_question(question)
    return bool(
        re.search(
            r"\b(accounts payable|account payable|ap bills?|payables?|vendor bills?)\b",
            text,
        )
        or re.search(r"\b(ap|a/p)\b", text)
    )


def is_ar_wording(question: str) -> bool:
    text = _normalize_question(question)
    return bool(
        re.search(
            r"\b(accounts receivable|account receivable|ar invoices?|receivables?)\b",
            text,
        )
        or re.search(r"\b(ar|a/r)\b", text)
    )


def is_supplier_invoice_wording(question: str) -> bool:
    text = _normalize_question(question)
    return bool(
        re.search(
            r"\b("
            r"supplier invoices?|vendor invoices?|purchase invoices?|"
            r"ap invoices?|supplier bills?|non-?po invoices?|landed[- ]cost invoices?"
            r")\b",
            text,
        )
    )


def is_sales_invoice_wording(question: str) -> bool:
    text = _normalize_question(question)
    return bool(
        re.search(
            r"\b(sales invoices?|customer invoices?|ar invoices?|receivable invoices?)\b",
            text,
        )
    )


def is_material_issue_wording(question: str) -> bool:
    text = _normalize_question(question)
    return bool(
        re.search(
            r"\b("
            r"materials? issues?|material issues?|"
            r"kit issues?|component issues?|"
            r"issue materials|issued materials|"
            r"material issuances?"
            r")\b",
            text,
        )
    )


def is_purchase_wording(question: str) -> bool:
    """Purchase orders / procurement. Not purchase invoices (those are AP)."""
    text = _normalize_question(question)
    if is_supplier_invoice_wording(text) or is_sales_invoice_wording(text):
        return False
    padded = f" {text} "
    if " po " in padded or " pos " in padded or "p.o." in text:
        return True
    return bool(
        re.search(
            r"\b(purchase orders?|purchases?|purchasing|procurement|vendor orders?)\b",
            text,
        )
    )


def is_sales_vs_purchase_wording(question: str) -> bool:
    """True for dashboard-style purchasing vs sales comparisons."""
    text = _normalize_question(question)
    if is_supplier_invoice_wording(text) or is_sales_invoice_wording(text):
        return False
    has_purchase = is_purchase_wording(text) or bool(re.search(r"\b(pos?)\b", text))
    has_sales = bool(re.search(r"\b(sales?|selling|sos?)\b", text))
    if not (has_purchase and has_sales):
        return False
    if re.search(r"\b(vs\.?|versus|v\.s\.|compared to|compared with|against)\b", text):
        return True
    if re.search(r"\bcompare\b", text):
        return True
    return bool(re.search(r"\b(and|&)\b", text) and is_monthly_group_question(text))


def is_period_entity_wording(question: str) -> bool:
    """True when a by-month question names a known ERP total or document type."""
    text = _normalize_question(question)
    return (
        is_sales_vs_purchase_wording(text)
        or is_profit_wording(text)
        or is_expense_wording(text)
        or is_revenue_wording(text)
        or is_purchase_wording(text)
        or is_ap_wording(text)
        or is_ar_wording(text)
        or is_supplier_invoice_wording(text)
        or is_sales_invoice_wording(text)
        or is_material_issue_wording(text)
        or bool(
            re.search(
                r"\b(invoices?|bills?|cash|sales|orders?|subcontract|sco)\b",
                text,
            )
        )
    )


def infer_financial_report_type(question: str) -> str:
    """Map wording onto a financial-report catalog id, or empty if not a report."""
    text = re.sub(r"&\s*", "&", (question or "").lower())
    text = re.sub(r"\s+", " ", text)
    # "P&L by month" / "compare revenue by quarter" are grouped totals, not one statement.
    if is_monthly_group_question(text) and (
        is_profit_wording(text) or is_revenue_wording(text) or is_expense_wording(text)
    ):
        return ""
    for report_id, needles in REPORT_TYPE_ALIASES:
        if any(needle in text for needle in needles):
            return report_id
    if any(phrase in text for phrase in ("financial report", "financial statement", "financial statements")):
        return "income-statement"
    # "Show me the revenue for September 2027" is a P&L ask, not a knowledge search.
    # Leave "revenue by month" / "revenue by vendor" to get_orders_by_month.
    if any(phrase in text for phrase in _GROUPED_TOTALS_PHRASES):
        return ""
    if (
        is_profit_wording(text)
        or is_expense_wording(text)
        or is_revenue_wording(text)
        or _has_near_word(
            text, "revenue", "revenues", "expense", "expenses", "opex", "spending", "turnover", max_dist=1
        )
    ):
        return "income-statement"
    # "show me expense for September 2026" / "show me September 2026"
    if parse_financial_report_period(question) and re.search(
        r"\b(show|give|tell|display|pull)\b", text
    ):
        if (
            is_invoice_document_wording(text)
            or is_invoice_due_wording(question)
            or is_transaction_document_wording(text)
        ):
            return ""
        if not any(hint in text for hint in _DOCUMENT_LIST_HINTS):
            return "income-statement"
    return ""


def parse_financial_report_period(question: str) -> dict[str, Any]:
    """Extract period / date range kwargs from wording such as 'June 2026'."""
    text = question or ""
    lower = text.lower()
    month_alt = "|".join(sorted(MONTH_NAMES, key=len, reverse=True))

    iso = re.search(r"\b(20\d{2})[-/](0?[1-9]|1[0-2])\b", text)
    if iso:
        return {"period": f"{int(iso.group(1)):04d}-{int(iso.group(2)):02d}"}

    month_year = re.search(r"\b(0?[1-9]|1[0-2])[-/](20\d{2})\b", text)
    if month_year:
        return {
            "period": f"{int(month_year.group(2)):04d}-{int(month_year.group(1)):02d}"
        }

    named = re.search(rf"\b({month_alt})\.?\s*,?\s*(20\d{{2}})\b", lower)
    if named:
        return {"period": f"{int(named.group(2)):04d}-{MONTH_NAMES[named.group(1).rstrip('.')]:02d}"}

    year_first = re.search(rf"\b(20\d{{2}})\s+({month_alt})\b", lower)
    if year_first:
        return {
            "period": f"{int(year_first.group(1)):04d}-{MONTH_NAMES[year_first.group(2)]:02d}"
        }

    quarter = re.search(r"\bq([1-4])\s*(?:of\s+)?(20\d{2})\b", lower)
    if quarter:
        qtr = int(quarter.group(1))
        year = int(quarter.group(2))
        start_month = (qtr - 1) * 3 + 1
        end_month = start_month + 2
        return {
            "date_from": date(year, start_month, 1),
            "date_to": date(year, end_month, monthrange(year, end_month)[1]),
            "fiscal_year": year,
        }

    year_m = re.search(r"\b(20\d{2})\b", text)
    if year_m:
        year = int(year_m.group(1))
        return {
            "date_from": date(year, 1, 1),
            "date_to": date(year, 12, 31),
            "fiscal_year": year,
        }
    return {}


def period_date_bounds(question: str) -> dict[str, Any]:
    """Inclusive dates for wording such as '09/2026' or 'September 2026'."""
    parsed = parse_financial_report_period(question)
    if not parsed:
        return {}

    period = str(parsed.get("period") or "").strip()
    if re.match(r"^\d{4}-(0[1-9]|1[0-2])$", period):
        year = int(period[:4])
        month = int(period[5:7])
        start = date(year, month, 1)
        end = date(year, month, monthrange(year, month)[1])
        return {
            "period": period,
            "date_from": start,
            "date_to": end,
            "period_label": (
                f"{('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')[month - 1]} "
                f"{year}"
            ),
        }

    start = parsed.get("date_from")
    end = parsed.get("date_to")
    if isinstance(start, date) and isinstance(end, date):
        if start.month == 1 and start.day == 1 and end.month == 12 and end.day == 31:
            label = str(start.year)
        else:
            label = f"{start.isoformat()} to {end.isoformat()}"
        return {
            "date_from": start,
            "date_to": end,
            "period_label": label,
        }
    return {}


def posted_pnl_months(db) -> list[dict[str, Any]]:
    """Posted Revenue/Expense totals grouped by journal period."""
    from app.services.financial_reports import signed_balance

    rows = (
        db.query(
            JournalEntry.period,
            ChartOfAccount.account_type,
            func.coalesce(func.sum(LedgerPosting.debit), 0),
            func.coalesce(func.sum(LedgerPosting.credit), 0),
        )
        .join(LedgerPosting, LedgerPosting.entry_id == JournalEntry.id)
        .join(ChartOfAccount, ChartOfAccount.id == LedgerPosting.account_id)
        .filter(func.lower(func.coalesce(JournalEntry.posting_status, "Posted")) == "posted")
        .filter(func.lower(ChartOfAccount.account_type).in_(["revenue", "expense"]))
        .filter(JournalEntry.period.isnot(None))
        .filter(_operating_pnl_filter())
        .group_by(JournalEntry.period, ChartOfAccount.account_type)
        .order_by(JournalEntry.period)
        .all()
    )
    by_period: dict[str, dict[str, Any]] = {}
    for period, account_type, debit, credit in rows:
        key = str(period or "")
        if not key:
            continue
        bucket = by_period.setdefault(
            key, {"period": key, "revenue": Decimal("0.00"), "expense": Decimal("0.00")}
        )
        amount = signed_balance(account_type, debit, credit)
        if (account_type or "").lower() == "revenue":
            bucket["revenue"] += amount
        else:
            bucket["expense"] += amount
    out: list[dict[str, Any]] = []
    for key, bucket in by_period.items():
        revenue = Decimal(str(bucket["revenue"]))
        expense = Decimal(str(bucket["expense"]))
        if revenue == 0 and expense == 0:
            continue
        try:
            label = date(int(key[:4]), int(key[5:7]), 1).strftime("%b %Y")
        except (TypeError, ValueError):
            label = key
        out.append(
            {
                "period": key,
                "label": label,
                "revenue": revenue,
                "expense": expense,
                "net_income": revenue - expense,
            }
        )
    return out


def _income_statement_is_empty(payload: dict[str, Any]) -> bool:
    summary = payload.get("summary") or {}
    keys = ("revenue", "cogs", "operating_expenses", "net_income")
    return all(Decimal(str(summary.get(key) or 0)) == 0 for key in keys)


def format_financial_report_answer(raw: str | dict[str, Any]) -> str:
    """Turn a financial-report payload into a Markdown table the chat UI can render."""
    if isinstance(raw, str):
        stripped = raw.strip()
        if not stripped:
            return raw
        if stripped.startswith("Permission denied") or stripped.startswith("## "):
            return raw
        try:
            data = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return raw
    else:
        data = raw
    if not isinstance(data, dict):
        return str(raw)
    if isinstance(data.get("error"), str):
        return data["error"]

    title = str(data.get("title") or "Financial report")
    subtitle = str(data.get("subtitle") or "")
    columns = data.get("columns") or []
    rows = data.get("rows") or []
    empty_period = bool(data.get("empty_period"))
    lines = [f"## {title}", ""]
    if empty_period:
        lines.append(
            "**No posted P&L activity in this date range.** Only Posted journals are included."
        )
        lines.append("")
    if subtitle:
        lines.append(subtitle)
        lines.append("")

    if not columns:
        return "\n".join(lines).rstrip()

    headers = [str(col.get("label") or col.get("key") or "") for col in columns]
    aligns: list[str] = []
    for col in columns:
        fmt = str(col.get("format") or "")
        align = str(col.get("align") or "")
        if fmt == "number" or align == "right":
            aligns.append("---:")
        else:
            aligns.append(":---")
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join(aligns) + " |")

    for row in rows:
        cells = row.get("cells") or {}
        emphasis = str(row.get("emphasis") or "normal")
        indent = int(row.get("indent") or 0)
        values: list[str] = []
        for index, col in enumerate(columns):
            key = str(col.get("key") or "")
            fmt = str(col.get("format") or "text")
            value = cells.get(key)
            if index == 0 and isinstance(value, str) and indent:
                value = f"{' ' * indent}{value}"
            if value is None or value == "":
                rendered = ""
            elif fmt == "number":
                rendered = _money(value)
            else:
                rendered = str(value)
            if emphasis in {"section", "total", "net", "negative"} and rendered:
                rendered = f"**{rendered}**"
            values.append(rendered)
        lines.append("| " + " | ".join(values) + " |")

    notes = data.get("notes") or []
    if notes:
        lines.append("")
        for note in notes:
            lines.append(f"_{note}_")
    compare = data.get("sales_order_compare") or {}
    if compare:
        lines.append("")
        period_label = str(compare.get("period_label") or "this period")
        lines.append(
            f"Dashboard **Total Revenue** is all sales orders (**{_money(compare.get('all_total'))}**), "
            f"not this P&L. Sales orders in {period_label}: **{_money(compare.get('period_total'))}** "
            f"({compare.get('period_count') or 0} order(s)). "
            "This statement is posted G/L revenue (month-end close excluded)."
        )
    other_periods = data.get("other_periods") or []
    if other_periods:
        lines.append("")
        lines.append("Posted P&L is in:")
        lines.append("")
        lines.append("| Month | Revenue | Expenses | Net Income |")
        lines.append("| :--- | ---: | ---: | ---: |")
        for row in other_periods:
            lines.append(
                f"| {row.get('label') or row.get('period')} | {_money(row.get('revenue'))} | "
                f"{_money(row.get('expense'))} | {_money(row.get('net_income'))} |"
            )
        labels = ", ".join(str(row.get("label") or row.get("period")) for row in other_periods)
        years = sorted(
            {str(row.get("period") or "")[:4] for row in other_periods if str(row.get("period") or "")[:4].isdigit()}
        )
        year_bit = f" or the year {years[0]}" if len(years) == 1 else ""
        lines.append("")
        lines.append(f"Ask for {labels}{year_bit} to see those totals.")
    elif empty_period:
        lines.append("")
        lines.append("There is no posted P&L in any month yet. Approve and post journals, then ask again.")

    report_type = str(data.get("report_type") or "")
    if report_type:
        filters = data.get("filters") or {}
        period = str(filters.get("period") or "")
        path = f"/financial-reports/{report_type}"
        if re.match(r"^\d{4}-(0[1-9]|1[0-2])$", period):
            path = f"{path}?period={period}"
        lines.append("")
        lines.append(f"[Open the full report]({path})")
    return "\n".join(lines).rstrip()


@tool
def get_financial_report(report_type: str = "", period: str = "", question: str = "") -> str:
    """Generate a live financial statement from posted journal entries.

    ALWAYS use this for Income Statement / P&L, Balance Sheet, Cash Flow,
    Trial Balance, AR/AP aging, or "financial report for June 2026".
    Do NOT use search_erp_knowledge or get_finance_records for these — those
    only return process docs or recent document lists.

    report_type: income-statement | balance-sheet | cash-flow | trial-balance |
    ar-aging | ap-aging | fixed-asset-schedule | cash-flow-forecast |
    budget-vs-actual | bank-reconciliation
    period: YYYY-MM (June 2026 → 2026-06). Leave empty to infer from question.
    Pass question= the user's wording so type and month/year can be inferred.
    Returns Markdown — copy it verbatim; do not wrap in a code fence.
    """
    from app.services.financial_reports import get_financial_report as build_report

    ctx = get_ai_context()
    denied = _require_any(ctx.user, "report:view")
    if denied:
        return denied

    report_id = (report_type or "").strip().lower()
    if question.strip() and not report_id:
        report_id = infer_financial_report_type(question)
    if not report_id:
        report_id = "income-statement"

    kwargs: dict[str, Any] = {}
    if question.strip():
        kwargs.update(parse_financial_report_period(question))
    if period.strip():
        kwargs["period"] = period.strip()
        kwargs.pop("date_from", None)
        kwargs.pop("date_to", None)

    try:
        payload = build_report(ctx.db, report_id, **kwargs)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return f"Could not generate that report: {detail}"
    if report_id == "income-statement":
        payload["sales_order_compare"] = _sales_order_revenue_compare(
            ctx.db, payload.get("filters") or {}
        )
        if _income_statement_is_empty(payload):
            requested = str((payload.get("filters") or {}).get("period") or "")
            payload["empty_period"] = True
            payload["other_periods"] = [
                row for row in posted_pnl_months(ctx.db) if row.get("period") != requested
            ]
    return format_financial_report_answer(payload)


def _sales_order_revenue_compare(db, filters: dict[str, Any]) -> dict[str, Any]:
    """Dashboard Total Revenue is all sales orders; this is the same month's SO total."""
    raw_from = str(filters.get("date_from") or "")
    raw_to = str(filters.get("date_to") or "")
    try:
        start = date.fromisoformat(raw_from)
        end = date.fromisoformat(raw_to)
    except ValueError:
        return {}
    period_count, period_total = (
        db.query(
            func.count(SalesOrder.sales_order_id),
            func.coalesce(func.sum(SalesOrder.total_amount), 0),
        )
        .filter(SalesOrder.order_date >= start, SalesOrder.order_date <= end)
        .one()
    )
    all_total = db.query(func.coalesce(func.sum(SalesOrder.total_amount), 0)).scalar()
    period = str(filters.get("period") or "")
    if re.match(r"^\d{4}-(0[1-9]|1[0-2])$", period):
        label = date(int(period[:4]), int(period[5:7]), 1).strftime("%b %Y")
    else:
        label = f"{start.isoformat()} to {end.isoformat()}"
    return {
        "period_label": label,
        "period_count": int(period_count or 0),
        "period_total": str(period_total or 0),
        "all_total": str(all_total or 0),
    }


@tool
def get_customers(status: str = "", q: str = "", limit: int = 20) -> str:
    """List customers. Filter by status (ACTIVE, INACTIVE, ON_HOLD) and optional search q (name, id, tax id)."""
    ctx = get_ai_context()
    rows = (
        _customer_query(ctx.db, status, q)
        .order_by(Customer.company_name.asc(), Customer.customer_id.asc())
        .limit(_limit(limit))
        .all()
    )
    return _json(
        {
            "count": len(rows),
            "customers": [
                {
                    "customer_id": c.customer_id,
                    "company_name": c.company_name,
                    "status": c.status,
                    "customer_number_ext": c.customer_number_ext,
                    "primary_email": c.primary_email,
                    "currency": c.currency,
                    "payment_terms": c.payment_terms,
                }
                for c in rows
            ],
        }
    )


@tool
def get_customer_detail(customer_id: str) -> str:
    """Get one customer with locations and certifications."""
    ctx = get_ai_context()
    customer = (
        ctx.db.query(Customer)
        .options(joinedload(Customer.locations), joinedload(Customer.certifications))
        .filter(Customer.customer_id == customer_id.strip())
        .first()
    )
    if not customer:
        return _json({"error": f"Customer '{customer_id}' not found"})
    return _json(
        {
            "customer_id": customer.customer_id,
            "company_name": customer.company_name,
            "status": customer.status,
            "tax_id": customer.tax_id,
            "industry_type": customer.industry_type,
            "facility_type": customer.facility_type,
            "primary_contact_name": customer.primary_contact_name,
            "primary_email": customer.primary_email,
            "primary_phone": customer.primary_phone,
            "currency": customer.currency,
            "credit_limit": customer.credit_limit,
            "payment_terms": customer.payment_terms,
            "preferred_incoterms": customer.preferred_incoterms,
            "preferred_shipping_method": customer.preferred_shipping_method,
            "locations": [
                {
                    "location_id": loc.location_id,
                    "location_type": loc.location_type,
                    "location_name": loc.location_name,
                    "city": loc.city,
                    "country": loc.country,
                    "is_default": loc.is_default,
                }
                for loc in (customer.locations or [])
            ],
            "certifications": [
                {
                    "certification_name": cert.certification_name,
                    "certificate_number": cert.certificate_number,
                    "valid_until": cert.valid_until,
                }
                for cert in (customer.certifications or [])
            ],
        }
    )


@tool
def get_vendors(status: str = "", vendor_type: str = "", q: str = "", limit: int = 20) -> str:
    """List vendors/suppliers. vendor_type: material, subcontractor, both, service. status: Active/Inactive."""
    ctx = get_ai_context()
    query = ctx.db.query(Supplier)
    if status.strip():
        query = query.filter(Supplier.status.ilike(_vendor_status(status)))
    if vendor_type.strip():
        query = query.filter(Supplier.vendor_type.ilike(vendor_type.strip()))
    if q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Supplier.supplier_id.ilike(term),
                Supplier.company_name.ilike(term),
                Supplier.vendor_number_ext.ilike(term),
            )
        )
    rows = query.order_by(Supplier.company_name.asc()).limit(_limit(limit)).all()
    return _json(
        {
            "count": len(rows),
            "vendors": [
                {
                    "supplier_id": s.supplier_id,
                    "company_name": s.company_name,
                    "status": s.status,
                    "vendor_type": s.vendor_type,
                    "payment_terms": s.payment_terms,
                    "is_overseas": s.is_overseas,
                    "qc_status": s.qc_status,
                    "work_center_id": s.work_center_id,
                }
                for s in rows
            ],
        }
    )


@tool
def get_vendor_detail(supplier_id: str) -> str:
    """Get one vendor/supplier by supplier_id."""
    ctx = get_ai_context()
    supplier = ctx.db.get(Supplier, supplier_id.strip())
    if not supplier:
        return _json({"error": f"Vendor '{supplier_id}' not found"})
    return _json(
        {
            "supplier_id": supplier.supplier_id,
            "company_name": supplier.company_name,
            "status": supplier.status,
            "vendor_type": supplier.vendor_type,
            "contact_name": supplier.contact_name,
            "contact_email": supplier.contact_email,
            "phone_number": supplier.phone_number,
            "city": supplier.city,
            "country": supplier.country,
            "payment_terms": supplier.payment_terms,
            "currency": supplier.currency,
            "is_overseas": supplier.is_overseas,
            "qc_status": supplier.qc_status,
            "iso_certified": supplier.iso_certified,
            "lead_time_days": supplier.lead_time_days,
            "work_center_id": supplier.work_center_id,
        }
    )


@tool
def get_items(
    q: str = "",
    purchase_only: bool = False,
    raw_material_only: bool = False,
    assembly_only: bool = False,
    with_bom_only: bool = False,
    limit: int = 20,
) -> str:
    """List item master SKUs. Set with_bom_only=true for items that have BOM component lines."""
    ctx = get_ai_context()
    query = ctx.db.query(Item)
    if purchase_only:
        query = query.filter(Item.is_purchase_item.is_(True))
    if raw_material_only:
        query = query.filter(Item.is_raw_material.is_(True))
    if assembly_only:
        query = query.filter(Item.is_subcontract_assembly.is_(True))
    if with_bom_only:
        query = query.filter(
            Item.item_id.in_(ctx.db.query(ItemBOMComponent.parent_item_id).distinct())
        )
    if q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Item.item_id.ilike(term),
                Item.customer_part_number.ilike(term),
                Item.description.ilike(term),
            )
        )
    rows = query.order_by(Item.item_id.asc()).limit(_limit(limit)).all()
    return _json(
        {
            "count": len(rows),
            "items": [
                {
                    "item_id": i.item_id,
                    "description": i.description,
                    "customer_part_number": i.customer_part_number,
                    "uom": i.uom,
                    "unit_price": i.unit_price,
                    "on_hand_quantity": i.on_hand_quantity,
                    "is_purchase_item": i.is_purchase_item,
                    "is_raw_material": i.is_raw_material,
                    "is_subcontract_assembly": i.is_subcontract_assembly,
                }
                for i in rows
            ],
        }
    )


@tool
def get_item_detail(item_id: str) -> str:
    """Get one item (SKU) plus BOM header summary."""
    ctx = get_ai_context()
    item = ctx.db.get(Item, item_id.strip())
    if not item:
        return _json({"error": f"Item '{item_id}' not found"})
    headers = (
        ctx.db.query(ItemBOMHeader)
        .options(selectinload(ItemBOMHeader.components))
        .filter(ItemBOMHeader.parent_item_id == item.item_id)
        .order_by(ItemBOMHeader.version_no.asc())
        .all()
    )
    return _json(
        {
            "item_id": item.item_id,
            "description": item.description,
            "customer_part_number": item.customer_part_number,
            "uom": item.uom,
            "unit_price": item.unit_price,
            "on_hand_quantity": item.on_hand_quantity,
            "wip_quantity": item.wip_quantity,
            "is_purchase_item": item.is_purchase_item,
            "is_raw_material": item.is_raw_material,
            "is_subcontract_assembly": item.is_subcontract_assembly,
            "is_outside_processed": item.is_outside_processed,
            "bom_headers": [
                {
                    "bom_header_id": h.bom_header_id,
                    "version_no": h.version_no,
                    "status": h.status,
                    "effective_from": h.effective_from,
                    "component_count": len(h.components or []),
                }
                for h in headers
            ],
        }
    )


@tool
def get_item_bom(item_id: str, bom_header_id: int = 0) -> str:
    """Get BOM component lines for an item. Uses the active header unless bom_header_id is set."""
    ctx = get_ai_context()
    from fastapi import HTTPException
    from app.services.bom_versions import resolve_header

    try:
        header = resolve_header(ctx.db, item_id.strip(), bom_header_id or None)
    except HTTPException as exc:
        return _json({"error": exc.detail})
    if header is None:
        return _json({"error": f"No BOM found for item '{item_id}'"})
    lines = (
        ctx.db.query(ItemBOMComponent)
        .filter(ItemBOMComponent.bom_header_id == header.bom_header_id)
        .order_by(ItemBOMComponent.bom_id)
        .all()
    )
    return _json(
        {
            "parent_item_id": header.parent_item_id,
            "bom_header_id": header.bom_header_id,
            "version_no": header.version_no,
            "status": header.status,
            "component_count": len(lines),
            "components": [
                {
                    "bom_id": line.bom_id,
                    "item_type": line.item_type,
                    "component_item_id": line.component_item_id,
                    "component_code": line.component_code,
                    "quantity_per": line.quantity_per,
                    "scrap_factor": line.scrap_factor,
                    "yield_loss_percentage": line.yield_loss_percentage,
                }
                for line in lines
            ],
        }
    )


@tool
def get_item_where_used(item_id: str) -> str:
    """Where-used: parent assemblies that consume this component on a BOM."""
    ctx = get_ai_context()
    sku = item_id.strip()
    if not sku:
        return _json({"error": "item_id is required"})
    rows = (
        ctx.db.query(ItemBOMComponent)
        .filter(
            or_(
                ItemBOMComponent.component_item_id == sku,
                ItemBOMComponent.component_code == sku,
            )
        )
        .order_by(ItemBOMComponent.parent_item_id, ItemBOMComponent.bom_id)
        .all()
    )
    return _json(
        {
            "component_item_id": sku,
            "count": len(rows),
            "used_on": [
                {
                    "parent_item_id": row.parent_item_id,
                    "bom_header_id": row.bom_header_id,
                    "component_item_id": row.component_item_id,
                    "quantity_per": row.quantity_per,
                }
                for row in rows
            ],
        }
    )


@tool
def get_work_centers(active_only: bool = True, limit: int = 20) -> str:
    """List manufacturing / outside-processing work centers."""
    ctx = get_ai_context()
    query = ctx.db.query(WorkCenter)
    if active_only:
        query = query.filter(WorkCenter.is_active.is_(True))
    rows = query.order_by(WorkCenter.name.asc()).limit(_limit(limit)).all()
    return _json(
        {
            "count": len(rows),
            "work_centers": [
                {
                    "work_center_id": w.work_center_id,
                    "name": w.name,
                    "warehouse_id": w.warehouse_id,
                    "is_active": w.is_active,
                }
                for w in rows
            ],
        }
    )


@tool
def get_warehouses() -> str:
    """List warehouses and their bins."""
    ctx = get_ai_context()
    rows = (
        ctx.db.query(Warehouse)
        .options(selectinload(Warehouse.bins))
        .order_by(Warehouse.code.asc())
        .all()
    )
    return _json(
        {
            "count": len(rows),
            "warehouses": [
                {
                    "warehouse_id": w.warehouse_id,
                    "code": w.code,
                    "name": w.name,
                    "is_active": w.is_active,
                    "bins": [
                        {"bin_id": b.bin_id, "bin_code": b.bin_code, "is_active": b.is_active}
                        for b in (w.bins or [])
                    ],
                }
                for w in rows
            ],
        }
    )


@tool
def get_fulfillments(status: str = "", sales_order_id: str = "", limit: int = 20) -> str:
    """List item fulfillments / shipments."""
    ctx = get_ai_context()
    denied = _require_any(ctx.user, "sales_order:view")
    if denied:
        return denied
    query = ctx.db.query(ItemFulfillment)
    if status.strip():
        query = query.filter(ItemFulfillment.status.ilike(status.strip()))
    if sales_order_id.strip():
        query = query.filter(ItemFulfillment.sales_order_id == sales_order_id.strip())
    rows = query.order_by(ItemFulfillment.created_at.desc()).limit(_limit(limit)).all()
    return _json(
        {
            "count": len(rows),
            "fulfillments": [
                {
                    "fulfillment_number": f.fulfillment_number,
                    "sales_order_id": f.sales_order_id,
                    "customer_id": f.customer_id,
                    "status": f.status,
                    "shipped_date": f.shipped_date,
                    "tracking_number": f.tracking_number,
                }
                for f in rows
            ],
        }
    )


def is_received_qty_by_po_wording(question: str) -> bool:
    """True for posted goods-receipt qty grouped by purchase order."""
    text = f" {_normalize_question(question)} "
    if is_unbilled_receipt_wording(question):
        return False
    has_po = bool(re.search(r"\b(purchase orders?|pos?)\b", text))
    has_received = bool(
        re.search(r"\b(qty|quantity|quantities)\b.{0,20}\breceived\b", text)
        or re.search(r"\breceived\b.{0,20}\b(qty|quantity|quantities)\b", text)
        or re.search(r"\bqty received\b", text)
    )
    return has_po and has_received


def is_unbilled_receipt_wording(question: str) -> bool:
    text = _normalize_question(question)
    if re.search(r"\bunbilled\b", text):
        return True
    return bool(re.search(r"\bready to (invoice|bill|ap)\b", text))


def is_unpaid_invoice_wording(question: str) -> bool:
    """True for issued invoices/bills that still have an outstanding balance."""
    text = f" {_normalize_question(question)} "
    if is_unbilled_receipt_wording(question):
        return False
    has_doc = bool(re.search(r"\b(invoices?|bills?)\b", text))
    has_unpaid = bool(
        re.search(r"\b(unpaid|outstanding)\b", text)
        or re.search(r"\bopen invoices?\b", text)
        or re.search(r"\bopen bills?\b", text)
    )
    return has_doc and has_unpaid


def infer_unpaid_invoice_side(question: str) -> str:
    """customer | vendor | both."""
    text = _normalize_question(question)
    vendor = is_supplier_invoice_wording(text) or is_ap_wording(text) or bool(
        re.search(r"\b(vendor|supplier)\b", text)
    )
    customer = is_sales_invoice_wording(text) or is_ar_wording(text) or bool(
        re.search(r"\b(customer|sales)\b", text)
    )
    if vendor and not customer:
        return "vendor"
    if customer and not vendor:
        return "customer"
    return "both"


def is_invoice_document_wording(question: str) -> bool:
    """True for invoice/bill lists, including common typos such as inovice."""
    text = _normalize_question(question)
    return bool(re.search(r"\b(invoices?|bills?)\b", text)) or _has_near_word(
        text, "invoice", "invoices", "bill", "bills"
    )


def is_invoice_due_wording(question: str) -> bool:
    """True for invoices/bills filtered by due date (not unpaid-only or unbilled)."""
    if is_unpaid_invoice_wording(question) or is_unbilled_receipt_wording(question):
        return False
    text = f" {_normalize_question(question)} "
    return is_invoice_document_wording(text) and bool(re.search(r"\bdue\b", text))


def infer_invoice_date_field(question: str) -> str:
    """due = due_date; document = sales issue_date / supplier invoice_date."""
    text = _normalize_question(question)
    if re.search(r"\bdue\b", text):
        return "due"
    return "document"


def is_invoice_billed_wording(question: str) -> bool:
    """True for invoices/bills filtered by billed/issue date."""
    if is_unpaid_invoice_wording(question) or is_unbilled_receipt_wording(question):
        return False
    text = f" {_normalize_question(question)} "
    if re.search(r"\bhow\s+(do|to|can|does|should)\b", text):
        return False
    return is_invoice_document_wording(text) and bool(
        re.search(r"\b(billed|issued|invoiced)\b", text)
    )


def is_invoice_list_wording(question: str) -> bool:
    """Status, due-date, billed-date, or period-filtered invoice lists."""
    if is_unpaid_invoice_wording(question) or is_unbilled_receipt_wording(question):
        return False
    if not is_invoice_document_wording(question):
        return False
    text = f" {_normalize_question(question)} "
    if re.search(r"\bhow\s+(do|to|can|does|should)\b", text):
        return False
    if is_invoice_status_wording(question) or is_invoice_due_wording(question):
        return True
    if is_invoice_billed_wording(question):
        return True
    return bool(period_date_bounds(question))


def infer_invoice_party(question: str) -> dict[str, Any]:
    """Parse 'for vendor Accelerate Global Solution' into a name filter."""
    text = (question or "").strip()
    match = re.search(
        r"\bfor\s+(?:the\s+)?(?P<kind>vendors?|suppliers?|customers?)\s+(?P<name>.+)$",
        text,
        re.I,
    )
    kind = ""
    name = ""
    if match:
        kind = match.group("kind").lower()
        name = match.group("name").strip(" .")
    else:
        match = re.search(r"\bfor\s+(?P<name>.+)$", text, re.I)
        if match:
            name = match.group("name").strip(" .")
    if not name:
        return {}

    stop = set(MONTH_NAMES) | {
        "period",
        "the",
        "of",
        "in",
        "for",
        "and",
        "inc",
        "llc",
        "ltd",
        "co",
    }
    tokens = [
        tok
        for tok in re.findall(r"[a-z0-9]+", name.lower())
        if tok not in stop
        and not re.fullmatch(r"20\d{2}", tok)
        and not re.fullmatch(r"0?[1-9]|1[0-2]", tok)
    ]
    if not tokens:
        return {}
    if kind.startswith("customer"):
        side = "customer"
    elif kind.startswith("vendor") or kind.startswith("supplier"):
        side = "vendor"
    else:
        side = ""
    return {"side": side, "query": name, "tokens": tokens}


def resolve_named_parties(db, question: str, asked: str) -> dict[str, Any]:
    """Resolve 'for vendor Accelerate Global Solution' onto customer/vendor ids."""
    asked_side = asked if asked in {"customer", "vendor", "both"} else "both"
    party = infer_invoice_party(question) if (question or "").strip() else {}
    if party.get("side") in {"customer", "vendor"}:
        asked_side = party["side"]
    tokens = [str(tok) for tok in (party.get("tokens") or []) if str(tok).strip()]
    party_label = ""
    customer_ids: list[str] = []
    vendor_ids: list[str] = []
    include_customers = asked_side in {"customer", "both"}
    include_vendors = asked_side in {"vendor", "both"}
    if tokens:
        if include_customers:
            customer_q = db.query(Customer)
            for tok in tokens:
                like = f"%{tok}%"
                customer_q = customer_q.filter(
                    or_(Customer.company_name.ilike(like), Customer.customer_id.ilike(like))
                )
            found_customers = customer_q.all()
            customer_ids = [row.customer_id for row in found_customers]
            if found_customers:
                party_label = ", ".join(
                    str(row.company_name or row.customer_id) for row in found_customers
                )
        if include_vendors:
            vendor_q = db.query(Supplier)
            for tok in tokens:
                like = f"%{tok}%"
                vendor_q = vendor_q.filter(
                    or_(Supplier.company_name.ilike(like), Supplier.supplier_id.ilike(like))
                )
            found_vendors = vendor_q.all()
            vendor_ids = [row.supplier_id for row in found_vendors]
            if found_vendors:
                party_label = ", ".join(
                    str(row.company_name or row.supplier_id) for row in found_vendors
                )
        if include_customers and not customer_ids:
            include_customers = False
        if include_vendors and not vendor_ids:
            include_vendors = False
        if not party_label:
            party_label = str(party.get("query") or "")
    return {
        "asked": asked_side,
        "party_label": party_label,
        "customer_ids": customer_ids,
        "vendor_ids": vendor_ids,
        "include_customers": include_customers,
        "include_vendors": include_vendors,
        "tokens": tokens,
    }


def infer_transaction_kind(question: str) -> str:
    """Map a list/show prompt onto a transactional document kind."""
    text = _normalize_question(question)
    if is_unbilled_receipt_wording(question) or is_received_qty_by_po_wording(question):
        return ""
    if is_material_issue_wording(text):
        return "material_issues"
    if (
        re.search(r"\b(goods receipts?|grns?|receipts?|receiving)\b", text)
        or _has_near_word(text, "receipt", "receipts", "grn", "grns")
    ):
        return "goods_receipts"
    if re.search(r"\b(fulfillments?|shipments?|item fulfillments?)\b", text):
        return "fulfillments"
    if re.search(r"\b(journals?|journal entries|gl entries)\b", text):
        return "journals"
    if re.search(
        r"\b(cash transactions?|check issues?|check deposits?|payments?)\b",
        text,
    ):
        return "cash"
    if (
        is_invoice_document_wording(text)
        or is_supplier_invoice_wording(text)
        or is_sales_invoice_wording(text)
    ):
        return "invoices"
    if re.search(r"\b(subcontract orders?|scos?)\b", text):
        return "subcontract_orders"
    if is_purchase_wording(text) or re.search(r"\b(purchase orders?|pos|po)\b", text):
        return "purchase_orders"
    if re.search(r"\b(sales orders?|sos|so)\b", text):
        return "sales_orders"
    return ""


def is_transaction_document_wording(question: str) -> bool:
    return bool(infer_transaction_kind(question)) or is_invoice_document_wording(question)


def is_transaction_list_wording(question: str) -> bool:
    """True for document lists (period/party/due/billed), not by-month totals or how-tos."""
    if is_sales_vs_purchase_wording(question):
        return False
    if is_monthly_group_question(question):
        return False
    if is_unbilled_receipt_wording(question) or is_received_qty_by_po_wording(question):
        return False
    text = _normalize_question(question)
    if re.search(r"\bhow\s+(do|to|can|does|should)\b", text):
        return False
    if re.search(r"\bwhat(?:'s| is)\s+an?\b", text):
        return False
    if re.search(r"\b(create|clone|copy|draft|corresponding|overdue)\b", text):
        return False
    kind = infer_transaction_kind(question)
    if not kind:
        return False
    if kind == "invoices":
        return is_invoice_list_wording(question) or is_unpaid_invoice_wording(question)
    if period_date_bounds(question) or infer_invoice_party(question):
        return True
    return bool(
        re.search(
            r"\b(show|list|display|give|tell|what|which|open|due|billed|issued|created|posted)\b",
            text,
        )
    )


def infer_invoice_list_title(question: str) -> str:
    if is_invoice_due_wording(question):
        return "Invoices due"
    if is_invoice_billed_wording(question):
        return "Invoices billed"
    if is_invoice_status_wording(question):
        return "Invoice status"
    return "Invoices"


def is_invoice_status_wording(question: str) -> bool:
    """True for invoice/bill status lists (not unpaid-only or unbilled GRNs)."""
    if is_unpaid_invoice_wording(question) or is_unbilled_receipt_wording(question):
        return False
    text = f" {_normalize_question(question)} "
    has_status = bool(re.search(r"\bstatus(es)?\b", text))
    return is_invoice_document_wording(text) and has_status


def is_closing_period_wording(question: str) -> bool:
    """True for Finance → Period Management close dates (not by-month totals)."""
    text = f" {_normalize_question(question)} "
    if is_monthly_group_question(text):
        return False
    return bool(
        re.search(
            r"\b("
            r"closing period|period close|close period|period lock|lock date|"
            r"current closing|soft close|hard close|period settings"
            r")\b",
            text,
        )
        or (
            re.search(r"\bperiod\b", text)
            and re.search(r"\b(close|closed|closing|lock|locked)\b", text)
            and not is_posting_rule_wording(question)
        )
    )


def is_posting_rule_wording(question: str) -> bool:
    """True for Chart of Accounts posting-rule lookups."""
    text = f" {_normalize_question(question)} "
    return bool(re.search(r"\bposting rules?\b", text))


def infer_posting_rule_event(question: str) -> str:
    """Map wording onto posting_rules.event_code, or empty for all active rules."""
    text = _normalize_question(question)
    if re.search(r"\b(month[- ]end|mec)\b", text):
        return "MONTH_END_CLOSE"
    if re.search(r"\b(year[- ]end|yec)\b", text):
        return "YEAR_END_CLOSE"
    if re.search(r"\b(goods receipt|grn|gr/ir)\b", text):
        return "GOODS_RECEIPT"
    if re.search(r"\b(supplier invoice|vendor invoice|vendor bill)\b", text):
        return "SUPPLIER_INVOICE"
    if re.search(r"\b(sales invoice|customer invoice)\b", text):
        return "SALES_INVOICE"
    if re.search(r"\b(sales credit|credit memo)\b", text):
        return "SALES_CREDIT"
    if re.search(r"\b(customer payment|ar payment)\b", text):
        return "AR_PAYMENT"
    if re.search(r"\b(vendor payment|ap payment)\b", text):
        return "AP_PAYMENT"
    if re.search(r"\bbank transfer\b", text):
        return "BANK_TRANSFER"
    return ""


def _account_cell(code: Any, name: Any, display: Any = None) -> str:
    if display:
        return str(display)
    code_s = str(code or "").strip()
    name_s = str(name or "").strip()
    if code_s and name_s:
        return f"{code_s} {name_s}"
    return code_s or name_s or "—"


def format_posting_rules_answer(raw: str) -> str:
    """Turn get_posting_rules JSON into a Markdown table."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    rows = data.get("rules") or []
    event_label = data.get("event_label") or "Posting rules"
    lines = [f"## {event_label}", ""]
    if not rows:
        lines.append("No active posting rules match that event.")
        return "\n".join(lines)

    lines.append("| Code | Event | Name | Debit | Credit |")
    lines.append("| :--- | :--- | :--- | :--- | :--- |")
    for row in rows:
        lines.append(
            f"| {row.get('rule_code') or '—'} | {row.get('event_label') or row.get('event_code') or '—'} | "
            f"{row.get('name') or '—'} | "
            f"{_account_cell(row.get('debit_account_code'), row.get('debit_account_name'), row.get('debit_display_label'))} | "
            f"{_account_cell(row.get('credit_account_code'), row.get('credit_account_name'))} |"
        )
    lines.append("")
    lines.append(
        f"{data.get('count', len(rows))} posting rule(s). "
        "Same debit/credit mapping as Finance → Posting Rules."
    )
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


def _period_status_label(status: str) -> str:
    key = (status or "").upper()
    if key == "HARD_CLOSE":
        return "Hard Close"
    if key == "SOFT_CLOSE":
        return "Soft Close"
    return "Open"


def format_closing_period_answer(raw: str) -> str:
    """Turn get_closing_period JSON into a Markdown table."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    soft = data.get("soft_close_date") or "Not set"
    hard = data.get("hard_close_date") or data.get("current_closing_date") or "Not set"
    today = data.get("as_of") or "—"
    status = _period_status_label(str(data.get("as_of_status") or "OPEN"))
    lines = [
        "## Current closing period",
        "",
        "| | Date |",
        "| :--- | :--- |",
        f"| Soft close through | {soft} |",
        f"| Hard close through | {hard} |",
        f"| Status today ({today}) | {status} |",
        "",
        "Same dates as Finance → Period Management. "
        "Soft Close locks operational documents; Hard Close locks all posting.",
    ]
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


def format_purchase_orders_answer(raw: str) -> str:
    """Turn get_purchase_orders JSON into a Markdown table."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    rows = data.get("orders") or []
    overdue = bool(data.get("overdue"))
    title = "Overdue purchase orders" if overdue else "Purchase orders"
    lines = [f"## {title}", ""]
    if not rows:
        lines.append(
            "No purchase orders are past their expected delivery date."
            if overdue
            else "No purchase orders found."
        )
        return "\n".join(lines)

    if overdue:
        lines.append("| PO | Vendor | Expected | Days late | Status | Billing | Amount |")
        lines.append("| :--- | :--- | :--- | ---: | :--- | :--- | ---: |")
    else:
        lines.append("| PO | Vendor | Order date | Expected | Status | Billing | Amount |")
        lines.append("| :--- | :--- | :--- | :--- | :--- | :--- | ---: |")

    today = date.today()
    total = Decimal("0")
    for row in rows:
        vendor = row.get("supplier_name") or row.get("supplier_id") or "—"
        expected = row.get("expected_delivery_date") or "—"
        amount = row.get("grand_total")
        total += Decimal(str(amount or 0))
        days = row.get("days_late")
        if days is None and overdue and row.get("expected_delivery_date"):
            try:
                due = date.fromisoformat(str(row["expected_delivery_date"])[:10])
                days = (today - due).days
            except ValueError:
                days = "—"
        if overdue:
            lines.append(
                f"| {row.get('po_number') or '—'} | {vendor} | {expected} | "
                f"{days if days is not None else '—'} | {row.get('status') or '—'} | "
                f"{row.get('billing_status') or '—'} | {_money(amount)} |"
            )
        else:
            lines.append(
                f"| {row.get('po_number') or '—'} | {vendor} | "
                f"{row.get('order_date') or '—'} | {expected} | "
                f"{row.get('status') or '—'} | {row.get('billing_status') or '—'} | "
                f"{_money(amount)} |"
            )
    lines.append("")
    lines.append(
        f"{data.get('count', len(rows))} purchase order(s) with expected delivery before today "
        f"(same as Purchase Orders → Expected delivery: Overdue). Total {_money(total)}."
        if overdue
        else f"{data.get('count', len(rows))} purchase order(s). Total {_money(total)}."
    )
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


def format_inventory_answer(raw: str) -> str:
    """Turn get_inventory_levels JSON into a Markdown table."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    rows = data.get("stock") or []
    below = bool(data.get("below_threshold"))
    status = str(data.get("status") or "").strip()
    if below:
        title = "Products under inventory threshold"
    elif status:
        title = f"Inventory — {status}"
    else:
        title = "Inventory stock levels"

    lines = [f"## {title}", ""]
    if not rows:
        lines.append(
            "No products are at or below their reorder point."
            if below
            else "No inventory stock found."
        )
        return "\n".join(lines)

    lines.append("| Item | Description | On hand | Reorder pt | ATP | Status | Warehouse |")
    lines.append("| :--- | :--- | ---: | ---: | ---: | :--- | :--- |")
    for row in rows:
        loc = " / ".join(
            part
            for part in (row.get("warehouse") or "", row.get("bin") or "")
            if part
        ) or "—"
        desc = str(row.get("description") or "—").replace("|", "/")
        lines.append(
            f"| {row.get('item_id') or '—'} | {desc} | "
            f"{_qty(row.get('on_hand'))} | {_qty(row.get('reorder_point'))} | "
            f"{_qty(row.get('atp'))} | {row.get('status') or '—'} | {loc} |"
        )
    lines.append("")
    if below:
        lines.append(
            f"{data.get('count', len(rows))} product(s) with on hand at or below "
            "reorder point (same as Inventory reorder alerts)."
        )
    else:
        lines.append(f"{data.get('count', len(rows))} stocked item(s).")
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


def format_goods_receipts_answer(raw: str) -> str:
    """Turn get_goods_receipts JSON into a Markdown table."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    receipts = data.get("receipts") or []
    unbilled_only = bool(data.get("unbilled_only"))
    title = (
        "Unbilled goods receipts ready to invoice"
        if unbilled_only
        else "Goods receipts"
    )
    lines = [f"## {title}", ""]
    if not receipts:
        lines.append(
            "No unbilled posted receipts are waiting to be invoiced."
            if unbilled_only
            else "No goods receipts found."
        )
        return "\n".join(lines)

    lines.append("| Receipt | Source | Vendor | Date | Unbilled qty | Amount | Billing |")
    lines.append("| :--- | :--- | :--- | :--- | ---: | ---: | :--- |")
    for row in receipts:
        vendor = row.get("vendor_name") or row.get("vendor_id") or "—"
        source = f"{row.get('source_type') or '—'} {row.get('source_order_id') or ''}".strip()
        lines.append(
            f"| {row.get('receipt_number') or '—'} | {source} | {vendor} | "
            f"{row.get('receipt_date') or '—'} | {_qty(row.get('quantity_unbilled'))} | "
            f"{_money(row.get('total_amount'))} | {row.get('billing_status') or '—'} |"
        )
    lines.append(f"| Total |  |  |  | {_qty(data.get('quantity_unbilled'))} | {_money(data.get('total_amount'))} |  |")
    lines.append("")
    lines.append(
        f"{data.get('count', len(receipts))} posted receipt(s) with quantity still unbilled."
        if unbilled_only
        else f"{data.get('count', len(receipts))} goods receipt(s)."
    )
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


@tool
def get_goods_receipts(
    status: str = "",
    vendor_id: str = "",
    limit: int = 20,
    unbilled_only: bool = False,
    source_type: str = "",
    question: str = "",
) -> str:
    """List goods receipts (PO / SCO receiving).

    For "unbilled goods receipts ready to invoice" / "receipts ready to bill",
    pass unbilled_only=true (or pass question= the user wording). That uses the
    same posted+unbilled picker as Supplier Invoice → GET /vendor-invoices/goods-receipts.
    Do not use this for monthly totals.
    """
    ctx = get_ai_context()
    denied = _require_any(ctx.user, "po:view", "subcontract:view", "ap_bill:view")
    if denied:
        return denied
    if question.strip() and is_unbilled_receipt_wording(question):
        unbilled_only = True

    from app.services import p2p

    display_limit = _limit(limit)
    fetch_limit = 200 if unbilled_only else display_limit
    rows = p2p.list_goods_receipts(
        ctx.db,
        vendor_id=vendor_id.strip() or None,
        source_type=source_type.strip() or None,
        status="POSTED" if unbilled_only else (status.strip().upper() or None),
        unbilled_only=unbilled_only,
        skip=0,
        limit=fetch_limit,
    )[:display_limit]

    total_qty = sum((Decimal(str(row.get("quantity_unbilled") or 0)) for row in rows), Decimal("0"))
    total_amt = sum((Decimal(str(row.get("total_amount") or 0)) for row in rows), Decimal("0"))
    return format_goods_receipts_answer(
        _json(
            {
                "count": len(rows),
                "unbilled_only": unbilled_only,
                "quantity_unbilled": str(total_qty),
                "total_amount": str(total_amt),
                "receipts": [
                    {
                        "receipt_number": row.get("receipt_number"),
                        "source_type": row.get("source_type"),
                        "source_order_id": row.get("source_order_id"),
                        "vendor_id": row.get("vendor_id"),
                        "vendor_name": row.get("vendor_name"),
                        "status": row.get("status"),
                        "receipt_date": row.get("receipt_date"),
                        "quantity_unbilled": str(row.get("quantity_unbilled") or 0),
                        "total_amount": str(row.get("total_amount") or 0),
                        "billing_status": row.get("billing_status"),
                    }
                    for row in rows
                ],
                "note": (
                    "Posted receipts with remaining unbilled quantity. "
                    "Create a supplier invoice from Supplier Invoices → New."
                    if unbilled_only
                    else None
                ),
            }
        )
    )


def format_po_received_qty_answer(raw: str) -> str:
    """Turn get_received_qty_by_purchase_order JSON into a Markdown table."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    rows = data.get("orders") or []
    lines = ["## Quantity received by purchase order", ""]
    if not rows:
        lines.append("No purchase orders found.")
        return "\n".join(lines)

    lines.append("| PO | Vendor | Ordered qty | Received qty | Remaining | Receipts |")
    lines.append("| :--- | :--- | ---: | ---: | ---: | ---: |")
    for row in rows:
        vendor = row.get("vendor_name") or row.get("vendor_id") or "—"
        lines.append(
            f"| {row.get('po_number') or '—'} | {vendor} | "
            f"{_qty(row.get('quantity_ordered'))} | {_qty(row.get('quantity_received'))} | "
            f"{_qty(row.get('quantity_remaining'))} | {_qty(row.get('receipt_count'))} |"
        )
    lines.append("")
    lines.append(
        f"{data.get('count', len(rows))} purchase order(s). "
        f"Received qty is posted goods receipts (PU67-), same as Receive Goods on the PO."
    )
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


@tool
def get_received_qty_by_purchase_order(limit: int = 40, question: str = "") -> str:
    """List posted goods-receipt quantity grouped by purchase order.

    Use for "list the qty received by purchase order" / "quantity received per PO".
    Do not use get_purchase_orders for that — that lists dollars, not received qty.
    """
    ctx = get_ai_context()
    denied = _require_any(ctx.user, "po:view")
    if denied:
        return denied

    cap = _limit(limit)
    ordered_rows = (
        ctx.db.query(
            PurchaseOrder.po_number,
            PurchaseOrder.supplier_id,
            Supplier.company_name,
            func.coalesce(func.sum(PurchaseOrderItem.quantity), 0),
        )
        .outerjoin(PurchaseOrderItem, PurchaseOrderItem.po_number == PurchaseOrder.po_number)
        .outerjoin(Supplier, Supplier.supplier_id == PurchaseOrder.supplier_id)
        .filter(~PurchaseOrder.status.ilike("Void"))
        .group_by(PurchaseOrder.po_number, PurchaseOrder.supplier_id, Supplier.company_name)
        .all()
    )
    received_rows = (
        ctx.db.query(
            GoodsReceipt.source_order_id,
            func.coalesce(func.sum(GoodsReceiptLine.quantity_received), 0),
            func.count(distinct(GoodsReceipt.id)),
        )
        .join(GoodsReceiptLine, GoodsReceiptLine.receipt_id == GoodsReceipt.id)
        .filter(
            GoodsReceipt.source_type == "PURCHASE_ORDER",
            GoodsReceipt.status == "POSTED",
        )
        .group_by(GoodsReceipt.source_order_id)
        .all()
    )
    received_by = {
        str(po_number): (Decimal(str(qty or 0)), int(count or 0))
        for po_number, qty, count in received_rows
    }
    rows = []
    for po_number, supplier_id, vendor_name, ordered in ordered_rows:
        received, receipt_count = received_by.get(str(po_number), (Decimal("0"), 0))
        ordered_qty = Decimal(str(ordered or 0))
        remaining = ordered_qty - received
        if remaining < 0:
            remaining = Decimal("0")
        rows.append(
            {
                "po_number": po_number,
                "vendor_id": supplier_id,
                "vendor_name": vendor_name,
                "quantity_ordered": str(ordered_qty),
                "quantity_received": str(received),
                "quantity_remaining": str(remaining),
                "receipt_count": receipt_count,
            }
        )
    rows.sort(
        key=lambda row: (
            -Decimal(str(row["quantity_received"])),
            str(row["po_number"] or ""),
        )
    )
    rows = rows[:cap]
    return format_po_received_qty_answer(
        _json(
            {
                "count": len(rows),
                "received_by_po": True,
                "orders": rows,
            }
        )
    )


def format_unpaid_invoices_answer(raw: str) -> str:
    """Turn get_unpaid_invoices JSON into a Markdown table."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    rows = data.get("invoices") or []
    lines = ["## Unpaid invoices", ""]
    if not rows:
        lines.append("No unpaid invoices found (approved documents with outstanding balance).")
        return "\n".join(lines)

    lines.append("| Invoice | Type | Party | Status | Due | Amount | Outstanding |")
    lines.append("| :--- | :--- | :--- | :--- | :--- | ---: | ---: |")
    total = Decimal("0")
    for row in rows:
        party = row.get("party_name") or row.get("party_id") or "—"
        outstanding = row.get("outstanding_balance")
        total += Decimal(str(outstanding or 0))
        lines.append(
            f"| {row.get('invoice_number') or '—'} | {row.get('invoice_type') or '—'} | "
            f"{party} | {row.get('status') or '—'} | {row.get('due_date') or '—'} | "
            f"{_money(row.get('total_amount'))} | {_money(outstanding)} |"
        )
    lines.append("")
    lines.append(
        f"{data.get('count', len(rows))} unpaid invoice(s). "
        f"Outstanding total {_money(total)}. "
        "Approved sales invoices and approved supplier invoices with remaining balance "
        "(same outstanding as Sales Invoices / Supplier Invoices)."
    )
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


def format_invoice_status_answer(raw: str) -> str:
    """Turn get_invoice_status JSON into status counts plus a document table."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    summary = data.get("by_status") or []
    rows = data.get("invoices") or []
    period_label = str(data.get("period_label") or "").strip()
    date_from = data.get("date_from")
    date_to = data.get("date_to")
    date_field = str(data.get("date_field") or "document")
    due_filter = date_field == "due"
    title = str(data.get("title") or "").strip() or (
        "Invoices due" if due_filter else "Invoice status"
    )
    lines = [f"## {title}", ""]
    if period_label:
        if date_from and date_to and due_filter:
            lines.append(
                f"Period **{period_label}** — due date {date_from} to {date_to}."
            )
        elif date_from and date_to:
            lines.append(
                f"Period **{period_label}** — sales invoice issue date and supplier "
                f"invoice date {date_from} to {date_to}."
            )
        else:
            lines.append(f"Period **{period_label}**.")
        party_label = str(data.get("party_label") or "").strip()
        if party_label:
            suffix = f" for **{party_label}**"
            lines[-1] = f"{lines[-1].rstrip('.')}{suffix}"
            if not party_label.endswith("."):
                lines[-1] += "."
        lines.append("")
    if summary:
        lines.append("| Type | Status | Count |")
        lines.append("| :--- | :--- | ---: |")
        for row in summary:
            lines.append(
                f"| {row.get('invoice_type') or '—'} | {row.get('status') or '—'} | "
                f"{_qty(row.get('count'))} |"
            )
        lines.append("")
    party_label = str(data.get("party_label") or "").strip()
    party_bit = f" for {party_label}" if party_label else ""
    if not rows:
        if period_label and due_filter:
            lines.append(f"No invoices due in {period_label}{party_bit}.")
        elif period_label and title == "Invoices billed":
            lines.append(f"No invoices billed in {period_label}{party_bit}.")
        elif period_label:
            lines.append(f"No invoices found for {period_label}{party_bit}.")
        else:
            lines.append(f"No invoices found{party_bit}." if party_bit else "No invoices found.")
        return "\n".join(lines)

    lines.append("| Invoice | Type | Party | Status | Date | Due | Amount | Outstanding |")
    lines.append("| :--- | :--- | :--- | :--- | :--- | :--- | ---: | ---: |")
    for row in rows:
        party = row.get("party_name") or row.get("party_id") or "—"
        lines.append(
            f"| {row.get('invoice_number') or '—'} | {row.get('invoice_type') or '—'} | "
            f"{party} | {row.get('status') or '—'} | {row.get('invoice_date') or '—'} | "
            f"{row.get('due_date') or '—'} | {_money(row.get('total_amount'))} | "
            f"{_money(row.get('outstanding_balance'))} |"
        )
    lines.append("")
    period_bit = f" for {period_label}" if period_label else ""
    if party_label:
        period_bit = f"{period_bit} for {party_label}" if period_bit else f" for {party_label}"
    if due_filter:
        filter_bit = " Filtered by due date." if period_label else ""
    elif title == "Invoices billed":
        filter_bit = (
            " Filtered by billed date (sales issue date / supplier invoice date)."
            if period_label
            else ""
        )
    else:
        filter_bit = (
            " Filtered by issue/invoice date (not due date)." if period_label else ""
        )
    lines.append(
        f"{data.get('count', len(rows))} invoice(s) shown{period_bit.rstrip('.')}."
        " "
        "Status is the document status from Sales Invoices / Supplier Invoices "
        f"(not AR/AP aging Unpaid/Partial/Paid).{filter_bit}"
    )
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


@tool
def get_unpaid_invoices(side: str = "", limit: int = 40, question: str = "") -> str:
    """List approved invoices that still have an outstanding balance.

    Use for "show me unpaid invoices" / "outstanding customer invoices" / "unpaid vendor bills".
    Do not use get_finance_records for that — that dumps recent invoices including paid ones.
    side: customer | vendor | both (inferred from question when empty).
    """
    ctx = get_ai_context()
    asked = (side or infer_unpaid_invoice_side(question)).strip().lower()
    if asked not in {"customer", "vendor", "both"}:
        asked = "both"
    cap = _limit(limit)
    bounds = period_date_bounds(question) if question.strip() else {}
    date_from = bounds.get("date_from")
    date_to = bounds.get("date_to")
    date_field = infer_invoice_date_field(question) if question.strip() else "due"
    if date_field != "due" and not is_invoice_billed_wording(question):
        date_field = "due"
    sales_date_col = SalesInvoice.due_date if date_field == "due" else SalesInvoice.issue_date
    vendor_date_col = (
        SupplierInvoice.due_date if date_field == "due" else SupplierInvoice.invoice_date
    )
    resolved = resolve_named_parties(ctx.db, question, asked)
    asked = resolved["asked"]
    include_customers = resolved["include_customers"]
    include_vendors = resolved["include_vendors"]
    rows: list[dict[str, Any]] = []
    skipped: list[str] = []

    def _in_period(query, date_col):
        if isinstance(date_from, date) and isinstance(date_to, date):
            return query.filter(date_col >= date_from, date_col <= date_to)
        return query

    if include_customers:
        denied = _require_any(ctx.user, "sales_order:view")
        if denied:
            skipped.append(denied)
        else:
            sales_q = _in_period(
                ctx.db.query(SalesInvoice, Customer.company_name)
                .outerjoin(Customer, Customer.customer_id == SalesInvoice.customer_id)
                .filter(
                    SalesInvoice.status == "APPROVED",
                    SalesInvoice.outstanding_balance > 0,
                ),
                sales_date_col,
            )
            if resolved["customer_ids"]:
                sales_q = sales_q.filter(SalesInvoice.customer_id.in_(resolved["customer_ids"]))
            sales_rows = sales_q.all()
            for inv, party_name in sales_rows:
                rows.append(
                    {
                        "invoice_number": inv.invoice_number,
                        "invoice_type": "Customer",
                        "party_id": inv.customer_id,
                        "party_name": party_name,
                        "status": inv.status,
                        "due_date": str(inv.due_date) if inv.due_date else None,
                        "total_amount": str(inv.total_amount or 0),
                        "outstanding_balance": str(inv.outstanding_balance or 0),
                    }
                )

    if include_vendors:
        denied = _require_any(ctx.user, "ap_bill:view")
        if denied:
            skipped.append(denied)
        else:
            vendor_q = _in_period(
                ctx.db.query(SupplierInvoice, Supplier.company_name)
                .outerjoin(Supplier, Supplier.supplier_id == SupplierInvoice.vendor_id)
                .filter(
                    SupplierInvoice.status == "APPROVED",
                    SupplierInvoice.outstanding_balance > 0,
                ),
                vendor_date_col,
            )
            if resolved["vendor_ids"]:
                vendor_q = vendor_q.filter(SupplierInvoice.vendor_id.in_(resolved["vendor_ids"]))
            vendor_rows = vendor_q.all()
            for inv, party_name in vendor_rows:
                rows.append(
                    {
                        "invoice_number": inv.invoice_number,
                        "invoice_type": "Vendor",
                        "party_id": inv.vendor_id,
                        "party_name": party_name,
                        "status": inv.status,
                        "due_date": str(inv.due_date) if inv.due_date else None,
                        "total_amount": str(inv.total_amount or 0),
                        "outstanding_balance": str(inv.outstanding_balance or 0),
                    }
                )

    if not rows and skipped and asked == "both":
        return skipped[0]

    rows.sort(key=lambda row: (str(row.get("due_date") or "9999"), str(row.get("invoice_number") or "")))
    rows = rows[:cap]
    return format_unpaid_invoices_answer(
        _json(
            {
                "count": len(rows),
                "unpaid_invoices": True,
                "side": asked,
                "invoices": rows,
            }
        )
    )


@tool
def get_invoice_status(side: str = "", limit: int = 40, question: str = "") -> str:
    """List sales and supplier invoice document statuses.

    Use for "show me invoice status" / "invoices by status" /
    "invoice status for the period 09/2026" / "invoices due in October 2026" /
    "invoices billed in October 2026" /
    "invoices billed in October 2026 for vendor Accelerate Global Solution".
    Named months and MM/YYYY filter sales issue_date and supplier invoice_date,
    unless the question says due — then filter due_date.
    "for vendor …" / "for customer …" filters the party name.
    For unpaid-only outstanding, use get_unpaid_invoices instead.
    """
    ctx = get_ai_context()
    asked = (side or infer_unpaid_invoice_side(question)).strip().lower()
    if asked not in {"customer", "vendor", "both"}:
        asked = "both"
    cap = _limit(limit)
    bounds = period_date_bounds(question) if question.strip() else {}
    date_from = bounds.get("date_from")
    date_to = bounds.get("date_to")
    date_field = infer_invoice_date_field(question) if question.strip() else "document"
    sales_date_col = SalesInvoice.due_date if date_field == "due" else SalesInvoice.issue_date
    vendor_date_col = (
        SupplierInvoice.due_date if date_field == "due" else SupplierInvoice.invoice_date
    )
    resolved = resolve_named_parties(ctx.db, question, asked)
    asked = resolved["asked"]
    party_label = resolved["party_label"]
    customer_ids = resolved["customer_ids"]
    vendor_ids = resolved["vendor_ids"]
    include_customers = resolved["include_customers"]
    include_vendors = resolved["include_vendors"]
    rows: list[dict[str, Any]] = []
    summary: list[dict[str, Any]] = []
    skipped: list[str] = []

    def _in_period(query, date_col):
        if isinstance(date_from, date) and isinstance(date_to, date):
            return query.filter(date_col >= date_from, date_col <= date_to)
        return query

    if include_customers:
        denied = _require_any(ctx.user, "sales_order:view")
        if denied:
            skipped.append(denied)
        else:
            count_q = _in_period(
                ctx.db.query(SalesInvoice.status, func.count(SalesInvoice.id)),
                sales_date_col,
            )
            if customer_ids:
                count_q = count_q.filter(SalesInvoice.customer_id.in_(customer_ids))
            counts = count_q.group_by(SalesInvoice.status).order_by(SalesInvoice.status).all()
            for status, count in counts:
                summary.append(
                    {"invoice_type": "Customer", "status": status, "count": int(count or 0)}
                )
            sales_q = _in_period(
                ctx.db.query(SalesInvoice, Customer.company_name).outerjoin(
                    Customer, Customer.customer_id == SalesInvoice.customer_id
                ),
                sales_date_col,
            )
            if customer_ids:
                sales_q = sales_q.filter(SalesInvoice.customer_id.in_(customer_ids))
            sales_rows = (
                sales_q.order_by(
                    sales_date_col.asc().nullslast()
                    if date_field == "due"
                    else SalesInvoice.issue_date.desc().nullslast(),
                    SalesInvoice.invoice_number.desc(),
                )
                .limit(cap)
                .all()
            )
            for inv, party_name in sales_rows:
                rows.append(
                    {
                        "invoice_number": inv.invoice_number,
                        "invoice_type": "Customer",
                        "party_id": inv.customer_id,
                        "party_name": party_name,
                        "status": inv.status,
                        "invoice_date": str(inv.issue_date) if inv.issue_date else None,
                        "due_date": str(inv.due_date) if inv.due_date else None,
                        "total_amount": str(inv.total_amount or 0),
                        "outstanding_balance": str(inv.outstanding_balance or 0),
                    }
                )

    if include_vendors:
        denied = _require_any(ctx.user, "ap_bill:view")
        if denied:
            skipped.append(denied)
        else:
            count_q = _in_period(
                ctx.db.query(SupplierInvoice.status, func.count(SupplierInvoice.id)),
                vendor_date_col,
            )
            if vendor_ids:
                count_q = count_q.filter(SupplierInvoice.vendor_id.in_(vendor_ids))
            counts = count_q.group_by(SupplierInvoice.status).order_by(SupplierInvoice.status).all()
            for status, count in counts:
                summary.append(
                    {"invoice_type": "Vendor", "status": status, "count": int(count or 0)}
                )
            vendor_q = _in_period(
                ctx.db.query(SupplierInvoice, Supplier.company_name).outerjoin(
                    Supplier, Supplier.supplier_id == SupplierInvoice.vendor_id
                ),
                vendor_date_col,
            )
            if vendor_ids:
                vendor_q = vendor_q.filter(SupplierInvoice.vendor_id.in_(vendor_ids))
            vendor_rows = (
                vendor_q.order_by(
                    vendor_date_col.asc().nullslast()
                    if date_field == "due"
                    else SupplierInvoice.invoice_date.desc().nullslast(),
                    SupplierInvoice.invoice_number.desc(),
                )
                .limit(cap)
                .all()
            )
            for inv, party_name in vendor_rows:
                rows.append(
                    {
                        "invoice_number": inv.invoice_number,
                        "invoice_type": "Vendor",
                        "party_id": inv.vendor_id,
                        "party_name": party_name,
                        "status": inv.status,
                        "invoice_date": str(inv.invoice_date) if inv.invoice_date else None,
                        "due_date": str(inv.due_date) if inv.due_date else None,
                        "total_amount": str(inv.total_amount or 0),
                        "outstanding_balance": str(inv.outstanding_balance or 0),
                    }
                )

    if not rows and skipped and asked == "both":
        return skipped[0]

    if date_field == "due":
        rows.sort(
            key=lambda row: (
                str(row.get("due_date") or "9999"),
                str(row.get("invoice_number") or ""),
            )
        )
    else:
        rows.sort(
            key=lambda row: (
                str(row.get("invoice_date") or row.get("due_date") or ""),
                str(row.get("invoice_number") or ""),
            ),
            reverse=True,
        )
    rows = rows[:cap]
    payload: dict[str, Any] = {
        "count": len(rows),
        "invoice_status": True,
        "date_field": date_field,
        "title": infer_invoice_list_title(question) if question.strip() else "Invoice status",
        "side": asked,
        "party_label": party_label or None,
        "by_status": summary,
        "invoices": rows,
    }
    if bounds:
        payload["period"] = bounds.get("period")
        payload["period_label"] = bounds.get("period_label")
        payload["date_from"] = str(bounds["date_from"]) if bounds.get("date_from") else None
        payload["date_to"] = str(bounds["date_to"]) if bounds.get("date_to") else None
    return format_invoice_status_answer(_json(payload))


@tool
def get_closing_period(question: str = "") -> str:
    """Return the live Period Management close dates.

    Use for "current closing period" / "soft close" / "hard close" / "period lock date".
    Do not treat this as out of scope and do not use get_orders_by_month.
    """
    ctx = get_ai_context()
    denied = _require_any(ctx.user, "journal:view")
    if denied:
        return denied

    from app.services import period_close

    settings = period_close.get_or_create_settings(ctx.db)
    payload = period_close.serialize_period_settings(settings)
    soft = period_close.soft_close_date(settings)
    hard = period_close.hard_close_date(settings)
    today = date.today()
    return format_closing_period_answer(
        _json(
            {
                "closing_period": True,
                "soft_close_date": soft.isoformat() if soft else None,
                "hard_close_date": hard.isoformat() if hard else None,
                "current_closing_date": hard.isoformat() if hard else None,
                "as_of": today.isoformat(),
                "as_of_status": payload.get("as_of_status") or period_close.status_for_date(today, settings),
                "question": question,
            }
        )
    )


@tool
def get_posting_rules(event_code: str = "", question: str = "") -> str:
    """List active posting rules (debit/credit G/L pairs).

    Use for "Posting rule for Month End Close" / "year-end close posting rules" /
    "list posting rules". Do not treat this as out of scope.
    """
    ctx = get_ai_context()
    denied = _require_any(ctx.user, "journal:view")
    if denied:
        return denied

    from app.services import posting_rules as posting_rule_service

    asked = (event_code or infer_posting_rule_event(question)).strip().upper()
    rows = posting_rule_service.list_posting_rules(ctx.db)
    if asked:
        rows = [row for row in rows if str(row.get("event_code") or "").upper() == asked]
    event_label = (
        posting_rule_service.EVENT_LABELS.get(asked, asked.replace("_", " ").title())
        if asked
        else "Posting rules"
    )
    if asked == "MONTH_END_CLOSE":
        event_label = "Month-end close posting rule"
        note = (
            "Month-End Close parks current-period net income (typically 3354 → 3353). "
            "Revenue and expense stay open until Year-End Close."
        )
    elif asked == "YEAR_END_CLOSE":
        event_label = "Year-end close posting rules"
        note = (
            "Year-End Close zeros full-year P&L into retained earnings and reverses "
            "the monthly NI park."
        )
    else:
        note = None
    return format_posting_rules_answer(
        _json(
            {
                "count": len(rows),
                "posting_rules": True,
                "event_code": asked or None,
                "event_label": event_label,
                "rules": rows,
                "note": note,
                "question": question,
            }
        )
    )


def journal_display_id(entry: Any) -> str:
    """Match Finance → General Ledger: UG11 number, else first UUID segment."""
    number = str(getattr(entry, "journal_number", None) or "").strip()
    if number:
        return number
    entry_id = getattr(entry, "id", None)
    if entry_id:
        return str(entry_id).split("-")[0].upper()
    return ""


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def journal_created_date(entry: Any) -> date | None:
    """Journal created_at date (Finance → General Ledger creation date)."""
    return _as_date(getattr(entry, "created_at", None))


def journal_posted_date(entry: Any) -> date | None:
    """Stored posting_date only — do not fall back to created_at."""
    return _as_date(getattr(entry, "posting_date", None))


def format_transactions_answer(raw: str) -> str:
    """Turn get_transactions JSON into a Markdown table."""
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    if not isinstance(data, dict):
        return raw
    if isinstance(data.get("error"), str):
        return data["error"]

    title = str(data.get("title") or "Transactions")
    rows = data.get("rows") or []
    columns = data.get("columns") or [
        {"key": "number", "label": "Number"},
        {"key": "party_name", "label": "Party"},
        {"key": "status", "label": "Status"},
        {"key": "doc_date", "label": "Date"},
        {"key": "amount", "label": "Amount", "format": "money"},
    ]
    period_label = str(data.get("period_label") or "").strip()
    party_label = str(data.get("party_label") or "").strip()
    date_note = str(data.get("date_note") or "").strip()
    lines = [f"## {title}", ""]
    if period_label or party_label:
        bits = []
        if period_label and data.get("date_from") and data.get("date_to"):
            bits.append(
                f"Period **{period_label}** — {date_note or 'document date'} "
                f"{data.get('date_from')} to {data.get('date_to')}"
            )
        elif period_label:
            bits.append(f"Period **{period_label}**")
        if party_label:
            bits.append(f"for **{party_label}**")
        lines.append(" ".join(bits).rstrip(".") + ".")
        lines.append("")
    if not rows:
        empty = f"No {title.lower()} found"
        if period_label:
            empty += f" for {period_label}"
        if party_label:
            empty += f" for {party_label}"
        lines.append(empty + ".")
        return "\n".join(lines)

    headers = [str(col.get("label") or col.get("key") or "") for col in columns]
    aligns = []
    for col in columns:
        if str(col.get("format") or "") == "money":
            aligns.append("---:")
        else:
            aligns.append(":---")
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join(aligns) + " |")
    for row in rows:
        cells = []
        for col in columns:
            key = str(col.get("key") or "")
            value = row.get(key)
            if str(col.get("format") or "") == "money":
                cells.append(_money(value))
            else:
                cells.append(str(value or "—"))
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")
    period_bit = f" for {period_label}" if period_label else ""
    if party_label:
        period_bit = f"{period_bit} for {party_label}".rstrip(".")
    lines.append(
        f"{data.get('count', len(rows))} document(s) shown{period_bit}."
    )
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


@tool
def get_transactions(kind: str = "", limit: int = 40, question: str = "") -> str:
    """List transactional documents with optional period and party filters.

    Use for "show me purchase orders in October 2026", "journals in September 2026",
    "goods receipts for vendor Accelerate Global Solution", "sales orders in 09/2026".
    kind: purchase_orders | sales_orders | subcontract_orders | goods_receipts |
    fulfillments | cash | journals | material_issues | invoices
    Pass question= the user wording so month/party/due can be inferred.
    For invoices, use get_invoice_status / get_unpaid_invoices instead when possible.
    """
    ctx = get_ai_context()
    asked_kind = (kind or infer_transaction_kind(question)).strip().lower()
    if asked_kind == "invoices":
        if is_unpaid_invoice_wording(question):
            return get_unpaid_invoices.invoke({"limit": limit, "question": question})
        return get_invoice_status.invoke({"limit": limit, "question": question})
    if asked_kind not in {
        "purchase_orders",
        "sales_orders",
        "subcontract_orders",
        "goods_receipts",
        "fulfillments",
        "cash",
        "journals",
        "material_issues",
    }:
        return "I can list invoices, purchase orders, sales orders, subcontract orders, goods receipts, fulfillments, payments, journals, or material issues."

    cap = _limit(limit)
    bounds = period_date_bounds(question) if question.strip() else {}
    date_from = bounds.get("date_from")
    date_to = bounds.get("date_to")
    due_filter = infer_invoice_date_field(question) == "due" if question.strip() else False
    resolved = resolve_named_parties(ctx.db, question, infer_unpaid_invoice_side(question))
    party_label = resolved["party_label"]
    vendor_ids = resolved["vendor_ids"]
    customer_ids = resolved["customer_ids"]
    rows: list[dict[str, Any]] = []
    title = "Transactions"
    date_note = "document date"
    columns: list[dict[str, str]] = []
    note = ""

    def _period(query, date_col):
        if date_col is None or not isinstance(date_from, date) or not isinstance(date_to, date):
            return query
        return query.filter(date_col >= date_from, date_col <= date_to)

    if asked_kind == "purchase_orders":
        denied = _require_any(ctx.user, "po:view")
        if denied:
            return denied
        title = "Purchase orders"
        date_col = PurchaseOrder.expected_delivery_date if due_filter else PurchaseOrder.order_date
        date_note = "expected delivery date" if due_filter else "order date"
        query = ctx.db.query(PurchaseOrder, Supplier.company_name).outerjoin(
            Supplier, Supplier.supplier_id == PurchaseOrder.supplier_id
        )
        query = _period(query, date_col)
        if vendor_ids:
            query = query.filter(PurchaseOrder.supplier_id.in_(vendor_ids))
        query = query.order_by(date_col.desc().nullslast(), PurchaseOrder.po_number.desc())
        for order, party_name in query.limit(cap).all():
            rows.append(
                {
                    "number": order.po_number,
                    "party_name": party_name or order.supplier_id,
                    "status": order.status,
                    "doc_date": str(order.order_date) if order.order_date else None,
                    "due_date": str(order.expected_delivery_date)
                    if order.expected_delivery_date
                    else None,
                    "amount": str(order.grand_total or 0),
                }
            )
        columns = [
            {"key": "number", "label": "PO"},
            {"key": "party_name", "label": "Vendor"},
            {"key": "status", "label": "Status"},
            {"key": "doc_date", "label": "Order date"},
            {"key": "due_date", "label": "Due"},
            {"key": "amount", "label": "Amount", "format": "money"},
        ]
    elif asked_kind == "sales_orders":
        denied = _require_any(ctx.user, "sales_order:view")
        if denied:
            return denied
        title = "Sales orders"
        date_note = "order date"
        query = ctx.db.query(SalesOrder, Customer.company_name).outerjoin(
            Customer, Customer.customer_id == SalesOrder.customer_id
        )
        query = _period(query, SalesOrder.order_date)
        if customer_ids:
            query = query.filter(SalesOrder.customer_id.in_(customer_ids))
        query = query.order_by(SalesOrder.order_date.desc().nullslast(), SalesOrder.sales_order_id.desc())
        for order, party_name in query.limit(cap).all():
            rows.append(
                {
                    "number": order.sales_order_id,
                    "party_name": party_name or order.customer_id,
                    "status": order.status,
                    "doc_date": str(order.order_date) if order.order_date else None,
                    "amount": str(order.total_amount or 0),
                }
            )
        columns = [
            {"key": "number", "label": "SO"},
            {"key": "party_name", "label": "Customer"},
            {"key": "status", "label": "Status"},
            {"key": "doc_date", "label": "Order date"},
            {"key": "amount", "label": "Amount", "format": "money"},
        ]
    elif asked_kind == "subcontract_orders":
        denied = _require_any(ctx.user, "subcontract:view")
        if denied:
            return denied
        title = "Subcontract orders"
        date_note = "order date"
        query = ctx.db.query(SubcontractOrder, Supplier.company_name).outerjoin(
            Supplier, Supplier.supplier_id == SubcontractOrder.supplier_id
        )
        query = _period(query, SubcontractOrder.order_date)
        if vendor_ids:
            query = query.filter(SubcontractOrder.supplier_id.in_(vendor_ids))
        query = query.order_by(
            SubcontractOrder.order_date.desc().nullslast(),
            SubcontractOrder.sco_number.desc(),
        )
        for order, party_name in query.limit(cap).all():
            rows.append(
                {
                    "number": order.sco_number,
                    "party_name": party_name or order.supplier_id,
                    "status": order.status,
                    "doc_date": str(order.order_date) if order.order_date else None,
                    "amount": str((order.quantity_ordered or 0) * (order.unit_price or 0)),
                }
            )
        columns = [
            {"key": "number", "label": "SCO"},
            {"key": "party_name", "label": "Vendor"},
            {"key": "status", "label": "Status"},
            {"key": "doc_date", "label": "Order date"},
            {"key": "amount", "label": "Amount", "format": "money"},
        ]
    elif asked_kind == "goods_receipts":
        denied = _require_any(ctx.user, "po:view", "subcontract:view", "ap_bill:view")
        if denied:
            return denied
        title = "Goods receipts"
        date_note = "receipt date"
        query = ctx.db.query(GoodsReceipt, Supplier.company_name).outerjoin(
            Supplier, Supplier.supplier_id == GoodsReceipt.vendor_id
        )
        query = _period(query, GoodsReceipt.receipt_date)
        if vendor_ids:
            query = query.filter(GoodsReceipt.vendor_id.in_(vendor_ids))
        query = query.order_by(
            GoodsReceipt.receipt_date.desc().nullslast(),
            GoodsReceipt.receipt_number.desc(),
        )
        for receipt, party_name in query.limit(cap).all():
            rows.append(
                {
                    "number": receipt.receipt_number,
                    "party_name": party_name or receipt.vendor_id,
                    "status": receipt.status,
                    "doc_date": str(receipt.receipt_date) if receipt.receipt_date else None,
                    "source": f"{receipt.source_type or ''} {receipt.source_order_id or ''}".strip(),
                }
            )
        columns = [
            {"key": "number", "label": "Receipt"},
            {"key": "source", "label": "Source"},
            {"key": "party_name", "label": "Vendor"},
            {"key": "status", "label": "Status"},
            {"key": "doc_date", "label": "Date"},
        ]
    elif asked_kind == "fulfillments":
        denied = _require_any(ctx.user, "sales_order:view")
        if denied:
            return denied
        title = "Fulfillments"
        date_note = "shipped date"
        query = ctx.db.query(ItemFulfillment, Customer.company_name).outerjoin(
            Customer, Customer.customer_id == ItemFulfillment.customer_id
        )
        query = _period(query, ItemFulfillment.shipped_date)
        if customer_ids:
            query = query.filter(ItemFulfillment.customer_id.in_(customer_ids))
        query = query.order_by(
            ItemFulfillment.shipped_date.desc().nullslast(),
            ItemFulfillment.fulfillment_number.desc(),
        )
        for fulfillment, party_name in query.limit(cap).all():
            rows.append(
                {
                    "number": fulfillment.fulfillment_number,
                    "party_name": party_name or fulfillment.customer_id,
                    "status": fulfillment.status,
                    "doc_date": str(fulfillment.shipped_date) if fulfillment.shipped_date else None,
                    "sales_order_id": fulfillment.sales_order_id,
                }
            )
        columns = [
            {"key": "number", "label": "Fulfillment"},
            {"key": "sales_order_id", "label": "SO"},
            {"key": "party_name", "label": "Customer"},
            {"key": "status", "label": "Status"},
            {"key": "doc_date", "label": "Shipped"},
        ]
    elif asked_kind == "cash":
        denied = _require_any(ctx.user, "cash:view")
        if denied:
            return denied
        title = "Payments"
        date_note = "transaction date"
        query = ctx.db.query(CashTransaction)
        if isinstance(date_from, date) and isinstance(date_to, date):
            query = query.filter(
                CashTransaction.transaction_date >= datetime.combine(date_from, time.min),
                CashTransaction.transaction_date
                < datetime.combine(date_to + timedelta(days=1), time.min),
            )
        if resolved["tokens"]:
            for tok in resolved["tokens"]:
                query = query.filter(CashTransaction.entity_name.ilike(f"%{tok}%"))
            if not party_label:
                party_label = str(infer_invoice_party(question).get("query") or "")
        query = query.order_by(CashTransaction.transaction_date.desc())
        for txn in query.limit(cap).all():
            txn_date = txn.transaction_date.date() if txn.transaction_date else None
            rows.append(
                {
                    "number": txn.transaction_id,
                    "party_name": txn.entity_name,
                    "status": txn.clearing_status,
                    "doc_date": str(txn_date) if txn_date else None,
                    "type": txn.type,
                    "amount": str(txn.amount or 0),
                }
            )
        columns = [
            {"key": "number", "label": "Payment"},
            {"key": "type", "label": "Type"},
            {"key": "party_name", "label": "Party"},
            {"key": "status", "label": "Clearing"},
            {"key": "doc_date", "label": "Date"},
            {"key": "amount", "label": "Amount", "format": "money"},
        ]
    elif asked_kind == "journals":
        denied = _require_any(ctx.user, "journal:view")
        if denied:
            return denied
        title = "Journals"
        date_note = "period or posting date"
        query = ctx.db.query(JournalEntry)
        journal_filters = []
        if bounds.get("period"):
            journal_filters.append(JournalEntry.period == bounds["period"])
        if isinstance(date_from, date) and isinstance(date_to, date):
            journal_filters.append(
                (JournalEntry.posting_date >= date_from)
                & (JournalEntry.posting_date <= date_to)
            )
        if journal_filters:
            query = query.filter(or_(*journal_filters))
        effective_date = func.coalesce(
            JournalEntry.posting_date, func.date(JournalEntry.created_at)
        )
        query = query.order_by(
            effective_date.desc().nullslast(),
            JournalEntry.journal_number.desc().nullslast(),
        )
        for entry in query.limit(cap).all():
            created = journal_created_date(entry)
            posted = journal_posted_date(entry)
            rows.append(
                {
                    "number": journal_display_id(entry),
                    "status": entry.posting_status,
                    "created_date": str(created) if created else None,
                    "doc_date": str(posted) if posted else None,
                    "period": entry.period,
                    "description": (entry.description or "")[:80],
                }
            )
        columns = [
            {"key": "number", "label": "Journal"},
            {"key": "period", "label": "Period"},
            {"key": "status", "label": "Status"},
            {"key": "created_date", "label": "Created"},
            {"key": "doc_date", "label": "Posting date"},
            {"key": "description", "label": "Description"},
        ]
        note = "Same journal documents as Finance → General Ledger. Created is the journal created date; posting date is the stored posting date."
    else:
        denied = _require_any(ctx.user, "subcontract:view")
        if denied:
            return denied
        title = "Material issues"
        date_note = "issue date"
        query = (
            ctx.db.query(MaterialIssue, Supplier.company_name)
            .outerjoin(SubcontractOrder, SubcontractOrder.sco_number == MaterialIssue.sco_number)
            .outerjoin(Supplier, Supplier.supplier_id == SubcontractOrder.supplier_id)
        )
        query = _period(query, MaterialIssue.issue_date)
        if vendor_ids:
            query = query.filter(SubcontractOrder.supplier_id.in_(vendor_ids))
        query = query.order_by(MaterialIssue.issue_date.desc().nullslast(), MaterialIssue.issue_id.desc())
        for issue, party_name in query.limit(cap).all():
            rows.append(
                {
                    "number": issue.issue_id,
                    "party_name": party_name,
                    "status": issue.sco_number,
                    "doc_date": str(issue.issue_date) if issue.issue_date else None,
                }
            )
        columns = [
            {"key": "number", "label": "Issue"},
            {"key": "status", "label": "SCO"},
            {"key": "party_name", "label": "Vendor"},
            {"key": "doc_date", "label": "Date"},
        ]

    return format_transactions_answer(
        _json(
            {
                "count": len(rows),
                "transactions": True,
                "kind": asked_kind,
                "title": title,
                "date_note": date_note,
                "period": bounds.get("period"),
                "period_label": bounds.get("period_label"),
                "date_from": str(date_from) if date_from else None,
                "date_to": str(date_to) if date_to else None,
                "party_label": party_label or None,
                "columns": columns,
                "rows": rows,
                "note": note or None,
            }
        )
    )


@tool
def get_finance_records(kind: str, status: str = "", limit: int = 20) -> str:
    """List recent finance documents. kind: ar_invoices, ap_bills, sales_invoices, supplier_invoices, cash, journals, accounts.

    Do NOT use this for "by month" / monthly totals — call get_orders_by_month instead
    (kind=ap_bills, ar_invoices, sales_invoices, supplier_invoices, or cash).
    """
    ctx = get_ai_context()
    kind_key = kind.strip().lower()
    lim = _limit(limit)
    st = status.strip()

    if kind_key in ("ar", "ar_invoices", "ar_invoice"):
        denied = _require_any(ctx.user, "ar_invoice:view")
        if denied:
            return denied
        q = ctx.db.query(ARInvoice)
        if st:
            q = q.filter(or_(ARInvoice.status.ilike(st), ARInvoice.approval_status.ilike(st)))
        rows = q.order_by(ARInvoice.created_at.desc()).limit(lim).all()
        return _json(
            {
                "count": len(rows),
                "ar_invoices": [
                    {
                        "invoice_id": r.invoice_id,
                        "customer_id": r.customer_id,
                        "sales_order_id": r.sales_order_id,
                        "amount": r.amount,
                        "status": r.status,
                        "due_date": r.due_date,
                    }
                    for r in rows
                ],
            }
        )

    if kind_key in ("ap", "ap_bills", "ap_bill"):
        denied = _require_any(ctx.user, "ap_bill:view")
        if denied:
            return denied
        q = ctx.db.query(APBill)
        if st:
            q = q.filter(or_(APBill.status.ilike(st), APBill.approval_status.ilike(st)))
        rows = q.order_by(APBill.created_at.desc()).limit(lim).all()
        return _json(
            {
                "count": len(rows),
                "ap_bills": [
                    {
                        "bill_id": r.bill_id,
                        "vendor_id": r.vendor_id,
                        "amount": r.amount,
                        "status": r.status,
                        "due_date": r.due_date,
                    }
                    for r in rows
                ],
            }
        )

    if kind_key in ("sales_invoices", "sales_invoice"):
        denied = _require_any(ctx.user, "sales_order:view")
        if denied:
            return denied
        q = ctx.db.query(SalesInvoice)
        if st:
            q = q.filter(SalesInvoice.status.ilike(st))
        rows = q.order_by(SalesInvoice.created_at.desc()).limit(lim).all()
        return _json(
            {
                "count": len(rows),
                "sales_invoices": [
                    {
                        "invoice_number": r.invoice_number,
                        "customer_id": r.customer_id,
                        "sales_order_id": r.sales_order_id,
                        "status": r.status,
                        "total_amount": r.total_amount,
                        "outstanding_balance": r.outstanding_balance,
                        "due_date": r.due_date,
                    }
                    for r in rows
                ],
            }
        )

    if kind_key in ("supplier_invoices", "supplier_invoice"):
        denied = _require_any(ctx.user, "ap_bill:view")
        if denied:
            return denied
        q = ctx.db.query(SupplierInvoice)
        if st:
            q = q.filter(SupplierInvoice.status.ilike(st))
        rows = q.order_by(SupplierInvoice.created_at.desc()).limit(lim).all()
        return _json(
            {
                "count": len(rows),
                "supplier_invoices": [
                    {
                        "invoice_number": r.invoice_number,
                        "vendor_id": r.vendor_id,
                        "source_order_id": r.source_order_id,
                        "status": r.status,
                        "total_amount": r.total_amount,
                        "outstanding_balance": r.outstanding_balance,
                    }
                    for r in rows
                ],
            }
        )

    if kind_key in ("cash", "cash_transactions"):
        denied = _require_any(ctx.user, "cash:view")
        if denied:
            return denied
        q = ctx.db.query(CashTransaction)
        if st:
            if st.lower() in {"uncleared", "un-cleared", "pending"}:
                q = q.filter(CashTransaction.clearing_status.ilike("PENDING"))
            else:
                q = q.filter(
                    or_(
                        CashTransaction.type.ilike(st),
                        CashTransaction.clearing_status.ilike(st),
                    )
                )
        rows = q.order_by(CashTransaction.transaction_date.desc()).limit(lim).all()
        return _json(
            {
                "count": len(rows),
                "cash_transactions": [
                    {
                        "transaction_id": r.transaction_id,
                        "type": r.type,
                        "reference_id": r.reference_id,
                        "amount": r.amount,
                        "transaction_date": r.transaction_date,
                        "clearing_status": getattr(r, "clearing_status", None),
                    }
                    for r in rows
                ],
            }
        )

    if kind_key in ("bank", "bank_accounts", "bank_account"):
        denied = _require_any(ctx.user, "cash:view")
        if denied:
            return denied
        q = ctx.db.query(BankAccount)
        if st.lower() in {"default", "is_default"}:
            q = q.filter(BankAccount.is_default.is_(True))
        rows = q.order_by(BankAccount.is_default.desc(), BankAccount.bank_name.asc()).limit(lim).all()
        return _json(
            {
                "count": len(rows),
                "bank_accounts": [
                    {
                        "bank_account_id": r.bank_account_id,
                        "bank_name": r.bank_name,
                        "account_name": r.account_name,
                        "account_number": r.account_number,
                        "currency": r.currency,
                        "gl_account_id": str(r.gl_account_id) if r.gl_account_id else None,
                        "is_default": r.is_default,
                        "is_active": r.is_active,
                    }
                    for r in rows
                ],
                "note": "Balances come from the linked G/L account; this list is the cash master.",
            }
        )

    if kind_key in ("journals", "journal", "journal_entries"):
        denied = _require_any(ctx.user, "journal:view")
        if denied:
            return denied
        q = ctx.db.query(JournalEntry)
        if st:
            q = q.filter(
                or_(JournalEntry.posting_status.ilike(st), JournalEntry.approval_status.ilike(st))
            )
        rows = q.order_by(JournalEntry.created_at.desc()).limit(lim).all()
        return _json(
            {
                "count": len(rows),
                "journal_entries": [
                    {
                        "id": r.id,
                        "description": r.description,
                        "period": r.period,
                        "posting_status": r.posting_status,
                        "approval_status": r.approval_status,
                    }
                    for r in rows
                ],
            }
        )

    if kind_key in ("accounts", "coa", "chart_of_accounts"):
        denied = _require_any(ctx.user, "journal:view")
        if denied:
            return denied
        q = ctx.db.query(ChartOfAccount)
        if st:
            q = q.filter(ChartOfAccount.account_type.ilike(st))
        rows = q.order_by(ChartOfAccount.account_code.asc()).limit(lim).all()
        return _json(
            {
                "count": len(rows),
                "accounts": [
                    {
                        "account_code": r.account_code,
                        "account_name": r.account_name,
                        "account_type": r.account_type,
                    }
                    for r in rows
                ],
            }
        )

    return _json(
        {
            "error": f"Unknown finance kind '{kind}'",
            "supported": [
                "ar_invoices",
                "ap_bills",
                "sales_invoices",
                "supplier_invoices",
                "cash",
                "journals",
                "accounts",
            ],
        }
    )


LOOKUP_TOOLS = [
    get_erp_counts,
    get_orders_by_month,
    get_customers,
    get_customer_detail,
    get_vendors,
    get_vendor_detail,
    get_items,
    get_item_detail,
    get_item_bom,
    get_item_where_used,
    get_work_centers,
    get_warehouses,
    get_fulfillments,
    get_goods_receipts,
    get_received_qty_by_purchase_order,
    get_unpaid_invoices,
    get_invoice_status,
    get_transactions,
    get_closing_period,
    get_posting_rules,
    get_finance_records,
    get_financial_report,
]
