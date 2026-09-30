# @author: Wendy Yang
# @date: 2026-09-19

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.p2p import (
    ALL_PO_ITEMS_RECEIVED_MESSAGE,
    PURCHASE_ORDER_LOCKED_EDIT_DETAIL,
    assert_po_approved_for_p2p,
    assert_purchase_order_deletable,
    assert_purchase_order_editable,
    purchase_order_delete_reason,
    purchase_order_is_editable,
    purchase_order_lock_reason,
    recall_status_blocker,
    remaining_to_bill,
    remaining_to_receive,
)


def test_recall_allowed_from_approved_and_submitted():
    assert (
        recall_status_blocker(SimpleNamespace(status="Approved", approval_status="APPROVED"))
        is None
    )
    assert (
        recall_status_blocker(
            SimpleNamespace(status="Submitted", approval_status="PENDING_APPROVAL")
        )
        is None
    )
    assert (
        recall_status_blocker(SimpleNamespace(status="Submitted", approval_status="SUBMITTED"))
        is None
    )


def test_recall_allowed_when_po_status_is_approved_even_if_approval_is_draft():
    assert (
        recall_status_blocker(SimpleNamespace(status="Approved", approval_status="DRAFT"))
        is None
    )
    assert (
        recall_status_blocker(SimpleNamespace(status="Submitted", approval_status="DRAFT"))
        is None
    )
    assert recall_status_blocker(
        SimpleNamespace(status="Draft", approval_status="DRAFT")
    )
    assert recall_status_blocker(
        SimpleNamespace(status="Draft", approval_status="REJECTED")
    )
    assert recall_status_blocker(
        SimpleNamespace(status="Void", approval_status="APPROVED")
    )


def test_receive_and_bill_require_approval_status_approved():
    with pytest.raises(HTTPException) as recalled:
        assert_po_approved_for_p2p(
            SimpleNamespace(approval_status="DRAFT", status="Approved"),
            action="receive",
        )
    assert recalled.value.status_code == 400
    assert "DRAFT" in recalled.value.detail

    with pytest.raises(HTTPException) as submitted:
        assert_po_approved_for_p2p(
            SimpleNamespace(approval_status="PENDING_APPROVAL", status="Submitted"),
            action="create a supplier invoice",
        )
    assert submitted.value.status_code == 400

    assert_po_approved_for_p2p(
        SimpleNamespace(approval_status="APPROVED", status="Approved"),
        action="receive",
    )


def test_approved_and_received_pos_are_not_inline_editable():
    approved = SimpleNamespace(status="Approved", approval_status="APPROVED")
    assert purchase_order_is_editable(approved) is False
    assert purchase_order_lock_reason(approved) == PURCHASE_ORDER_LOCKED_EDIT_DETAIL
    with pytest.raises(HTTPException) as locked:
        assert_purchase_order_editable(approved)
    assert locked.value.status_code == 409

    received = SimpleNamespace(
        status="Approved",
        approval_status="APPROVED",
        has_posted_receipts=True,
    )
    assert "Posted goods receipts" in (purchase_order_lock_reason(received) or "")

    pending = SimpleNamespace(status="Submitted", approval_status="PENDING_APPROVAL")
    assert purchase_order_is_editable(pending) is False
    assert "in approval" in (purchase_order_lock_reason(pending) or "")


def test_draft_and_rejected_pos_remain_editable():
    assert purchase_order_is_editable(
        SimpleNamespace(status="Draft", approval_status="DRAFT")
    )
    assert purchase_order_is_editable(
        SimpleNamespace(status="Draft", approval_status="REJECTED")
    )
    assert purchase_order_lock_reason(
        SimpleNamespace(status="Void", approval_status="DRAFT")
    )


def test_remaining_to_receive_floors_at_zero():
    assert remaining_to_receive(Decimal("500"), Decimal("500"), amount_only=False) == Decimal("0")
    assert remaining_to_receive(Decimal("500"), Decimal("200"), amount_only=False) == Decimal("300")
    assert remaining_to_receive(Decimal("0"), Decimal("0"), amount_only=True) == Decimal("1")
    assert remaining_to_receive(Decimal("0"), Decimal("1"), amount_only=True) == Decimal("0")


def test_remaining_to_bill_matches_received_qty():
    assert remaining_to_bill(
        Decimal("500"),
        Decimal("500"),
        ordered=Decimal("500"),
        billed_amount=Decimal("0"),
        line_amount=Decimal("0"),
        amount_only=False,
    ) == Decimal("0")
    assert remaining_to_bill(
        Decimal("500"),
        Decimal("100"),
        ordered=Decimal("500"),
        billed_amount=Decimal("0"),
        line_amount=Decimal("0"),
        amount_only=False,
    ) == Decimal("400")
    assert remaining_to_bill(
        Decimal("1"),
        Decimal("0"),
        ordered=Decimal("0"),
        billed_amount=Decimal("25"),
        line_amount=Decimal("25"),
        amount_only=True,
    ) == Decimal("0")


class _FlagDb:
    def __init__(self, receipts=False, invoices=False):
        self.receipts = receipts
        self.invoices = invoices
        self._step = 0

    def query(self, _col):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        self._step += 1
        if self._step == 1:
            return object() if self.receipts else None
        return object() if self.invoices else None


def test_purchase_order_with_receipts_cannot_be_deleted():
    po = SimpleNamespace(po_number="PU62-26090008", status="Approved", approval_status="APPROVED")
    reason = purchase_order_delete_reason(_FlagDb(receipts=True), po)
    assert reason is not None
    assert "goods receipts" in reason
    with pytest.raises(HTTPException) as blocked:
        assert_purchase_order_deletable(_FlagDb(receipts=True), po)
    assert blocked.value.status_code == 409


def test_draft_purchase_order_without_downstream_docs_can_be_deleted():
    po = SimpleNamespace(po_number="PU62-26090099", status="Draft", approval_status="DRAFT")
    assert purchase_order_delete_reason(_FlagDb(), po) is None
    assert_purchase_order_deletable(_FlagDb(), po)


def test_approved_purchase_order_without_receipts_cannot_be_deleted():
    po = SimpleNamespace(po_number="PU62-26090100", status="Approved", approval_status="APPROVED")
    reason = purchase_order_delete_reason(_FlagDb(), po)
    assert reason is not None
    assert "draft" in reason.lower()


def test_fully_received_message_constant():
    assert ALL_PO_ITEMS_RECEIVED_MESSAGE == (
        "All items on this purchase order have been fully received"
    )
