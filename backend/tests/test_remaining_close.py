# @author: Wendy Yang
# @date: 2026-09-30

from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.services.remaining_close import (
    NO_OPEN_REMAINING_DETAIL,
    NO_PARTIAL_PROGRESS_DETAIL,
    REMAINING_ALREADY_CLOSED_DETAIL,
    UNBILLED_RECEIVED_DETAIL,
    assert_can_close_remaining,
    is_remaining_closed,
)


class RemainingCloseTests(TestCase):
    def test_requires_partial_progress(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_can_close_remaining(progressed=0, remaining=200)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, NO_PARTIAL_PROGRESS_DETAIL)

    def test_requires_open_remaining(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_can_close_remaining(progressed=800, remaining=0)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, NO_OPEN_REMAINING_DETAIL)

    def test_allows_partial_then_close(self):
        assert_can_close_remaining(progressed=800, remaining=200)

    def test_requires_received_qty_billed(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_can_close_remaining(progressed=800, remaining=200, unbilled=800)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, UNBILLED_RECEIVED_DETAIL)

    def test_allows_close_after_received_is_billed(self):
        assert_can_close_remaining(progressed=800, remaining=200, unbilled=0)

    def test_already_closed_flag(self):
        self.assertTrue(is_remaining_closed(SimpleNamespace(remaining_closed=True)))
        self.assertFalse(is_remaining_closed(SimpleNamespace(remaining_closed=False)))
        self.assertFalse(is_remaining_closed(SimpleNamespace()))
        self.assertEqual(REMAINING_ALREADY_CLOSED_DETAIL, "Remaining quantity is already cancelled.")
