# @author: Wendy Yang
# @date: 2026-09-19

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
    DOC_BILL,
    DOC_FINISHED_GOODS_RECEIPT,
    DOC_FULFILLMENT,
    DOC_GOODS_RECEIPT,
    DOC_INVOICE,
    DOC_JOURNAL,
    DOC_MATERIAL_ISSUE,
    DOC_PURCHASE_ORDER,
    DOC_SALES_ORDER,
    DOC_SUBCONTRACT_ORDER,
    format_document_number,
    generate_document_number,
    parse_document_date,
    peek_document_number,
    plan_document_renames,
    remap_legacy_sales_order_id,
)


class DocumentSequenceFormatTests(unittest.TestCase):
    def test_format_uses_prefix_yy_mm_and_padded_sequence(self):
        self.assertEqual(format_document_number("PU61-", date(2026, 9, 14), 1), "PU61-26090001")
        self.assertEqual(format_document_number("PU62-", date(2026, 9, 1), 2), "PU62-26090002")
        self.assertEqual(format_document_number("UP23-", date(2026, 12, 31), 99), "UP23-26120099")
        self.assertEqual(format_document_number("USS5-", date(2027, 1, 5), 12), "USS5-27010012")
        self.assertEqual(format_document_number("US51-", date(2026, 8, 1), 1), "US51-26080001")
        self.assertEqual(format_document_number("PU67-", date(2026, 8, 1), 1), "PU67-26080001")
        self.assertEqual(format_document_number("UM31-", date(2026, 8, 1), 1), "UM31-26080001")
        self.assertEqual(format_document_number("UP72-", date(2026, 8, 1), 1), "UP72-26080001")
        self.assertEqual(format_document_number("UX13-", date(2026, 8, 1), 1), "UX13-26080001")
        self.assertEqual(format_document_number("UG11-", date(2026, 8, 1), 1), "UG11-26080001")

    def test_parse_document_date_prefers_selected_date(self):
        self.assertEqual(parse_document_date(date(2026, 3, 8)), date(2026, 3, 8))
        self.assertEqual(parse_document_date(datetime(2026, 3, 8, 15, 30)), date(2026, 3, 8))
        self.assertEqual(parse_document_date("2026-03-08"), date(2026, 3, 8))
        self.assertEqual(parse_document_date("2026-03-08T15:30:00"), date(2026, 3, 8))

    def test_format_rejects_out_of_range_sequence(self):
        with self.assertRaises(ValueError):
            format_document_number("PU61-", date(2026, 9, 1), 0)
        with self.assertRaises(ValueError):
            format_document_number("PU61-", date(2026, 9, 1), 10000)


class DocumentSequencePersistenceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        DocumentSequence.__table__.create(engine)
        self.db = sessionmaker(bind=engine)()

    def test_generate_increments_per_type_and_month(self):
        september = date(2026, 9, 14)
        october = date(2026, 10, 1)

        self.assertEqual(generate_document_number(self.db, DOC_SALES_ORDER, september), "PU61-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_SALES_ORDER, september), "PU61-26090002")
        self.assertEqual(generate_document_number(self.db, DOC_SALES_ORDER, october), "PU61-26100001")
        self.assertEqual(generate_document_number(self.db, DOC_PURCHASE_ORDER, september), "PU62-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_SUBCONTRACT_ORDER, september), "UP23-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_INVOICE, september), "USS5-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_INVOICE, "2026-09-20"), "USS5-26090002")
        self.assertEqual(generate_document_number(self.db, DOC_FULFILLMENT, september), "US51-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_GOODS_RECEIPT, september), "PU67-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_MATERIAL_ISSUE, september), "UM31-26090001")
        self.assertEqual(
            generate_document_number(self.db, DOC_FINISHED_GOODS_RECEIPT, september),
            "UP72-26090001",
        )
        self.assertEqual(generate_document_number(self.db, DOC_BILL, september), "UX13-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_JOURNAL, september), "UG11-26090001")

    def test_unknown_document_type_is_rejected(self):
        with self.assertRaises(ValueError):
            generate_document_number(self.db, "UNKNOWN", date(2026, 9, 1))

    def test_peek_does_not_consume_sequence(self):
        september = date(2026, 9, 30)
        self.assertEqual(peek_document_number(self.db, DOC_BILL, september), "UX13-26090001")
        self.assertEqual(peek_document_number(self.db, DOC_BILL, september), "UX13-26090001")
        self.assertEqual(generate_document_number(self.db, DOC_BILL, september), "UX13-26090001")
        self.assertEqual(peek_document_number(self.db, DOC_BILL, september), "UX13-26090002")


class DocumentRenamePlanTests(unittest.TestCase):
    def test_assigns_from_document_date_and_keeps_canonical_slots(self):
        changes, last_value = plan_document_renames(
            [
                ("SO-20260901-001", date(2026, 9, 1), 1),
                ("SO-20260915-002", date(2026, 9, 15), 2),
                ("PU61-26090005", date(2026, 9, 20), 3),
                ("SO-20261001-001", date(2026, 10, 1), 4),
            ],
            "PU61-",
        )
        self.assertEqual(
            changes,
            {
                "SO-20260901-001": "PU61-26090001",
                "SO-20260915-002": "PU61-26090002",
                "SO-20261001-001": "PU61-26100001",
            },
        )
        self.assertEqual(last_value, {"202609": 5, "202610": 1})

    def test_reassigns_when_canonical_prefix_does_not_match_date(self):
        changes, last_value = plan_document_renames(
            [("PU61-26080001", date(2026, 9, 14), 1)],
            "PU61-",
        )
        self.assertEqual(changes, {"PU61-26080001": "PU61-26090001"})
        self.assertEqual(last_value, {"202609": 1})

    def test_legacy_pub61_prefix_keeps_year_month_and_sequence(self):
        self.assertEqual(remap_legacy_sales_order_id("PUB61-26090004"), "PU61-26090004")
        self.assertEqual(remap_legacy_sales_order_id("PU61-26090004"), "PU61-26090004")
        self.assertEqual(remap_legacy_sales_order_id("SO-20260901-001"), "SO-20260901-001")


if __name__ == "__main__":
    unittest.main()
