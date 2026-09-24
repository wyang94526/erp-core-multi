# @author: Wendy Yang
# @date: 2026-09-24

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
import unittest

from fastapi import HTTPException

from app.services.finance import (
    GENERATED_JOURNAL_APPROVAL_STATUS,
    GENERATED_JOURNAL_POSTING_STATUS,
    assert_bank_transfer_accounts,
    assert_bank_transfer_amount,
    assert_transfer_within_balance,
    is_bank_transfer_deletable,
    serialize_bank_transfer,
)


class BankTransferValidationTests(unittest.TestCase):
    def test_rejects_same_from_and_to_account(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_bank_transfer_accounts("BANK-OPERATING", "BANK-OPERATING")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("different", str(ctx.exception.detail).lower())

    def test_rejects_missing_accounts(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_bank_transfer_accounts("", "BANK-PAYROLL")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_accepts_distinct_accounts(self):
        assert_bank_transfer_accounts("BANK-OPERATING", "BANK-PAYROLL")

    def test_amount_must_be_greater_than_zero(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_bank_transfer_amount(0)
        self.assertEqual(ctx.exception.status_code, 400)
        with self.assertRaises(HTTPException) as ctx:
            assert_bank_transfer_amount("-10.00")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_amount_quantizes_to_cents(self):
        self.assertEqual(assert_bank_transfer_amount("25.1"), Decimal("25.10"))

    def test_rejects_amount_above_available_book_balance(self):
        assert_transfer_within_balance(Decimal("25.00"), Decimal("25.00"))
        with self.assertRaises(HTTPException) as ctx:
            assert_transfer_within_balance(Decimal("1500000000.00"), Decimal("1200.50"))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Insufficient funds", ctx.exception.detail)
        self.assertIn("1,200.50", ctx.exception.detail)

    def test_serialize_includes_account_labels_and_status(self):
        transfer = SimpleNamespace(
            id=3,
            from_account_id="BANK-OPERATING",
            to_account_id="BANK-PAYROLL",
            from_account=SimpleNamespace(
                bank_name="Amerant Bank",
                account_name="Operating",
                account_number="0000008420",
            ),
            to_account=SimpleNamespace(
                bank_name="Amerant Bank",
                account_name="Payroll",
                account_number="0000009001",
            ),
            amount=Decimal("150.00"),
            transfer_date=date(2026, 9, 24),
            reference_number="BTR-000003",
            status="draft",
            approval_status="draft",
            current_approval_step=None,
            journal_entry_id=None,
            created_at=None,
        )
        data = serialize_bank_transfer(transfer)
        self.assertEqual(data["id"], 3)
        self.assertEqual(data["status"], "DRAFT")
        self.assertEqual(data["approval_status"], "DRAFT")
        self.assertIn("Operating", data["from_account_name"] or "")
        self.assertIn("Payroll", data["to_account_name"] or "")
        self.assertEqual(data["reference_number"], "BTR-000003")

    def test_transfer_journals_start_as_drafts(self):
        self.assertEqual(GENERATED_JOURNAL_POSTING_STATUS, "Draft")
        self.assertEqual(GENERATED_JOURNAL_APPROVAL_STATUS, "DRAFT")


class BankTransferDeleteTests(unittest.TestCase):
    def test_only_draft_gl_and_draft_approval_are_deletable(self):
        draft = SimpleNamespace(status="DRAFT", approval_status="DRAFT")
        self.assertTrue(is_bank_transfer_deletable(draft))
        self.assertFalse(
            is_bank_transfer_deletable(SimpleNamespace(status="DRAFT", approval_status="REJECTED"))
        )
        self.assertFalse(
            is_bank_transfer_deletable(
                SimpleNamespace(status="DRAFT", approval_status="PENDING_APPROVAL")
            )
        )
        self.assertFalse(
            is_bank_transfer_deletable(SimpleNamespace(status="POSTED", approval_status="APPROVED"))
        )

    def test_delete_rejects_non_draft_approval(self):
        from unittest.mock import patch

        from app.services import finance

        db = MagicMock()
        pending = SimpleNamespace(
            id=5,
            status="DRAFT",
            approval_status="PENDING_APPROVAL",
            journal_entry_id=None,
        )
        with patch.object(finance, "get_bank_transfer", return_value=pending):
            with self.assertRaises(HTTPException) as ctx:
                finance.delete_bank_transfer(db, 5)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("both Draft", str(ctx.exception.detail))
        db.delete.assert_not_called()

    def test_delete_removes_draft_transfer(self):
        from unittest.mock import patch

        from app.services import finance

        db = MagicMock()
        draft = SimpleNamespace(
            id=5,
            status="DRAFT",
            approval_status="DRAFT",
            journal_entry_id=None,
        )
        with patch.object(finance, "get_bank_transfer", return_value=draft):
            finance.delete_bank_transfer(db, 5)
        db.delete.assert_called_once_with(draft)


class BankTransferPostingTests(unittest.TestCase):
    def test_post_rejects_already_posted(self):
        from unittest.mock import patch

        from app.services import finance

        db = MagicMock()
        posted = SimpleNamespace(
            id=1,
            status="POSTED",
            from_account_id="BANK-A",
            to_account_id="BANK-B",
            amount=Decimal("10.00"),
        )
        with patch.object(finance, "get_bank_transfer", return_value=posted):
            with self.assertRaises(HTTPException) as ctx:
                finance.post_bank_transfer(db, 1)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("already posted", str(ctx.exception.detail).lower())


if __name__ == "__main__":
    unittest.main()
