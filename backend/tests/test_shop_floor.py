# @author: Wendy Yang
# @date: 2026-10-11

import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException

from app.services.production import routing_snapshot
from app.services.shop_floor import (
    apply_backflush,
    backflush_delta_units,
    proportional_issue_qty,
    time_variance,
    validate_step_output,
)


class ShopFloorTests(unittest.TestCase):
    def test_routing_snapshot_keeps_the_step_copied_onto_the_draft(self):
        template = SimpleNamespace(
            sequence=10,
            name="Assembly",
            work_center_id="WC-PLATING-01",
            setup_minutes=Decimal("5"),
            run_minutes_per_unit=Decimal("2"),
        )
        frozen = routing_snapshot(template, uuid4(), "MP01-26100002")
        template.name = "Pack"
        template.sequence = 20
        template.work_center_id = "WC-OUTSIDE-01"
        self.assertEqual(frozen["operation_name"], "Assembly")
        self.assertEqual(frozen["operation_sequence"], 10)
        self.assertEqual(frozen["work_center_id"], "WC-PLATING-01")
        self.assertEqual(frozen["status"], "pending")

    def test_backflush_uses_good_and_scrap_once(self):
        self.assertEqual(proportional_issue_qty(Decimal("10"), 10, 10), 10)
        self.assertEqual(backflush_delta_units(reported=10, already=10), 0)
        self.assertEqual(backflush_delta_units(reported=8, already=10), 0)
        self.assertEqual(backflush_delta_units(reported=10, already=8), 2)

    def test_rework_does_not_increase_the_backflush(self):
        self.assertEqual(proportional_issue_qty(Decimal("10"), 10, 8 + 2), 10)

    def test_variance_against_standard_setup_and_run(self):
        result = time_variance(Decimal("5"), Decimal("2"), 10, Decimal("8"), Decimal("15"))
        self.assertEqual(result["standard_minutes"], Decimal("25.00"))
        self.assertEqual(result["actual_minutes"], Decimal("23.00"))
        self.assertEqual(result["variance_minutes"], Decimal("-2.00"))

    def test_scrap_requires_a_reason_and_a_failed_check_needs_disposition(self):
        with self.assertRaises(HTTPException) as missing_reason:
            validate_step_output(8, 2, 0, 10, None, False)
        self.assertEqual(missing_reason.exception.status_code, 400)
        reason = validate_step_output(8, 2, 1, 10, "raw_material_defect", True)
        self.assertEqual(reason, "RAW_MATERIAL_DEFECT")
        with self.assertRaises(HTTPException) as blocked:
            validate_step_output(10, 0, 0, 10, None, True)
        self.assertIn("scrap or rework", blocked.exception.detail)

    def test_completing_a_step_backflushes_component_inventory(self):
        component = SimpleNamespace(item_id="COMP-1", item_type="INVENTORY", on_hand_quantity=20)
        material = SimpleNamespace(
            id=1,
            component_item_id="COMP-1",
            quantity_required=Decimal("10"),
            quantity_issued=Decimal("0"),
        )
        order = SimpleNamespace(
            company_id=uuid4(),
            production_order_id="MP01-1",
            qty_ordered=10,
            warehouse_id="WH-MAIN",
            backflushed_units=0,
            materials=[material],
        )
        step = SimpleNamespace(id=5, operation_sequence=10)
        db = SimpleNamespace(get=lambda model, key: component if key == "COMP-1" else None, added=[])
        db.add = db.added.append

        def consume(_db, item, quantity, reference, notes, warehouse_id):
            item.on_hand_quantity -= quantity
            self.assertEqual(reference, "MP01-1")
            self.assertEqual(warehouse_id, "WH-MAIN")

        with patch("app.services.shop_floor._consume_component", consume):
            created = apply_backflush(db, order, step, reported_units=10, lot_number="LOT-9", serial_number=None)
            again = apply_backflush(db, order, step, reported_units=10, lot_number="LOT-9", serial_number=None)

        self.assertEqual(component.on_hand_quantity, 10)
        self.assertEqual(material.quantity_issued, Decimal("10"))
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0].quantity, Decimal("10"))
        self.assertEqual(created[0].lot_number, "LOT-9")
        self.assertEqual(again, [])
        self.assertEqual(order.backflushed_units, 10)


if __name__ == "__main__":
    unittest.main()
