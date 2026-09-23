# @author: Wendy Yang
# @date: 2026-09-19

from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.services.subcontract import (
    PARENT_SO_MUST_BE_APPROVED_FOR_SCO_DETAIL,
    assert_linked_sales_order_approved,
    fully_fulfilled_sco_message,
    subcontract_create_gate,
)


class ScoSoRemainingGateTests(TestCase):
    def test_fully_fulfilled_message_includes_sales_order_id(self):
        self.assertEqual(
            fully_fulfilled_sco_message("PU61-26060001"),
            "Sales Order PU61-26060001 is fully fulfilled. "
            "Subcontract orders cannot be created for completed orders.",
        )

    def test_blocks_when_remaining_qty_is_zero(self):
        can_create, message = subcontract_create_gate(
            sales_order_id="PU61-26060001",
            status="APPROVED",
            remaining_total=0,
            selectable_line_count=0,
            approval_status="APPROVED",
        )
        self.assertFalse(can_create)
        self.assertEqual(message, fully_fulfilled_sco_message("PU61-26060001"))

    def test_blocks_completed_sales_orders_even_with_remaining_qty(self):
        can_create, message = subcontract_create_gate(
            sales_order_id="PU61-26060001",
            status="INVOICED",
            remaining_total=12,
            selectable_line_count=1,
            approval_status="APPROVED",
        )
        self.assertFalse(can_create)
        self.assertEqual(message, fully_fulfilled_sco_message("PU61-26060001"))

    def test_allows_open_order_with_selectable_remaining_qty(self):
        can_create, message = subcontract_create_gate(
            sales_order_id="PU61-26070002",
            status="APPROVED",
            remaining_total=10,
            selectable_line_count=1,
            approval_status="APPROVED",
        )
        self.assertTrue(can_create)
        self.assertIsNone(message)

    def test_blocks_when_remaining_qty_has_no_bom(self):
        can_create, message = subcontract_create_gate(
            sales_order_id="PU61-26070002",
            status="APPROVED",
            remaining_total=4,
            selectable_line_count=0,
            approval_status="APPROVED",
        )
        self.assertFalse(can_create)
        self.assertIn("no Material BOM", message or "")

    def test_gate_uses_sales_order_namespace_status(self):
        order = SimpleNamespace(status="FULFILLED")
        can_create, _message = subcontract_create_gate(
            sales_order_id="SO-1",
            status=order.status,
            remaining_total=1,
            selectable_line_count=1,
            approval_status="APPROVED",
        )
        self.assertFalse(can_create)

    def test_blocks_unapproved_parent_sales_order(self):
        for approval in ("DRAFT", "PENDING_APPROVAL", "REJECTED", None):
            can_create, message = subcontract_create_gate(
                sales_order_id="PU61-26090001",
                status="CONFIRMED",
                remaining_total=10,
                selectable_line_count=1,
                approval_status=approval,
            )
            self.assertFalse(can_create)
            self.assertEqual(message, PARENT_SO_MUST_BE_APPROVED_FOR_SCO_DETAIL)

    def test_assert_linked_sales_order_approved_rejects_draft(self):
        class FakeDb:
            def get(self, _model, _key):
                return SimpleNamespace(approval_status="DRAFT")

        with self.assertRaises(HTTPException) as raised:
            assert_linked_sales_order_approved(FakeDb(), "PU61-26090001")
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, PARENT_SO_MUST_BE_APPROVED_FOR_SCO_DETAIL)

    def test_assert_linked_sales_order_approved_allows_approved(self):
        order = SimpleNamespace(approval_status="APPROVED")

        class FakeDb:
            def get(self, _model, _key):
                return order

        self.assertIs(assert_linked_sales_order_approved(FakeDb(), "PU61-26090001"), order)
        self.assertIsNone(assert_linked_sales_order_approved(FakeDb(), None))
