# @author: Wendy Yang
# @date: 2026-09-19

from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.services.subcontract import (
    SCO_KIT_MUST_BE_ISSUED_DETAIL,
    SCO_RECEIVE_REQUIRES_APPROVAL_DETAIL,
    SCO_RECEIVE_REQUIRES_KIT_DETAIL,
    assert_sco_fulfillment_allowed,
    assert_sco_kit_fully_issued,
    assert_sco_receive_allowed,
    sco_kit_is_fully_issued,
)


ISSUED_KIT = [
    SimpleNamespace(quantity_required=Decimal("2"), quantity_issued=Decimal("2")),
]


class ScoReceiveApprovalTests(TestCase):
    def test_receive_allowed_when_approved_and_kit_issued(self):
        assert_sco_receive_allowed(
            SimpleNamespace(
                status="MATERIALS_ISSUED",
                approval_status="APPROVED",
                components=ISSUED_KIT,
            )
        )

    def test_receive_blocked_when_kit_not_issued(self):
        with self.assertRaises(HTTPException) as raised:
            assert_sco_receive_allowed(
                SimpleNamespace(status="PLANNED", approval_status="APPROVED", components=[])
            )
        self.assertEqual(raised.exception.detail, SCO_RECEIVE_REQUIRES_KIT_DETAIL)

    def test_receive_blocked_for_draft_pending_and_rejected(self):
        for approval in ("DRAFT", "PENDING_APPROVAL", "REJECTED"):
            with self.assertRaises(HTTPException) as raised:
                assert_sco_receive_allowed(
                    SimpleNamespace(
                        status="MATERIALS_ISSUED",
                        approval_status=approval,
                        components=ISSUED_KIT,
                    )
                )
            self.assertEqual(raised.exception.status_code, 400)
            self.assertEqual(raised.exception.detail, SCO_RECEIVE_REQUIRES_APPROVAL_DETAIL)

    def test_receive_blocked_while_amending(self):
        with self.assertRaises(HTTPException) as raised:
            assert_sco_receive_allowed(
                SimpleNamespace(
                    status="PARTIALLY_ISSUED",
                    approval_status="DRAFT",
                    amendment_number=1,
                    components=ISSUED_KIT,
                )
            )
        self.assertEqual(raised.exception.detail, SCO_RECEIVE_REQUIRES_APPROVAL_DETAIL)

    def test_kit_issue_allowed_before_approval(self):
        for approval in ("DRAFT", "PENDING_APPROVAL", "REJECTED", "APPROVED"):
            assert_sco_fulfillment_allowed(
                SimpleNamespace(status="PLANNED", approval_status=approval),
                "issuing materials",
            )

    def test_kit_issue_blocked_when_closed(self):
        with self.assertRaises(HTTPException) as raised:
            assert_sco_fulfillment_allowed(
                SimpleNamespace(status="COMPLETED", approval_status="APPROVED"),
                "issuing materials",
            )
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("completed", raised.exception.detail)

    def test_empty_kit_is_not_fully_issued(self):
        self.assertFalse(sco_kit_is_fully_issued(SimpleNamespace(components=[])))
        with self.assertRaises(HTTPException) as raised:
            assert_sco_kit_fully_issued(SimpleNamespace(components=[]))
        self.assertEqual(raised.exception.detail, SCO_KIT_MUST_BE_ISSUED_DETAIL)

    def test_receive_blocked_when_closed(self):
        with self.assertRaises(HTTPException) as raised:
            assert_sco_receive_allowed(
                SimpleNamespace(
                    status="COMPLETED",
                    approval_status="APPROVED",
                    components=ISSUED_KIT,
                )
            )
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("completed", raised.exception.detail)
