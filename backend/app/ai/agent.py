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
You help authenticated users look up sales orders, inventory, and ERP process docs.
You can propose creating a DRAFT sales order, but never claim it was created until the user confirms.

Rules:
- Prefer tools for live data over guessing.
- Respect RBAC: if a tool returns permission denied, explain clearly.
- Use page_context when the user says "this order" or "current page".
- Keep answers concise and use Markdown (tables when helpful).
- When propose_draft_sales_order returns pending_confirmation, tell the user a confirmation dialog will appear — do not invent an order ID beyond the proposed payload.
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

    # Sales order detail from page or explicit ID
    so_match = re.search(r"(SO-[\w-]+)", original, re.I)
    page_so = page_context.get("sales_order_id") or page_context.get("entity_id")
    if so_match or (page_so and any(w in text for w in ("this order", "current", "status", "detail"))):
        from app.ai.tools import get_sales_order_detail

        oid = so_match.group(1) if so_match else str(page_so)
        tool_outputs.append(get_sales_order_detail.invoke({"order_id": oid}))

    # Draft create proposal (before generic order list so create intent wins)
    if any(w in text for w in ("create", "draft", "new sales order", "place order")):
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
            # Prefer create path over list when proposing
            pending = _extract_pending(tool_outputs)
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
            return "\n".join(reply_parts), pending
        tool_outputs.append(
            json.dumps(
                {
                    "hint": "To create a draft sales order, include customer_id (e.g. CUST-GTT-USA) "
                    "and item SKU (e.g. PROD-1001G), optionally a quantity."
                }
            )
        )

    # Sales order list
    if any(w in text for w in ("sales order", "sales orders", "list order", "orders for")) or (
        "order" in text and "inventory" not in text and not tool_outputs
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
    return "\n".join(reply_parts), pending


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
