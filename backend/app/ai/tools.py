# @author: Wendy Yang
# @date: 2026-09-19

"""LangChain tools that wrap live ERP database lookups and write proposals."""

from __future__ import annotations

import json
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.ai.context import get_ai_context
from app.ai.pending_actions import create_pending_action
from app.deps.auth import user_is_admin, user_permission_codes
from app.models import (
    Customer,
    CustomerLocation,
    Item,
    PurchaseOrder,
    SalesOrder,
    SubcontractOrder,
    Supplier,
    User,
)
from app.ai.lookups import LOOKUP_TOOLS
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
def get_purchase_orders(vendor_id: str = "", status: str = "", limit: int = 20) -> str:
    """List purchase orders, optionally filtered by vendor/supplier_id and/or status (Draft, Submitted, Approved, Void)."""
    ctx = get_ai_context()
    denied = _require_perm(ctx.user, "po:view")
    if denied:
        return denied

    q = ctx.db.query(PurchaseOrder)
    if vendor_id.strip():
        q = q.filter(PurchaseOrder.supplier_id == vendor_id.strip())
    if status.strip():
        # Accept DRAFT/Approved style from users
        st = status.strip()
        q = q.filter(PurchaseOrder.status.ilike(st))
    orders = q.order_by(PurchaseOrder.created_at.desc()).limit(max(1, min(limit, 50))).all()
    rows = [
        {
            "po_number": o.po_number,
            "supplier_id": o.supplier_id,
            "status": o.status,
            "approval_status": o.approval_status,
            "billing_status": getattr(o, "billing_status", None),
            "grand_total": o.grand_total,
            "order_date": o.order_date,
            "payment_terms": o.payment_terms,
        }
        for o in orders
    ]
    return _json({"count": len(rows), "orders": rows})


@tool
def get_purchase_order_detail(po_number: str) -> str:
    """Get one purchase order by PO number, including line items."""
    ctx = get_ai_context()
    denied = _require_perm(ctx.user, "po:view")
    if denied:
        return denied

    from sqlalchemy.orm import joinedload

    order = (
        ctx.db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items))
        .filter(PurchaseOrder.po_number == po_number.strip())
        .first()
    )
    if not order:
        return _json({"error": f"Purchase order '{po_number}' not found"})
    return _json(
        {
            "po_number": order.po_number,
            "supplier_id": order.supplier_id,
            "status": order.status,
            "approval_status": order.approval_status,
            "billing_status": getattr(order, "billing_status", None),
            "order_date": order.order_date,
            "payment_terms": order.payment_terms,
            "incoterms": getattr(order, "incoterms", None),
            "freight_terms": getattr(order, "freight_terms", None),
            "carrier_account": getattr(order, "carrier_account", None),
            "sco_number": getattr(order, "sco_number", None),
            "shipping_fee": order.shipping_fee,
            "subtotal": order.subtotal,
            "total_tax": order.total_tax,
            "grand_total": order.grand_total,
            "notes": order.notes,
            "items": [
                {
                    "item_id": i.item_id,
                    "sku": i.sku,
                    "quantity": i.quantity,
                    "unit_price": i.unit_price,
                    "tax_rate": i.tax_rate,
                    "line_subtotal": i.line_subtotal,
                    "line_tax": i.line_tax,
                    "line_total": i.line_total,
                }
                for i in (order.items or [])
            ],
        }
    )


@tool
def propose_draft_purchase_order(
    supplier_id: str = "",
    items_json: str = "",
    po_number: str = "",
    template_po_number: str = "",
    quantity_multiplier: float = 1.0,
    payment_terms: str = "",
) -> str:
    """Propose creating a DRAFT purchase order. Does NOT write until the user confirms in the UI.

    Provide either:
    - template_po_number: clone an existing PO (optional quantity_multiplier, e.g. 100 for "x 100"), or
    - supplier_id + items_json JSON array like [{"sku":"PROD-1001G","quantity":2,"unit_price":10.5}]

    When cloning, supplier/terms/lines come from the template; quantities are multiplied by quantity_multiplier.
    The PO number is assigned on save as PU62-YYMMXXXX from the order date; do not invent po_number.
    """
    ctx = get_ai_context()
    denied = _require_perm(ctx.user, "po:create")
    if denied:
        return denied

    from sqlalchemy.orm import joinedload
    from app.services.po_totals import vendor_freight

    mult = Decimal(str(quantity_multiplier or 1))
    if mult <= 0:
        return _json({"error": "quantity_multiplier must be positive"})

    line_items: list[dict[str, Any]] = []
    vendor_id = supplier_id.strip()
    terms = payment_terms.strip() or "Net 30"
    shipping_fee = Decimal("0.00")
    discount_type = "percentage"
    discount_value = Decimal("0")
    freight_terms = "PREPAID_ON_PO"
    incoterms = None
    carrier_account = None
    sco_number = None
    notes = "Created via AI assistant"

    template_id = template_po_number.strip()
    if template_id:
        template = (
            ctx.db.query(PurchaseOrder)
            .options(joinedload(PurchaseOrder.items))
            .filter(PurchaseOrder.po_number == template_id)
            .first()
        )
        if not template:
            return _json({"error": f"Template purchase order '{template_id}' not found"})
        vendor_id = template.supplier_id
        terms = template.payment_terms or terms
        shipping_fee = Decimal(str(template.shipping_fee or 0))
        discount_type = template.discount_type or "percentage"
        discount_value = Decimal(str(template.discount_value or 0))
        freight_terms = getattr(template, "freight_terms", None) or "PREPAID_ON_PO"
        incoterms = getattr(template, "incoterms", None)
        carrier_account = getattr(template, "carrier_account", None)
        sco_number = getattr(template, "sco_number", None)
        notes = f"Cloned from {template_id} via AI (qty × {mult})"
        if not template.items:
            return _json({"error": f"Template '{template_id}' has no line items"})
        for row in template.items:
            qty = (Decimal(str(row.quantity)) * mult).quantize(Decimal("0.0001"))
            if qty <= 0:
                return _json({"error": f"Invalid scaled quantity for SKU {row.sku}"})
            unit_price = Decimal(str(row.unit_price or 0))
            tax_rate = Decimal(str(row.tax_rate or 0))
            line_subtotal = (unit_price * qty).quantize(Decimal("0.01"))
            line_tax = (line_subtotal * tax_rate / Decimal("100")).quantize(Decimal("0.01"))
            line_total = (line_subtotal + line_tax).quantize(Decimal("0.01"))
            line_items.append(
                {
                    "sku": row.sku,
                    "quantity": str(qty),
                    "unit_price": str(unit_price),
                    "tax_rate": str(tax_rate),
                    "line_subtotal": str(line_subtotal),
                    "line_tax": str(line_tax),
                    "line_total": str(line_total),
                }
            )
    else:
        if not vendor_id:
            return _json({"error": "supplier_id is required when not cloning a template PO"})
        supplier = ctx.db.get(Supplier, vendor_id)
        if not supplier:
            return _json({"error": f"Supplier/vendor '{vendor_id}' not found"})
        try:
            raw_items = json.loads(items_json) if items_json.strip() else []
        except json.JSONDecodeError:
            return _json({"error": "items_json must be valid JSON array"})
        if not isinstance(raw_items, list) or not raw_items:
            return _json({"error": "items_json must be a non-empty array"})

        for idx, row in enumerate(raw_items, start=1):
            sku = str(row.get("sku") or row.get("item_id") or "").strip()
            qty = Decimal(str(row.get("quantity") or 0))
            if not sku or qty <= 0:
                return _json({"error": f"Invalid line {idx}: need sku/item_id and positive quantity"})
            catalog = ctx.db.get(Item, sku)
            if not catalog:
                return _json({"error": f"Item '{sku}' not found"})
            unit_price = Decimal(
                str(
                    row.get("unit_price")
                    if row.get("unit_price") is not None
                    else (catalog.unit_price or 0)
                )
            )
            tax_rate = Decimal(str(row.get("tax_rate") or 0))
            line_subtotal = (unit_price * qty).quantize(Decimal("0.01"))
            line_tax = (line_subtotal * tax_rate / Decimal("100")).quantize(Decimal("0.01"))
            line_total = (line_subtotal + line_tax).quantize(Decimal("0.01"))
            line_items.append(
                {
                    "sku": sku,
                    "quantity": str(qty),
                    "unit_price": str(unit_price),
                    "tax_rate": str(tax_rate),
                    "line_subtotal": str(line_subtotal),
                    "line_tax": str(line_tax),
                    "line_total": str(line_total),
                }
            )

    subtotal = sum((Decimal(li["line_subtotal"]) for li in line_items), Decimal("0"))
    total_tax = sum((Decimal(li["line_tax"]) for li in line_items), Decimal("0"))
    # Apply header discount like UI (percentage of subtotal or fixed)
    if discount_type == "fixed":
        discount_amount = discount_value.quantize(Decimal("0.01"))
    else:
        discount_amount = (subtotal * discount_value / Decimal("100")).quantize(Decimal("0.01"))
    # Scale shipping with multiplier when cloning
    if template_id and mult != 1:
        shipping_fee = (shipping_fee * mult).quantize(Decimal("0.01"))
    vendor_shipping = vendor_freight(shipping_fee, freight_terms)
    grand_total = (subtotal + total_tax + vendor_shipping - discount_amount).quantize(Decimal("0.01"))
    if grand_total < 0:
        grand_total = Decimal("0.00")

    payload = {
        "supplier_id": vendor_id,
        "sco_number": sco_number,
        "order_date": date.today().isoformat(),
        "payment_terms": terms,
        "status": "Draft",
        "shipping_fee": str(shipping_fee),
        "discount_type": discount_type,
        "discount_value": str(discount_value),
        "incoterms": incoterms,
        "freight_terms": freight_terms,
        "carrier_account": carrier_account,
        "subtotal": str(subtotal),
        "total_tax": str(total_tax),
        "discount_amount": str(discount_amount),
        "grand_total": str(grand_total),
        "notes": notes,
        "items": line_items,
    }
    summary = (
        f"Create draft purchase order for vendor {vendor_id} "
        f"({len(line_items)} line(s), total ${grand_total}; number assigned on save)"
    )
    if template_id:
        summary += f" cloned from {template_id} ×{mult}"

    action = create_pending_action(
        user_id=str(ctx.user.id),
        action_type="create_draft_purchase_order",
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


@tool
def get_subcontract_orders(vendor_id: str = "", status: str = "", limit: int = 20) -> str:
    """List subcontract orders, optionally filtered by vendor/supplier_id and/or status."""
    ctx = get_ai_context()
    denied = _require_perm(ctx.user, "subcontract:view")
    if denied:
        return denied

    q = ctx.db.query(SubcontractOrder)
    if vendor_id.strip():
        q = q.filter(SubcontractOrder.supplier_id == vendor_id.strip())
    if status.strip():
        q = q.filter(SubcontractOrder.status.ilike(status.strip()))
    orders = q.order_by(SubcontractOrder.created_at.desc()).limit(max(1, min(limit, 50))).all()
    rows = [
        {
            "sco_number": o.sco_number,
            "supplier_id": o.supplier_id,
            "item_id": o.item_id,
            "sales_order_id": getattr(o, "sales_order_id", None),
            "line_count": getattr(o, "line_count", 0),
            "quantity_ordered": o.quantity_ordered,
            "unit_price": o.unit_price,
            "document_total": getattr(o, "document_total", None),
            "status": o.status,
            "approval_status": o.approval_status,
            "amendment_number": getattr(o, "amendment_number", 0),
            "billing_status": getattr(o, "billing_status", None),
            "order_date": o.order_date,
            "expected_return_date": o.expected_return_date,
        }
        for o in orders
    ]
    return _json({"count": len(rows), "orders": rows})


@tool
def get_subcontract_order_detail(sco_number: str) -> str:
    """Get one subcontract order by SCO number, including component kit lines."""
    ctx = get_ai_context()
    denied = _require_perm(ctx.user, "subcontract:view")
    if denied:
        return denied

    from sqlalchemy.orm import joinedload

    order = (
        ctx.db.query(SubcontractOrder)
        .options(joinedload(SubcontractOrder.components))
        .filter(SubcontractOrder.sco_number == sco_number.strip())
        .first()
    )
    if not order:
        return _json({"error": f"Subcontract order '{sco_number}' not found"})
    return _json(
        {
            "sco_number": order.sco_number,
            "supplier_id": order.supplier_id,
            "item_id": order.item_id,
            "sales_order_id": getattr(order, "sales_order_id", None),
            "line_count": getattr(order, "line_count", 0),
            "quantity_ordered": order.quantity_ordered,
            "unit_price": order.unit_price,
            "document_total": getattr(order, "document_total", None),
            "status": order.status,
            "approval_status": order.approval_status,
            "amendment_number": getattr(order, "amendment_number", 0),
            "billing_status": getattr(order, "billing_status", None),
            "order_date": order.order_date,
            "expected_return_date": order.expected_return_date,
            "notes": order.notes,
            "components": [
                {
                    "component_item_id": c.component_item_id,
                    "quantity_required": c.quantity_required,
                    "quantity_issued": c.quantity_issued,
                }
                for c in (order.components or [])
            ],
        }
    )


@tool
def propose_draft_subcontract_order(
    supplier_id: str = "",
    item_id: str = "",
    quantity_ordered: int = 0,
    sco_number: str = "",
    template_sco_number: str = "",
    quantity_multiplier: float = 1.0,
    unit_price: float = -1.0,
    notes: str = "",
) -> str:
    """Propose creating a subcontract order (starts PLANNED / approval DRAFT). Does NOT write until UI confirm.

    Provide either:
    - template_sco_number: clone an existing SCO (optional quantity_multiplier, e.g. 2 for "x 2"), or
    - supplier_id + item_id + quantity_ordered (assembly must have a Material BOM / subcontract kit).

    When cloning, supplier/item/unit_price come from the template; quantity_ordered is multiplied.
    Component kit lines are rebuilt from BOM on create (scaled to the new quantity).
    The SCO number is assigned on save as UP23-YYMMXXXX from the order date.
    """
    ctx = get_ai_context()
    denied = _require_perm(ctx.user, "subcontract:create")
    if denied:
        return denied

    mult = Decimal(str(quantity_multiplier or 1))
    if mult <= 0:
        return _json({"error": "quantity_multiplier must be positive"})

    vendor_id = supplier_id.strip()
    assembly_id = item_id.strip()
    qty = int(quantity_ordered or 0)
    price = Decimal(str(unit_price)) if unit_price is not None and unit_price >= 0 else None
    note_text = notes.strip() or "Created via AI assistant"
    template_id = template_sco_number.strip()

    if template_id:
        template = ctx.db.get(SubcontractOrder, template_id)
        if not template:
            return _json({"error": f"Template subcontract order '{template_id}' not found"})
        vendor_id = template.supplier_id
        assembly_id = template.item_id
        raw_qty = Decimal(str(template.quantity_ordered or 0)) * mult
        qty = int(raw_qty.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if qty <= 0:
            return _json({"error": "Scaled quantity must be at least 1"})
        price = Decimal(str(template.unit_price or 0))
        note_text = f"Cloned from {template_id} via AI (qty × {mult})"
    else:
        if not vendor_id:
            return _json({"error": "supplier_id is required when not cloning a template SCO"})
        if not assembly_id:
            return _json({"error": "item_id is required when not cloning a template SCO"})
        if qty <= 0:
            return _json({"error": "quantity_ordered must be a positive integer"})
        if price is None:
            price = Decimal("0")

    supplier = ctx.db.get(Supplier, vendor_id)
    if not supplier:
        return _json({"error": f"Supplier/vendor '{vendor_id}' not found"})
    product = ctx.db.get(Item, assembly_id)
    if not product:
        return _json({"error": f"Item '{assembly_id}' not found"})

    from app.services.catalog import material_bom_lines

    bom_lines = material_bom_lines(ctx.db, assembly_id)
    if not bom_lines:
        return _json(
            {
                "error": f"Item '{assembly_id}' has no Material BOM / subcontract kit; "
                "cannot create a subcontract order"
            }
        )

    payload = {
        "supplier_id": vendor_id,
        "item_id": assembly_id,
        "quantity_ordered": qty,
        "unit_price": str(price),
        "order_date": date.today().isoformat(),
        "notes": note_text,
    }
    summary = (
        f"Create subcontract order for vendor {vendor_id} "
        f"(item {assembly_id}, qty {qty}, unit ${price}; number assigned on save)"
    )
    if template_id:
        summary += f" cloned from {template_id} ×{mult}"

    action = create_pending_action(
        user_id=str(ctx.user.id),
        action_type="create_draft_subcontract_order",
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


@tool
def search_erp_knowledge(query: str) -> str:
    """Search ERP documentation for how modules, statuses, and workflows work.

    Do NOT use this for "how many" / count questions — those must use get_erp_counts
    against live data. Schema CREATE TABLE snippets are not an answer to a count.
    """
    from app.ai.rag import search_knowledge

    hits = search_knowledge(query, k=4)
    if not hits:
        return (
            "I don't have ERP process notes that match that. "
            "Ask about customers, orders, inventory, journals, or financial reports."
        )
    parts = ["Here is what the ERP process docs say:", ""]
    for hit in hits:
        source = str(hit.get("source") or "docs")
        content = str(hit.get("content") or "").strip()
        if not content:
            continue
        if len(content) > 700:
            content = content[:700].rstrip() + "…"
        parts.append(f"**{source}**")
        parts.append(content)
        parts.append("")
    return "\n".join(parts).strip()


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
    The sales order ID is assigned on save as PU61-YYMMXXXX from the order date.
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
    bill = next(
        (l for l in locations if l.location_type in ("BILL_TO", "BOTH") and getattr(l, "is_default", False)),
        None,
    ) or next((l for l in locations if l.location_type in ("BILL_TO", "BOTH")), None)
    ship = next(
        (l for l in locations if l.location_type in ("SHIP_TO", "BOTH") and getattr(l, "is_default", False)),
        None,
    ) or next((l for l in locations if l.location_type in ("SHIP_TO", "BOTH")), None)
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

    payload = {
        "customer_id": customer_id.strip(),
        "bill_to_location_id": bill.location_id,
        "ship_to_location_id": ship.location_id,
        "customer_po_number": customer_po_number.strip() or "AI-DRAFT",
        "po_revision_number": 0,
        "order_date": date.today().isoformat(),
        "payment_terms": customer.payment_terms,
        "freight_terms": customer.preferred_incoterms,
        "shipping_method": customer.preferred_shipping_method,
        "currency": customer.currency or "USD",
        "status": "DRAFT",
        "total_amount": str(total),
        "items": line_items,
    }
    summary = (
        f"Create draft sales order for customer {customer_id} "
        f"({len(line_items)} line(s), total ${total}; number assigned on save)"
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
    if action_type == "create_draft_purchase_order":
        denied = _require_perm(user, "po:create")
        if denied:
            raise PermissionError(denied)
        from app.routers.purchase_orders import create_purchase_order
        from app.schemas import PurchaseOrderCreate

        create_payload = PurchaseOrderCreate.model_validate(payload)
        order = create_purchase_order(create_payload, db)
        return {
            "po_number": order.po_number,
            "status": order.status,
            "grand_total": order.grand_total,
            "supplier_id": order.supplier_id,
        }
    if action_type == "create_draft_subcontract_order":
        denied = _require_perm(user, "subcontract:create")
        if denied:
            raise PermissionError(denied)
        from app.routers.subcontract_orders import create_subcontract_order
        from app.schemas import SubcontractOrderCreate

        create_payload = SubcontractOrderCreate.model_validate(payload)
        order = create_subcontract_order(create_payload, db)
        return {
            "sco_number": order.sco_number,
            "status": order.status,
            "approval_status": order.approval_status,
            "supplier_id": order.supplier_id,
            "item_id": order.item_id,
            "quantity_ordered": order.quantity_ordered,
            "unit_price": order.unit_price,
        }
    raise ValueError(f"Unsupported action type: {action_type}")


ERP_TOOLS = [
    *LOOKUP_TOOLS,
    get_sales_orders,
    get_sales_order_detail,
    get_purchase_orders,
    get_purchase_order_detail,
    get_subcontract_orders,
    get_subcontract_order_detail,
    get_inventory_levels,
    search_erp_knowledge,
    propose_draft_sales_order,
    propose_draft_purchase_order,
    propose_draft_subcontract_order,
]
