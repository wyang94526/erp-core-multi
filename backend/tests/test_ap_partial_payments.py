# @author: Wendy Yang
# @date: 2026-10-01

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.services.finance import settlement_apply_amount


class SettlementApplyAmountTests(TestCase):
    def test_defaults_to_remaining_balance(self):
        pay, remaining = settlement_apply_amount(
            invoice_total=Decimal("35776.00"),
            already_paid=Decimal("0.00"),
            requested=None,
        )
        self.assertEqual(pay, Decimal("35776.00"))
        self.assertEqual(remaining, Decimal("0.00"))

    def test_partial_then_remaining(self):
        first, remaining = settlement_apply_amount(
            invoice_total=Decimal("35776.00"),
            already_paid=Decimal("0.00"),
            requested=Decimal("10000.00"),
        )
        self.assertEqual(first, Decimal("10000.00"))
        self.assertEqual(remaining, Decimal("25776.00"))

        second, remaining_after = settlement_apply_amount(
            invoice_total=Decimal("35776.00"),
            already_paid=Decimal("10000.00"),
            requested=Decimal("25776.00"),
        )
        self.assertEqual(second, Decimal("25776.00"))
        self.assertEqual(remaining_after, Decimal("0.00"))

    def test_rejects_overpayment(self):
        with self.assertRaises(HTTPException) as raised:
            settlement_apply_amount(
                invoice_total=Decimal("35776.00"),
                already_paid=Decimal("10000.00"),
                requested=Decimal("30000.00"),
            )
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("25776.00", str(raised.exception.detail))

    def test_rejects_when_already_cleared(self):
        with self.assertRaises(HTTPException) as raised:
            settlement_apply_amount(
                invoice_total=Decimal("100.00"),
                already_paid=Decimal("100.00"),
                requested=Decimal("10.00"),
                already_paid_message="Bill is already fully paid",
            )
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "Bill is already fully paid")


class ApSettlementSyncTests(TestCase):
    def test_partial_keeps_supplier_invoice_open(self):
        from app.services.finance import _sync_ap_settlement

        bill = SimpleNamespace(status="Unpaid")
        invoice = SimpleNamespace(status="APPROVED", outstanding_balance=Decimal("35776.00"), updated_at=None)
        _sync_ap_settlement(bill, invoice, Decimal("25776.00"))
        self.assertEqual(bill.status, "Partial")
        self.assertEqual(invoice.status, "APPROVED")
        self.assertEqual(invoice.outstanding_balance, Decimal("25776.00"))
        self.assertIsNotNone(invoice.updated_at)

    def test_final_payment_marks_paid(self):
        from app.services.finance import _sync_ap_settlement

        bill = SimpleNamespace(status="Partial")
        invoice = SimpleNamespace(status="APPROVED", outstanding_balance=Decimal("25776.00"), updated_at=None)
        _sync_ap_settlement(bill, invoice, Decimal("0.00"))
        self.assertEqual(bill.status, "Paid")
        self.assertEqual(invoice.status, "PAID")
        self.assertEqual(invoice.outstanding_balance, Decimal("0.00"))


class ApDisplayStatusTests(TestCase):
    def test_display_status_stays_partial_while_open(self):
        from app.services.finance import ap_display_status

        today = date(2026, 10, 1)
        self.assertEqual(
            ap_display_status(status="Partial", due_date=date(2026, 9, 1), today=today),
            "Partial",
        )
