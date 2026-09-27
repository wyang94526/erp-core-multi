# @author: Wendy Yang
# @date: 2026-09-27

from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.services.document_revisions import diff_snapshots, flatten_snapshot, json_safe
from app.services.o2c import (
    SALES_ORDER_LOCKED_EDIT_DETAIL,
    assert_can_revise_sales_order,
    sales_order_can_revise,
    sales_order_revise_blocker,
)


class SnapshotDiffTests(TestCase):
    def test_flatten_skips_status_and_nests_lines(self):
        flat = flatten_snapshot(
            {
                "customer_po_number": "PO-1",
                "status": "APPROVED",
                "items": [{"item_id": "FG-1", "quantity_ordered": 10}],
            }
        )
        self.assertEqual(flat["customer_po_number"], "PO-1")
        self.assertEqual(flat["items[0].item_id"], "FG-1")
        self.assertNotIn("status", flat)

    def test_diff_reports_changed_and_added_fields(self):
        changes = dict(
            (field, (old, new))
            for field, old, new in diff_snapshots(
                {"total_amount": "100.00", "items": [{"quantity_ordered": 2}]},
                {"total_amount": "150.00", "items": [{"quantity_ordered": 3, "item_id": "A"}]},
            )
        )
        self.assertEqual(changes["total_amount"], ("100.00", "150.00"))
        self.assertEqual(changes["items[0].quantity_ordered"], ("2", "3"))
        self.assertEqual(changes["items[0].item_id"], (None, "A"))

    def test_json_safe_decimal_and_none(self):
        from decimal import Decimal

        self.assertEqual(json_safe(Decimal("12.50")), "12.50")
        self.assertIsNone(json_safe(None))


class SalesOrderReviseGateTests(TestCase):
    def test_approved_open_order_can_revise(self):
        order = SimpleNamespace(status="APPROVED", approval_status="APPROVED", invoice_status="UNBILLED")
        self.assertTrue(sales_order_can_revise(order))
        self.assertIsNone(sales_order_revise_blocker(order))

    def test_draft_cannot_revise(self):
        order = SimpleNamespace(status="DRAFT", approval_status="DRAFT", invoice_status="UNBILLED")
        self.assertFalse(sales_order_can_revise(order))
        with self.assertRaises(HTTPException) as ctx:
            assert_can_revise_sales_order(order)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_fully_billed_cannot_revise(self):
        order = SimpleNamespace(
            status="APPROVED",
            approval_status="APPROVED",
            invoice_status="FULLY_BILLED",
        )
        self.assertIn("fully billed", sales_order_revise_blocker(order) or "")

    def test_lock_message_points_at_create_revision(self):
        self.assertIn("Create Revision", SALES_ORDER_LOCKED_EDIT_DETAIL)
