from datetime import date, datetime
import sys
import types
import unittest

from sqlalchemy.orm import DeclarativeBase


class _Base(DeclarativeBase):
    pass


_database = types.ModuleType("app.database")
_database.Base = _Base
_database.get_db = lambda: None
_database.engine = None
_database.SessionLocal = None
sys.modules.setdefault("app.database", _database)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.entities import DocumentSequence
from app.services.document_sequences import (
    DOC_INVOICE,
    DOC_PURCHASE_ORDER,
    DOC_SALES_ORDER,
    DOC_SUBCONTRACT_ORDER,
    format_document_number,
    generate_document_number,
    parse_document_date,
    plan_document_renames,
)


class DocumentSequenceFormatTests(unittest.TestCase):
    def test_format_uses_prefix_yy_mm_and_padded_sequence(self):
        self.assertEqual(format_document_number("PUB61-", date(2026, 9, 14), 1), "PUB61-26090001")
        self.assertEqual(format_document_number("PU62-", date(2026, 9, 1), 2), "PU62-26090002")
        self.assertEqual(format_document_number("UP23-", date(2026, 12, 31), 99), "UP23-26120099")
        self.assertEqual(format_document_number("PU65-", date(2027, 1, 5), 12), "PU65-27010012")

    def test_parse_document_date_prefers_selected_date(self):
        self.assertEqual(parse_document_date(date(2026, 3, 8)), date(2026, 3, 8))
        self.assertEqual(parse_document_date(datetime(2026, 3, 8, 15, 30)), date(2026, 3, 8))
        self.assertEqual(parse_document_date("2026-03-08"), date(2026, 3, 8))
        self.assertEqual(parse_document_date("2026-03-08T15:30:00"), date(2026, 3, 8))

    def test_format_rejects_out_of_range_sequence(self):
        with self.assertRaises(ValueError):
            format_document_number("PUB61-", date(2026, 9, 1), 0)
        with self.assertRaises(ValueError):
            format_document_number("PUB61-", date(2026, 9, 1), 10000)


class DocumentSequencePersistenceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        DocumentSequence.__table__.create(engine)
        self.db = sessionmaker(bind=engine)()

    def test_generate_increments_per_type_and_month(self):
        september = date(2026, 9, 14)
        october = date(2026, 10, 1)

        self.assertEqual(generate_document_number(self.db, DOC_SALES_ORDER, september), "PUB61-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_SALES_ORDER, september), "PUB61-26090002")
        self.assertEqual(generate_document_number(self.db, DOC_SALES_ORDER, october), "PUB61-26100001")
        self.assertEqual(generate_document_number(self.db, DOC_PURCHASE_ORDER, september), "PU62-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_SUBCONTRACT_ORDER, september), "UP23-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_INVOICE, september), "PU65-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_INVOICE, "2026-09-20"), "PU65-26090002")

    def test_unknown_document_type_is_rejected(self):
        with self.assertRaises(ValueError):
            generate_document_number(self.db, "UNKNOWN", date(2026, 9, 1))


class DocumentRenamePlanTests(unittest.TestCase):
    def test_assigns_from_document_date_and_keeps_canonical_slots(self):
        changes, last_value = plan_document_renames(
            [
                ("SO-20260901-001", date(2026, 9, 1), 1),
                ("SO-20260915-002", date(2026, 9, 15), 2),
                ("PUB61-26090005", date(2026, 9, 20), 3),
                ("SO-20261001-001", date(2026, 10, 1), 4),
            ],
            "PUB61-",
        )
        self.assertEqual(
            changes,
            {
                "SO-20260901-001": "PUB61-26090001",
                "SO-20260915-002": "PUB61-26090002",
                "SO-20261001-001": "PUB61-26100001",
            },
        )
        self.assertEqual(last_value, {"202609": 5, "202610": 1})

    def test_reassigns_when_canonical_prefix_does_not_match_date(self):
        changes, last_value = plan_document_renames(
            [("PUB61-26080001", date(2026, 9, 14), 1)],
            "PUB61-",
        )
        self.assertEqual(changes, {"PUB61-26080001": "PUB61-26090001"})
        self.assertEqual(last_value, {"202609": 1})


if __name__ == "__main__":
    unittest.main()
