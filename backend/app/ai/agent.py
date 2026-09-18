"""LangGraph / LangChain agent + heuristic fallback for ERP AI chat."""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from uuid import uuid4

from app.ai.tools import ERP_TOOLS
from app.config import get_settings

logger = logging.getLogger(__name__)

# conversation_id -> list[{role, content}]
_HISTORY: dict[str, list[dict[str, str]]] = {}


SYSTEM_PROMPT = """You are the GTT-USA ERP assistant embedded in the application.
You can look up live data across the whole system: master data (customers, vendors, items, BOMs, work centers, warehouses),
sales (sales orders, fulfillments, sales invoices), purchasing (purchase orders, goods receipts), manufacturing (subcontract orders),
inventory/stock, and finance (AR invoices, AP bills, supplier invoices, cash, journals, chart of accounts), plus ERP process docs.
You can propose creating a DRAFT sales order, DRAFT purchase order, or subcontract order, but never claim it was created until the user confirms.

Rules:
- Prefer tools for live data over guessing. Never invent counts or IDs.
- For "how many …" / count questions, ALWAYS call get_erp_counts (never search_erp_knowledge).
  Pass question= the user wording. "How many bom items?" → entity=items_with_bom.
  "How many active customers?" → entity=customers, status=ACTIVE.
- For "… by month" / monthly totals (sales/purchase/SCO orders, AP, AR, invoices, cash), ALWAYS call get_orders_by_month with the matching kind (ap_bills, ar_invoices, sales_invoices, supplier_invoices, cash, sales_orders, purchase_orders, subcontract_orders). Pass question= the user wording. "Account Payable by Month by Vendor" → kind=ap_bills. "Account Receivable by Month by customer" → kind=ar_invoices, group_by=customer. Never dump a raw list from get_finance_records or get_sales_orders for that.
- Use get_customers / get_customer_detail, get_vendors / get_vendor_detail, get_items / get_item_detail / get_item_bom for master data.
- Use get_finance_records only to list recent AR/AP/invoices/cash/journals/accounts (not monthly totals).
- Respect RBAC: if a tool returns permission denied, explain clearly.
- Use page_context when the user says "this order", "this customer", "this item", or "current page".
- Keep answers concise. Present totals as a GitHub-flavored Markdown table the chat UI can render
  (heading, header row, alignment row `| :--- | ---: | ---: |`, data rows, then a Total row).
  Currency uses $ and thousands separators (example: $9,650.00). Never wrap the table in code fences.
  If a tool returned a ```ai-chart fence, keep that fence exactly so the UI can draw the trend.
  If a tool already returned Markdown, copy it verbatim — do not rewrite as JSON or a bullet list.
  Example of the required shape:

## Purchase orders by month

| Month | Orders | Amount |
| :--- | ---: | ---: |
| Jun 2026 | 1 | $9,650.00 |
| Aug 2026 | 4 | $10,060.00 |
| Total | 5 | $19,710.00 |
- When propose_draft_sales_order, propose_draft_purchase_order, or propose_draft_subcontract_order returns pending_confirmation, tell the user a confirmation dialog will appear — do not invent an order ID; the server assigns PU61-/PU62-/UP23- numbers on save.
- For "create PO like PO-XXXX with x N", call propose_draft_purchase_order with template_po_number=PO-XXXX and quantity_multiplier=N.
- For "create Subcontract Order like SCO-XXXX with x N", call propose_draft_subcontract_order with template_sco_number=SCO-XXXX and quantity_multiplier=N.
"""


def _history(conversation_id: str) -> list[dict[str, str]]:
    return _HISTORY.setdefault(conversation_id, [])


def _append(conversation_id: str, role: str, content: str) -> None:
    hist = _history(conversation_id)
    hist.append({"role": role, "content": content})
    # keep last 20 turns
    if len(hist) > 40:
        del hist[:-40]


def _extract_pending(tool_outputs: list[str]) -> dict[str, Any] | None:
    for raw in tool_outputs:
        try:
            data = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and data.get("pending_confirmation"):
            return {
                "action_id": data.get("action_id"),
                "action_type": data.get("action_type"),
                "summary": data.get("summary"),
                "payload": data.get("payload"),
            }
    return None


def _is_preformatted_lookup(text: str) -> bool:
    """True when a tool already returned user-facing Markdown (not JSON)."""
    stripped = (text or "").lstrip()
    if not stripped or stripped.startswith("{") or stripped.startswith("["):
        return False
    if "```ai-chart" in text:
        return True
    if "| Month |" in text and re.search(r"\|[-: ]+\|", text):
        return True
    if stripped.startswith("## ") and "|" in text:
        return True
    if stripped.startswith("Live counts from"):
        return True
    if re.match(r"\*\*\d+", stripped):
        return True
    return False


def _format_tool_reply(tool_outputs: list[str], pending: dict[str, Any] | None) -> str:
    from app.ai.lookups import format_count_answer, format_period_answer

    reply_parts: list[str] = []
    for out in tool_outputs:
        try:
            data = json.loads(out)
        except (TypeError, json.JSONDecodeError):
            reply_parts.append(out)
            continue
        if isinstance(data, dict) and data.get("months") is not None:
            reply_parts.append(format_period_answer(out))
        elif isinstance(data, dict) and "entity" in data and "orders" not in data:
            reply_parts.append(format_count_answer(out))
        else:
            reply_parts.append("```json")
            reply_parts.append(json.dumps(data, indent=2, default=str))
            reply_parts.append("```")
    if pending:
        reply_parts.append("")
        reply_parts.append(f"**Action requires confirmation:** {pending.get('summary')}")
    body = "\n\n".join(part for part in reply_parts if part).strip()
    if "```json" in body:
        return (
            "*(Running in local tool mode — set OPENAI_API_KEY for full LLM reasoning.)*\n\n"
            + body
        )
    return body


def _parse_qty_multiplier(text: str) -> float:
    """Parse 'x 100', '×100', '* 100', or trailing quantity for clone scale."""
    m = re.search(r"(?:x|×|\*)\s*(\d+(?:\.\d+)?)", text, re.I)
    if m:
        return float(m.group(1))
    m = re.search(r"(?:qty|quantity)\s*[:=]?\s*(\d+(?:\.\d+)?)", text, re.I)
    if m:
        return float(m.group(1))
    return 1.0


def _is_count_question(message: str) -> bool:
    text = message.lower()
    return bool(
        re.search(
            r"\b(how many|how much|number of|count of|total number|"
            r"what(?:'s| is) the count)\b",
            text,
        )
    ) or bool(re.search(r"\bcount\b.{0,40}\b(customer|item|bom|vendor|order|invoice)\b", text))


def _answer_count_question(message: str) -> str:
    from app.ai.lookups import format_count_answer, get_erp_counts

    raw = get_erp_counts.invoke({"question": message, "entity": "", "status": ""})
    return format_count_answer(raw)


def _is_period_question(message: str) -> bool:
    text = message.lower()
    grouped = any(
        w in text
        for w in ("by month", "per month", "monthly", "by year", "per year", "month by month")
    )
    about_entity = any(
        w in text
        for w in (
            "sales order",
            "purchase order",
            "subcontract",
            "orders",
            "order",
            "accounts payable",
            "account payable",
            "accounts receivable",
            "account receivable",
            "ap bill",
            "ar invoice",
            "payables",
            "receivables",
            "payable",
            "receivable",
            "invoice",
            "invoices",
            "cash",
            "supplier invoice",
            "sales invoice",
        )
    ) or bool(re.search(r"\b(ap|ar|a/p|a/r)\b", text))
    return grouped and about_entity


def _answer_period_question(message: str) -> str:
    from app.ai.lookups import (
        format_period_answer,
        get_orders_by_month,
        infer_period_breakdown,
        infer_period_kind,
    )

    kind = infer_period_kind(message)
    year = 0
    ym = re.search(r"\b(20\d{2})\b", message)
    if ym:
        year = int(ym.group(1))
    raw = get_orders_by_month.invoke(
        {
            "kind": kind,
            "year": year,
            "question": message,
            "group_by": infer_period_breakdown(message),
        }
    )
    return format_period_answer(raw)


def _run_heuristic(message: str, page_context: dict[str, Any] | None) -> tuple[str, dict[str, Any] | None]:
    """Tool router used when OpenAI is not configured."""
    text = message.lower()
    original = message
    tool_outputs: list[str] = []
    page_context = page_context or {}

    if _is_count_question(message):
        return _answer_count_question(message), None
    if _is_period_question(message):
        return _answer_period_question(message), None

    # Knowledge / how-to
    if any(w in text for w in ("how", "what is", "explain", "workflow", "approval", "permission")):
        from app.ai.tools import search_erp_knowledge

        tool_outputs.append(search_erp_knowledge.invoke({"query": message}))

    # Customers
    cust_id_match = re.search(r"(CUST-[\w-]+)", original, re.I)
    page_cust = page_context.get("customer_id") or (
        page_context.get("entity_id") if page_context.get("entity_type") == "customer" else None
    )
    if cust_id_match or (
        page_cust
        and any(w in text for w in ("this customer", "current", "detail", "show"))
        and "order" not in text
    ):
        from app.ai.lookups import get_customer_detail

        cid = cust_id_match.group(1).upper() if cust_id_match else str(page_cust)
        tool_outputs.append(get_customer_detail.invoke({"customer_id": cid}))
    elif any(w in text for w in ("customer", "customers")) and not any(
        w in text for w in ("sales order", "invoice", "fulfillment", "receivable", "payable", "by month")
    ):
        from app.ai.lookups import get_customers

        status = ""
        for s in ("ACTIVE", "INACTIVE", "ON_HOLD"):
            if s.lower().replace("_", " ") in text or s.lower() in text:
                status = s
                break
        tool_outputs.append(get_customers.invoke({"status": status, "q": "", "limit": 20}))

    # Vendors
    vend_id_match = re.search(r"(SUP-[\w-]+|VEND(?:OR)?-[\w-]+)", original, re.I)
    page_vend = page_context.get("supplier_id") or page_context.get("vendor_id") or (
        page_context.get("entity_id") if page_context.get("entity_type") in ("vendor", "supplier") else None
    )
    if (
        (vend_id_match or page_vend)
        and any(w in text for w in ("vendor", "supplier", "this vendor", "detail", "show"))
        and "purchase" not in text
        and "subcontract" not in text
        and "create" not in text
    ):
        from app.ai.lookups import get_vendor_detail

        vid = vend_id_match.group(1).upper() if vend_id_match else str(page_vend)
        tool_outputs.append(get_vendor_detail.invoke({"supplier_id": vid}))
    elif any(w in text for w in ("vendor", "vendors", "supplier", "suppliers")) and not any(
        w in text for w in ("purchase order", "subcontract", "invoice", "bill")
    ):
        from app.ai.lookups import get_vendors

        vtype = ""
        for t in ("material", "subcontractor", "both", "service"):
            if t in text:
                vtype = t
                break
        tool_outputs.append(get_vendors.invoke({"status": "", "vendor_type": vtype, "q": "", "limit": 20}))

    # Items / BOM
    item_id_match = re.search(r"(PROD-[\w-]+|ITEM[_-][\w-]+)", original, re.I)
    page_item = page_context.get("item_id") or (
        page_context.get("entity_id") if page_context.get("entity_type") == "item" else None
    )
    if any(w in text for w in ("bom", "bill of material", "bill of materials", "components of")) and (
        item_id_match or page_item
    ):
        from app.ai.lookups import get_item_bom

        iid = item_id_match.group(1).upper() if item_id_match else str(page_item)
        tool_outputs.append(get_item_bom.invoke({"item_id": iid, "bom_header_id": 0}))
    elif item_id_match or (
        page_item and any(w in text for w in ("this item", "this sku", "current", "detail", "show"))
    ):
        if not any(w in text for w in ("inventory", "stock", "on hand", "sales order", "purchase")):
            from app.ai.lookups import get_item_detail

            iid = item_id_match.group(1).upper() if item_id_match else str(page_item)
            tool_outputs.append(get_item_detail.invoke({"item_id": iid}))
    elif any(w in text for w in ("item master", "items", "sku", "catalog", "assemblies", "raw material")) and not any(
        w in text for w in ("sales order", "purchase order", "line item")
    ):
        from app.ai.lookups import get_items

        tool_outputs.append(
            get_items.invoke(
                {
                    "q": "",
                    "purchase_only": "purchase" in text,
                    "raw_material_only": "raw" in text,
                    "assembly_only": "assembl" in text,
                    "with_bom_only": "bom" in text,
                    "limit": 20,
                }
            )
        )

    # Finance
    if any(w in text for w in ("ar invoice", "accounts receivable", "ar aging")):
        from app.ai.lookups import get_finance_records

        tool_outputs.append(get_finance_records.invoke({"kind": "ar_invoices", "status": "", "limit": 15}))
    if any(w in text for w in ("ap bill", "accounts payable", "ap aging")):
        from app.ai.lookups import get_finance_records

        tool_outputs.append(get_finance_records.invoke({"kind": "ap_bills", "status": "", "limit": 15}))
    if any(w in text for w in ("sales invoice", "customer invoice")):
        from app.ai.lookups import get_finance_records

        tool_outputs.append(get_finance_records.invoke({"kind": "sales_invoices", "status": "", "limit": 15}))
    if any(w in text for w in ("supplier invoice", "vendor invoice", "vendor bill")):
        from app.ai.lookups import get_finance_records

        tool_outputs.append(get_finance_records.invoke({"kind": "supplier_invoices", "status": "", "limit": 15}))
    if any(w in text for w in ("cash management", "check issue", "check deposit", "cash transaction")):
        from app.ai.lookups import get_finance_records

        tool_outputs.append(get_finance_records.invoke({"kind": "cash", "status": "", "limit": 15}))
    if any(w in text for w in ("journal", "general ledger", "chart of account")):
        from app.ai.lookups import get_finance_records

        kind = "accounts" if "chart of account" in text else "journals"
        tool_outputs.append(get_finance_records.invoke({"kind": kind, "status": "", "limit": 15}))

    # Fulfillments / receipts / work centers / warehouses
    if any(w in text for w in ("fulfillment", "shipment", "shipped")):
        from app.ai.lookups import get_fulfillments

        tool_outputs.append(get_fulfillments.invoke({"status": "", "sales_order_id": "", "limit": 15}))
    if any(w in text for w in ("goods receipt", "grn", "receiving")):
        from app.ai.lookups import get_goods_receipts

        tool_outputs.append(get_goods_receipts.invoke({"status": "", "vendor_id": "", "limit": 15}))
    if any(w in text for w in ("work center", "work centres", "work centers")):
        from app.ai.lookups import get_work_centers

        tool_outputs.append(get_work_centers.invoke({"active_only": "inactive" not in text, "limit": 20}))
    if any(w in text for w in ("warehouse", "warehouses", "bins")) and "stock" not in text:
        from app.ai.lookups import get_warehouses

        tool_outputs.append(get_warehouses.invoke({}))

    # Inventory
    if any(w in text for w in ("inventory", "stock", "on hand", "atp")) and "warehouse" not in text:
        from app.ai.tools import get_inventory_levels

        sku_match = re.search(r"(PROD-[\w-]+|ITEM[_-][\w-]+)", original, re.I)
        sku = sku_match.group(1).upper() if sku_match else ""
        tool_outputs.append(get_inventory_levels.invoke({"item_sku": sku}))

    # Purchase order detail from page or explicit ID
    po_match = re.search(r"(PO-[\w-]+)", original, re.I)
    page_po = page_context.get("purchase_order_id")
    if po_match or (
        page_po
        and page_context.get("entity_type") == "purchase_order"
        and any(w in text for w in ("this order", "this po", "current", "status", "detail", "show"))
        and "create" not in text
        and "like" not in text
    ):
        from app.ai.tools import get_purchase_order_detail

        oid = po_match.group(1) if po_match else str(page_po)
        # Skip detail-only fetch when this is clearly a create-from-template request
        if not (any(w in text for w in ("create", "draft", "clone", "like", "copy")) and po_match):
            tool_outputs.append(get_purchase_order_detail.invoke({"po_number": oid}))

    # Sales order detail from page or explicit ID
    so_match = re.search(r"(SO-[\w-]+)", original, re.I)
    page_so = page_context.get("sales_order_id") or (
        page_context.get("entity_id") if page_context.get("entity_type") == "sales_order" else None
    )
    if so_match or (
        page_so
        and any(w in text for w in ("this order", "current", "status", "detail"))
        and "purchase" not in text
        and "subcontract" not in text
    ):
        from app.ai.tools import get_sales_order_detail

        oid = so_match.group(1) if so_match else str(page_so)
        tool_outputs.append(get_sales_order_detail.invoke({"order_id": oid}))

    # Subcontract order detail from page or explicit ID
    sco_match = re.search(r"(SCO-[\w-]+)", original, re.I)
    page_sco = page_context.get("subcontract_order_id") or (
        page_context.get("entity_id") if page_context.get("entity_type") == "subcontract_order" else None
    )
    if sco_match or (
        page_sco
        and any(w in text for w in ("this order", "this sco", "current", "status", "detail", "show"))
        and "create" not in text
        and "like" not in text
    ):
        from app.ai.tools import get_subcontract_order_detail

        oid = sco_match.group(1) if sco_match else str(page_sco)
        if not (any(w in text for w in ("create", "draft", "clone", "like", "copy")) and sco_match):
            tool_outputs.append(get_subcontract_order_detail.invoke({"sco_number": oid}))

    # Draft PO create / clone (before generic lists)
    po_create_intent = any(
        w in text
        for w in (
            "create purchase order",
            "create po",
            "draft purchase",
            "draft po",
            "new purchase order",
            "new po",
            "clone po",
            "copy po",
        )
    ) or (
        any(w in text for w in ("create", "draft", "clone", "copy"))
        and any(w in text for w in ("purchase order", "purchase orders", " po ", "po-", "like po"))
    )
    if po_create_intent or (re.search(r"\blike\s+po-", text) and any(w in text for w in ("create", "make", "draft"))):
        from app.ai.tools import propose_draft_purchase_order

        template_m = re.search(r"(?:like|from|clone(?:d)?\s+from|copy(?:ing)?\s+from)\s+(PO-[\w-]+)", original, re.I)
        if not template_m:
            template_m = re.search(r"(PO-[\w-]+)", original, re.I) if "like" in text else None
        vendor_m = re.search(r"(SUP-[\w-]+|VEND(?:OR)?-[\w-]+)", original, re.I)
        item_m = re.search(r"(PROD-[\w-]+)", original, re.I)
        qty_m = re.search(r"(\d+)\s*(?:x|units?|pcs|of)?", text, re.I)

        if template_m:
            mult = _parse_qty_multiplier(text)
            tool_outputs.append(
                propose_draft_purchase_order.invoke(
                    {
                        "template_po_number": template_m.group(1).upper(),
                        "quantity_multiplier": mult,
                    }
                )
            )
            pending = _extract_pending(tool_outputs)
            return _format_tool_reply(tool_outputs, pending), pending

        if vendor_m and item_m:
            qty = int(qty_m.group(1)) if qty_m else 1
            items = [{"sku": item_m.group(1).upper(), "quantity": qty}]
            tool_outputs.append(
                propose_draft_purchase_order.invoke(
                    {
                        "supplier_id": vendor_m.group(1).upper(),
                        "items_json": json.dumps(items),
                    }
                )
            )
            pending = _extract_pending(tool_outputs)
            return _format_tool_reply(tool_outputs, pending), pending

        tool_outputs.append(
            json.dumps(
                {
                    "hint": "To create a draft purchase order, either "
                    "(1) say 'create PO like PO-XXXX with x 100' to clone a template, or "
                    "(2) include supplier_id (e.g. SUP-…) and item SKU (e.g. PROD-1001G)."
                }
            )
        )

    # Draft subcontract order create / clone
    sco_create_intent = any(
        w in text
        for w in (
            "create subcontract",
            "create sco",
            "draft subcontract",
            "draft sco",
            "new subcontract",
            "new sco",
            "clone sco",
            "copy sco",
        )
    ) or (
        any(w in text for w in ("create", "draft", "clone", "copy", "make"))
        and any(w in text for w in ("subcontract", "sco-", "like sco"))
    )
    if sco_create_intent or (re.search(r"\blike\s+sco-", text) and any(w in text for w in ("create", "make", "draft"))):
        from app.ai.tools import propose_draft_subcontract_order

        template_m = re.search(
            r"(?:like|from|clone(?:d)?\s+from|copy(?:ing)?\s+from)\s+(SCO-[\w-]+)",
            original,
            re.I,
        )
        if not template_m:
            template_m = re.search(r"(SCO-[\w-]+)", original, re.I) if "like" in text else None
        vendor_m = re.search(r"(SUP-[\w-]+|VEND(?:OR)?-[\w-]+)", original, re.I)
        item_m = re.search(r"(PROD-[\w-]+)", original, re.I)
        qty_m = re.search(r"(?:qty|quantity)\s*[:=]?\s*(\d+)", text, re.I)

        if template_m:
            mult = _parse_qty_multiplier(text)
            tool_outputs.append(
                propose_draft_subcontract_order.invoke(
                    {
                        "template_sco_number": template_m.group(1).upper(),
                        "quantity_multiplier": mult,
                    }
                )
            )
            pending = _extract_pending(tool_outputs)
            return _format_tool_reply(tool_outputs, pending), pending

        if vendor_m and item_m:
            qty = int(qty_m.group(1)) if qty_m else 1
            tool_outputs.append(
                propose_draft_subcontract_order.invoke(
                    {
                        "supplier_id": vendor_m.group(1).upper(),
                        "item_id": item_m.group(1).upper(),
                        "quantity_ordered": qty,
                    }
                )
            )
            pending = _extract_pending(tool_outputs)
            return _format_tool_reply(tool_outputs, pending), pending

        tool_outputs.append(
            json.dumps(
                {
                    "hint": "To create a subcontract order, either "
                    "(1) say 'create Subcontract Order like SCO-XXXX with x 2' to clone a template, or "
                    "(2) include supplier_id (e.g. SUP-…), assembly item_id (e.g. PROD-1020G), and quantity."
                }
            )
        )

    # Draft sales order create proposal
    if (
        any(w in text for w in ("create", "draft", "new sales order", "place order"))
        and not po_create_intent
        and not sco_create_intent
    ):
        from app.ai.tools import propose_draft_sales_order

        cust_m = re.search(r"(CUST-[\w-]+)", original, re.I)
        item_m = re.search(r"(PROD-[\w-]+)", original, re.I)
        qty_m = re.search(r"(\d+)\s*(?:x|units?|pcs|of)?", text, re.I)
        if cust_m and item_m:
            qty = int(qty_m.group(1)) if qty_m else 1
            items = [{"item_id": item_m.group(1).upper(), "quantity": qty}]
            tool_outputs.append(
                propose_draft_sales_order.invoke(
                    {
                        "customer_id": cust_m.group(1).upper(),
                        "items_json": json.dumps(items),
                        "customer_po_number": "AI-DRAFT",
                    }
                )
            )
            pending = _extract_pending(tool_outputs)
            return _format_tool_reply(tool_outputs, pending), pending
        if "sales" in text or "customer" in text:
            tool_outputs.append(
                json.dumps(
                    {
                        "hint": "To create a draft sales order, include customer_id (e.g. CUST-GTT-USA) "
                        "and item SKU (e.g. PROD-1001G), optionally a quantity."
                    }
                )
            )

    # Purchase order list
    if any(w in text for w in ("purchase order", "purchase orders", "list po", "pos for", "vendor po")):
        from app.ai.tools import get_purchase_orders

        status = ""
        for s in ("Draft", "Submitted", "Approved", "Void"):
            if s.lower() in text:
                status = s
                break
        vendor = ""
        vm = re.search(r"(SUP-[\w-]+|VEND(?:OR)?-[\w-]+)", original, re.I)
        if vm:
            vendor = vm.group(1).upper()
        tool_outputs.append(
            get_purchase_orders.invoke({"vendor_id": vendor, "status": status, "limit": 15})
        )

    # Subcontract order list
    if any(
        w in text
        for w in ("subcontract order", "subcontract orders", "list sco", "scos for", "list subcontract")
    ):
        from app.ai.tools import get_subcontract_orders

        status = ""
        for s in ("PLANNED", "ISSUED", "PARTIALLY_ISSUED", "COMPLETED", "CANCELLED"):
            if s.lower() in text:
                status = s
                break
        vendor = ""
        vm = re.search(r"(SUP-[\w-]+|VEND(?:OR)?-[\w-]+)", original, re.I)
        if vm:
            vendor = vm.group(1).upper()
        tool_outputs.append(
            get_subcontract_orders.invoke({"vendor_id": vendor, "status": status, "limit": 15})
        )

    # Sales order list
    if any(w in text for w in ("sales order", "sales orders", "list order", "orders for")) or (
        "order" in text
        and "inventory" not in text
        and "purchase" not in text
        and "subcontract" not in text
        and not tool_outputs
    ):
        from app.ai.tools import get_sales_orders

        status = ""
        for s in ("DRAFT", "SUBMITTED", "APPROVED", "CANCELLED"):
            if s.lower() in text:
                status = s
                break
        cust = ""
        cm = re.search(r"(CUST-[\w-]+)", original, re.I)
        if cm:
            cust = cm.group(1).upper()
        tool_outputs.append(
            get_sales_orders.invoke({"customer_id": cust, "status": status, "limit": 15})
        )

    if not tool_outputs:
        from app.ai.tools import search_erp_knowledge

        tool_outputs.append(search_erp_knowledge.invoke({"query": message}))

    pending = _extract_pending(tool_outputs)
    return _format_tool_reply(tool_outputs, pending), pending


def _run_llm_agent(message: str, conversation_id: str, page_context: dict[str, Any] | None) -> tuple[str, dict[str, Any] | None]:
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
    from langchain_openai import ChatOpenAI
    from langgraph.prebuilt import create_react_agent

    settings = get_settings()
    llm = ChatOpenAI(
        api_key=settings.openai_api_key,
        model=settings.openai_model,
        temperature=0.2,
    )
    agent = create_react_agent(llm, ERP_TOOLS)

    page_note = ""
    if page_context:
        page_note = f"\nCurrent page context: {json.dumps(page_context, default=str)}"

    messages: list[Any] = [SystemMessage(content=SYSTEM_PROMPT + page_note)]
    for turn in _history(conversation_id)[-12:]:
        if turn["role"] == "user":
            messages.append(HumanMessage(content=turn["content"]))
        else:
            messages.append(AIMessage(content=turn["content"]))
    messages.append(HumanMessage(content=message))

    result = agent.invoke({"messages": messages})
    out_messages = result.get("messages") or []
    tool_outputs: list[str] = []
    final_text = ""
    for msg in out_messages:
        if isinstance(msg, ToolMessage):
            tool_outputs.append(str(msg.content))
        if isinstance(msg, AIMessage) and msg.content:
            final_text = msg.content if isinstance(msg.content, str) else str(msg.content)

    pending = _extract_pending(tool_outputs)
    preformatted = next(
        (
            out
            for out in reversed(tool_outputs)
            if _is_preformatted_lookup(out)
        ),
        None,
    )
    if preformatted:
        final_text = preformatted
    if not final_text:
        final_text = "I looked that up, but have nothing further to add."
    return final_text, pending


def run_chat(
    *,
    message: str,
    conversation_id: str | None,
    page_context: dict[str, Any] | None,
) -> dict[str, Any]:
    cid = conversation_id or str(uuid4())
    settings = get_settings()
    try:
        if _is_count_question(message):
            reply, pending = _answer_count_question(message), None
        elif _is_period_question(message):
            reply, pending = _answer_period_question(message), None
        elif settings.openai_api_key:
            reply, pending = _run_llm_agent(message, cid, page_context)
        else:
            reply, pending = _run_heuristic(message, page_context)
    except Exception as exc:
        logger.exception("AI chat failed")
        reply = f"Sorry — the assistant hit an error: {exc}"
        pending = None

    _append(cid, "user", message)
    _append(cid, "assistant", reply)
    return {
        "conversation_id": cid,
        "reply": reply,
        "pending_action": pending,
    }
