# @author: Wendy Yang
# @date: 2026-10-13

import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException

from app.services.accounting import validate_posting_rows
from app.services.compliance import (
    accrual_posting_date,
    assembled_release_block,
    component_lot_block,
    document_audit_fields,
    finished_inventory_block,
    historical_journal_block,
    inventory_lot_block,
    journal_audit_fields,
    quality_gate_block,
    released_revision_block,
    reversal_lines,
    shipment_trace_block,
    vendor_list_block,
)
from app.services.period_close import SETTINGS_ID, assert_transaction_date_open
from app.services.production import receipt_posts_immediately


class _Query:
    def __init__(self, row):
        self.row = row

    def order_by(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.row


class _FakeDb:
    def __init__(self, settings):
        self.settings = settings

    def get(self, _model, key):
        if key == self.settings.id:
            return self.settings
        return None

    def query(self, _model):
        return _Query(self.settings)

    def add(self, _obj):
        return None

    def flush(self):
        return None


class ComplianceControlTests(unittest.TestCase):
    def test_locked_period_rejects_a_journal_date(self):
        settings = SimpleNamespace(
            id=SETTINGS_ID,
            current_closing_date=None,
            soft_close_date=None,
            hard_close_date=date(2026, 9, 30),
        )
        with self.assertRaises(HTTPException) as caught:
            assert_transaction_date_open(
                _FakeDb(settings),
                date(2026, 9, 15),
                document="journal entry",
            )
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIn("hard-closed", str(caught.exception.detail))

    def test_uninspected_lots_cannot_enter_finished_inventory(self):
        self.assertFalse(receipt_posts_immediately(False))
        self.assertIn("finished inventory", finished_inventory_block("pending") or "")
        self.assertIn("finished inventory", finished_inventory_block(None) or "")
        self.assertIsNone(finished_inventory_block("accepted"))

    def test_an_operation_cannot_advance_good_quantity_without_a_passing_inspection(self):
        self.assertIn("quality inspection", quality_gate_block(8, []) or "")
        self.assertIn("passes", quality_gate_block(8, [False]) or "")
        self.assertIsNone(quality_gate_block(8, [True]))
        self.assertIsNone(quality_gate_block(0, []))

    def test_shipment_requires_acceptance_and_a_component_lot(self):
        self.assertIn("cannot be picked", shipment_trace_block("rejected", "FG-1", ["RM-1"]) or "")
        self.assertIn("raw-material", shipment_trace_block("accepted", "FG-1", []) or "")
        self.assertIsNone(shipment_trace_block("accepted", "FG-1", ["RM-1"]))
        self.assertIn("raw-material lot", component_lot_block(None, consumes_material=True) or "")

    def test_only_an_approved_active_vendor_can_be_purchased(self):
        self.assertIn("Active", vendor_list_block("Inactive", "approved") or "")
        self.assertIn("not approved", vendor_list_block("Active", "blocked") or "")
        self.assertIsNone(vendor_list_block("Active", "approved"))

    def test_released_bom_revisions_are_locked(self):
        self.assertIn("locked", released_revision_block("active") or "")
        self.assertIn("locked", released_revision_block("obsolete") or "")
        self.assertIsNone(released_revision_block("draft"))

    def test_posted_journals_are_not_overwritten(self):
        self.assertIn("reversal", historical_journal_block("Posted") or "")
        self.assertIsNone(historical_journal_block("Draft"))

    def test_journal_audit_attributes_create_edit_and_delete_to_the_user(self):
        user_id = uuid4()
        entry_id = uuid4()
        for action in ("CREATE", "UPDATE", "DELETE"):
            fields = journal_audit_fields(entry_id, user_id, action, "JV-1", f"{action} reason")
            self.assertEqual(fields["table_name"], "journal_entries")
            self.assertEqual(fields["record_id"], entry_id)
            self.assertEqual(fields["user_id"], user_id)
            self.assertEqual(fields["action"], action)
            body = fields["old_data"] if action == "DELETE" else fields["new_data"]
            self.assertEqual(body["user_id"], str(user_id))

    def test_unbalanced_journals_are_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            validate_posting_rows(
                [
                    {"debit": Decimal("10"), "credit": Decimal("0")},
                    {"debit": Decimal("0"), "credit": Decimal("9")},
                ]
            )
        self.assertIn("not balanced", str(caught.exception.detail))

    def test_a_shipment_without_acceptance_or_component_lots_is_blocked(self):
        self.assertIn(
            "cannot be picked",
            assembled_release_block(
                stock_tracked=True,
                inspection_status="pending",
                finished_lot="FG-1",
                component_lots=["RM-1"],
            )
            or "",
        )
        self.assertIn(
            "raw-material",
            assembled_release_block(
                stock_tracked=True,
                inspection_status="accepted",
                finished_lot="FG-1",
                component_lots=[],
            )
            or "",
        )
        self.assertIsNone(
            assembled_release_block(
                stock_tracked=True,
                inspection_status="accepted",
                finished_lot="FG-1",
                component_lots=["RM-1"],
            )
        )
        self.assertIsNone(
            assembled_release_block(
                stock_tracked=False,
                inspection_status=None,
                finished_lot=None,
                component_lots=[],
            )
        )

    def test_inventory_movement_requires_a_lot(self):
        self.assertIn("lot", inventory_lot_block(None) or "")
        self.assertIsNone(inventory_lot_block("RM-9"))

    def test_document_audit_attributes_a_sales_order_to_the_user(self):
        user_id = uuid4()
        fields = document_audit_fields(
            "salesorders",
            "CREATE",
            user_id,
            "Sales order created",
            document_key="SO-1",
        )
        self.assertEqual(fields["document_key"], "SO-1")
        self.assertIsNone(fields["record_id"])
        self.assertEqual(fields["user_id"], user_id)
        self.assertEqual(fields["new_data"]["user_id"], str(user_id))
        voided = document_audit_fields(
            "sales_invoices",
            "VOID",
            user_id,
            "Customer cancelled",
            document_key="INV-1",
        )
        self.assertEqual(voided["action"], "VOID")
        self.assertEqual(voided["old_data"]["reason"], "Customer cancelled")

    def test_a_reversal_offsets_the_original_journal(self):
        original = [
            {"account_id": "ar", "debit": Decimal("10"), "credit": Decimal("0")},
            {"account_id": "revenue", "debit": Decimal("0"), "credit": Decimal("10")},
        ]
        reversed_rows = reversal_lines(original)
        self.assertEqual(reversed_rows[0]["debit"], Decimal("0"))
        self.assertEqual(reversed_rows[0]["credit"], Decimal("10"))
        self.assertEqual(reversed_rows[1]["debit"], Decimal("10"))
        validate_posting_rows(reversed_rows)

    def test_accrual_uses_the_transaction_date_rather_than_cash_date(self):
        self.assertEqual(
            accrual_posting_date(date(2026, 9, 30), date(2026, 10, 15)),
            date(2026, 9, 30),
        )


if __name__ == "__main__":
    unittest.main()
