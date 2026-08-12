"""LangChain tools that wrap live ERP database lookups and write proposals."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import uuid4

from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.ai.context import get_ai_context
from app.ai.pending_actions import create_pending_action
from app.deps.auth import user_is_admin, user_permission_codes
from app.models import Customer, CustomerLocation, Item, SalesOrder, User
from app.services.inventory import list_stock_overview


def _require_perm(user: User, code: str) -> str | None:
    if user_is_admin(user):
        return None
    if code not in user_permission_codes(user):
        return f"Permission denied: missing '{code}'"
    return None


def _json(data: Any) -> str:
    return json.dumps(data, default=str, indent=2)


@tool
def get_sales_orders(customer_id: str = "", status: str = "", limit: int = 20) -> str:
    """List sales orders, optionally filtered by customer_id and/or status (DRAFT, SUBMITTED, APPROVED, CANCELLED)."""
    ctx = get_ai_context()
    denied = _require_perm(ctx.user, "sales_order:view")
    if denied:
        return denied

    q = ctx.db.query(SalesOrder)
    if customer_id.strip():
        q = q.filter(SalesOrder.customer_id == customer_id.strip())
    if status.strip():
        q = q.filter(SalesOrder.status == status.strip().upper())
    orders = q.order_by(SalesOrder.created_at.desc()).limit(max(1, min(limit, 50))).all()
    rows = [
        {
            "sales_order_id": o.sales_order_id,
            "customer_id": o.customer_id,
            "status": o.status,
            "approval_status": o.approval_status,
            "total_amount": o.total_amount,
            "order_date": o.order_date,
            "customer_po_number": o.customer_po_number,
        }
        for o in orders
    ]
    return _json({"count": len(rows), "orders": rows})


@tool
def get_sales_order_detail(order_id: str) -> str:
    """Get one sales order by ID, including line items."""
    ctx = get_ai_context()
    denied = _require_perm(ctx.user, "sales_order:view")
    if denied:
        return denied

    order = ctx.db.get(SalesOrder, order_id.strip())
    if not order:
        return _json({"error": f"Sales order '{order_id}' not found"})
    return _json(
        {
            "sales_order_id": order.sales_order_id,
            "customer_id": order.customer_id,
            "status": order.status,
            "approval_status": order.approval_status,
            "total_amount": order.total_amount,
            "order_date": order.order_date,
            "bill_to_location_id": order.bill_to_location_id,
            "ship_to_location_id": order.ship_to_location_id,
            "customer_po_number": order.customer_po_number,
            "items": [
                {
                    "line_number": i.line_number,
                    "item_id": i.item_id,
                    "quantity_ordered": i.quantity_ordered,
                    "unit_price": i.unit_price,
                    "total_amount": i.total_amount,
                }
                for i in (order.items or [])
            ],
        }
    )


@tool
def get_inventory_levels(item_sku: str = "") -> str:
    """Get inventory stock levels. Pass item_sku (internal item_id) to filter one SKU, or omit for a summary of all."""
    ctx = get_ai_context()
    overview = list_stock_overview(ctx.db)
    if item_sku.strip():
        sku = item_sku.strip().upper()
        overview = [r for r in overview if r.item_id.upper() == sku]
        if not overview:
            # soft match
            overview = [r for r in list_stock_overview(ctx.db) if sku in r.item_id.upper()]
    rows = [
        {
            "item_id": r.item_id,
            "description": r.description,
            "on_hand": r.on_hand_quantity,
            "allocated": r.allocated_quantity,
            "on_order": r.on_order_quantity,
            "atp": r.available_to_promise,
            "status": r.status,
            "warehouse": r.primary_warehouse_code,
            "bin": r.primary_bin_code,
        }
        for r in overview[:40]
    ]
    return _json({"count": len(rows), "stock": rows})


@tool
def search_erp_knowledge(query: str) -> str:
    """Search ERP documentation and schema knowledge for how modules, statuses, and workflows work."""
    from app.ai.rag import search_knowledge

    hits = search_knowledge(query, k=4)
    if not hits:
        return _json({"results": [], "note": "Knowledge base empty — run ingest script or restart API."})
    return _json({"results": hits})


@tool
def propose_draft_sales_order(
    customer_id: str,
    items_json: str,
    customer_po_number: str = "AI-DRAFT",
    sales_order_id: str = "",
) -> str:
    """Propose creating a DRAFT sales order. Does NOT write until the user confirms in the UI.

    items_json must be a JSON array like:
    [{"item_id":"PROD-1001G","quantity":2,"unit_price":10.5}]
    Bill-to / ship-to locations are auto-selected from the customer when possible.
    """
    ctx = get_ai_context()
    denied = _require_perm(ctx.user, "sales_order:create")
    if denied:
        return denied

    customer = ctx.db.get(Customer, customer_id.strip())
    if not customer:
        return _json({"error": f"Customer '{customer_id}' not found"})

    try:
        raw_items = json.loads(items_json)
    except json.JSONDecodeError:
        return _json({"error": "items_json must be valid JSON array"})

    if not isinstance(raw_items, list) or not raw_items:
        return _json({"error": "items_json must be a non-empty array"})

    locations = (
        ctx.db.query(CustomerLocation)
        .filter(CustomerLocation.customer_id == customer_id.strip())
        .all()
    )
    bill = next((l for l in locations if l.location_type in ("BILL_TO", "BOTH")), None)
    ship = next((l for l in locations if l.location_type in ("SHIP_TO", "BOTH")), None)
    if not bill or not ship:
        return _json(
            {
                "error": "Customer is missing BILL_TO/SHIP_TO locations",
                "locations": [
                    {"location_id": l.location_id, "type": l.location_type} for l in locations
                ],
            }
        )

    line_items = []
    total = Decimal("0.00")
    for idx, row in enumerate(raw_items, start=1):
        item_id = str(row.get("item_id", "")).strip()
        qty = int(row.get("quantity") or row.get("quantity_ordered") or 0)
        if not item_id or qty <= 0:
            return _json({"error": f"Invalid line {idx}: need item_id and positive quantity"})
        catalog = ctx.db.get(Item, item_id)
        if not catalog:
            return _json({"error": f"Item '{item_id}' not found"})
        unit_price = Decimal(str(row.get("unit_price") if row.get("unit_price") is not None else (catalog.unit_price or 0)))
        line_total = (unit_price * qty).quantize(Decimal("0.01"))
        total += line_total
        line_items.append(
            {
                "line_number": idx,
                "item_id": item_id,
                "quantity_ordered": qty,
                "unit_price": str(unit_price),
                "tax_amount": "0.00",
                "total_amount": str(line_total),
            }
        )

    so_id = sales_order_id.strip() or f"SO-AI-{uuid4().hex[:8].upper()}"
    payload = {
        "sales_order_id": so_id,
        "customer_id": customer_id.strip(),
        "bill_to_location_id": bill.location_id,
        "ship_to_location_id": ship.location_id,
        "customer_po_number": customer_po_number.strip() or "AI-DRAFT",
        "po_revision_number": 0,
        "order_date": date.today().isoformat(),
        "currency": "USD",
        "status": "DRAFT",
        "total_amount": str(total),
        "items": line_items,
    }
    summary = (
        f"Create draft sales order {so_id} for customer {customer_id} "
        f"({len(line_items)} line(s), total ${total})"
    )
    action = create_pending_action(
        user_id=str(ctx.user.id),
        action_type="create_draft_sales_order",
        summary=summary,
        payload=payload,
    )
    return _json(
        {
            "pending_confirmation": True,
            "action_id": action.action_id,
            "action_type": action.action_type,
            "summary": summary,
            "payload": payload,
        }
    )


def execute_confirmed_action(db: Session, user: User, action_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Execute a previously confirmed write action."""
    if action_type == "create_draft_sales_order":
        denied = _require_perm(user, "sales_order:create")
        if denied:
            raise PermissionError(denied)
        from app.routers.sales_orders import create_sales_order
        from app.schemas import SalesOrderCreate

        create_payload = SalesOrderCreate.model_validate(payload)
        order = create_sales_order(create_payload, db)
        return {
            "sales_order_id": order.sales_order_id,
            "status": order.status,
            "total_amount": order.total_amount,
            "customer_id": order.customer_id,
        }
    raise ValueError(f"Unsupported action type: {action_type}")


ERP_TOOLS = [
    get_sales_orders,
    get_sales_order_detail,
    get_inventory_levels,
    search_erp_knowledge,
    propose_draft_sales_order,
]
