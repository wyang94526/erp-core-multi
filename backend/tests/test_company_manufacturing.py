# @author: Wendy Yang
# @date: 2026-10-11

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4
import unittest

from fastapi import HTTPException

from app.deps.company import resolve_membership_company_id
from app.services.catalog import required_quantity
from app.services.companies import pick_company_for_country
from app.services.exchange_rates import pick_rate
from app.services.inspections import apply_inspection_decision, canonical_inspection_status
from app.services.production import build_material_requirements, receipt_posts_immediately


class CompanyContextTests(unittest.TestCase):
    def test_header_must_match_a_membership(self):
        allowed = uuid4()
        other = uuid4()
        memberships = [(allowed, True)]
        self.assertEqual(resolve_membership_company_id(memberships, allowed), allowed)
        with self.assertRaises(HTTPException) as caught:
            resolve_membership_company_id(memberships, other)
        self.assertEqual(caught.exception.status_code, 403)

    def test_omitted_header_uses_the_default_company(self):
        default_company = uuid4()
        other = uuid4()
        chosen = resolve_membership_company_id(
            [(other, False), (default_company, True)],
            None,
        )
        self.assertEqual(chosen, default_company)

    def test_user_without_a_company_is_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            resolve_membership_company_id([], None)
        self.assertEqual(caught.exception.status_code, 400)


class LocalCompanyTests(unittest.TestCase):
    def _companies(self):
        return [
            SimpleNamespace(code="GTT", country="Taiwan", is_active=True, parent_company_id=None),
            SimpleNamespace(code="GTT-US", country="United States", is_active=True, parent_company_id="gtt"),
            SimpleNamespace(code="GTT-JAPAN", country="Japan", is_active=True, parent_company_id="gtt"),
            SimpleNamespace(code="GTT-CHINA", country="China", is_active=True, parent_company_id="gtt"),
            SimpleNamespace(code="GTT-VIETNAM", country="Vietnam", is_active=True, parent_company_id="gtt"),
        ]

    def test_country_selects_the_local_company(self):
        companies = self._companies()
        self.assertEqual(pick_company_for_country(companies, "Japan").code, "GTT-JAPAN")
        self.assertEqual(pick_company_for_country(companies, "usa").code, "GTT-US")
        self.assertEqual(pick_company_for_country(companies, "Taiwan").code, "GTT")

    def test_unknown_country_has_no_company(self):
        self.assertIsNone(pick_company_for_country(self._companies(), "France"))


class ExchangeRateTests(unittest.TestCase):
    def test_later_rate_does_not_change_an_earlier_document_date(self):
        rows = [
            (date(2026, 1, 1), Decimal("1.10")),
            (date(2026, 6, 1), Decimal("1.25")),
        ]
        self.assertEqual(pick_rate("USD", "EUR", date(2026, 3, 1), rows), Decimal("1.10"))
        self.assertEqual(pick_rate("USD", "EUR", date(2026, 7, 1), rows), Decimal("1.25"))

    def test_base_currency_converts_at_one_without_a_row(self):
        self.assertEqual(pick_rate("USD", "usd", date(2026, 1, 1), []), Decimal("1"))

    def test_missing_rate_is_an_error(self):
        with self.assertRaises(HTTPException) as caught:
            pick_rate("USD", "EUR", date(2026, 1, 1), [])
        self.assertEqual(caught.exception.status_code, 400)


class BomExplosionTests(unittest.TestCase):
    def test_release_scales_quantity_scrap_and_yield(self):
        line = SimpleNamespace(
            component_item_id="RAW-1",
            component_code=None,
            item_type="Material",
            quantity_per=Decimal("2"),
            scrap_factor=Decimal("0.10"),
            yield_loss_percentage=Decimal("0"),
        )
        rows = build_material_requirements([line], 5)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["quantity_required"], required_quantity(Decimal("2"), 5, Decimal("0.10"), 0))
        self.assertEqual(rows[0]["quantity_required"], Decimal("11.0000"))


class InspectionDecisionTests(unittest.TestCase):
    def test_accept_posts_and_reject_holds_stock(self):
        self.assertEqual(apply_inspection_decision("accepted"), "post")
        self.assertEqual(apply_inspection_decision("rejected"), "hold")
        self.assertEqual(canonical_inspection_status("Accepted"), "accepted")
        self.assertEqual(canonical_inspection_status("Rejected"), "rejected")
        self.assertEqual(apply_inspection_decision(canonical_inspection_status("Accepted")), "post")

    def test_inspection_flag_holds_the_receipt(self):
        self.assertTrue(receipt_posts_immediately(False))
        self.assertFalse(receipt_posts_immediately(True))


if __name__ == "__main__":
    unittest.main()
