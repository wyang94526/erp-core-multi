# @author: Wendy Yang
# @date: 2026-09-27

import unittest
from unittest.mock import patch

from app.ai.agent import (
    _is_financial_report_question,
    _is_howto_question,
    _is_period_question,
    _is_transaction_list_question,
    _run_heuristic,
)
from app.ai.lookups import (
    format_financial_report_answer,
    format_period_answer,
    infer_entity_and_status,
    infer_financial_report_type,
    infer_period_grain,
    infer_period_kind,
    parse_financial_report_period,
)


class FinancialReportIntentTests(unittest.TestCase):
    def test_income_statement_june_2026(self):
        question = "Show me the Income Statement for the month June 2026"
        self.assertEqual(infer_financial_report_type(question), "income-statement")
        self.assertEqual(parse_financial_report_period(question), {"period": "2026-06"})
        self.assertTrue(_is_financial_report_question(question))

    def test_p_and_l_alias_and_iso_period(self):
        self.assertEqual(infer_financial_report_type("P&L for 2026-06"), "income-statement")
        self.assertEqual(infer_financial_report_type("Show me P& L for June 2026"), "income-statement")
        self.assertEqual(parse_financial_report_period("P&L for 2026-06"), {"period": "2026-06"})
        self.assertEqual(
            parse_financial_report_period("P&L for the period 09/2026"),
            {"period": "2026-09"},
        )
        self.assertEqual(parse_financial_report_period("invoice status 9-2026"), {"period": "2026-09"})

    def test_balance_sheet_and_full_year(self):
        self.assertEqual(infer_financial_report_type("Balance sheet as of 2026"), "balance-sheet")
        parsed = parse_financial_report_period("Balance sheet as of 2026")
        self.assertEqual(parsed["fiscal_year"], 2026)
        self.assertEqual(str(parsed["date_from"]), "2026-01-01")
        self.assertEqual(str(parsed["date_to"]), "2026-12-31")

    def test_order_questions_are_not_reports(self):
        self.assertFalse(_is_financial_report_question("list purchase orders"))
        self.assertEqual(infer_financial_report_type("list purchase orders"), "")
        self.assertEqual(
            infer_financial_report_type("show me inovice due in October 2026"),
            "",
        )
        self.assertFalse(_is_financial_report_question("show me inovice due in October 2026"))
        self.assertEqual(
            infer_financial_report_type("show me inovice billed in October 2026"),
            "",
        )
        self.assertFalse(_is_financial_report_question("show me inovice billed in October 2026"))
        self.assertEqual(
            infer_financial_report_type(
                "show me purchase orders in October 2026 for Vendor Accelerate Global Solution"
            ),
            "",
        )
        self.assertFalse(
            _is_financial_report_question("show me journals in September 2026")
        )
        self.assertFalse(_is_financial_report_question("what receipts are in September 2026"))
        self.assertEqual(
            parse_financial_report_period("show me inovice due in October 2026"),
            {"period": "2026-10"},
        )

    def test_show_me_is_not_a_howto_question(self):
        self.assertFalse(_is_howto_question("show me the revenue for September 2026"))
        self.assertFalse(_is_howto_question("show me the revenuse for the September 2026"))
        self.assertFalse(_is_howto_question("what is the expense for September 2026"))
        self.assertTrue(_is_howto_question("how do I create a purchase order"))
        self.assertTrue(_is_howto_question("what is a purchase order"))

    def test_revenue_for_named_month_is_income_statement(self):
        for question in (
            "Show me the revenue for September 2027",
            "Show me the revenue for September, 2027",
            "show me the revenuse for the September 2026",
        ):
            self.assertEqual(infer_financial_report_type(question), "income-statement")
            self.assertTrue(_is_financial_report_question(question))
            self.assertFalse(_is_period_question(question))
        self.assertEqual(
            parse_financial_report_period("Show me the revenue for September 2027"),
            {"period": "2027-09"},
        )
        self.assertEqual(
            parse_financial_report_period("show me the revenuse for the September 2026"),
            {"period": "2026-09"},
        )

    def test_expense_for_named_month_is_income_statement(self):
        for question in (
            "what is the expense for September 2026",
            "show me expense for September 2026",
            "show me the expenses for September 2026",
        ):
            self.assertEqual(infer_financial_report_type(question), "income-statement", question)
            self.assertEqual(parse_financial_report_period(question), {"period": "2026-09"})
            self.assertTrue(_is_financial_report_question(question), question)
            self.assertFalse(_is_period_question(question), question)
            self.assertFalse(_is_howto_question(question), question)


class FinancialReportFormatTests(unittest.TestCase):
    def test_markdown_table_from_income_statement_payload(self):
        markdown = format_financial_report_answer(
            {
                "title": "Income Statement (Profit & Loss)",
                "subtitle": "2026-06-01 to 2026-06-30",
                "report_type": "income-statement",
                "columns": [
                    {"key": "label", "label": "Account", "align": "left", "format": "text"},
                    {"key": "amount", "label": "Amount", "align": "right", "format": "number"},
                ],
                "rows": [
                    {"cells": {"label": "Revenue", "amount": None}, "emphasis": "section"},
                    {"cells": {"label": "4110001  Sales", "amount": 1000}, "indent": 1},
                    {"cells": {"label": "Net Income", "amount": 1000}, "emphasis": "net"},
                ],
                "notes": ["Activity is taken from posted journal entries in the selected date range."],
                "filters": {"period": "2026-06"},
            }
        )
        self.assertIn("## Income Statement (Profit & Loss)", markdown)
        self.assertIn("2026-06-01 to 2026-06-30", markdown)
        self.assertIn("| Account | Amount |", markdown)
        self.assertIn("| :--- | ---: |", markdown)
        self.assertIn("$1,000.00", markdown)
        self.assertIn("**Net Income**", markdown)
        self.assertNotIn("```", markdown)
        self.assertIn("[Open the full report](/financial-reports/income-statement?period=2026-06)", markdown)

    def test_revenue_answer_explains_dashboard_sales_orders(self):
        markdown = format_financial_report_answer(
            {
                "title": "Income Statement (Profit & Loss)",
                "subtitle": "2026-09-01 to 2026-09-30",
                "report_type": "income-statement",
                "sales_order_compare": {
                    "period_label": "Sep 2026",
                    "period_count": 6,
                    "period_total": "985428.00",
                    "all_total": "1144368.00",
                },
                "columns": [
                    {"key": "label", "label": "Account", "align": "left", "format": "text"},
                    {"key": "amount", "label": "Amount", "align": "right", "format": "number"},
                ],
                "rows": [
                    {"cells": {"label": "Sales Revenue", "amount": 635760}, "emphasis": "normal"},
                    {"cells": {"label": "Net Income", "amount": 64033.31}, "emphasis": "net"},
                ],
                "filters": {"period": "2026-09"},
            }
        )
        self.assertIn("all sales orders (**$1,144,368.00**)", markdown)
        self.assertIn("Sales orders in Sep 2026: **$985,428.00** (6 order(s))", markdown)
        self.assertIn("month-end close excluded", markdown)

    def test_empty_month_points_at_posted_months(self):
        markdown = format_financial_report_answer(
            {
                "title": "Income Statement (Profit & Loss)",
                "subtitle": "2026-06-01 to 2026-06-30",
                "report_type": "income-statement",
                "empty_period": True,
                "other_periods": [
                    {
                        "period": "2026-09",
                        "label": "Sep 2026",
                        "revenue": "635760.00",
                        "expense": "444781.43",
                        "net_income": "190978.57",
                    }
                ],
                "columns": [
                    {"key": "label", "label": "Account", "align": "left", "format": "text"},
                    {"key": "amount", "label": "Amount", "align": "right", "format": "number"},
                ],
                "rows": [
                    {"cells": {"label": "Net Income", "amount": 0}, "emphasis": "net"},
                ],
                "summary": {"revenue": 0, "cogs": 0, "operating_expenses": 0, "net_income": 0},
                "filters": {"period": "2026-06"},
            }
        )
        self.assertIn("No posted P&L activity", markdown)
        self.assertIn("| Sep 2026 | $635,760.00 | $444,781.43 | $190,978.57 |", markdown)
        self.assertIn("Ask for Sep 2026 or the year 2026", markdown)
        self.assertIn("[Open the full report](/financial-reports/income-statement?period=2026-06)", markdown)


class FinancialReportHeuristicTests(unittest.TestCase):
    @patch("app.ai.lookups.get_financial_report")
    def test_heuristic_calls_report_not_knowledge(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Income Statement (Profit & Loss)\n\n"
            "| Account | Amount |\n| :--- | ---: |\n| **Net Income** | $1.00 |"
        )
        reply, pending = _run_heuristic(
            "Show me the Income Statement for the month June 2026", None
        )
        mock_tool.invoke.assert_called_once()
        args = mock_tool.invoke.call_args[0][0]
        self.assertEqual(args["question"], "Show me the Income Statement for the month June 2026")
        self.assertIn("Income Statement", reply)
        self.assertNotIn("purchase_orders", reply)
        self.assertNotIn("Running in local tool mode", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_financial_report")
    def test_heuristic_revenue_for_month_ignores_page_sco(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Income Statement (Profit & Loss)\n\n"
            "No posted P&L activity in 2027-09.\n"
        )
        reply, pending = _run_heuristic(
            "Show me the revenue for September, 2027",
            {
                "entity_type": "subcontract_order",
                "entity_id": "UP23-26090007",
                "subcontract_order_id": "UP23-26090007",
            },
        )
        mock_tool.invoke.assert_called_once()
        self.assertEqual(
            mock_tool.invoke.call_args[0][0]["question"],
            "Show me the revenue for September, 2027",
        )
        self.assertIn("Income Statement", reply)
        self.assertNotIn("purchase_orders", reply)
        self.assertNotIn("UP23-26090007", reply)
        self.assertNotIn("Running in local tool mode", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_financial_report")
    def test_heuristic_revenue_typo_does_not_search_knowledge(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Income Statement (Profit & Loss)\n\n"
            "| Account | Amount |\n| :--- | ---: |\n| **Revenue** | $1.00 |"
        )
        reply, pending = _run_heuristic(
            "show me the revenuse for the September 2026", None
        )
        mock_tool.invoke.assert_called_once()
        self.assertEqual(
            mock_tool.invoke.call_args[0][0]["question"],
            "show me the revenuse for the September 2026",
        )
        self.assertIn("Income Statement", reply)
        self.assertNotIn("purchase_orders", reply)
        self.assertNotIn("Running in local tool mode", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_financial_report")
    def test_heuristic_expense_for_month_ignores_docs(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Income Statement (Profit & Loss)\n\n"
            "| Account | Amount |\n| :--- | ---: |\n| **Total Operating Expenses** | $1.00 |"
        )
        reply, pending = _run_heuristic("show me expense for September 2026", None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(
            mock_tool.invoke.call_args[0][0]["question"],
            "show me expense for September 2026",
        )
        self.assertIn("Operating Expenses", reply)
        self.assertNotIn("schema_0", reply)
        self.assertNotIn("purchase_orders", reply)
        self.assertIsNone(pending)


class MonthlyTotalsIntentTests(unittest.TestCase):
    def test_revenue_by_month_is_gl_not_knowledge(self):
        question = "what are the revenue by month for 2026"
        self.assertTrue(_is_period_question(question))
        self.assertFalse(_is_financial_report_question(question))
        self.assertEqual(infer_period_kind(question), "gl_revenue")

    def test_sales_by_month_is_sales_orders(self):
        question = "what are the sales by month for the year 2026"
        self.assertTrue(_is_period_question(question))
        self.assertFalse(_is_financial_report_question(question))
        self.assertEqual(infer_period_kind(question), "sales_orders")

    def test_purchasing_vs_sales_by_month_is_compare(self):
        for question in (
            "show me purchasing vs sales by month",
            "sales vs purchases by month",
            "compare purchasing and sales by month",
            "PO vs SO by month",
        ):
            self.assertTrue(_is_period_question(question), question)
            self.assertFalse(_is_financial_report_question(question), question)
            self.assertEqual(infer_period_kind(question), "sales_vs_purchases", question)
        self.assertEqual(infer_period_kind("purchases by month for 2026"), "purchase_orders")
        self.assertEqual(
            infer_period_kind("what are the sales by month for the year 2026"),
            "sales_orders",
        )

    def test_purchasing_vs_sales_named_month_is_not_a_po_list(self):
        question = "show me purchasing vs sales in September 2026"
        self.assertTrue(_is_period_question(question))
        self.assertFalse(_is_transaction_list_question(question))
        self.assertFalse(_is_financial_report_question(question))
        self.assertEqual(infer_period_kind(question), "sales_vs_purchases")

    def test_profit_by_month_is_gl_profit_not_out_of_scope(self):
        question = "show the profit by month for 2026"
        self.assertTrue(_is_period_question(question))
        self.assertFalse(_is_financial_report_question(question))
        self.assertEqual(infer_financial_report_type(question), "")
        self.assertEqual(infer_period_kind(question), "gl_profit")
        self.assertEqual(infer_period_kind("net income by month for 2026"), "gl_profit")

    def test_profit_synonyms_by_month_are_gl_profit(self):
        for question in (
            "show profits by month for 2026",
            "profitability by month for 2026",
            "earnings by month for 2026",
            "net earnings by month for 2026",
            "bottom line by month for 2026",
            "P&L by month for 2026",
            "P and L by month for 2026",
            "PnL by month for 2026",
            "profit and loss by month for 2026",
        ):
            self.assertTrue(_is_period_question(question), question)
            self.assertFalse(_is_financial_report_question(question), question)
            self.assertEqual(infer_financial_report_type(question), "", question)
            self.assertEqual(infer_period_kind(question), "gl_profit", question)

    def test_named_month_p_and_l_stays_income_statement(self):
        question = "P&L for September 2026"
        self.assertTrue(_is_financial_report_question(question))
        self.assertFalse(_is_period_question(question))
        self.assertEqual(infer_financial_report_type(question), "income-statement")

    def test_operating_profit_and_ebitda_are_not_net_income(self):
        self.assertNotEqual(infer_period_kind("operating profit by month for 2026"), "gl_profit")
        self.assertNotEqual(infer_period_kind("EBITDA by month for 2026"), "gl_profit")

    def test_expense_purchase_invoice_synonyms(self):
        cases = {
            "opex by month for 2026": "gl_expense",
            "spending by month for 2026": "gl_expense",
            "operating expenses by month for 2026": "gl_expense",
            "turnover by month for 2026": "gl_revenue",
            "purchases by month for 2026": "purchase_orders",
            "procurement by month for 2026": "purchase_orders",
            "PO by month for 2026": "purchase_orders",
            "purchase invoices by month for 2026": "supplier_invoices",
            "vendor invoice by month for 2026": "supplier_invoices",
            "customer invoices by month for 2026": "sales_invoices",
            "invoices by month for 2026": "sales_invoices",
            "bills by month for 2026": "ap_bills",
            "vendor bills by month for 2026": "ap_bills",
        }
        for question, kind in cases.items():
            self.assertTrue(_is_period_question(question), question)
            self.assertFalse(_is_financial_report_question(question), question)
            self.assertEqual(infer_period_kind(question), kind, question)

    def test_cogs_is_not_gl_expense(self):
        self.assertNotEqual(infer_period_kind("COGS by month for 2026"), "gl_expense")

    def test_material_issues_by_week_is_in_scope(self):
        question = "show materials issues by week"
        self.assertTrue(_is_period_question(question))
        self.assertFalse(_is_financial_report_question(question))
        self.assertEqual(infer_period_kind(question), "material_issues")
        self.assertEqual(infer_period_grain(question), "week")

    @patch("app.ai.lookups.get_orders_by_month")
    def test_heuristic_routes_material_issues_by_week(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Material issues by week\n\n| Week | Issues | Qty issued |\n"
        )
        reply, pending = _run_heuristic("show materials issues by week", None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["kind"], "material_issues")
        self.assertIn("Material issues by week", reply)
        self.assertNotIn("outside information", reply)
        self.assertIsNone(pending)

    def test_compare_revenue_by_quarter_is_not_a_statement(self):
        question = "compare revenue by quarter"
        self.assertTrue(_is_period_question(question))
        self.assertFalse(_is_financial_report_question(question))
        self.assertEqual(infer_financial_report_type(question), "")
        self.assertEqual(infer_period_kind(question), "gl_revenue")
        self.assertEqual(infer_period_grain(question), "quarter")
        self.assertEqual(infer_period_grain("revenue by month for 2026"), "month")

    @patch("app.ai.lookups.get_orders_by_month")
    def test_heuristic_routes_revenue_by_quarter(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Revenue by quarter\n\n| Quarter | Journals | Amount |\n"
        )
        reply, pending = _run_heuristic("compare revenue by quarter", None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["kind"], "gl_revenue")
        self.assertIn("Revenue by quarter", reply)
        self.assertNotIn("Income Statement", reply)
        self.assertIsNone(pending)

    def test_count_synonyms_map_entities(self):
        self.assertEqual(infer_entity_and_status("how many POs")[0], "purchase_orders")
        self.assertEqual(infer_entity_and_status("how many invoices")[0], "sales_invoices")
        self.assertEqual(infer_entity_and_status("how many purchase invoices")[0], "supplier_invoices")

    @patch("app.ai.lookups.get_orders_by_month")
    def test_heuristic_routes_revenue_by_month(self, mock_tool):
        mock_tool.invoke.return_value = "## Revenue by month (2026)\n\n| Month | Amount |\n"
        reply, pending = _run_heuristic("what are the revenue by month for 2026", None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["kind"], "gl_revenue")
        self.assertEqual(mock_tool.invoke.call_args[0][0]["year"], 2026)
        self.assertIn("Revenue by month", reply)
        self.assertNotIn("schema_0", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_orders_by_month")
    def test_heuristic_routes_sales_by_month(self, mock_tool):
        mock_tool.invoke.return_value = "## Sales orders by month (2026)\n\n| Month | Amount |\n"
        reply, pending = _run_heuristic(
            "what are the sales by month for the year 2026", None
        )
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["kind"], "sales_orders")
        self.assertIn("Sales orders by month", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_orders_by_month")
    def test_heuristic_routes_purchasing_vs_sales(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Purchasing vs sales by month\n\n"
            "| Month | Sales orders | Sales | Purchase orders | Purchasing |\n"
        )
        reply, pending = _run_heuristic("show me purchasing vs sales by month", None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["kind"], "sales_vs_purchases")
        self.assertIn("Purchasing vs sales by month", reply)
        self.assertIn("Sales", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_orders_by_month")
    def test_heuristic_routes_purchasing_vs_sales_named_month(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Purchasing vs sales — Sep 2026\n\n"
            "| Month | Sales orders | Sales | Purchase orders | Purchasing |\n"
        )
        reply, pending = _run_heuristic(
            "show me purchasing vs sales in September 2026", None
        )
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["kind"], "sales_vs_purchases")
        self.assertIn("Purchasing vs sales", reply)
        self.assertIn("Sales", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_orders_by_month")
    def test_heuristic_routes_profit_by_month(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Profit by month (2026)\n\n| Month | Revenue | Expenses | Net Income |\n"
        )
        reply, pending = _run_heuristic("show the profit by month for 2026", None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["kind"], "gl_profit")
        self.assertEqual(mock_tool.invoke.call_args[0][0]["year"], 2026)
        self.assertIn("Profit by month", reply)
        self.assertNotIn("weather", reply)
        self.assertNotIn("outside information", reply)
        self.assertIsNone(pending)

    @patch("app.ai.lookups.get_orders_by_month")
    def test_heuristic_routes_pnl_by_month_synonym(self, mock_tool):
        mock_tool.invoke.return_value = (
            "## Profit by month (2026)\n\n| Month | Revenue | Expenses | Net Income |\n"
        )
        reply, pending = _run_heuristic("P&L by month for 2026", None)
        mock_tool.invoke.assert_called_once()
        self.assertEqual(mock_tool.invoke.call_args[0][0]["kind"], "gl_profit")
        self.assertIn("Profit by month", reply)
        self.assertIsNone(pending)


class ProfitByMonthFormatTests(unittest.TestCase):
    def test_profit_table_has_revenue_expense_net(self):
        markdown = format_period_answer(
            """
            {
              "kind": "gl_profit",
              "title": "Profit by month (2026)",
              "count_label": "Months",
              "months": [
                {
                  "month": "2026-09",
                  "label": "Sep 2026",
                  "revenue": "1000.00",
                  "expense": "400.00",
                  "net_income": "600.00"
                }
              ],
              "note": "Posted journals only."
            }
            """
        )
        self.assertIn("## Profit by month (2026)", markdown)
        self.assertIn("| Month | Revenue | Expenses | Net Income |", markdown)
        self.assertIn("| Sep 2026 | $1,000.00 | $400.00 | $600.00 |", markdown)
        self.assertIn("| Total | $1,000.00 | $400.00 | $600.00 |", markdown)
        self.assertIn("```ai-chart", markdown)
        self.assertIn("Posted journals only.", markdown)

    def test_quarter_revenue_table_uses_quarter_header(self):
        markdown = format_period_answer(
            """
            {
              "kind": "gl_revenue",
              "title": "Revenue by quarter",
              "count_label": "Journals",
              "grain": "quarter",
              "months": [
                {
                  "month": "2026-Q3",
                  "label": "Q3 2026",
                  "order_count": 4,
                  "total_amount": "635760.00"
                }
              ]
            }
            """
        )
        self.assertIn("## Revenue by quarter", markdown)
        self.assertIn("| Quarter | Journals | Amount |", markdown)
        self.assertIn("| Q3 2026 | 4 | $635,760.00 |", markdown)
        self.assertNotIn("Income Statement", markdown)

    def test_purchasing_vs_sales_table_has_both_sides(self):
        markdown = format_period_answer(
            """
            {
              "kind": "sales_vs_purchases",
              "title": "Purchasing vs sales by month",
              "count_label": "Orders",
              "months": [
                {
                  "month": "2026-06",
                  "label": "Jun 2026",
                  "sales_count": 2,
                  "sales_amount": "1000.00",
                  "purchase_count": 1,
                  "purchase_amount": "400.00"
                },
                {
                  "month": "2026-09",
                  "label": "Sep 2026",
                  "sales_count": 3,
                  "sales_amount": "2500.00",
                  "purchase_count": 5,
                  "purchase_amount": "800.00"
                }
              ],
              "note": "Sales is sales-order totals by order date."
            }
            """
        )
        self.assertIn("## Purchasing vs sales by month", markdown)
        self.assertIn(
            "| Month | Sales orders | Sales | Purchase orders | Purchasing |",
            markdown,
        )
        self.assertIn("| Jun 2026 | 2 | $1,000.00 | 1 | $400.00 |", markdown)
        self.assertIn("| Total | 5 | $3,500.00 | 6 | $1,200.00 |", markdown)
        self.assertIn("5 sales orders totaling $3,500.00", markdown)
        self.assertIn("6 purchase orders totaling $1,200.00", markdown)
        self.assertIn('"compare":true', markdown)
        self.assertIn('"series":"Sales"', markdown)
        self.assertIn('"series":"Purchasing"', markdown)

    def test_material_issues_week_table_uses_qty(self):
        markdown = format_period_answer(
            """
            {
              "kind": "material_issues",
              "title": "Material issues by week",
              "count_label": "Issues",
              "grain": "week",
              "amount_format": "quantity",
              "order_count": 2,
              "total_amount": "150.0000",
              "months": [
                {
                  "month": "2026-W36",
                  "label": "Sep 1–7, 2026",
                  "order_count": 2,
                  "total_amount": "150.0000"
                }
              ]
            }
            """
        )
        self.assertIn("## Material issues by week", markdown)
        self.assertIn("| Week | Issues | Qty issued |", markdown)
        self.assertIn("| Sep 1–7, 2026 | 2 | 150 |", markdown)
        self.assertNotIn("$150", markdown)


if __name__ == "__main__":
    unittest.main()
