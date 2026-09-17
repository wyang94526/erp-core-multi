"""Purchase-order line/header totals and vendor-payable freight rules."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

FREIGHT_PREPAID = "PREPAID_ON_PO"
FREIGHT_THIRD_PARTY = "THIRD_PARTY_COLLECT"
FREIGHT_ROUTING = "ROUTING_ACCOUNT"
PO_FREIGHT_TERMS = (FREIGHT_PREPAID, FREIGHT_THIRD_PARTY, FREIGHT_ROUTING)

TWOPLACES = Decimal("0.01")
ZERO = Decimal("0.00")


def _d(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    amount = Decimal(str(value))
    if not amount.is_finite():
        return Decimal("0")
    return amount


def money(value: Any) -> Decimal:
    return _d(value).quantize(TWOPLACES)


def normalize_freight_terms(value: Any) -> str:
    terms = str(value or FREIGHT_PREPAID).strip() or FREIGHT_PREPAID
    if terms not in PO_FREIGHT_TERMS:
        return FREIGHT_PREPAID
    return terms


def includes_vendor_freight(freight_terms: Any) -> bool:
    return normalize_freight_terms(freight_terms) == FREIGHT_PREPAID


def requires_carrier_account(freight_terms: Any) -> bool:
    return normalize_freight_terms(freight_terms) in {FREIGHT_THIRD_PARTY, FREIGHT_ROUTING}


def vendor_freight(shipping_fee: Any, freight_terms: Any) -> Decimal:
    if includes_vendor_freight(freight_terms):
        return money(max(_d(shipping_fee), Decimal("0")))
    return ZERO


def invoice_freight_default(shipping_fee: Any, freight_terms: Any) -> Decimal:
    """Freight that belongs on the goods-vendor AP invoice."""
    return vendor_freight(shipping_fee, freight_terms)


def remaining_to_buy(quantity_required: Any, quantity_already_ordered: Any) -> Decimal:
    remaining = _d(quantity_required) - _d(quantity_already_ordered)
    if remaining < 0:
        return Decimal("0.0000")
    return remaining.quantize(Decimal("0.0001"))


def apply_line_totals(item: Any) -> None:
    qty = max(_d(getattr(item, "quantity", 0)), Decimal("0"))
    price = max(_d(getattr(item, "unit_price", 0)), Decimal("0"))
    tax_rate = max(_d(getattr(item, "tax_rate", 0)), Decimal("0"))
    if qty == 0:
        provided = money(getattr(item, "line_subtotal", 0))
        line_subtotal = provided if provided > 0 else money(price)
    else:
        line_subtotal = money(qty * price)
    line_tax = money(line_subtotal * tax_rate / Decimal("100"))
    item.line_subtotal = line_subtotal
    item.line_tax = line_tax
    item.line_total = money(line_subtotal + line_tax)


def apply_po_totals(po: Any) -> None:
    items = list(getattr(po, "items", None) or [])
    for item in items:
        apply_line_totals(item)

    subtotal = money(sum((_d(item.line_subtotal) for item in items), Decimal("0")))
    total_tax = money(sum((_d(item.line_tax) for item in items), Decimal("0")))

    discount_type = getattr(po, "discount_type", None) or "percentage"
    raw_discount = max(_d(getattr(po, "discount_value", 0)), Decimal("0"))
    if discount_type == "fixed":
        discount_amount = money(raw_discount)
    else:
        pct = min(raw_discount, Decimal("100"))
        discount_amount = money(subtotal * pct / Decimal("100"))

    shipping = money(max(_d(getattr(po, "shipping_fee", 0)), Decimal("0")))
    po.shipping_fee = shipping
    po.subtotal = subtotal
    po.total_tax = total_tax
    po.discount_amount = discount_amount
    grand = money(
        subtotal + total_tax + vendor_freight(shipping, getattr(po, "freight_terms", None)) - discount_amount
    )
    po.grand_total = grand if grand > 0 else ZERO
