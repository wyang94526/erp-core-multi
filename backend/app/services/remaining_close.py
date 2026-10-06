# @author: Wendy Yang
# @date: 2026-09-30

"""Shared rules for cancelling leftover quantity after a partial shipment or receipt."""

from __future__ import annotations

from fastapi import HTTPException

REMAINING_ALREADY_CLOSED_DETAIL = "Remaining quantity is already cancelled."
NO_PARTIAL_PROGRESS_DETAIL = (
    "Cancel remaining is only available after a partial shipment or receipt."
)
NO_OPEN_REMAINING_DETAIL = "There is no remaining quantity to cancel."
UNBILLED_RECEIVED_DETAIL = (
    "Create a supplier invoice for the received quantity before cancelling remaining."
)
REMAINING_CLOSED_RECEIVE_DETAIL = (
    "Remaining quantity was cancelled. This order is closed for further receipts."
)
REMAINING_CLOSED_FULFILL_DETAIL = (
    "Remaining quantity was cancelled. This sales order is closed for further fulfillment."
)


def over_receive_detail(item_id: str, qty, remaining) -> str:
    return (
        f"Quantity {qty} exceeds remaining receivable {remaining} for {item_id}. "
        "Over-receipt is not allowed."
    )


def assert_qty_within_remaining(*, item_id: str, qty, remaining) -> None:
    if qty > remaining:
        raise HTTPException(status_code=400, detail=over_receive_detail(item_id, qty, remaining))


def is_remaining_closed(document) -> bool:
    return bool(getattr(document, "remaining_closed", False))


def assert_can_close_remaining(
    *,
    progressed: int | float,
    remaining: int | float,
    unbilled: int | float = 0,
) -> None:
    if progressed <= 0:
        raise HTTPException(status_code=400, detail=NO_PARTIAL_PROGRESS_DETAIL)
    if remaining <= 0:
        raise HTTPException(status_code=400, detail=NO_OPEN_REMAINING_DETAIL)
    if unbilled > 0:
        raise HTTPException(status_code=400, detail=UNBILLED_RECEIVED_DETAIL)
