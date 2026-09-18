"""Catalog item types: inventory vs non-stock / service charges."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Iterable

from fastapi import HTTPException, status

INVENTORY = "INVENTORY"
NON_INVENTORY = "NON_INVENTORY"
SERVICE = "SERVICE"
ITEM_TYPES = (INVENTORY, NON_INVENTORY, SERVICE)
STOCK_TYPES = {INVENTORY}

# Existing/legacy SKUs that should be treated as charges, not warehouse stock.
SERVICE_SKU_ALIASES = {
    "MISC",
    "MISCELLANEOUS",
    "FREIGHT",
    "FRT",
    "FREIGHT-IN",
    "FREIGHTIN",
    "SVC-FREIGHT",
}

DEFAULT_EXPENSE_ACCOUNT_CODE = "5190"
DEFAULT_EXPENSE_ACCOUNT_NAME = "Purchase Expenses"
DEFAULT_REVENUE_ACCOUNT_CODE = "4110001"


def normalize_item_type(value: Any) -> str:
    raw = str(value or INVENTORY).strip().upper().replace("-", "_").replace(" ", "_")
    if raw in {"NONINVENTORY", "NON_STOCK", "NONSTOCK"}:
        return NON_INVENTORY
    if raw in ITEM_TYPES:
        return raw
    return INVENTORY


def is_service_sku(sku: Any) -> bool:
    raw = str(sku or "").strip().upper().replace(" ", "")
    return raw in SERVICE_SKU_ALIASES


def is_stock_type(item_type: Any) -> bool:
    return normalize_item_type(item_type) == INVENTORY


def is_stock_tracked(item: Any | None) -> bool:
    """Unknown catalog rows stay inventory (existing PO/SO behavior)."""
    if item is None:
        return True
    return is_stock_type(getattr(item, "item_type", None))


def skip_inventory_movement(item: Any | None) -> bool:
    return not is_stock_tracked(item)


def blank_to_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_item_fields(*, item_type: Any = INVENTORY, uom: Any = None) -> tuple[str, str | None]:
    kind = normalize_item_type(item_type)
    unit = blank_to_none(uom)
    if kind == INVENTORY and not unit:
        unit = "Each"
    return kind, unit


def validate_item_master_fields(*, item_type: Any = INVENTORY, uom: Any = None) -> tuple[str, str | None]:
    kind, unit = normalize_item_fields(item_type=item_type, uom=uom)
    if kind == INVENTORY and not unit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unit of measure is required for inventory items",
        )
    return kind, unit


def _as_money(value: Any) -> Decimal:
    try:
        amount = Decimal(str(value or 0))
    except Exception:
        return Decimal("0")
    return amount if amount.is_finite() else Decimal("0")


def validate_line_quantity(
    *,
    sku: str,
    quantity: Any,
    amount: Any = None,
    unit_price: Any = None,
    item: Any | None = None,
    allow_zero_amount: bool = False,
) -> Decimal:
    qty = Decimal(str(quantity or 0))
    if qty < 0:
        raise HTTPException(status_code=400, detail=f"Quantity cannot be negative for {sku}")
    if is_stock_tracked(item):
        if qty <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Quantity must be greater than 0 for inventory item {sku}",
            )
        return qty
    amt = _as_money(amount)
    if amt <= 0:
        amt = _as_money(unit_price)
    if qty == 0 and amt <= 0 and not allow_zero_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Enter a quantity or an amount for non-inventory item {sku}",
        )
    return qty


def item_type_by_id(db, skus: Iterable[str]) -> dict[str, str]:
    from app.models import Item

    ids = [sku for sku in skus if sku]
    if not ids:
        return {}
    rows = db.query(Item.item_id, Item.item_type).filter(Item.item_id.in_(ids)).all()
    return {row[0]: normalize_item_type(row[1]) for row in rows}


def catalog_item(db, sku: str | None):
    from app.models import Item

    if not sku:
        return None
    return db.get(Item, sku)
