# @author: Wendy Yang
# @date: 2026-10-11

import unittest
from decimal import Decimal

from fastapi import HTTPException

from types import SimpleNamespace

from app.services.master_routings import can_edit_routing, freeze_routing_steps
from app.services.production import (
    canonical_status,
    component_is_short,
    next_status,
    open_receipt_quantity,
    production_is_covered,
)


class ProductionOrderRulesTests(unittest.TestCase):
    def test_in_progress_is_stored_as_in_process(self):
        self.assertEqual(canonical_status("in_progress"), "in_process")
        self.assertEqual(next_status("released", "in_progress"), "in_process")

    def test_draft_can_be_released_or_cancelled(self):
        self.assertEqual(next_status("draft", "released"), "released")
        self.assertEqual(next_status("draft", "cancelled"), "cancelled")

    def test_completed_order_cannot_return_to_draft(self):
        with self.assertRaises(HTTPException) as caught:
            next_status("completed", "draft")
        self.assertEqual(caught.exception.status_code, 400)

    def test_frozen_routing_keeps_the_revision_copied_onto_the_order(self):
        step = SimpleNamespace(
            sequence=10,
            name="Assembly",
            work_center_id="WC-OUTSIDE-01",
            setup_minutes=5,
            run_minutes_per_unit=2,
        )
        frozen = freeze_routing_steps([step], routing_code="RT-ASSY", version_no=1)
        step.name = "Rework"
        step.sequence = 20
        self.assertEqual(frozen[0]["name"], "Assembly")
        self.assertEqual(frozen[0]["sequence"], 10)
        self.assertEqual(frozen[0]["routing_code"], "RT-ASSY")
        self.assertEqual(frozen[0]["routing_version_no"], 1)

    def test_shop_floor_cannot_edit_the_route_library(self):
        self.assertFalse(can_edit_routing({"routing:view", "production:view"}, is_admin=False))
        self.assertTrue(can_edit_routing({"routing:edit"}, is_admin=False))
        self.assertTrue(can_edit_routing(set(), is_admin=True))

    def test_scrap_closes_the_remaining_receipt_quantity(self):
        self.assertEqual(open_receipt_quantity(10, 8, 2), 0)
        self.assertTrue(production_is_covered(10, 8, 2))
        self.assertEqual(open_receipt_quantity(10, 8, 0), 2)
        self.assertFalse(production_is_covered(10, 8, 0))

    def test_stocked_component_shortfall(self):
        self.assertTrue(component_is_short(Decimal("2"), Decimal("5"), True))
        self.assertFalse(component_is_short(Decimal("5"), Decimal("5"), True))
        self.assertFalse(component_is_short(Decimal("0"), Decimal("5"), False))


if __name__ == "__main__":
    unittest.main()
