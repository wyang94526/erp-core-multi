# @author: Wendy Yang
# @date: 2026-09-19

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
- For "… by month" / "… by quarter" / "… by week" totals (sales, revenue, expenses, profit, purchases, invoices, material issues, SCO, AP, AR, cash), ALWAYS call get_orders_by_month. "show materials issues by week" → kind=material_issues. "compare revenue by quarter" → kind=gl_revenue. "show me purchasing vs sales by month" / "purchasing vs sales in September 2026" → kind=sales_vs_purchases (both series, not a PO-only list). Never use search_erp_knowledge or get_financial_report for those.
- Use get_customers / get_customer_detail, get_vendors / get_vendor_detail, get_items / get_item_detail / get_item_bom for master data.
- For Income Statement / P&L, revenue for a month, Balance Sheet, Cash Flow, Trial Balance, or AR/AP aging, ALWAYS call get_financial_report. Pass question= the user wording. "Show me the Income Statement for the month June 2026" → report_type=income-statement, period=2026-06. "Show me the revenue for September 2027" → report_type=income-statement, period=2027-09. Copy the Markdown table verbatim — never search_erp_knowledge for statements.
- Use get_finance_records only to list recent AR/AP/invoices/cash/journals/accounts (not monthly totals or statements).
- For "unbilled goods receipts ready to invoice" / "receipts ready to bill", ALWAYS call get_goods_receipts with unbilled_only=true (or question= the user wording). Do not list all recent GRNs.
- For "list the qty received by purchase order" / "quantity received per PO", ALWAYS call get_received_qty_by_purchase_order. Do not use get_purchase_orders (that lists dollar amounts, not received qty).
- For "show me unpaid invoices" / "outstanding invoices" / "unpaid vendor bills", ALWAYS call get_unpaid_invoices. Do not use get_finance_records (that lists recent invoices including paid) and do not treat it as out of scope.
- For "show me invoice status" / "invoices by status" / "invoice status for 09/2026", ALWAYS call get_invoice_status. Pass question= so MM/YYYY or September 2026 filters sales issue date and supplier invoice date. Do not treat it as out of scope.
- For "show me invoices due in October 2026" / "inovice due in October 2026", ALWAYS call get_invoice_status (due-date filter). Do not call get_financial_report.
- For "show me invoices billed in October 2026" / "inovice billed in October 2026 for vendor Accelerate Global Solution", ALWAYS call get_invoice_status (issue/invoice date, optional party name). Do not treat it as out of scope.
- For other transactional lists with a month or party — purchase orders, sales orders, subcontract orders, goods receipts, fulfillments, payments, journals, material issues — ALWAYS call get_transactions. Pass question=. "show me purchase orders in October 2026 for vendor Accelerate Global Solution" is a PO list, not a P&L and not out of scope.
- For "current closing period" / "soft close" / "hard close" / "period lock date", ALWAYS call get_closing_period. This is Finance → Period Management, not an out-of-scope question.
- For "Posting rule for Month End Close" / "year-end close posting rules" / "list posting rules", ALWAYS call get_posting_rules. Do not treat this as out of scope.
- For "products under inventory threshold" / "below reorder point" / "reorder alerts", ALWAYS call get_inventory_levels with below_threshold=true (or question= the user wording). Do not list every SKU.
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
- For "create a sales order like PU61-XXXX / SO-XXXX with 2x quantity", call propose_draft_sales_order with template_so_number= that ID and quantity_multiplier=N. Do not list sales orders or ask for customer_id/SKU when a template ID is present.
- For "create corresponding subcontract order and purchase order for PU61-XXXX", ALWAYS call propose_orders_from_sales_order with sales_order_id= that SO. Do not list recent POs/SCOs or ask for supplier_id. The parent SO must be approved; if it is still Draft, explain that and show the planned assembly/kit.
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
    if "| Account |" in text and re.search(r"\|[-: ]+\|", text):
        return True
    if stripped.startswith("Live counts from"):
        return True
    if re.match(r"\*\*\d+", stripped):
        return True
    return False


ERP_SCOPE_REPLY = (
    "I can only look up **GTT-USA ERP** data — customers, vendors, items, orders, "
    "inventory, journals, and financial reports. I don't have weather, news, or other "
    "outside information.\n\n"
    "Try “P&L for September 2026”, “how many open purchase orders?”, or “how do I create a PO?”."
)

_OUT_OF_SCOPE_RE = re.compile(
    r"\b("
    r"weather|temperature|humidity|rainfall|precipitation|typhoon|"
    r"horoscope|lottery|recipe|sports score"
    r")\b",
    re.I,
)


def _format_knowledge_hits(hits: list[Any]) -> str:
    parts = ["Here is what the ERP process docs say:", ""]
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        source = str(hit.get("source") or "docs")
        content = str(hit.get("content") or "").strip()
        if not content:
            continue
        if len(content) > 700:
            content = content[:700].rstrip() + "…"
        parts.append(f"**{source}**")
        parts.append(content)
        parts.append("")
    return "\n".join(parts).strip() or ERP_SCOPE_REPLY


def _format_tool_reply(tool_outputs: list[str], pending: dict[str, Any] | None) -> str:
    from app.ai.lookups import (
        format_count_answer,
        format_goods_receipts_answer,
        format_inventory_answer,
        format_period_answer,
        format_po_received_qty_answer,
        format_purchase_orders_answer,
        format_unpaid_invoices_answer,
        format_invoice_status_answer,
        format_closing_period_answer,
        format_posting_rules_answer,
    )

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
        elif isinstance(data, dict) and "results" in data and "orders" not in data:
            hits = data.get("results") or []
            reply_parts.append(_format_knowledge_hits(hits) if hits else ERP_SCOPE_REPLY)
        elif isinstance(data, dict) and "receipts" in data:
            reply_parts.append(format_goods_receipts_answer(out))
        elif isinstance(data, dict) and "stock" in data:
            reply_parts.append(format_inventory_answer(out))
        elif isinstance(data, dict) and data.get("received_by_po"):
            reply_parts.append(format_po_received_qty_answer(out))
        elif isinstance(data, dict) and data.get("unpaid_invoices"):
            reply_parts.append(format_unpaid_invoices_answer(out))
        elif isinstance(data, dict) and data.get("invoice_status"):
            reply_parts.append(format_invoice_status_answer(out))
        elif isinstance(data, dict) and data.get("transactions"):
            from app.ai.lookups import format_transactions_answer

            reply_parts.append(format_transactions_answer(out))
        elif isinstance(data, dict) and data.get("closing_period"):
            reply_parts.append(format_closing_period_answer(out))
        elif isinstance(data, dict) and data.get("posting_rules"):
            reply_parts.append(format_posting_rules_answer(out))
        elif isinstance(data, dict) and (
            data.get("overdue") is True
            or (
                isinstance(data.get("orders"), list)
                and data.get("orders")
                and isinstance(data["orders"][0], dict)
                and data["orders"][0].get("po_number")
            )
        ):
            reply_parts.append(format_purchase_orders_answer(out))
        elif isinstance(data, dict) and data.get("pending_confirmation"):
            reply_parts.append(str(data.get("message") or data.get("summary") or "Ready to create."))
        elif isinstance(data, dict) and data.get("message"):
            reply_parts.append(str(data["message"]))
        elif isinstance(data, dict) and data.get("hint"):
            reply_parts.append(str(data["hint"]))
        elif isinstance(data, dict) and data.get("error"):
            reply_parts.append(str(data["error"]))
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


_SO_NUMBER_RE = r"(SO-[\w-]+|PU61-[\w-]+)"
_PO_NUMBER_RE = r"(PO-[\w-]+|PU62-[\w-]+)"
_SCO_NUMBER_RE = r"(SCO-[\w-]+|UP23-[\w-]+)"
_UNSUPPORTED_GL_REPLY = (
    "I can look up posted **net income**, **revenue**, and **operating expenses** "
    "by month or quarter, or a named-month P&L. EBIT, EBITDA, operating profit, "
    "and COGS are not mapped as separate totals in this assistant."
)


def _sales_order_create_source(original: str, text: str) -> str:
    """SO id when the user wants SCO/PO created from that sales order (not clone-like)."""
    if re.search(rf"\blike\s+{_SO_NUMBER_RE}", original, re.I):
        return ""
    so_m = re.search(_SO_NUMBER_RE, original, re.I)
    if not so_m:
        return ""
    if not any(w in text for w in ("create", "draft", "make", "generate")):
        return ""
    wants_docs = any(
        w in text for w in ("subcontract", "sco", "purchase order", "material po")
    ) or bool(re.search(r"\bpurchase\b", text))
    if not wants_docs:
        return ""
    if any(w in text for w in ("corresponding", "linked", "matching")):
        return so_m.group(1).upper()
    if re.search(r"\b(for|from|against)\b", text):
        return so_m.group(1).upper()
    if ("subcontract" in text or "sco" in text) and "purchase" in text:
        return so_m.group(1).upper()
    return ""


def _parse_qty_multiplier(text: str) -> float:
    """Parse 'x 100', '2x', '×100', '* 100', or trailing quantity for clone scale."""
    m = re.search(r"(?:x|×|\*)\s*(\d+(?:\.\d+)?)", text, re.I)
    if m:
        return float(m.group(1))
    m = re.search(r"\b(\d+(?:\.\d+)?)\s*[x×]\b", text, re.I)
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
    ) or bool(
        re.search(
            r"\bcount\b.{0,40}\b(customer|item|bom|vendor|supplier|order|invoice|bill|purchase|po)\b",
            text,
        )
    )


def _answer_count_question(message: str) -> str:
    from app.ai.lookups import format_count_answer, get_erp_counts

    raw = get_erp_counts.invoke({"question": message, "entity": "", "status": ""})
    return format_count_answer(raw)


def _is_period_question(message: str) -> bool:
    from app.ai.lookups import (
        is_monthly_group_question,
        is_period_entity_wording,
        is_sales_vs_purchase_wording,
    )

    if is_sales_vs_purchase_wording(message):
        return True
    return is_monthly_group_question(message) and is_period_entity_wording(message)


def _is_posting_rule_question(message: str) -> bool:
    from app.ai.lookups import is_posting_rule_wording

    return is_posting_rule_wording(message)


def _answer_posting_rule_question(message: str) -> str:
    from app.ai.lookups import get_posting_rules

    return get_posting_rules.invoke({"question": message})


def _is_invoice_status_question(message: str) -> bool:
    from app.ai.lookups import is_invoice_list_wording

    return is_invoice_list_wording(message)


def _is_transaction_list_question(message: str) -> bool:
    from app.ai.lookups import infer_transaction_kind, is_transaction_list_wording

    if infer_transaction_kind(message) == "invoices":
        return False
    return is_transaction_list_wording(message)


def _answer_transaction_list_question(message: str) -> str:
    from app.ai.lookups import get_transactions

    return get_transactions.invoke({"limit": 40, "question": message})


def _answer_invoice_status_question(message: str) -> str:
    from app.ai.lookups import get_invoice_status

    return get_invoice_status.invoke({"limit": 40, "question": message})


def _is_closing_period_question(message: str) -> bool:
    from app.ai.lookups import is_closing_period_wording

    return is_closing_period_wording(message)


def _answer_closing_period_question(message: str) -> str:
    from app.ai.lookups import get_closing_period

    return get_closing_period.invoke({"question": message})


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


def _is_unsupported_gl_question(message: str) -> bool:
    text = (message or "").lower()
    return bool(re.search(r"\b(ebitda|ebit|operating profit|cogs|cost of goods)\b", text))


def _is_howto_question(message: str) -> bool:
    """Process/docs questions. 'what is the expense for September 2026' is a live P&L lookup."""
    if _is_invoice_status_question(message) or _is_transaction_list_question(message):
        return False
    text = (message or "").lower()
    if re.search(
        r"\b(status|balance|credit limit|on hand|atp|unbilled|unpaid|overdue|due|billed|issued|invoiced|closing period|soft close|hard close|posting rule)\b",
        text,
    ):
        return False
    if any(phrase in text for phrase in ("explain", "workflow", "approval", "permission")):
        return True
    if re.search(r"\bhow\s+(do|to|can|does|should|is|are|would)\b", text):
        return True
    if re.search(r"\bwhat(?:'s| is)\b", text):
        from app.ai.lookups import parse_financial_report_period

        if parse_financial_report_period(text) or _is_financial_report_question(message):
            return False
        return True
    return False


def _is_out_of_scope_question(message: str) -> bool:
    """True for weather/news-style asks that are not ERP lookups or statements."""
    if (
        _is_financial_report_question(message)
        or _is_period_question(message)
        or _is_invoice_status_question(message)
        or _is_transaction_list_question(message)
    ):
        return False
    return bool(_OUT_OF_SCOPE_RE.search(message or ""))


def _is_financial_report_question(message: str) -> bool:
    from app.ai.lookups import infer_financial_report_type

    return bool(infer_financial_report_type(message))


def _answer_financial_report_question(message: str) -> str:
    from app.ai.lookups import get_financial_report

    return get_financial_report.invoke(
        {"report_type": "", "period": "", "question": message}
    )


def _run_heuristic(message: str, page_context: dict[str, Any] | None) -> tuple[str, dict[str, Any] | None]:
    """Tool router used when OpenAI is not configured."""
    text = message.lower()
    original = message
    tool_outputs: list[str] = []
    page_context = page_context or {}

    if _is_count_question(message):
        return _answer_count_question(message), None
    if _is_financial_report_question(message):
        return _answer_financial_report_question(message), None
    if _is_period_question(message):
        return _answer_period_question(message), None
    if _is_closing_period_question(message):
        return _answer_closing_period_question(message), None
    if _is_invoice_status_question(message):
        return _answer_invoice_status_question(message), None
    if _is_transaction_list_question(message):
        return _answer_transaction_list_question(message), None
    if _is_posting_rule_question(message):
        return _answer_posting_rule_question(message), None
    if _is_unsupported_gl_question(message):
        return _UNSUPPORTED_GL_REPLY, None
    if _is_out_of_scope_question(message):
        return ERP_SCOPE_REPLY, None

    # Knowledge / how-to. Do not treat the "how" inside "show me …" as a how-to ask.
    if _is_howto_question(message):
        from app.ai.tools import search_erp_knowledge

        tool_outputs.append(search_erp_knowledge.invoke({"query": message}))

    # Customers
    cust_id_match = re.search(r"(CUST-[\w-]+|[A-Z]\d{5,})", original, re.I)
    page_cust = page_context.get("customer_id") or (
        page_context.get("entity_id") if page_context.get("entity_type") == "customer" else None
    )
    if cust_id_match or (
        page_cust
        and any(w in text for w in ("this customer", "current customer", "current page"))
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
    if vend_id_match or (
        page_vend
        and any(w in text for w in ("this vendor", "this supplier", "current vendor", "current supplier"))
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
    item_id_match = re.search(r"(PROD-[\w-]+|ITEM[_-][\w-]+|\d{3,}[A-Z][A-Z0-9-]{4,})", original, re.I)
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
        page_item and any(w in text for w in ("this item", "this sku", "current item", "current sku"))
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
    from app.ai.lookups import (
        is_closing_period_wording,
        is_invoice_list_wording,
        is_unpaid_invoice_wording,
    )

    if is_closing_period_wording(original):
        return _answer_closing_period_question(original), None
    if is_unpaid_invoice_wording(original):
        from app.ai.lookups import get_unpaid_invoices

        return get_unpaid_invoices.invoke({"limit": 40, "question": original}), None
    if is_invoice_list_wording(original):
        return _answer_invoice_status_question(original), None
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
    if any(w in text for w in ("goods receipt", "grn", "receiving")) or (
        "receipt" in text and ("unbilled" in text or "ready to invoice" in text or "ready to bill" in text)
    ):
        from app.ai.lookups import get_goods_receipts

        tool_outputs.append(
            get_goods_receipts.invoke(
                {
                    "status": "",
                    "vendor_id": "",
                    "limit": 20,
                    "unbilled_only": False,
                    "question": original,
                }
            )
        )
    if any(w in text for w in ("work center", "work centres", "work centers")):
        from app.ai.lookups import get_work_centers

        tool_outputs.append(get_work_centers.invoke({"active_only": "inactive" not in text, "limit": 20}))

    # Inventory
    if any(
        w in text
        for w in (
            "inventory",
            "stock",
            "on hand",
            "atp",
            "reorder",
            "threshold",
        )
    ):
        from app.ai.tools import get_inventory_levels

        sku_match = re.search(
            r"(PROD-[\w-]+|ITEM[_-][\w-]+|\d{3,}[A-Z][A-Z0-9-]{4,})",
            original,
            re.I,
        )
        sku = sku_match.group(1).upper() if sku_match else ""
        tool_outputs.append(
            get_inventory_levels.invoke(
                {
                    "item_sku": sku,
                    "below_threshold": False,
                    "status": "",
                    "question": original,
                }
            )
        )
    if any(w in text for w in ("warehouse", "warehouses", "bins")):
        from app.ai.lookups import get_warehouses

        tool_outputs.append(get_warehouses.invoke({}))

    # Purchase order detail from page or explicit ID
    po_match = re.search(_PO_NUMBER_RE, original, re.I)
    page_po = page_context.get("purchase_order_id")
    if po_match or (
        page_po
        and page_context.get("entity_type") == "purchase_order"
        and any(w in text for w in ("this order", "this po", "current order", "current po"))
        and "create" not in text
        and "like" not in text
    ):
        from app.ai.tools import get_purchase_order_detail

        oid = po_match.group(1) if po_match else str(page_po)
        # Skip detail-only fetch when this is clearly a create-from-template request
        if not (any(w in text for w in ("create", "draft", "clone", "like", "copy")) and po_match):
            tool_outputs.append(get_purchase_order_detail.invoke({"po_number": oid}))

    # Sales order detail from page or explicit ID
    so_match = re.search(_SO_NUMBER_RE, original, re.I)
    page_so = page_context.get("sales_order_id") or (
        page_context.get("entity_id") if page_context.get("entity_type") == "sales_order" else None
    )
    if so_match or (
        page_so
        and any(w in text for w in ("this order", "this so", "current order", "current so"))
        and "purchase" not in text
        and "subcontract" not in text
        and "create" not in text
        and "like" not in text
    ):
        from app.ai.tools import get_sales_order_detail

        oid = so_match.group(1) if so_match else str(page_so)
        if not (any(w in text for w in ("create", "draft", "clone", "like", "copy")) and so_match):
            tool_outputs.append(get_sales_order_detail.invoke({"order_id": oid}))

    # Subcontract order detail from page or explicit ID
    sco_match = re.search(_SCO_NUMBER_RE, original, re.I)
    page_sco = page_context.get("subcontract_order_id") or (
        page_context.get("entity_id") if page_context.get("entity_type") == "subcontract_order" else None
    )
    if sco_match or (
        page_sco
        and any(w in text for w in ("this order", "this sco", "current order", "current sco"))
        and "create" not in text
        and "like" not in text
    ):
        from app.ai.tools import get_subcontract_order_detail

        oid = sco_match.group(1) if sco_match else str(page_sco)
        if not (any(w in text for w in ("create", "draft", "clone", "like", "copy")) and sco_match):
            tool_outputs.append(get_subcontract_order_detail.invoke({"sco_number": oid}))

    # SCO + material PO from a sales order (before generic create hints / lists)
    from_so_id = _sales_order_create_source(original, text)
    if from_so_id and not _is_howto_question(message):
        from app.ai.tools import propose_orders_from_sales_order

        wants_po = any(
            w in text for w in ("purchase order", "purchase orders", "material po", " po")
        ) or "purchase" in text
        tool_outputs.append(
            propose_orders_from_sales_order.invoke(
                {
                    "sales_order_id": from_so_id,
                    "create_material_po": wants_po or "corresponding" in text,
                }
            )
        )
        pending = _extract_pending(tool_outputs)
        return _format_tool_reply(tool_outputs, pending), pending

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
    if (
        not _is_howto_question(message)
        and (
            po_create_intent
            or (re.search(rf"\blike\s+{_PO_NUMBER_RE}", original, re.I) and any(w in text for w in ("create", "make", "draft")))
        )
    ):
        from app.ai.tools import propose_draft_purchase_order

        template_m = re.search(
            rf"(?:like|from|clone(?:d)?\s+from|copy(?:ing)?\s+from)\s+{_PO_NUMBER_RE}",
            original,
            re.I,
        )
        if not template_m:
            template_m = re.search(_PO_NUMBER_RE, original, re.I) if "like" in text else None
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
    if (
        not _is_howto_question(message)
        and (
            sco_create_intent
            or (re.search(rf"\blike\s+{_SCO_NUMBER_RE}", original, re.I) and any(w in text for w in ("create", "make", "draft")))
        )
    ):
        from app.ai.tools import propose_draft_subcontract_order

        template_m = re.search(
            rf"(?:like|from|clone(?:d)?\s+from|copy(?:ing)?\s+from)\s+{_SCO_NUMBER_RE}",
            original,
            re.I,
        )
        if not template_m:
            template_m = re.search(_SCO_NUMBER_RE, original, re.I) if "like" in text else None
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

    # Draft sales order create / clone (before generic lists)
    so_create_intent = any(
        w in text
        for w in (
            "create sales order",
            "create a sales order",
            "create so",
            "draft sales",
            "draft so",
            "new sales order",
            "new so",
            "clone so",
            "copy so",
            "place order",
        )
    ) or (
        any(w in text for w in ("create", "draft", "clone", "copy", "make"))
        and any(w in text for w in ("sales order", "sales orders", " so ", "so-", "pu61-", "like so", "like pu61"))
    )
    if (
        not _is_howto_question(message)
        and (
            so_create_intent
            or (re.search(rf"\blike\s+{_SO_NUMBER_RE}", original, re.I) and any(w in text for w in ("create", "make", "draft")))
        )
        and not po_create_intent
        and not sco_create_intent
    ):
        from app.ai.tools import propose_draft_sales_order

        template_m = re.search(
            rf"(?:like|from|clone(?:d)?\s+from|copy(?:ing)?\s+from)\s+{_SO_NUMBER_RE}",
            original,
            re.I,
        )
        if not template_m:
            template_m = re.search(_SO_NUMBER_RE, original, re.I) if "like" in text else None
        cust_m = re.search(r"(CUST-[\w-]+)", original, re.I)
        item_m = re.search(r"(PROD-[\w-]+)", original, re.I)
        qty_m = re.search(r"(\d+)\s*(?:x|units?|pcs|of)?", text, re.I)

        if template_m:
            mult = _parse_qty_multiplier(text)
            tool_outputs.append(
                propose_draft_sales_order.invoke(
                    {
                        "template_so_number": template_m.group(1).upper(),
                        "quantity_multiplier": mult,
                    }
                )
            )
            pending = _extract_pending(tool_outputs)
            return _format_tool_reply(tool_outputs, pending), pending

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

        tool_outputs.append(
            json.dumps(
                {
                    "hint": "To create a draft sales order, either "
                    "(1) say 'create a sales order like PU61-XXXX with 2x quantity' to clone a template, or "
                    "(2) include customer_id (e.g. CUST-GTT-USA) and item SKU (e.g. PROD-1001G)."
                }
            )
        )

    # Posted received qty grouped by PO (before the dollar PO list)
    from app.ai.lookups import is_received_qty_by_po_wording

    if is_received_qty_by_po_wording(original):
        from app.ai.lookups import get_received_qty_by_purchase_order

        return (
            get_received_qty_by_purchase_order.invoke({"limit": 40, "question": original}),
            None,
        )

    # Purchase order list
    if any(w in text for w in ("purchase order", "purchase orders", "list po", "pos for", "vendor po")) or (
        "overdue" in text and re.search(r"\bpos?\b", text)
    ):
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
            get_purchase_orders.invoke(
                {
                    "vendor_id": vendor,
                    "status": status,
                    "limit": 15,
                    "overdue": "overdue" in text,
                }
            )
        )

    # Subcontract order list
    waiting_materials = bool(re.search(r"waiting (on|for) materials", text))
    if waiting_materials or any(
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
        if waiting_materials and not status:
            for wait_status in ("PLANNED", "PARTIALLY_ISSUED"):
                tool_outputs.append(
                    get_subcontract_orders.invoke(
                        {"vendor_id": vendor, "status": wait_status, "limit": 15}
                    )
                )
        else:
            tool_outputs.append(
                get_subcontract_orders.invoke({"vendor_id": vendor, "status": status, "limit": 15})
            )

    # Sales order list
    if not so_create_intent and (
        any(w in text for w in ("sales order", "sales orders", "list order", "orders for"))
        or (
            "order" in text
            and "inventory" not in text
            and "purchase" not in text
            and "subcontract" not in text
            and not tool_outputs
        )
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

    if "finished goods" in text:
        from app.ai.lookups import get_goods_receipts

        tool_outputs.append(
            get_goods_receipts.invoke(
                {
                    "status": "POSTED",
                    "vendor_id": "",
                    "limit": 20,
                    "source_type": "SUBCONTRACT_ORDER",
                    "question": original,
                }
            )
        )

    if re.search(r"\bwhere(?:'s| is)?\b", text) and any(
        w in text for w in ("used", "where-used", "component")
    ):
        from app.ai.lookups import get_item_where_used

        item_m = re.search(r"(PROD-[\w-]+|ITEM[_-][\w-]+|[A-Z0-9]{4,}[A-Z0-9-]*)", original)
        sku = item_m.group(1) if item_m else ""
        if sku:
            tool_outputs.append(get_item_where_used.invoke({"item_id": sku}))

    if "uncleared" in text or "un-cleared" in text:
        from app.ai.lookups import get_finance_records

        tool_outputs.append(get_finance_records.invoke({"kind": "cash", "status": "Uncleared", "limit": 20}))

    if any(w in text for w in ("bank account", "bank accounts", "default bank")):
        from app.ai.lookups import get_finance_records

        tool_outputs.append(
            get_finance_records.invoke(
                {
                    "kind": "bank_accounts",
                    "status": "default" if "default" in text else "",
                    "limit": 20,
                }
            )
        )

    if not tool_outputs:
        return ERP_SCOPE_REPLY, None

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
        elif _is_invoice_status_question(message):
            reply, pending = _answer_invoice_status_question(message), None
        elif _is_period_question(message):
            reply, pending = _answer_period_question(message), None
        elif _is_transaction_list_question(message):
            reply, pending = _answer_transaction_list_question(message), None
        elif _is_financial_report_question(message):
            reply, pending = _answer_financial_report_question(message), None
        elif _is_closing_period_question(message):
            reply, pending = _answer_closing_period_question(message), None
        elif _is_posting_rule_question(message):
            reply, pending = _answer_posting_rule_question(message), None
        elif _is_unsupported_gl_question(message):
            reply, pending = _UNSUPPORTED_GL_REPLY, None
        elif _is_out_of_scope_question(message):
            reply, pending = ERP_SCOPE_REPLY, None
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
