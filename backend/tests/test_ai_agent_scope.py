# @author: Wendy Yang
# @date: 2026-10-01

import json
from unittest import TestCase
from unittest.mock import patch

from app.ai.agent import (
    ERP_SCOPE_REPLY,
    _is_out_of_scope_question,
    _parse_qty_multiplier,
    _run_heuristic,
    _sales_order_create_source,
)
from app.ai.lookups import (
    format_goods_receipts_answer,
    format_inventory_answer,
    format_po_received_qty_answer,
    format_purchase_orders_answer,
    format_closing_period_answer,
    format_invoice_status_answer,
    format_transactions_answer,
    journal_created_date,
    journal_display_id,
    journal_posted_date,
    format_posting_rules_answer,
    format_unpaid_invoices_answer,
    infer_entity_and_status,
    infer_invoice_party,
    infer_transaction_kind,
    is_transaction_list_wording,
    is_below_threshold_wording,
    is_closing_period_wording,
    is_invoice_billed_wording,
    is_invoice_due_wording,
    is_invoice_list_wording,
    is_invoice_status_wording,
    is_posting_rule_wording,
    is_received_qty_by_po_wording,
    is_unbilled_receipt_wording,
    is_unpaid_invoice_wording,
    parse_financial_report_period,
    period_date_bounds,
)


class OutOfScopeQuestionTests(TestCase):
    def test_weather_is_out_of_scope(self):
        self.assertTrue(_is_out_of_scope_question("weather in Taipei today"))
        self.assertTrue(_is_out_of_scope_question("What's the temperature in Taipei?"))

    def test_erp_lookups_are_in_scope(self):
        self.assertFalse(_is_out_of_scope_question("Show me the revenue for September 2026"))
        self.assertFalse(_is_out_of_scope_question("show the profit by month for 2026"))
        self.assertFalse(_is_out_of_scope_question("P&L by month for 2026"))
        self.assertFalse(_is_out_of_scope_question("earnings by month for 2026"))
        self.assertFalse(_is_out_of_scope_question("show materials issues by week"))
        self.assertFalse(_is_out_of_scope_question("cash flow forecast for 2026"))
        self.assertFalse(_is_out_of_scope_question("how do I create a purchase order"))
        self.assertFalse(_is_out_of_scope_question("Which POs are overdue?"))
        self.assertFalse(_is_out_of_scope_question("list the qty received by purchase order"))
        self.assertFalse(_is_out_of_scope_question("show me unpaid invoices"))
        self.assertFalse(_is_out_of_scope_question("current closing period"))
        self.assertFalse(_is_out_of_scope_question("Posting rule for Month End Close"))
        self.assertFalse(_is_out_of_scope_question("show me invoice status"))
        self.assertFalse(_is_out_of_scope_question("show me inovice billed in October 2026"))
        self.assertFalse(
            _is_out_of_scope_question(
                "show me purchase orders in October 2026 for Vendor Accelerate Global Solution"
            )
        )
        self.assertFalse(_is_out_of_scope_question("show me journals in September 2026"))
        self.assertFalse(_is_out_of_scope_question("what receipts are in September 2026"))
        self.assertFalse(_is_out_of_scope_question("How many material issues?"))

    @patch("app.ai.tools.search_erp_knowledge")
    def test_weather_does_not_search_knowledge(self, mock_search):
        reply, pending = _run_heuristic("weather in Taipei today", None)
        mock_search.invoke.assert_not_called()
        self.assertEqual(reply, ERP_SCOPE_REPLY)
        self.assertNotIn("Running in local tool mode", reply)
        self.assertNotIn("Knowledge base empty", reply)
        self.assertNotIn("```json", reply)
        self.assertIsNone(pending)

    @patch("app.ai.tools.search_erp_knowledge")
    def test_unrelated_question_does_not_dump_json(self, mock_search):
        reply, pending = _run_heuristic("tell me a story about cats", None)
        mock_search.invoke.assert_not_called()
        self.assertEqual(reply, ERP_SCOPE_REPLY)
        self.assertNotIn("```json", reply)
        self.assertIsNone(pending)


class SalesOrderCloneIntentTests(TestCase):
    def test_parses_2x_quantity_phrasing(self):
        self.assertEqual(_parse_qty_multiplier("with 2x quantity"), 2.0)
        self.assertEqual(_parse_qty_multiplier("with x 2 quantity"), 2.0)
        self.assertEqual(_parse_qty_multiplier("qty 3"), 3.0)

    @patch("app.ai.tools.propose_draft_sales_order")
    def test_clones_pu61_template_at_2x(self, mock_tool):
        mock_tool.invoke.return_value = json.dumps(
            {
                "pending_confirmation": True,
                "action_id": "act-1",
                "action_type": "create_draft_sales_order",
                "summary": "Create draft sales order cloned from PU61-26090004 ×2",
                "payload": {"customer_id": "G03050"},
            }
        )
        reply, pending = _run_heuristic(
            "create a sales order like PU61-26090004 with 2x quantity",
            None,
        )
        mock_tool.invoke.assert_called_once()
        args = mock_tool.invoke.call_args[0][0]
        self.assertEqual(args["template_so_number"], "PU61-26090004")
        self.assertEqual(args["quantity_multiplier"], 2.0)
        self.assertIsNotNone(pending)
        self.assertEqual(pending["action_type"], "create_draft_sales_order")
        self.assertIn("cloned from PU61-26090004", reply)
        self.assertNotIn("outside information", reply)
        self.assertNotIn("include customer_id", reply)


class UnbilledGoodsReceiptIntentTests(TestCase):
    def test_unbilled_wording(self):
        self.assertTrue(is_unbilled_receipt_wording("Unbilled goods receipts ready to invoice"))
        self.assertTrue(is_unbilled_receipt_wording("receipts ready to bill"))
        self.assertFalse(is_unbilled_receipt_wording("list goods receipts"))

    def test_unbilled_table_format(self):
        markdown = format_goods_receipts_answer(
            """
            {
              "count": 1,
              "unbilled_only": true,
              "quantity_unbilled": "6",
              "total_amount": "120.00",
              "receipts": [
                {
                  "receipt_number": "PU67-26100001",
                  "source_type": "PURCHASE_ORDER",
                  "source_order_id": "PU62-26100001",
                  "vendor_name": "Acme",
                  "receipt_date": "2026-10-01",
                  "quantity_unbilled": "6",
                  "total_amount": "120.00",
                  "billing_status": "UNBILLED"
                }
              ]
            }
            """
        )
        self.assertIn("## Unbilled goods receipts ready to invoice", markdown)
        self.assertIn("| PU67-26100001 |", markdown)
        self.assertIn("| 6 |", markdown)
        self.assertNotIn("$6", markdown)

    @patch("app.ai.lookups.get_goods_receipts")
    def test_unbilled_receipts_ready_to_invoice(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Unbilled goods receipts ready to invoice\n\n"
            "| Receipt | Source | Vendor | Date | Unbilled qty | Amount | Billing |\n"
        )
        reply, pending = _run_heuristic(
            "Unbilled goods receipts ready to invoice",
            None,
        )
        mock_tool.invoke.assert_called_once()
        args = mock_tool.invoke.call_args[0][0]
        self.assertEqual(args["question"], "Unbilled goods receipts ready to invoice")
        self.assertIn("Unbilled goods receipts ready to invoice", reply)
        self.assertNotIn("outside information", reply)
        self.assertIsNone(pending)


class InventoryThresholdIntentTests(TestCase):
    def test_threshold_wording(self):
        self.assertTrue(is_below_threshold_wording("product under inventory threshold"))
        self.assertTrue(is_below_threshold_wording("items below reorder point"))
        self.assertTrue(is_below_threshold_wording("reorder alerts"))
        self.assertFalse(is_below_threshold_wording("summarize inventory levels"))
        self.assertFalse(is_below_threshold_wording("approval threshold"))

    def test_count_routes_to_inventory_not_items(self):
        entity, status = infer_entity_and_status("how many products under inventory threshold")
        self.assertEqual(entity, "inventory")
        self.assertEqual(status, "below_threshold")

    def test_threshold_table_format(self):
        markdown = format_inventory_answer(
            """
            {
              "count": 1,
              "below_threshold": true,
              "stock": [
                {
                  "item_id": "1001G00001710",
                  "description": "Enclosure",
                  "on_hand": 0,
                  "reorder_point": 80,
                  "atp": 0,
                  "status": "Out of Stock",
                  "warehouse": "ECH",
                  "bin": "E-01-01"
                }
              ]
            }
            """
        )
        self.assertIn("## Products under inventory threshold", markdown)
        self.assertIn("| 1001G00001710 |", markdown)
        self.assertIn("| 80 |", markdown)
        self.assertNotIn("```json", markdown)

    @patch("app.ai.tools.get_inventory_levels")
    def test_heuristic_passes_question(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Products under inventory threshold\n\n"
            "| Item | Description | On hand | Reorder pt | ATP | Status | Warehouse |\n"
        )
        reply, pending = _run_heuristic("product under inventory threshold", None)
        mock_tool.invoke.assert_called_once()
        args = mock_tool.invoke.call_args[0][0]
        self.assertEqual(args["question"], "product under inventory threshold")
        self.assertIn("Products under inventory threshold", reply)
        self.assertNotIn("outside information", reply)
        self.assertNotIn("```json", reply)
        self.assertIsNone(pending)


class OrdersFromSalesOrderIntentTests(TestCase):
    def test_detects_corresponding_orders_for_pu61(self):
        original = "create corresponding subcontract order and purchase order for PU61-26100001"
        text = original.lower()
        self.assertEqual(_sales_order_create_source(original, text), "PU61-26100001")
        self.assertEqual(
            _sales_order_create_source(
                "create a sales order like PU61-26090004 with 2x quantity",
                "create a sales order like pu61-26090004 with 2x quantity",
            ),
            "",
        )

    @patch("app.ai.tools.propose_orders_from_sales_order")
    def test_heuristic_proposes_from_sales_order(self, mock_tool):
        mock_tool.invoke.return_value = json.dumps(
            {
                "message": "## Corresponding orders for PU61-26100001\n\n"
                "The parent Sales Order must be approved before a subcontract order can be created or updated."
            }
        )
        reply, pending = _run_heuristic(
            "create corresponding subcontract order and purchase order for PU61-26100001",
            None,
        )
        mock_tool.invoke.assert_called_once()
        args = mock_tool.invoke.call_args[0][0]
        self.assertEqual(args["sales_order_id"], "PU61-26100001")
        self.assertTrue(args["create_material_po"])
        self.assertIn("PU61-26100001", reply)
        self.assertIn("must be approved", reply)
        self.assertNotIn("```json", reply)
        self.assertNotIn("outside information", reply)
        self.assertIsNone(pending)


class OverduePurchaseOrderIntentTests(TestCase):
    def test_overdue_table_format(self):
        markdown = format_purchase_orders_answer(
            """
            {
              "count": 1,
              "overdue": true,
              "orders": [
                {
                  "po_number": "PU62-26090005",
                  "supplier_id": "TP0002",
                  "supplier_name": "Test Vendor",
                  "status": "Approved",
                  "billing_status": "UNBILLED",
                  "grand_total": "47280.45",
                  "expected_delivery_date": "2026-09-18",
                  "days_late": 16
                }
              ]
            }
            """
        )
        self.assertIn("## Overdue purchase orders", markdown)
        self.assertIn("| PU62-26090005 |", markdown)
        self.assertIn("| $47,280.45 |", markdown)
        self.assertNotIn("```json", markdown)

    @patch("app.ai.tools.get_purchase_orders")
    def test_heuristic_asks_overdue(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Overdue purchase orders\n\n"
            "| PO | Vendor | Expected | Days late | Status | Billing | Amount |\n"
        )
        reply, pending = _run_heuristic("Which POs are overdue?", None)
        mock_tool.invoke.assert_called_once()
        args = mock_tool.invoke.call_args[0][0]
        self.assertTrue(args["overdue"])
        self.assertIn("Overdue purchase orders", reply)
        self.assertNotIn("```json", reply)
        self.assertNotIn("outside information", reply)
        self.assertIsNone(pending)


class ReceivedQtyByPurchaseOrderIntentTests(TestCase):
    def test_received_qty_wording(self):
        self.assertTrue(is_received_qty_by_po_wording("list the qty received by purchase order"))
        self.assertTrue(is_received_qty_by_po_wording("quantity received per PO"))
        self.assertTrue(is_received_qty_by_po_wording("received quantities by purchase orders"))
        self.assertFalse(is_received_qty_by_po_wording("list purchase orders"))
        self.assertFalse(is_received_qty_by_po_wording("Which POs are overdue?"))
        self.assertFalse(is_received_qty_by_po_wording("Unbilled goods receipts ready to invoice"))

    def test_received_qty_table_format(self):
        markdown = format_po_received_qty_answer(
            """
            {
              "count": 1,
              "received_by_po": true,
              "orders": [
                {
                  "po_number": "PU62-26090001",
                  "vendor_id": "TP0002",
                  "vendor_name": "Grand-Tek Techonlogy.Co.,ltd",
                  "quantity_ordered": "1000",
                  "quantity_received": "400",
                  "quantity_remaining": "600",
                  "receipt_count": 1
                }
              ]
            }
            """
        )
        self.assertIn("## Quantity received by purchase order", markdown)
        self.assertIn("| PU62-26090001 |", markdown)
        self.assertIn("| 1,000 |", markdown)
        self.assertIn("| 400 |", markdown)
        self.assertIn("| 600 |", markdown)
        self.assertNotIn("$", markdown)
        self.assertNotIn("```json", markdown)

    @patch("app.ai.lookups.get_received_qty_by_purchase_order")
    def test_heuristic_asks_received_qty_not_po_amounts(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Quantity received by purchase order\n\n"
            "| PO | Vendor | Ordered qty | Received qty | Remaining | Receipts |\n"
        )
        reply, pending = _run_heuristic("list the qty received by purchase order", None)
        mock_tool.invoke.assert_called_once()
        self.assertIn("Quantity received by purchase order", reply)
        self.assertNotIn("$255,653.88", reply)
        self.assertNotIn("```json", reply)
        self.assertIsNone(pending)


class UnpaidInvoiceIntentTests(TestCase):
    def test_unpaid_invoice_wording(self):
        self.assertTrue(is_unpaid_invoice_wording("show me unpaid invoices"))
        self.assertTrue(is_unpaid_invoice_wording("outstanding customer invoices"))
        self.assertTrue(is_unpaid_invoice_wording("unpaid vendor bills"))
        self.assertTrue(is_unpaid_invoice_wording("open invoices"))
        self.assertFalse(is_unpaid_invoice_wording("list sales invoices"))
        self.assertFalse(is_unpaid_invoice_wording("Unbilled goods receipts ready to invoice"))

    def test_unpaid_invoice_table_format(self):
        markdown = format_unpaid_invoices_answer(
            """
            {
              "count": 1,
              "unpaid_invoices": true,
              "invoices": [
                {
                  "invoice_number": "PU65-26090001",
                  "invoice_type": "Customer",
                  "party_id": "G03050",
                  "party_name": "DENSO Products and Services of Americas",
                  "status": "APPROVED",
                  "due_date": "2026-11-12",
                  "total_amount": "158940.00",
                  "outstanding_balance": "158940.00"
                }
              ]
            }
            """
        )
        self.assertIn("## Unpaid invoices", markdown)
        self.assertIn("| PU65-26090001 |", markdown)
        self.assertIn("| $158,940.00 |", markdown)
        self.assertNotIn("```json", markdown)

    @patch("app.ai.lookups.get_unpaid_invoices")
    def test_heuristic_asks_unpaid_invoices(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Unpaid invoices\n\n"
            "| Invoice | Type | Party | Status | Due | Amount | Outstanding |\n"
        )
        reply, pending = _run_heuristic("show me unpaid invoices", None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["question"], "show me unpaid invoices")
        self.assertIn("Unpaid invoices", reply)
        self.assertNotIn("outside information", reply)
        self.assertNotIn("```json", reply)
        self.assertIsNone(pending)


class ClosingPeriodIntentTests(TestCase):
    def test_closing_period_wording(self):
        self.assertTrue(is_closing_period_wording("current closing period"))
        self.assertTrue(is_closing_period_wording("what is the soft close date"))
        self.assertTrue(is_closing_period_wording("hard close through"))
        self.assertTrue(is_closing_period_wording("period lock date"))
        self.assertFalse(is_closing_period_wording("profit by month"))
        self.assertFalse(is_closing_period_wording("show me unpaid invoices"))
        self.assertFalse(is_closing_period_wording("Posting rule for Month End Close"))

    def test_closing_period_table_format(self):
        markdown = format_closing_period_answer(
            """
            {
              "closing_period": true,
              "soft_close_date": "2026-07-31",
              "hard_close_date": "2026-07-31",
              "current_closing_date": "2026-07-31",
              "as_of": "2026-10-04",
              "as_of_status": "OPEN"
            }
            """
        )
        self.assertIn("## Current closing period", markdown)
        self.assertIn("| Soft close through | 2026-07-31 |", markdown)
        self.assertIn("| Hard close through | 2026-07-31 |", markdown)
        self.assertIn("Open", markdown)
        self.assertNotIn("```json", markdown)

    @patch("app.ai.lookups.get_closing_period")
    def test_heuristic_asks_closing_period(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Current closing period\n\n"
            "| | Date |\n| :--- | :--- |\n| Soft close through | 2026-07-31 |\n"
        )
        reply, pending = _run_heuristic("current closing period", None)
        mock_tool.invoke.assert_called_once()
        self.assertIn("Current closing period", reply)
        self.assertNotIn("outside information", reply)
        self.assertNotIn("```json", reply)
        self.assertIsNone(pending)


class PostingRuleIntentTests(TestCase):
    def test_posting_rule_wording(self):
        self.assertTrue(is_posting_rule_wording("Posting rule for Month End Close"))
        self.assertTrue(is_posting_rule_wording("list posting rules"))
        self.assertTrue(is_posting_rule_wording("year-end close posting rules"))
        self.assertFalse(is_posting_rule_wording("current closing period"))
        self.assertFalse(is_posting_rule_wording("show me unpaid invoices"))

    def test_posting_rule_table_format(self):
        markdown = format_posting_rules_answer(
            """
            {
              "count": 1,
              "posting_rules": true,
              "event_label": "Month-end close posting rule",
              "rules": [
                {
                  "rule_code": "MEC_PARK_NI",
                  "event_label": "Month-end close",
                  "name": "Park Current Period Net Income",
                  "debit_account_code": "3354",
                  "debit_account_name": "Net income or loss for current period-IS",
                  "credit_account_code": "3353",
                  "credit_account_name": "Net income or loss for current period-BS"
                }
              ]
            }
            """
        )
        self.assertIn("## Month-end close posting rule", markdown)
        self.assertIn("| MEC_PARK_NI |", markdown)
        self.assertIn("3354", markdown)
        self.assertIn("3353", markdown)
        self.assertNotIn("```json", markdown)

    @patch("app.ai.lookups.get_posting_rules")
    def test_heuristic_asks_posting_rules(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Month-end close posting rule\n\n"
            "| Code | Event | Name | Debit | Credit |\n"
        )
        reply, pending = _run_heuristic("Posting rule for Month End Close", None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(
            mock_tool.invoke.call_args[0][0]["question"],
            "Posting rule for Month End Close",
        )
        self.assertIn("Month-end close posting rule", reply)
        self.assertNotIn("outside information", reply)
        self.assertNotIn("```json", reply)
        self.assertIsNone(pending)


class InvoiceStatusIntentTests(TestCase):
    def test_invoice_status_wording(self):
        self.assertTrue(is_invoice_status_wording("show me invoice status"))
        self.assertTrue(is_invoice_status_wording("invoices by status"))
        self.assertTrue(is_invoice_status_wording("vendor bill status"))
        self.assertTrue(is_invoice_status_wording("show me invoice status for the period 09/2026"))
        self.assertTrue(is_invoice_status_wording("show me inovice status"))
        self.assertFalse(is_invoice_status_wording("show me unpaid invoices"))
        self.assertFalse(is_invoice_status_wording("list sales invoices"))
        self.assertFalse(is_invoice_status_wording("Unbilled goods receipts ready to invoice"))
        self.assertFalse(is_invoice_status_wording("show me inovice due in October 2026"))

    def test_invoice_due_wording(self):
        self.assertTrue(is_invoice_due_wording("show me invoice due in October 2026"))
        self.assertTrue(is_invoice_due_wording("show me inovice due in October 2026"))
        self.assertTrue(is_invoice_due_wording("invoices due October 2026"))
        self.assertFalse(is_invoice_due_wording("show me invoice status"))
        self.assertFalse(is_invoice_due_wording("show me unpaid invoices"))

    def test_invoice_billed_wording(self):
        self.assertTrue(is_invoice_billed_wording("show me invoice billed in October 2026"))
        self.assertTrue(is_invoice_billed_wording("show me inovice billed in October 2026"))
        self.assertTrue(is_invoice_list_wording("show me inovice billed in October 2026"))
        self.assertFalse(is_invoice_billed_wording("show me invoice status"))
        self.assertFalse(is_invoice_billed_wording("show me inovice due in October 2026"))
        self.assertFalse(is_invoice_billed_wording("Unbilled goods receipts ready to invoice"))
        self.assertFalse(is_invoice_list_wording("how do I create an invoice"))
        self.assertTrue(
            is_invoice_list_wording(
                "show me inovice billed in October 2026 for Vendor Accelerate Global Solution"
            )
        )

    def test_invoice_party_from_for_vendor(self):
        party = infer_invoice_party(
            "show me inovice billed in October 2026 for Vendor Accelerate Global Solution"
        )
        self.assertEqual(party["side"], "vendor")
        self.assertEqual(party["tokens"], ["accelerate", "global", "solution"])
        self.assertEqual(infer_invoice_party("show me invoice status for the period 09/2026"), {})
        self.assertEqual(infer_invoice_party("show me invoices billed in October 2026"), {})

    def test_invoice_status_period_bounds(self):
        self.assertEqual(
            parse_financial_report_period("show me invoice status for the period 09/2026"),
            {"period": "2026-09"},
        )
        bounds = period_date_bounds("show me invoice status for the period 09/2026")
        self.assertEqual(str(bounds["date_from"]), "2026-09-01")
        self.assertEqual(str(bounds["date_to"]), "2026-09-30")
        self.assertEqual(bounds["period_label"], "Sep 2026")
        self.assertEqual(period_date_bounds("show me invoice status"), {})

    def test_invoice_status_table_format(self):
        markdown = format_invoice_status_answer(
            """
            {
              "count": 1,
              "invoice_status": true,
              "period_label": "Sep 2026",
              "date_from": "2026-09-01",
              "date_to": "2026-09-30",
              "by_status": [
                {"invoice_type": "Customer", "status": "APPROVED", "count": 4}
              ],
              "invoices": [
                {
                  "invoice_number": "PU65-26090001",
                  "invoice_type": "Customer",
                  "party_name": "DENSO Products and Services of Americas",
                  "status": "APPROVED",
                  "invoice_date": "2026-09-13",
                  "due_date": "2026-11-12",
                  "total_amount": "158940.00",
                  "outstanding_balance": "158940.00"
                }
              ]
            }
            """
        )
        self.assertIn("## Invoice status", markdown)
        self.assertIn("Period **Sep 2026**", markdown)
        self.assertIn("| Customer | APPROVED | 4 |", markdown)
        self.assertIn("| PU65-26090001 |", markdown)
        self.assertIn("| 2026-09-13 |", markdown)
        self.assertIn("for Sep 2026", markdown)
        self.assertNotIn("```json", markdown)

    def test_invoice_due_table_format(self):
        markdown = format_invoice_status_answer(
            """
            {
              "count": 1,
              "invoice_status": true,
              "date_field": "due",
              "period_label": "Oct 2026",
              "date_from": "2026-10-01",
              "date_to": "2026-10-31",
              "by_status": [
                {"invoice_type": "Vendor", "status": "APPROVED", "count": 1}
              ],
              "invoices": [
                {
                  "invoice_number": "VBILL-2026-0001",
                  "invoice_type": "Vendor",
                  "party_name": "ACCELERATED GLOBAL SOLUTIONS INC.",
                  "status": "APPROVED",
                  "invoice_date": "2026-09-14",
                  "due_date": "2026-10-14",
                  "total_amount": "2661.43",
                  "outstanding_balance": "2661.43"
                }
              ]
            }
            """
        )
        self.assertIn("## Invoices due", markdown)
        self.assertIn("due date 2026-10-01 to 2026-10-31", markdown)
        self.assertIn("| VBILL-2026-0001 |", markdown)
        self.assertIn("Filtered by due date.", markdown)
        self.assertNotIn("Income Statement", markdown)

    def test_invoice_billed_table_format(self):
        markdown = format_invoice_status_answer(
            """
            {
              "count": 1,
              "invoice_status": true,
              "date_field": "document",
              "title": "Invoices billed",
              "period_label": "Oct 2026",
              "date_from": "2026-10-01",
              "date_to": "2026-10-31",
              "by_status": [
                {"invoice_type": "Vendor", "status": "APPROVED", "count": 1}
              ],
              "invoices": [
                {
                  "invoice_number": "UX13-26100002",
                  "invoice_type": "Vendor",
                  "party_name": "ACCELERATED GLOBAL SOLUTIONS INC.",
                  "status": "APPROVED",
                  "invoice_date": "2026-10-01",
                  "due_date": "2026-10-31",
                  "total_amount": "80.00",
                  "outstanding_balance": "80.00"
                }
              ]
            }
            """
        )
        self.assertIn("## Invoices billed", markdown)
        self.assertIn("| UX13-26100002 |", markdown)
        self.assertIn("Filtered by billed date", markdown)
        self.assertNotIn("outside information", markdown)

    def test_invoice_billed_party_format(self):
        markdown = format_invoice_status_answer(
            """
            {
              "count": 1,
              "invoice_status": true,
              "date_field": "document",
              "title": "Invoices billed",
              "period_label": "Oct 2026",
              "date_from": "2026-10-01",
              "date_to": "2026-10-31",
              "party_label": "ACCELERATED GLOBAL SOLUTIONS INC.",
              "by_status": [
                {"invoice_type": "Vendor", "status": "APPROVED", "count": 1}
              ],
              "invoices": [
                {
                  "invoice_number": "UX13-26100002",
                  "invoice_type": "Vendor",
                  "party_name": "ACCELERATED GLOBAL SOLUTIONS INC.",
                  "status": "APPROVED",
                  "invoice_date": "2026-10-01",
                  "due_date": "2026-10-31",
                  "total_amount": "80.00",
                  "outstanding_balance": "80.00"
                }
              ]
            }
            """
        )
        self.assertIn("for **ACCELERATED GLOBAL SOLUTIONS INC.**", markdown)
        self.assertIn("| UX13-26100002 |", markdown)
        self.assertNotIn("Nex Computers", markdown)

    @patch("app.ai.lookups.get_invoice_status")
    def test_heuristic_asks_invoice_status(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Invoice status\n\n"
            "| Type | Status | Count |\n"
        )
        reply, pending = _run_heuristic("show me invoice status", None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["question"], "show me invoice status")
        self.assertIn("Invoice status", reply)
        self.assertNotIn("outside information", reply)
        self.assertNotIn("```json", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_invoice_status")
    def test_heuristic_asks_invoice_status_for_period(self, mock_tool):
        mock_tool.invoke.return_value = "## Invoice status\n\nPeriod **Sep 2026**\n"
        question = "show me invoice status for the period 09/2026"
        reply, pending = _run_heuristic(question, None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["question"], question)
        self.assertIn("Sep 2026", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_invoice_status")
    def test_heuristic_asks_invoices_due(self, mock_tool):
        mock_tool.invoke.return_value = "## Invoices due\n\nPeriod **Oct 2026**\n"
        question = "show me inovice due in October 2026"
        reply, pending = _run_heuristic(question, None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["question"], question)
        self.assertIn("Invoices due", reply)
        self.assertNotIn("Income Statement", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_invoice_status")
    def test_heuristic_asks_invoices_billed(self, mock_tool):
        mock_tool.invoke.return_value = "## Invoices billed\n\nPeriod **Oct 2026**\n"
        question = "show me inovice billed in October 2026"
        reply, pending = _run_heuristic(question, None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["question"], question)
        self.assertIn("Invoices billed", reply)
        self.assertNotIn("outside information", reply)
        self.assertIsNone(pending)


class TransactionListIntentTests(TestCase):
    def test_transaction_kinds(self):
        self.assertEqual(
            infer_transaction_kind("show me purchase orders in October 2026"),
            "purchase_orders",
        )
        self.assertEqual(infer_transaction_kind("show me sales orders in 09/2026"), "sales_orders")
        self.assertEqual(
            infer_transaction_kind("subcontract orders for vendor Accelerate Global Solution"),
            "subcontract_orders",
        )
        self.assertEqual(infer_transaction_kind("goods receipts in October 2026"), "goods_receipts")
        self.assertEqual(
            infer_transaction_kind("what receipts are in September 2026"),
            "goods_receipts",
        )
        self.assertTrue(is_transaction_list_wording("what receipts are in September 2026"))
        self.assertFalse(
            is_transaction_list_wording("Unbilled goods receipts ready to invoice")
        )
        self.assertEqual(infer_transaction_kind("fulfillments in October 2026"), "fulfillments")
        self.assertEqual(infer_transaction_kind("show me journals in September 2026"), "journals")
        self.assertEqual(infer_transaction_kind("journals for September 2026"), "journals")
        self.assertTrue(is_transaction_list_wording("journals for September 2026"))
        self.assertEqual(infer_transaction_kind("payments in October 2026"), "cash")
        self.assertEqual(
            infer_transaction_kind("material issues in September 2026"),
            "material_issues",
        )
        self.assertEqual(
            infer_transaction_kind("show me inovice billed in October 2026"),
            "invoices",
        )

    def test_transaction_list_wording_not_howto_or_monthly(self):
        self.assertTrue(
            is_transaction_list_wording(
                "show me purchase orders in October 2026 for Vendor Accelerate Global Solution"
            )
        )
        self.assertTrue(is_transaction_list_wording("show me journals in September 2026"))
        self.assertFalse(is_transaction_list_wording("how do I create a purchase order"))
        self.assertFalse(is_transaction_list_wording("what is a purchase order"))
        self.assertFalse(is_transaction_list_wording("Which POs are overdue?"))
        self.assertFalse(
            is_transaction_list_wording(
                "create corresponding subcontract order and purchase order for PU61-26100001"
            )
        )
        self.assertFalse(is_transaction_list_wording("purchase orders by month"))

    def test_transaction_table_format(self):
        markdown = format_transactions_answer(
            """
            {
              "count": 1,
              "transactions": true,
              "title": "Purchase orders",
              "period_label": "Oct 2026",
              "date_from": "2026-10-01",
              "date_to": "2026-10-31",
              "date_note": "order date",
              "party_label": "ACCELERATED GLOBAL SOLUTIONS INC.",
              "columns": [
                {"key": "number", "label": "PO"},
                {"key": "party_name", "label": "Vendor"},
                {"key": "amount", "label": "Amount", "format": "money"}
              ],
              "rows": [
                {
                  "number": "PU62-26100001",
                  "party_name": "ACCELERATED GLOBAL SOLUTIONS INC.",
                  "amount": "80.00"
                }
              ]
            }
            """
        )
        self.assertIn("## Purchase orders", markdown)
        self.assertIn("for **ACCELERATED GLOBAL SOLUTIONS INC.**", markdown)
        self.assertIn("| PU62-26100001 |", markdown)
        self.assertNotIn("Income Statement", markdown)

    def test_journal_display_matches_general_ledger(self):
        from datetime import date, datetime
        from types import SimpleNamespace
        from uuid import UUID

        numbered = SimpleNamespace(
            journal_number="UG11-26090009",
            id=UUID("ec8444e2-0000-4000-8000-000000000001"),
            posting_date=date(2026, 9, 30),
            created_at=datetime(2026, 9, 1, 12, 0),
        )
        legacy = SimpleNamespace(
            journal_number=None,
            id=UUID("75c58d8a-1111-4000-8000-000000000002"),
            posting_date=None,
            created_at=datetime(2026, 9, 13, 8, 30),
        )
        self.assertEqual(journal_display_id(numbered), "UG11-26090009")
        self.assertEqual(journal_display_id(legacy), "75C58D8A")
        self.assertEqual(journal_created_date(numbered), date(2026, 9, 1))
        self.assertEqual(journal_created_date(legacy), date(2026, 9, 13))
        self.assertEqual(journal_posted_date(numbered), date(2026, 9, 30))
        self.assertIsNone(journal_posted_date(legacy))
        markdown = format_transactions_answer(
            """
            {
              "count": 1,
              "transactions": true,
              "title": "Journals",
              "period_label": "Sep 2026",
              "date_from": "2026-09-01",
              "date_to": "2026-09-30",
              "date_note": "period or posting date",
              "columns": [
                {"key": "number", "label": "Journal"},
                {"key": "created_date", "label": "Created"},
                {"key": "doc_date", "label": "Posting date"}
              ],
              "rows": [
                {
                  "number": "75C58D8A",
                  "created_date": "2026-09-13",
                  "doc_date": null
                }
              ]
            }
            """
        )
        self.assertIn("| Created | Posting date |", markdown)
        self.assertIn("| 75C58D8A | 2026-09-13 | — |", markdown)

    @patch("app.ai.lookups.get_transactions")
    def test_heuristic_asks_purchase_orders_for_period_and_vendor(self, mock_tool):
        mock_tool.invoke.return_value = "## Purchase orders\n\nPeriod **Oct 2026**\n"
        question = "show me purchase orders in October 2026 for Vendor Accelerate Global Solution"
        reply, pending = _run_heuristic(question, None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["question"], question)
        self.assertIn("Purchase orders", reply)
        self.assertNotIn("outside information", reply)
        self.assertIsNone(pending)
