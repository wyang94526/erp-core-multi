# @author: Wendy Yang
# @date: 2026-09-30

from decimal import Decimal
from unittest import TestCase

from fastapi import HTTPException

from app.services.p2p import apply_balanced_amount_to_postings, assert_receipt_qty_adjustment


class ReceiptQtyAdjustmentTests(TestCase):
    def test_allows_partial_correction(self):
        assert_receipt_qty_adjustment(
            sku="1001G00001710",
            old_qty=Decimal("800"),
            new_qty=Decimal("750"),
            ordered_qty=Decimal("1000"),
            already_received=Decimal("800"),
            billed_qty=Decimal("0"),
            remaining_closed=False,
        )

    def test_rejects_qty_over_ordered(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_receipt_qty_adjustment(
                sku="1001G00001710",
                old_qty=Decimal("800"),
                new_qty=Decimal("1100"),
                ordered_qty=Decimal("1000"),
                already_received=Decimal("800"),
                billed_qty=Decimal("0"),
                remaining_closed=False,
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("exceeds remaining receivable", ctx.exception.detail)

    def test_rejects_below_billed(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_receipt_qty_adjustment(
                sku="1001G00001710",
                old_qty=Decimal("800"),
                new_qty=Decimal("500"),
                ordered_qty=Decimal("1000"),
                already_received=Decimal("800"),
                billed_qty=Decimal("600"),
                remaining_closed=False,
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("below billed quantity", ctx.exception.detail)

    def test_closed_remaining_blocks_increase_not_decrease(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_receipt_qty_adjustment(
                sku="1001G00001710",
                old_qty=Decimal("800"),
                new_qty=Decimal("850"),
                ordered_qty=Decimal("1000"),
                already_received=Decimal("800"),
                billed_qty=Decimal("0"),
                remaining_closed=True,
            )
        self.assertIn("closed", ctx.exception.detail)
        assert_receipt_qty_adjustment(
            sku="1001G00001710",
            old_qty=Decimal("800"),
            new_qty=Decimal("750"),
            ordered_qty=Decimal("1000"),
            already_received=Decimal("800"),
            billed_qty=Decimal("0"),
            remaining_closed=True,
        )


class GrniJournalAmountTests(TestCase):
    def test_rewrites_debit_and_credit_to_new_receipt_value(self):
        debit = type("P", (), {"debit": Decimal("35776.00"), "credit": Decimal("0")})()
        credit = type("P", (), {"debit": Decimal("0"), "credit": Decimal("35776.00")})()
        self.assertTrue(apply_balanced_amount_to_postings([debit, credit], Decimal("31304")))
        self.assertEqual(debit.debit, Decimal("31304.00"))
        self.assertEqual(debit.credit, Decimal("0.0000"))
        self.assertEqual(credit.credit, Decimal("31304.00"))
        self.assertEqual(credit.debit, Decimal("0.0000"))

