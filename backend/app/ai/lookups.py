# @author: Wendy Yang
# @date: 2026-09-19

"""Read-only LangChain tools for live ERP lookups across all modules."""

from __future__ import annotations

import json
import re
from calendar import monthrange
from datetime import date
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
    BinLocation,
    CashTransaction,
    ChartOfAccount,
    Customer,
    GoodsReceipt,
    Item,
    ItemBOMComponent,
    ItemBOMHeader,
    ItemFulfillment,
    JournalEntry,
    LedgerPosting,
    PurchaseOrder,
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
    ("sales_orders", ("sales order", " so ")),
    ("purchase_orders", ("purchase order", " po ")),
    ("subcontract_orders", ("subcontract", " sco ")),
    ("inventory", ("inventory", "stock", "on hand", "atp", "warehouse bin")),
    ("warehouses", ("warehouse", "bin")),
    ("fulfillments", ("fulfillment", "shipment", "shipped")),
    ("goods_receipts", ("goods receipt", "grn", "receiving")),
    ("ar_invoices", ("ar invoice", "accounts receivable", "account receivable", "ar aging")),
    ("ap_bills", ("ap bill", "accounts payable", "account payable", "ap aging")),
    ("sales_invoices", ("sales invoice", "customer invoice")),
    ("supplier_invoices", ("supplier invoice", "vendor invoice", "vendor bill")),
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
    elif re.search(r"\blow stock\b", text):
        status = "Low Stock"
    elif re.search(r"\bout of stock\b", text):
        status = "Out of Stock"

    for entity, needles in ENTITY_ALIASES:
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

    if entity in ("inventory", "stock"):
        overview = list_stock_overview(db)
        if st:
            overview = [r for r in overview if (r.status or "").lower() == st.lower()]
        by_status: dict[str, int] = {}
        for row in list_stock_overview(db):
            by_status[row.status] = by_status.get(row.status, 0) + 1
        return {
            "entity": "inventory",
            "count": len(overview),
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
    months = data.get("months") or []
    lines = [f"## {title}", ""]
    if not months:
        lines.append(f"No {count_label.lower()} found for this grouping.")
        return "\n".join(lines)

    has_party = bool(party_label) and any(row.get("party") or row.get("party_id") for row in months)
    chart_points: list[dict[str, Any]] = []
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
        for row in _fill_month_gaps(months):
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
        "amountLabel": "Amount",
        "seriesLabel": party_label or None,
        "points": chart_points,
    }
    lines.append("```ai-chart")
    lines.append(json.dumps(chart, separators=(",", ":")))
    lines.append("```")
    lines.append("")

    if has_party:
        lines.append(f"| Month | {party_label} | {count_label} | Amount |")
        lines.append("| :--- | :--- | ---: | ---: |")
        for row in months:
            party = row.get("party") or row.get("party_id") or "—"
            lines.append(
                f"| {row.get('label') or row.get('month')} | {party} | "
                f"{row.get('order_count', 0)} | {_money(row.get('total_amount'))} |"
            )
        lines.append(
            f"| Total |  | {data.get('order_count', 0)} | {_money(data.get('total_amount'))} |"
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
        lines.append(f"| {party_label} | {count_label} | Amount |")
        lines.append("| :--- | ---: | ---: |")
        for name, bucket in sorted(
            party_totals.items(), key=lambda item: item[1]["amount"], reverse=True
        ):
            lines.append(
                f"| {name} | {bucket['count']} | {_money(bucket['amount'])} |"
            )
        lines.append(
            f"| Total | {data.get('order_count', 0)} | {_money(data.get('total_amount'))} |"
        )
    else:
        lines.append(f"| Month | {count_label} | Amount |")
        lines.append("| :--- | ---: | ---: |")
        for row in months:
            lines.append(
                f"| {row.get('label') or row.get('month')} | {row.get('order_count', 0)} | {_money(row.get('total_amount'))} |"
            )
        lines.append(
            f"| Total | {data.get('order_count', 0)} | {_money(data.get('total_amount'))} |"
        )

    lines.append("")
    lines.append(
        f"{data.get('order_count', 0)} {count_label.lower()} totaling {_money(data.get('total_amount'))}."
    )
    if data.get("note"):
        lines.append("")
        lines.append(str(data["note"]))
    return "\n".join(lines)


def infer_period_kind(question: str) -> str:
    text = question.lower()
    if any(
        w in text
        for w in (
            "accounts payable",
            "account payable",
            "ap bill",
            "ap bills",
            "payables",
            "vendor bill",
        )
    ) or re.search(r"\b(ap|a/p)\b", text):
        return "ap_bills"
    if any(
        w in text
        for w in (
            "accounts receivable",
            "account receivable",
            "ar invoice",
            "ar invoices",
            "receivables",
        )
    ) or re.search(r"\b(ar|a/r)\b", text):
        return "ar_invoices"
    if "supplier invoice" in text or "vendor invoice" in text:
        return "supplier_invoices"
    if "sales invoice" in text or "customer invoice" in text:
        return "sales_invoices"
    if re.search(r"\bcash\b", text):
        return "cash"
    if any(w in text for w in ("purchase", " po ", "pos ", "vendor po")):
        return "purchase_orders"
    if "subcontract" in text or "sco" in text:
        return "subcontract_orders"
    if re.search(r"\brevenue\b", text) or "sales revenue" in text:
        return "gl_revenue"
    if re.search(r"\bexpenses?\b", text):
        return "gl_expense"
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


def _gl_totals_by_month(db, user: User, kind_key: str, year_filter: int) -> str:
    """Posted G/L Revenue or Expense totals grouped by journal period."""
    from app.services.financial_reports import signed_balance

    denied = _require_any(user, "report:view", "journal:view")
    if denied:
        return denied

    account_type = "revenue" if kind_key == "gl_revenue" else "expense"
    title = "Revenue by month" if kind_key == "gl_revenue" else "Expenses by month"
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

    return format_period_answer(
        _json(
            {
                "kind": kind_key,
                "title": title,
                "count_label": "Journals",
                "year": year_filter or None,
                "order_count": total_count,
                "total_amount": str(total_amount.quantize(Decimal("0.01"))),
                "months": months,
                "note": note,
            }
        )
    )


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

    Use for "revenue by month" (kind=gl_revenue, posted G/L) and "sales by month"
    (kind=sales_orders). Never use search_erp_knowledge for those.

    kind: sales_orders | purchase_orders | subcontract_orders | ap_bills | ar_invoices |
    sales_invoices | supplier_invoices | cash | gl_revenue | gl_expense
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
        "gl_revenue": "gl_revenue",
        "expense": "gl_expense",
        "expenses": "gl_expense",
        "gl_expense": "gl_expense",
    }
    kind_key = aliases.get(kind_key, kind_key)

    year_filter = int(year or 0)
    if not year_filter and question.strip():
        ym = re.search(r"\b(20\d{2})\b", question)
        if ym:
            year_filter = int(ym.group(1))

    if kind_key in ("gl_revenue", "gl_expense"):
        return _gl_totals_by_month(ctx.db, ctx.user, kind_key, year_filter)

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
    return format_period_answer(
        _json(
            {
                "kind": kind_key,
                "title": title,
                "count_label": count_label,
                "party_label": party_label or None,
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
    "customer",
    "vendor",
    "supplier",
    "item",
    "sku",
    "bom",
    "warehouse",
    "journal",
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


def infer_financial_report_type(question: str) -> str:
    """Map wording onto a financial-report catalog id, or empty if not a report."""
    text = re.sub(r"&\s*", "&", (question or "").lower())
    text = re.sub(r"\s+", " ", text)
    for report_id, needles in REPORT_TYPE_ALIASES:
        if any(needle in text for needle in needles):
            return report_id
    if any(phrase in text for phrase in ("financial report", "financial statement", "financial statements")):
        return "income-statement"
    # "Show me the revenue for September 2027" is a P&L ask, not a knowledge search.
    # Leave "revenue by month" / "revenue by vendor" to get_orders_by_month.
    if any(phrase in text for phrase in _GROUPED_TOTALS_PHRASES):
        return ""
    if re.search(r"\b(net income|gross profit)\b", text) or _has_near_word(
        text, "revenue", "revenues", "expense", "expenses", "opex", max_dist=1
    ):
        return "income-statement"
    # "show me expense for September 2026" / "show me September 2026"
    if parse_financial_report_period(question) and re.search(
        r"\b(show|give|tell|display|pull)\b", text
    ):
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
    if report_id == "income-statement" and _income_statement_is_empty(payload):
        requested = str((payload.get("filters") or {}).get("period") or "")
        payload["empty_period"] = True
        payload["other_periods"] = [
            row for row in posted_pnl_months(ctx.db) if row.get("period") != requested
        ]
    return format_financial_report_answer(payload)


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


@tool
def get_goods_receipts(status: str = "", vendor_id: str = "", limit: int = 20) -> str:
    """List goods receipts (PO / SCO receiving)."""
    ctx = get_ai_context()
    denied = _require_any(ctx.user, "po:view", "subcontract:view")
    if denied:
        return denied
    query = ctx.db.query(GoodsReceipt)
    if status.strip():
        query = query.filter(GoodsReceipt.status.ilike(status.strip()))
    if vendor_id.strip():
        query = query.filter(GoodsReceipt.vendor_id == vendor_id.strip())
    rows = query.order_by(GoodsReceipt.created_at.desc()).limit(_limit(limit)).all()
    return _json(
        {
            "count": len(rows),
            "receipts": [
                {
                    "receipt_number": r.receipt_number,
                    "source_type": r.source_type,
                    "source_order_id": r.source_order_id,
                    "vendor_id": r.vendor_id,
                    "status": r.status,
                    "receipt_date": r.receipt_date,
                }
                for r in rows
            ],
        }
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
            q = q.filter(CashTransaction.type.ilike(st))
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
                    }
                    for r in rows
                ],
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
    get_work_centers,
    get_warehouses,
    get_fulfillments,
    get_goods_receipts,
    get_finance_records,
    get_financial_report,
]
