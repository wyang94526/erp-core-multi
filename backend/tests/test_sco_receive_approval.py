# @author: Wendy Yang
# @date: 2026-09-19

from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.services.subcontract import (
    SCO_MUST_BE_APPROVED_TO_ISSUE_DETAIL,
    SCO_RECEIVE_REQUIRES_APPROVAL_DETAIL,
    assert_sco_fulfillment_allowed,
    assert_sco_receive_allowed,
)


class ScoReceiveApprovalTests(TestCase):
    def test_receive_allowed_only_when_approved_and_open(self):
        assert_sco_receive_allowed(
            SimpleNamespace(status="MATERIALS_ISSUED", approval_status="APPROVED")
        )

    def test_receive_blocked_for_draft_pending_and_rejected(self):
        for approval in ("DRAFT", "PENDING_APPROVAL", "REJECTED"):
            with self.assertRaises(HTTPException) as raised:
                assert_sco_receive_allowed(
                    SimpleNamespace(status="PLANNED", approval_status=approval)
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
                )
            )
        self.assertEqual(raised.exception.detail, SCO_RECEIVE_REQUIRES_APPROVAL_DETAIL)

    def test_kit_issue_blocked_before_approval(self):
        for approval in ("DRAFT", "PENDING_APPROVAL", "REJECTED"):
            with self.assertRaises(HTTPException) as raised:
                assert_sco_fulfillment_allowed(
                    SimpleNamespace(status="PLANNED", approval_status=approval),
                    "issuing materials",
                )
            self.assertEqual(raised.exception.status_code, 400)
            self.assertEqual(raised.exception.detail, SCO_MUST_BE_APPROVED_TO_ISSUE_DETAIL)

    def test_kit_issue_allowed_after_approval(self):
        assert_sco_fulfillment_allowed(
            SimpleNamespace(status="PLANNED", approval_status="APPROVED"),
            "issuing materials",
        )

    def test_receive_blocked_when_closed(self):
        with self.assertRaises(HTTPException) as raised:
            assert_sco_receive_allowed(
                SimpleNamespace(status="COMPLETED", approval_status="APPROVED")
            )
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("completed", raised.exception.detail)
