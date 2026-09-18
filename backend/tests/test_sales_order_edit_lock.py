from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.services.o2c import (
    SALES_ORDER_LOCKED_EDIT_DETAIL,
    require_sales_order_editable,
    sales_order_is_editable,
)


class SalesOrderEditLockTests(TestCase):
    def test_draft_and_rejected_are_editable(self):
        self.assertTrue(
            sales_order_is_editable(SimpleNamespace(status="DRAFT", approval_status="DRAFT"))
        )
        self.assertTrue(
            sales_order_is_editable(SimpleNamespace(status="DRAFT", approval_status="REJECTED"))
        )

    def test_approved_is_locked(self):
        self.assertFalse(
            sales_order_is_editable(SimpleNamespace(status="APPROVED", approval_status="APPROVED"))
        )
        self.assertFalse(
            sales_order_is_editable(SimpleNamespace(status="DRAFT", approval_status="APPROVED"))
        )

    def test_pending_approval_is_locked(self):
        self.assertFalse(
            sales_order_is_editable(
                SimpleNamespace(status="DRAFT", approval_status="PENDING_APPROVAL")
            )
        )

    def test_shipped_or_invoiced_is_locked(self):
        self.assertFalse(
            sales_order_is_editable(SimpleNamespace(status="SHIPPED", approval_status="DRAFT"))
        )
        self.assertFalse(
            sales_order_is_editable(SimpleNamespace(status="INVOICED", approval_status="REJECTED"))
        )
        self.assertFalse(
            sales_order_is_editable(SimpleNamespace(status="FULFILLED", approval_status="DRAFT"))
        )
        self.assertFalse(
            sales_order_is_editable(
                SimpleNamespace(status="APPROVED", approval_status="DRAFT", invoice_status="FULLY_BILLED")
            )
        )

    def test_require_raises_conflict(self):
        with self.assertRaises(HTTPException) as ctx:
            require_sales_order_editable(
                SimpleNamespace(status="INVOICED", approval_status="APPROVED")
            )
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail, SALES_ORDER_LOCKED_EDIT_DETAIL)
