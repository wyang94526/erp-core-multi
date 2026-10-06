# @author: Wendy Yang
# @date: 2026-09-30

from types import SimpleNamespace
from uuid import uuid4
import unittest

from fastapi import HTTPException

from app.services.journal_list import infer_posting_rule_id
from app.services.journal_source import (
    SOURCE_GOODS_RECEIPT,
    SOURCE_MONTH_END_CLOSE,
    SYSTEM_JOURNAL_IMMUTABLE_DETAIL,
    assert_journal_editable,
    assert_journal_mutable,
    generated_journal_fields,
    infer_source_document_type,
    journal_is_editable,
    source_record_key,
)


class JournalSourceTests(unittest.TestCase):
    def test_generated_fields_mark_system_journals(self):
        rule = uuid4()
        fields = generated_journal_fields(
            source_document_type=SOURCE_GOODS_RECEIPT,
            source_record_id=" GR-1001 ",
            posting_rule_id=rule,
        )
        self.assertTrue(fields["is_system_generated"])
        self.assertEqual(fields["source_document_type"], "GOODS_RECEIPT")
        self.assertEqual(fields["source_record_id"], "GR-1001")
        self.assertEqual(fields["posting_rule_id"], rule)

    def test_source_record_key_accepts_ints(self):
        self.assertEqual(source_record_key(42), "42")
        self.assertIsNone(source_record_key("  "))

    def test_infer_source_from_generated_text(self):
        self.assertEqual(
            infer_source_document_type("Goods receipt GR-1 for PO PU62-1", "GR-1"),
            SOURCE_GOODS_RECEIPT,
        )
        self.assertEqual(
            infer_source_document_type("Month-end close 2026-09 — close P&L", "MEC-2026-09"),
            SOURCE_MONTH_END_CLOSE,
        )
        self.assertIsNone(infer_source_document_type("Accrue September rent", "ADJ-1"))

    def test_infer_posting_rule_from_account_pair(self):
        debit = uuid4()
        credit = uuid4()
        rule = SimpleNamespace(id=uuid4(), debit_account_id=debit, credit_account_id=credit)
        other = SimpleNamespace(id=uuid4(), debit_account_id=debit, credit_account_id=uuid4())
        self.assertEqual(
            infer_posting_rule_id(debit_account_id=debit, credit_account_id=credit, rules=[rule, other]),
            rule.id,
        )
        self.assertIsNone(
            infer_posting_rule_id(debit_account_id=debit, credit_account_id=uuid4(), rules=[rule, other])
        )

    def test_assert_journal_mutable_blocks_system_delete(self):
        assert_journal_mutable(SimpleNamespace(is_system_generated=False))
        with self.assertRaises(HTTPException) as ctx:
            assert_journal_mutable(SimpleNamespace(is_system_generated=True))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, SYSTEM_JOURNAL_IMMUTABLE_DETAIL)

    def test_draft_system_journals_are_not_editable(self):
        draft = SimpleNamespace(
            is_system_generated=True,
            approval_status="DRAFT",
            posting_status="Draft",
        )
        self.assertFalse(journal_is_editable(draft))
        with self.assertRaises(HTTPException) as ctx:
            assert_journal_editable(draft)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, SYSTEM_JOURNAL_IMMUTABLE_DETAIL)

    def test_pending_and_posted_journals_are_not_editable(self):
        with self.assertRaises(HTTPException) as ctx:
            assert_journal_editable(
                SimpleNamespace(
                    is_system_generated=False,
                    approval_status="PENDING_APPROVAL",
                    posting_status="Draft",
                )
            )
        self.assertEqual(ctx.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            assert_journal_editable(
                SimpleNamespace(
                    is_system_generated=False,
                    approval_status="DRAFT",
                    posting_status="Posted",
                )
            )


if __name__ == "__main__":
    unittest.main()
