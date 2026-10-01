# @author: Wendy Yang
# @date: 2026-10-01

from unittest import TestCase
from unittest.mock import patch

from app.ai.agent import (
    ERP_SCOPE_REPLY,
    _is_out_of_scope_question,
    _run_heuristic,
)


class OutOfScopeQuestionTests(TestCase):
    def test_weather_is_out_of_scope(self):
        self.assertTrue(_is_out_of_scope_question("weather in Taipei today"))
        self.assertTrue(_is_out_of_scope_question("What's the temperature in Taipei?"))

    def test_erp_lookups_are_in_scope(self):
        self.assertFalse(_is_out_of_scope_question("Show me the revenue for September 2026"))
        self.assertFalse(_is_out_of_scope_question("cash flow forecast for 2026"))
        self.assertFalse(_is_out_of_scope_question("how do I create a purchase order"))

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
