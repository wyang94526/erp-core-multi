# @author: Wendy Yang
# @date: 2026-10-02

from datetime import date
from types import SimpleNamespace
from uuid import UUID, uuid4
import unittest

from fastapi import HTTPException

from app.services.period_close import (
    KIND_ADJUSTMENT,
    KIND_OPERATIONAL,
    SETTINGS_ID,
    STATUS_HARD_CLOSE,
    STATUS_OPEN,
    STATUS_SOFT_CLOSE,
    as_date,
    assert_transaction_date_open,
    journal_lock_kind,
    period_lock_message,
    status_for_date,
    update_period_settings,
)


class _Query:
    def __init__(self, row):
        self.row = row

    def order_by(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.row


class _FakeDb:
    def __init__(self, settings=None):
        self.settings = settings
        self.added = []

    def get(self, _model, key):
        if self.settings is not None and key == self.settings.id:
            return self.settings
        return None

    def query(self, _model):
        return _Query(self.settings)

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        return None


def _settings(**kwargs):
    defaults = {
        "id": SETTINGS_ID,
        "current_closing_date": None,
        "soft_close_date": None,
        "hard_close_date": None,
        "updated_by_user_id": None,
        "updated_at": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


class PeriodCloseTests(unittest.TestCase):
    def test_open_when_no_lock_dates(self):
        settings = _settings()
        self.assertEqual(status_for_date(date(2026, 9, 30), settings), STATUS_OPEN)
        db = _FakeDb(settings)
        self.assertIsNone(period_lock_message(db, date(2026, 9, 30)))
        assert_transaction_date_open(db, date(2026, 9, 30), document="sales order")

    def test_soft_close_blocks_operations_allows_adjustments(self):
        settings = _settings(soft_close_date=date(2026, 9, 30))
        self.assertEqual(status_for_date(date(2026, 9, 15), settings), STATUS_SOFT_CLOSE)
        db = _FakeDb(settings)
        message = period_lock_message(db, date(2026, 9, 15), document="purchase order")
        self.assertIn("soft-closed", message or "")
        with self.assertRaises(HTTPException) as ctx:
            assert_transaction_date_open(db, date(2026, 9, 15), document="purchase order")
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIsNone(
            period_lock_message(
                db, date(2026, 9, 15), document="journal entry", kind=KIND_ADJUSTMENT
            )
        )
        assert_transaction_date_open(
            db, date(2026, 9, 15), document="journal entry", kind=KIND_ADJUSTMENT
        )

    def test_hard_close_blocks_adjustments(self):
        settings = _settings(
            soft_close_date=date(2026, 9, 30),
            hard_close_date=date(2026, 9, 30),
            current_closing_date=date(2026, 9, 30),
        )
        self.assertEqual(status_for_date(date(2026, 9, 30), settings), STATUS_HARD_CLOSE)
        db = _FakeDb(settings)
        with self.assertRaises(HTTPException) as ctx:
            assert_transaction_date_open(
                db, date(2026, 9, 30), document="journal entry", kind=KIND_ADJUSTMENT
            )
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("hard-closed", str(ctx.exception.detail))

    def test_dates_after_soft_close_stay_open(self):
        settings = _settings(soft_close_date=date(2026, 9, 30))
        self.assertEqual(status_for_date(date(2026, 10, 1), settings), STATUS_OPEN)
        db = _FakeDb(settings)
        assert_transaction_date_open(db, date(2026, 10, 1), document="sales order")

    def test_hard_close_advances_soft_close(self):
        settings = _settings(soft_close_date=date(2026, 8, 31))
        db = _FakeDb(settings)
        user = SimpleNamespace(id=uuid4(), roles=[])
        update_period_settings(
            db, user, hard_close_date_value=date(2026, 9, 30)
        )
        self.assertEqual(settings.hard_close_date, date(2026, 9, 30))
        self.assertEqual(settings.soft_close_date, date(2026, 9, 30))
        self.assertEqual(settings.current_closing_date, date(2026, 9, 30))

    def test_hard_reopen_requires_admin_and_justification(self):
        settings = _settings(
            soft_close_date=date(2026, 9, 30),
            hard_close_date=date(2026, 9, 30),
            current_closing_date=date(2026, 9, 30),
        )
        db = _FakeDb(settings)
        finance_user = SimpleNamespace(id=uuid4(), roles=[])
        with self.assertRaises(HTTPException) as ctx:
            update_period_settings(
                db,
                finance_user,
                hard_close_date_value=date(2026, 8, 31),
                justification="Fix a posted accrual",
            )
        self.assertEqual(ctx.exception.status_code, 403)

        admin = SimpleNamespace(
            id=uuid4(),
            roles=[SimpleNamespace(role_id="ROLE-ADMIN", role_name="Admin")],
        )
        with self.assertRaises(HTTPException) as short:
            update_period_settings(
                db, admin, hard_close_date_value=date(2026, 8, 31), justification="short"
            )
        self.assertEqual(short.exception.status_code, 400)

        update_period_settings(
            db,
            admin,
            hard_close_date_value=date(2026, 8, 31),
            justification="Correct September freight accrual after vendor restated the invoice.",
        )
        self.assertEqual(settings.hard_close_date, date(2026, 8, 31))
        log = db.added[-1]
        self.assertEqual(log.action, "UPDATE")
        self.assertEqual(log.old_data["hard_close_date"], "2026-09-30")
        self.assertEqual(log.new_data["hard_close_date"], "2026-08-31")
        self.assertIn("freight accrual", log.new_data["justification"])

    def test_journal_lock_kind(self):
        self.assertEqual(
            journal_lock_kind(SimpleNamespace(is_system_generated=False, source_document_type=None)),
            KIND_ADJUSTMENT,
        )
        self.assertEqual(
            journal_lock_kind(
                SimpleNamespace(is_system_generated=True, source_document_type="GOODS_RECEIPT")
            ),
            KIND_OPERATIONAL,
        )
        self.assertEqual(
            journal_lock_kind(
                SimpleNamespace(is_system_generated=True, source_document_type="MONTH_END_CLOSE")
            ),
            KIND_ADJUSTMENT,
        )

    def test_as_date_accepts_datetime(self):
        from datetime import datetime

        self.assertEqual(as_date(datetime(2026, 9, 1, 12, 30)), date(2026, 9, 1))
        self.assertIsInstance(SETTINGS_ID, UUID)


if __name__ == "__main__":
    unittest.main()
