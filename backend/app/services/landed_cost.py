# @author: Wendy Yang
# @date: 2026-09-23

"""Allocate freight/duty AP bills onto goods-receipt and purchase-order lines."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.services.po_totals import ZERO, _d, money, money4

LANDED_COST_ACTIVE_STATUSES = frozenset({"DRAFT", "PENDING_APPROVAL", "APPROVED", "PAID"})


def allocation_weight(quantity: Any, line_amount: Any) -> Decimal:
    """Prefer line subtotal; fall back to received quantity."""
    amount = money(line_amount)
    if amount > 0:
        return amount
    qty = _d(quantity)
    return qty if qty > 0 else ZERO


def allocate_amount_by_weights(weights: list[Decimal], amount: Decimal) -> list[Decimal]:
    """Spread `amount` across weights. Remainder goes to the last positive weight."""
    total = money(amount)
    if total <= 0 or not weights:
        return [ZERO for _ in weights]
    pool = sum((max(_d(weight), ZERO) for weight in weights), ZERO)
    if pool <= 0:
        return [ZERO for _ in weights]

    shares = [ZERO for _ in weights]
    remaining = total
    last_positive = max((index for index, weight in enumerate(weights) if _d(weight) > 0), default=None)
    if last_positive is None:
        return shares

    for index, weight in enumerate(weights):
        if _d(weight) <= 0:
            continue
        if index == last_positive:
            shares[index] = remaining
            remaining = ZERO
            continue
        share = money(total * _d(weight) / pool)
        shares[index] = share
        remaining = money(remaining - share)
    if remaining != ZERO:
        shares[last_positive] = money(shares[last_positive] + remaining)
    return shares


def landed_unit_cost(unit_cost: Any, quantity: Any, allocated: Any) -> Decimal:
    qty = _d(quantity)
    base = money4(unit_cost)
    extra = money(allocated)
    if qty <= 0:
        return money4(base + extra) if extra > 0 else base
    return money4(base + extra / qty)


def annotate_receipt_line(line: Any, allocated: Decimal) -> None:
    qty = _d(getattr(line, "quantity_received", 0))
    base = _d(getattr(line, "unit_cost", 0))
    line.allocated_landed_amount = money(allocated)
    line.landed_unit_cost = landed_unit_cost(base, qty, allocated)
    line.actual_unit_cost = line.landed_unit_cost


def annotate_po_line(line: Any, extra_allocated: Decimal) -> None:
    qty = _d(getattr(line, "quantity", 0))
    price = max(_d(getattr(line, "unit_price", 0)), ZERO)
    extra = money(extra_allocated)
    estimated_alloc = money(getattr(line, "allocated_landed_expense", 0))
    line.allocated_landed_expense = money(estimated_alloc + extra)
    line.actual_allocated_landed_expense = extra
    if qty <= 0:
        line.estimated_landed_unit_cost = ZERO
        line.actual_unit_cost = money4(price + extra) if extra > 0 else money4(price)
        return
    estimated_per_unit = estimated_alloc / qty
    line.estimated_landed_unit_cost = money4(estimated_per_unit)
    extra_per_unit = extra / qty if extra > 0 else estimated_per_unit
    line.actual_unit_cost = money4(price + extra_per_unit)
