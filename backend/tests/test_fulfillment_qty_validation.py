# @author: Wendy Yang
# @date: 2026-09-19

from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.services.o2c import (
    assert_fulfillment_qty_within_ordered,
    over_fulfillment_detail,
)


class FulfillmentQtyValidationTests(TestCase):
    def test_message_includes_ordered_quantity_and_item(self):
        self.assertEqual(
            over_fulfillment_detail("PU-WIDGET", 12),
            "Total fulfillment quantity cannot exceed the ordered quantity of 12 for item PU-WIDGET.",
        )

    def test_allows_qty_up_to_ordered(self):
        assert_fulfillment_qty_within_ordered(
            item_id="A", ordered=10, already=6, qty=4
        )

    def test_blocks_when_cumulative_exceeds_ordered(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_fulfillment_qty_within_ordered(
                item_id="A", ordered=10, already=6, qty=5
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(
            ctx.exception.detail,
            over_fulfillment_detail("A", 10),
        )

    def test_counts_existing_draft_qty_as_already_fulfilled(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_fulfillment_qty_within_ordered(
                item_id="A", ordered=10, already=10, qty=1
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("ordered quantity of 10", ctx.exception.detail)

    def test_rejects_non_positive_qty(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_fulfillment_qty_within_ordered(
                item_id="A", ordered=10, already=0, qty=0
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "quantity_fulfilled must be positive")

    def test_helper_is_independent_of_sales_order_namespace(self):
        line = SimpleNamespace(item_id="SKU-1", quantity_ordered=3)
        with self.assertRaises(HTTPException):
            assert_fulfillment_qty_within_ordered(
                item_id=line.item_id,
                ordered=int(line.quantity_ordered),
                already=2,
                qty=2,
            )
