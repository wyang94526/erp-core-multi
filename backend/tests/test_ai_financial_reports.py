# @author: Wendy Yang
# @date: 2026-09-27

import unittest
from unittest.mock import patch

from app.ai.agent import (
    _is_financial_report_question,
    _is_howto_question,
    _is_period_question,
    _run_heuristic,
)
from app.ai.lookups import (
    format_financial_report_answer,
    infer_financial_report_type,
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

    def test_balance_sheet_and_full_year(self):
        self.assertEqual(infer_financial_report_type("Balance sheet as of 2026"), "balance-sheet")
        parsed = parse_financial_report_period("Balance sheet as of 2026")
        self.assertEqual(parsed["fiscal_year"], 2026)
        self.assertEqual(str(parsed["date_from"]), "2026-01-01")
        self.assertEqual(str(parsed["date_to"]), "2026-12-31")

    def test_order_questions_are_not_reports(self):
        self.assertFalse(_is_financial_report_question("list purchase orders"))
        self.assertEqual(infer_financial_report_type("list purchase orders"), "")

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


if __name__ == "__main__":
    unittest.main()
