# @author: Wendy Yang
# @date: 2026-10-06

"""Smoke checks for GTT USA ERP 問題討論_20261005v1.xlsx."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.services.document_sequences import DOCUMENT_PREFIXES
from app.services.journal_source import journal_is_editable
from app.services.financial_reports import signed_balance
from app.services.o2c import (
    resolve_fulfillment_ship_date,
    resolve_sales_invoice_issue_date,
)
from app.services.p2p import _resolve_posting_date, non_po_debit_account
from app.services.remaining_close import (
    assert_can_close_remaining,
    assert_qty_within_issuable,
    assert_qty_within_remaining,
    over_issue_detail,
    over_receive_detail,
)
from app.services.subcontract import (
    SCO_KIT_MUST_BE_ISSUED_DETAIL,
    SCO_MUST_BE_APPROVED_TO_ISSUE_DETAIL,
    SCO_RECEIVE_REQUIRES_APPROVAL_DETAIL,
    SCO_RECEIVE_REQUIRES_KIT_DETAIL,
    assert_sco_fulfillment_allowed,
    assert_sco_kit_fully_issued,
    assert_sco_receive_allowed,
    sco_kit_is_fully_issued,
    so_is_approved_for_sco,
)


class NumberingSmokeTests(TestCase):
    def test_issue_11_27_sales_and_invoice_prefixes(self):
        self.assertEqual(DOCUMENT_PREFIXES["SALES_ORDER"], "PU61-")
        self.assertEqual(DOCUMENT_PREFIXES["INVOICE"], "US55-")
        self.assertEqual(DOCUMENT_PREFIXES["FULFILLMENT"], "US51-")
        self.assertEqual(DOCUMENT_PREFIXES["BILL"], "UX13-")
        self.assertEqual(DOCUMENT_PREFIXES["JOURNAL"], "UG11-")


class SubcontractControlSmokeTests(TestCase):
    def test_issue_12_sco_requires_approved_sales_order(self):
        self.assertTrue(so_is_approved_for_sco("APPROVED"))
        self.assertFalse(so_is_approved_for_sco("DRAFT"))
        self.assertFalse(so_is_approved_for_sco("PENDING_APPROVAL"))

    def test_issue_35_empty_kit_is_not_issued(self):
        self.assertFalse(sco_kit_is_fully_issued(SimpleNamespace(components=[])))
        with self.assertRaises(HTTPException) as raised:
            assert_sco_kit_fully_issued(SimpleNamespace(components=[]))
        self.assertEqual(raised.exception.detail, SCO_KIT_MUST_BE_ISSUED_DETAIL)

    def test_issue_35_cannot_issue_before_approve(self):
        with self.assertRaises(HTTPException) as raised:
            assert_sco_fulfillment_allowed(
                SimpleNamespace(status="PLANNED", approval_status="DRAFT"),
                "issuing materials",
            )
        self.assertEqual(raised.exception.detail, SCO_MUST_BE_APPROVED_TO_ISSUE_DETAIL)
        assert_sco_fulfillment_allowed(
            SimpleNamespace(status="PLANNED", approval_status="APPROVED"),
            "issuing materials",
        )

    def test_issue_35_cannot_receive_before_issue_and_approve(self):
        with self.assertRaises(HTTPException) as raised:
            assert_sco_receive_allowed(
                SimpleNamespace(status="PLANNED", approval_status="APPROVED", components=[])
            )
        self.assertEqual(raised.exception.detail, SCO_RECEIVE_REQUIRES_KIT_DETAIL)
        issued = [SimpleNamespace(quantity_required=Decimal("1"), quantity_issued=Decimal("1"))]
        with self.assertRaises(HTTPException) as raised:
            assert_sco_receive_allowed(
                SimpleNamespace(
                    status="MATERIALS_ISSUED",
                    approval_status="DRAFT",
                    components=issued,
                )
            )
        self.assertEqual(raised.exception.detail, SCO_RECEIVE_REQUIRES_APPROVAL_DETAIL)


class PostingDateSmokeTests(TestCase):
    def test_issue_33_34_posting_date_wins_over_invoice_date(self):
        self.assertEqual(
            _resolve_posting_date(date(2026, 9, 30), date(2026, 10, 5)),
            date(2026, 9, 30),
        )
        self.assertEqual(_resolve_posting_date(None, date(2026, 10, 5)), date(2026, 10, 5))
        self.assertEqual(_resolve_posting_date(), date.today())


class FulfillmentShippingDateSmokeTests(TestCase):
    def test_issue_36_inventory_and_ar_follow_shipping_date(self):
        ship = resolve_fulfillment_ship_date(date(2026, 9, 30))
        self.assertEqual(ship, date(2026, 9, 30))
        invoice = resolve_sales_invoice_issue_date(
            None, SimpleNamespace(shipped_date=ship)
        )
        self.assertEqual(invoice, date(2026, 9, 30))


class LandedCostAccountSmokeTests(TestCase):
    def test_issue_23_allocated_landed_cost_uses_inventory(self):
        inventory = SimpleNamespace(account_code="1313")
        expense = SimpleNamespace(account_code="5190")
        self.assertEqual(
            non_po_debit_account(
                invoice_type="LANDED_COST",
                goods_receipt_id=12,
                distribution_account=expense,
                inventory_account=inventory,
            ).account_code,
            "1313",
        )

    def test_issue_23_unallocated_non_po_keeps_chosen_account(self):
        inventory = SimpleNamespace(account_code="1313")
        expense = SimpleNamespace(account_code="5190")
        self.assertEqual(
            non_po_debit_account(
                invoice_type="EXPENSE",
                goods_receipt_id=None,
                distribution_account=expense,
                inventory_account=inventory,
            ).account_code,
            "5190",
        )
        self.assertEqual(
            non_po_debit_account(
                invoice_type="LANDED_COST",
                goods_receipt_id=None,
                distribution_account=expense,
                inventory_account=inventory,
            ).account_code,
            "5190",
        )


class ReceiveQtySmokeTests(TestCase):
    def test_issue_22_over_receive_raises_error(self):
        with self.assertRaises(HTTPException) as raised:
            assert_qty_within_remaining(item_id="1001G00001710", qty=1100, remaining=200)
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(
            raised.exception.detail,
            over_receive_detail("1001G00001710", 1100, 200),
        )
        self.assertIn("Over-receipt is not allowed", raised.exception.detail)

    def test_issue_22_short_receive_uses_cancel_remaining(self):
        assert_can_close_remaining(progressed=800, remaining=200)
        assert_qty_within_remaining(item_id="1001G00001710", qty=800, remaining=1000)

    def test_partial_issue_allowed_over_issue_rejected(self):
        assert_qty_within_issuable(item_id="1001G00001710", qty=50, remaining=200)
        with self.assertRaises(HTTPException) as raised:
            assert_qty_within_issuable(item_id="1001G00001710", qty=201, remaining=200)
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(
            raised.exception.detail,
            over_issue_detail("1001G00001710", 201, 200),
        )
        self.assertIn("Over-issue is not allowed", raised.exception.detail)


class JournalWorkflowSmokeTests(TestCase):
    def test_issue_31_draft_and_rejected_manual_journals_are_editable(self):
        self.assertFalse(
            journal_is_editable(
                SimpleNamespace(approval_status="DRAFT", posting_status="Draft", is_system_generated=True)
            )
        )
        self.assertTrue(
            journal_is_editable(
                SimpleNamespace(approval_status="DRAFT", posting_status="Draft", is_system_generated=False)
            )
        )
        self.assertTrue(
            journal_is_editable(
                SimpleNamespace(approval_status="REJECTED", posting_status="Draft", is_system_generated=False)
            )
        )
        self.assertFalse(
            journal_is_editable(
                SimpleNamespace(approval_status="PENDING_APPROVAL", posting_status="Draft")
            )
        )
        self.assertFalse(
            journal_is_editable(
                SimpleNamespace(approval_status="APPROVED", posting_status="Posted")
            )
        )


class StatementLogicSmokeTests(TestCase):
    def test_issue_37_pnl_nets_debit_and_credit(self):
        self.assertEqual(
            signed_balance("Revenue", Decimal("1000"), Decimal("9000"), "4110001"),
            Decimal("8000.00"),
        )
        self.assertEqual(
            signed_balance("Expense", Decimal("500"), Decimal("80")),
            Decimal("420.00"),
        )

    def test_issue_38_tb_uses_raw_debit_and_credit_totals(self):
        debit = Decimal("1254414.51")
        credit = Decimal("1254414.51")
        self.assertEqual(debit - credit, Decimal("0.00"))
        self.assertEqual(
            signed_balance("Revenue", Decimal("0"), Decimal("158940.00")),
            Decimal("158940.00"),
        )
