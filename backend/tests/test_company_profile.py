# @author: Wendy Yang
# @date: 2026-10-02

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4
import unittest

from fastapi import HTTPException

from app.services.company_profile import (
    DEFAULT_COMPANY_NAME,
    SETTINGS_ID,
    empty_address,
    normalize_address,
    serialize_profile,
    update_profile,
)


class _Query:
    def __init__(self, row):
        self.row = row

    def order_by(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.row


class _FakeDb:
    def __init__(self, profile=None):
        self.profile = profile
        self.added = []

    def get(self, _model, _id):
        return self.profile

    def query(self, _model):
        return _Query(self.profile)

    def add(self, row):
        self.added.append(row)
        self.profile = row

    def flush(self):
        return None


def _profile(**overrides):
    row = SimpleNamespace(
        id=SETTINGS_ID,
        company_name=DEFAULT_COMPANY_NAME,
        contact_name=None,
        contact_email=None,
        contact_phone=None,
        bill_to={},
        ship_to={},
        logo_stored_filename=None,
        logo_original_filename=None,
        logo_content_type=None,
        updated_by_user_id=None,
        updated_at=datetime.now(timezone.utc),
    )
    row.__dict__.update(overrides)
    return row


class CompanyProfileTests(unittest.TestCase):
    def test_normalize_address_keeps_known_keys(self):
        raw = normalize_address(
            {
                "location_name": " HQ ",
                "city": "Irvine",
                "extra": "ignored",
                "contact_email": "ap@example.com",
            }
        )
        self.assertEqual(raw["location_name"], "HQ")
        self.assertEqual(raw["city"], "Irvine")
        self.assertEqual(raw["contact_email"], "ap@example.com")
        self.assertEqual(raw["address_line1"], "")
        self.assertNotIn("extra", raw)

    def test_serialize_includes_has_logo_false(self):
        data = serialize_profile(_profile())
        self.assertEqual(data["company_name"], DEFAULT_COMPANY_NAME)
        self.assertFalse(data["has_logo"])
        self.assertEqual(data["bill_to"], empty_address())

    def test_update_requires_company_name(self):
        db = _FakeDb(_profile())
        user = SimpleNamespace(id=uuid4())
        with self.assertRaises(HTTPException) as ctx:
            update_profile(db, user, {"company_name": "   "})
        self.assertEqual(ctx.exception.status_code, 400)

    def test_update_writes_contact_and_addresses(self):
        db = _FakeDb(_profile())
        user = SimpleNamespace(id=uuid4())
        row = update_profile(
            db,
            user,
            {
                "contact_name": "AP Desk",
                "contact_email": "ap@grand-tek.com",
                "bill_to": {"location_name": "Billing", "city": "Irvine"},
                "ship_to": {"location_name": "Receiving", "city": "Irvine"},
            },
        )
        self.assertEqual(row.contact_name, "AP Desk")
        self.assertEqual(row.contact_email, "ap@grand-tek.com")
        self.assertEqual(row.bill_to["location_name"], "Billing")
        self.assertEqual(row.ship_to["location_name"], "Receiving")
        self.assertEqual(row.updated_by_user_id, user.id)


if __name__ == "__main__":
    unittest.main()
