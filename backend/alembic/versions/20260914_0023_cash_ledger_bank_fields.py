"""Company bank accounts plus cash-ledger instrument and counterparty fields.

Revision ID: 20260914_0023
Revises: 20260911_0022
Create Date: 2026-09-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260914_0023"
down_revision: Union[str, Sequence[str], None] = "20260911_0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bank_accounts",
        sa.Column("bank_account_id", sa.String(length=50), primary_key=True),
        sa.Column("bank_name", sa.String(length=150), nullable=False),
        sa.Column("account_name", sa.String(length=100), nullable=False),
        sa.Column("account_number", sa.String(length=34), nullable=False),
        sa.Column("routing_number", sa.String(length=9), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index(
        "uq_bank_accounts_one_default",
        "bank_accounts",
        ["is_default"],
        unique=True,
        postgresql_where=sa.text("is_default = true"),
    )
    op.execute(
        """
        INSERT INTO bank_accounts (
            bank_account_id, bank_name, account_name, account_number, routing_number, is_default, is_active
        ) VALUES (
            'BANK-OPERATING', 'Amerant Bank', 'Operating', '0000008420', '067000123', true, true
        )
        """
    )

    op.add_column(
        "cash_transactions",
        sa.Column("payment_method", sa.String(length=20), nullable=False, server_default="CHECK"),
    )
    op.add_column("cash_transactions", sa.Column("instrument_ref_no", sa.String(length=50), nullable=True))
    op.add_column("cash_transactions", sa.Column("entity_name", sa.String(length=255), nullable=True))
    op.add_column(
        "cash_transactions",
        sa.Column("clearing_status", sa.String(length=20), nullable=False, server_default="CLEARED"),
    )
    op.create_check_constraint(
        "chk_cash_payment_method",
        "cash_transactions",
        "payment_method IN ('CHECK', 'WIRE', 'ACH')",
    )
    op.create_check_constraint(
        "chk_cash_clearing_status",
        "cash_transactions",
        "clearing_status IN ('PENDING', 'CLEARED', 'VOID')",
    )
    op.execute(
        """
        UPDATE cash_transactions
        SET bank_account_id = 'BANK-OPERATING'
        WHERE bank_account_id IS NULL OR btrim(bank_account_id) = ''
        """
    )
    op.execute(
        """
        UPDATE cash_transactions AS ct
        SET entity_name = c.company_name
        FROM ar_invoices AS ar
        JOIN customers AS c ON c.customer_id = ar.customer_id
        WHERE ct.reference_id = ar.invoice_id
          AND ct.type = 'Check Deposit'
          AND (ct.entity_name IS NULL OR btrim(ct.entity_name) = '')
        """
    )
    op.execute(
        """
        UPDATE cash_transactions AS ct
        SET entity_name = c.company_name
        FROM sales_invoices AS si
        JOIN customers AS c ON c.customer_id = si.customer_id
        WHERE ct.reference_id = si.invoice_number
          AND ct.type = 'Check Deposit'
          AND (ct.entity_name IS NULL OR btrim(ct.entity_name) = '')
        """
    )
    op.execute(
        """
        UPDATE cash_transactions AS ct
        SET entity_name = s.company_name
        FROM ap_bills AS ap
        JOIN suppliers AS s ON s.supplier_id = ap.vendor_id
        WHERE ct.reference_id = ap.bill_id
          AND ct.type = 'Check Issue'
          AND (ct.entity_name IS NULL OR btrim(ct.entity_name) = '')
        """
    )
    op.execute(
        """
        UPDATE cash_transactions AS ct
        SET entity_name = s.company_name
        FROM supplier_invoices AS vi
        JOIN suppliers AS s ON s.supplier_id = vi.vendor_id
        WHERE (ct.reference_id = vi.invoice_number OR ct.reference_id = vi.ap_bill_id)
          AND ct.type = 'Check Issue'
          AND (ct.entity_name IS NULL OR btrim(ct.entity_name) = '')
        """
    )
    op.execute(
        """
        WITH numbered AS (
            SELECT
                transaction_id,
                1041 + ROW_NUMBER() OVER (ORDER BY transaction_date, transaction_id) AS n
            FROM cash_transactions
            WHERE instrument_ref_no IS NULL OR btrim(instrument_ref_no) = ''
        )
        UPDATE cash_transactions AS ct
        SET instrument_ref_no = 'CHK-' || numbered.n::text
        FROM numbered
        WHERE ct.transaction_id = numbered.transaction_id
        """
    )
    op.create_foreign_key(
        "fk_cash_transactions_bank_account",
        "cash_transactions",
        "bank_accounts",
        ["bank_account_id"],
        ["bank_account_id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_cash_transactions_bank_account", "cash_transactions", type_="foreignkey")
    op.drop_constraint("chk_cash_clearing_status", "cash_transactions", type_="check")
    op.drop_constraint("chk_cash_payment_method", "cash_transactions", type_="check")
    op.drop_column("cash_transactions", "clearing_status")
    op.drop_column("cash_transactions", "entity_name")
    op.drop_column("cash_transactions", "instrument_ref_no")
    op.drop_column("cash_transactions", "payment_method")
    op.drop_index("uq_bank_accounts_one_default", table_name="bank_accounts")
    op.drop_table("bank_accounts")
