# @author: Wendy Yang
# @date: 2026-09-19

from types import SimpleNamespace
import unittest

from fastapi import HTTPException

from app.services.finance import (
    gl_account_display,
    normalize_bank_account_type,
    normalize_currency,
    normalize_routing_or_swift,
    resolve_bank_cash_gl,
    serialize_bank_account,
)


class BankAccountMasterTests(unittest.TestCase):
    def test_routing_accepts_aba_and_swift(self):
        self.assertEqual(normalize_routing_or_swift("067000123"), "067000123")
        self.assertEqual(normalize_routing_or_swift("chas us 33"), "CHASUS33")
        self.assertEqual(normalize_routing_or_swift("BOFAUS3NXXX"), "BOFAUS3NXXX")
        self.assertIsNone(normalize_routing_or_swift("  "))

    def test_routing_rejects_invalid_values(self):
        with self.assertRaises(HTTPException) as ctx:
            normalize_routing_or_swift("12345")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_account_type_and_currency_normalize(self):
        self.assertEqual(normalize_bank_account_type("checking"), "CHECKING")
        self.assertEqual(normalize_bank_account_type("Money Market"), "MONEY_MARKET")
        self.assertEqual(normalize_currency("usd"), "USD")

    def test_serialize_includes_mapped_gl_account(self):
        gl = SimpleNamespace(id="gl-1000", account_code="1000", account_name="Cash")
        account = SimpleNamespace(
            bank_account_id="BANK-OPERATING",
            bank_name="Amerant Bank",
            account_name="Operating",
            account_number="0000008420",
            routing_number="067000123",
            account_type="CHECKING",
            currency="USD",
            gl_account_id="gl-1000",
            gl_account=gl,
            is_default=True,
            is_active=True,
        )
        data = serialize_bank_account(account)
        self.assertEqual(data["gl_account_id"], "gl-1000")
        self.assertEqual(data["gl_account_code"], "1000")
        self.assertEqual(data["gl_account_display"], "1000 — Cash")
        self.assertEqual(data["account_type"], "CHECKING")
        self.assertEqual(data["currency"], "USD")

    def test_resolve_bank_cash_gl_uses_mapped_account(self):
        gl = SimpleNamespace(id="gl-1010", account_code="1010", account_name="Operating Cash")
        bank = SimpleNamespace(gl_account_id="gl-1010", gl_account=gl)
        self.assertIs(resolve_bank_cash_gl(None, bank), gl)
        self.assertEqual(gl_account_display(gl), "1010 — Operating Cash")


if __name__ == "__main__":
    unittest.main()
