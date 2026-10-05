# @author: Wendy Yang
# @date: 2026-10-05

from types import SimpleNamespace
from unittest import TestCase
from uuid import UUID

from app.services.audit_display import (
    action_label,
    enrich_audit_log,
    record_label,
    table_label,
)


class AuditDisplayTests(TestCase):
    def test_period_settings_uses_lock_dates_not_uuid(self):
        label = record_label(
            "finance_period_settings",
            UUID("00000000-0000-4000-8000-000000000001"),
            {
                "soft_close_date": "2026-08-31",
                "hard_close_date": "2026-07-31",
            },
        )
        self.assertEqual(label, "Period close — soft 2026-08-31, hard 2026-07-31")
        self.assertEqual(table_label("finance_period_settings"), "Period Management")
        self.assertEqual(action_label("UPDATE"), "Updated")

    def test_cleared_lock_dates(self):
        label = record_label(
            "finance_period_settings",
            UUID("00000000-0000-4000-8000-000000000001"),
            {"soft_close_date": None, "hard_close_date": None},
            {"soft_close_date": "2026-08-31"},
        )
        self.assertEqual(label, "Period close — lock dates cleared")

    def test_journal_uses_document_number(self):
        label = record_label(
            "journal_entries",
            UUID("75c58d8a-1111-4000-8000-000000000002"),
            {"journal_number": "UG11-26090009", "description": "Goods receipt"},
        )
        self.assertEqual(label, "UG11-26090009")

    def test_enrich_includes_user_name(self):
        log = SimpleNamespace(
            id=15,
            table_name="finance_period_settings",
            record_id=UUID("00000000-0000-4000-8000-000000000001"),
            action="UPDATE",
            old_data={},
            new_data={"soft_close_date": "2026-08-31", "hard_close_date": "2026-07-31"},
            user_id=UUID("b5d77425-fb86-44b3-97d1-ed3ab216ff8f"),
            changed_at="2026-10-02T01:52:24Z",
        )
        user = SimpleNamespace(full_name="Wendy Yang", email="wendy.yang@grand-tek.com")
        row = enrich_audit_log(log, user)
        self.assertEqual(row["user_name"], "Wendy Yang")
        self.assertEqual(row["user_email"], "wendy.yang@grand-tek.com")
        self.assertEqual(row["record_label"], "Period close — soft 2026-08-31, hard 2026-07-31")
        self.assertNotIn("b5d77425", row["user_name"])
