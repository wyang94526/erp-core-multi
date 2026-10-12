# @author: Wendy Yang
# @date: 2026-10-12

import unittest
from decimal import Decimal

from app.services.inspection_control import (
    counts_as_available,
    disposition_is_terminal,
    legacy_stock_mismatch,
    measurement_passed,
    override_block_reason,
    receipt_is_closed,
    reopen_block_reason,
    signoff_block_reason,
)


class InspectionControlTests(unittest.TestCase):
    def test_a_final_decision_closes_the_lot(self):
        self.assertFalse(receipt_is_closed(["pending"]))
        self.assertTrue(receipt_is_closed(["accepted"]))
        self.assertTrue(receipt_is_closed(["rejected", "pending"]))

    def test_quarantine_is_not_available_stock(self):
        self.assertTrue(counts_as_available("unrestricted"))
        self.assertTrue(counts_as_available(None))
        self.assertFalse(counts_as_available("quarantine"))
        self.assertFalse(counts_as_available("scrap"))

    def test_admin_cannot_sign_off_without_a_quality_role(self):
        reason = signoff_block_reason({"ROLE-ADMIN"}, "user-1", None)
        self.assertIn("Quality Inspector", reason or "")

    def test_the_receiver_cannot_sign_off(self):
        reason = signoff_block_reason({"ROLE-QC-INSP"}, "user-1", "user-1")
        self.assertIn("received this lot", reason or "")

    def test_a_quality_inspector_who_did_not_receive_the_lot_can_sign_off(self):
        self.assertIsNone(signoff_block_reason({"ROLE-QC-MGR"}, "inspector", "receiver"))

    def test_only_a_different_quality_manager_can_reopen(self):
        self.assertIn("Quality Manager", reopen_block_reason({"ROLE-QC-INSP"}, "mgr", "other") or "")
        self.assertIn("cannot approve", reopen_block_reason({"ROLE-QC-MGR"}, "same", "same") or "")
        self.assertIsNone(reopen_block_reason({"ROLE-QC-MGR"}, "mgr", "requester"))

    def test_numeric_limits_are_inclusive(self):
        self.assertTrue(measurement_passed("numeric", "10", Decimal("9"), Decimal("11"), None))
        self.assertTrue(measurement_passed("numeric", "9", Decimal("9"), Decimal("11"), None))
        self.assertFalse(measurement_passed("numeric", "12", Decimal("9"), Decimal("11"), None))

    def test_attribute_results_must_be_a_passing_value(self):
        self.assertTrue(measurement_passed("attribute", "Pass", None, None, "Pass"))
        self.assertFalse(measurement_passed("attribute", "Scratch", None, None, "Pass"))

    def test_scrap_and_rework_are_terminal_and_unavailable(self):
        self.assertTrue(disposition_is_terminal("scrap"))
        self.assertTrue(disposition_is_terminal("rework"))
        self.assertFalse(disposition_is_terminal("quarantine"))
        self.assertFalse(counts_as_available("rework"))

    def test_a_rejected_lot_left_in_unrestricted_stock_is_a_legacy_mismatch(self):
        self.assertTrue(legacy_stock_mismatch("rejected", "unrestricted"))
        self.assertFalse(legacy_stock_mismatch("rejected", "quarantine"))
        self.assertFalse(legacy_stock_mismatch("accepted", "unrestricted"))

    def test_emergency_override_requires_an_administrator_and_a_justification(self):
        self.assertIn("administrator", override_block_reason({"ROLE-QC-MGR"}, "a" * 20) or "")
        self.assertIn("20", override_block_reason({"ROLE-ADMIN"}, "too short") or "")
        self.assertIsNone(override_block_reason({"ROLE-ADMIN"}, "Correct the legacy stock location now."))

    def test_a_blank_or_non_numeric_measurement_is_rejected(self):
        with self.assertRaises(ValueError):
            measurement_passed("numeric", "  ", Decimal("0"), Decimal("1"), None)
        with self.assertRaises(ValueError):
            measurement_passed("numeric", "wide", Decimal("0"), Decimal("1"), None)


if __name__ == "__main__":
    unittest.main()
