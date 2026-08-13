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
You help authenticated users look up sales orders, purchase orders, subcontract orders, inventory, and ERP process docs.
You can propose creating a DRAFT sales order, DRAFT purchase order, or subcontract order, but never claim it was created until the user confirms.

Rules:
- Prefer tools for live data over guessing.
- Respect RBAC: if a tool returns permission denied, explain clearly.
- Use page_context when the user says "this order" or "current page".
- Keep answers concise and use Markdown (tables when helpful).
- When propose_draft_sales_order, propose_draft_purchase_order, or propose_draft_subcontract_order returns pending_confirmation, tell the user a confirmation dialog will appear — do not invent an order ID beyond the proposed payload.
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


def _format_tool_reply(tool_outputs: list[str], pending: dict[str, Any] | None) -> str:
    reply_parts = [
        "*(Running in local tool mode — set OPENAI_API_KEY for full LLM reasoning.)*",
        "",
    ]
    for out in tool_outputs:
        try:
            data = json.loads(out)
            reply_parts.append("```json")
            reply_parts.append(json.dumps(data, indent=2, default=str))
            reply_parts.append("```")
        except json.JSONDecodeError:
            reply_parts.append(out)
    if pending:
        reply_parts.append("")
        reply_parts.append(f"**Action requires confirmation:** {pending.get('summary')}")
    return "\n".join(reply_parts)


def _parse_qty_multiplier(text: str) -> float:
    """Parse 'x 100', '×100', '* 100', or trailing quantity for clone scale."""
    m = re.search(r"(?:x|×|\*)\s*(\d+(?:\.\d+)?)", text, re.I)
    if m:
        return float(m.group(1))
    m = re.search(r"(?:qty|quantity)\s*[:=]?\s*(\d+(?:\.\d+)?)", text, re.I)
    if m:
        return float(m.group(1))
    return 1.0


def _run_heuristic(message: str, page_context: dict[str, Any] | None) -> tuple[str, dict[str, Any] | None]:
    """Tool router used when OpenAI is not configured."""
    text = message.lower()
    original = message
    tool_outputs: list[str] = []
    page_context = page_context or {}

    # Knowledge / how-to
    if any(w in text for w in ("how", "what is", "explain", "workflow", "approval", "permission")):
        from app.ai.tools import search_erp_knowledge

        tool_outputs.append(search_erp_knowledge.invoke({"query": message}))

    # Inventory
    if any(w in text for w in ("inventory", "stock", "on hand", "atp", "warehouse")):
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
        if settings.openai_api_key:
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
