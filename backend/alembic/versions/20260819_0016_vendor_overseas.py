# @author: Wendy Yang
# @date: 2026-09-19

"""Overseas vendor classification, remittance, and trade fields.

Revision ID: 20260819_0016
Revises: 20260819_0015
Create Date: 2026-08-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260819_0016"
down_revision: Union[str, Sequence[str], None] = "20260819_0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "suppliers",
        sa.Column("is_overseas", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("suppliers", sa.Column("tax_document_type", sa.String(length=64), nullable=True))
    op.add_column("suppliers", sa.Column("incoterm_location", sa.String(length=150), nullable=True))
    op.add_column("suppliers", sa.Column("country_of_origin", sa.String(length=50), nullable=True))
    op.add_column("suppliers", sa.Column("bank_name", sa.String(length=150), nullable=True))
    op.add_column("suppliers", sa.Column("swift_code", sa.String(length=11), nullable=True))
    op.add_column("suppliers", sa.Column("iban_account_number", sa.String(length=64), nullable=True))
    op.add_column("suppliers", sa.Column("bank_address", sa.Text(), nullable=True))
    op.add_column("suppliers", sa.Column("intermediary_bank_name", sa.String(length=150), nullable=True))
    op.add_column("suppliers", sa.Column("intermediary_swift_code", sa.String(length=11), nullable=True))
    op.add_column("suppliers", sa.Column("intermediary_routing_aba", sa.String(length=20), nullable=True))
    op.create_check_constraint(
        "chk_supplier_tax_document_type",
        "suppliers",
        "tax_document_type IS NULL OR tax_document_type IN "
        "('W-8BEN-E', 'W-8BEN', 'Certificate of Foreign Status', 'Other', 'W-9')",
    )
    op.execute(
        """
        UPDATE suppliers
        SET is_overseas = TRUE
        WHERE country IS NOT NULL
          AND TRIM(country) <> ''
          AND LOWER(REPLACE(country, '.', '')) NOT IN
              ('us', 'usa', 'united states', 'united states of america')
        """
    )


def downgrade() -> None:
    op.drop_constraint("chk_supplier_tax_document_type", "suppliers", type_="check")
    op.drop_column("suppliers", "intermediary_routing_aba")
    op.drop_column("suppliers", "intermediary_swift_code")
    op.drop_column("suppliers", "intermediary_bank_name")
    op.drop_column("suppliers", "bank_address")
    op.drop_column("suppliers", "iban_account_number")
    op.drop_column("suppliers", "swift_code")
    op.drop_column("suppliers", "bank_name")
    op.drop_column("suppliers", "country_of_origin")
    op.drop_column("suppliers", "incoterm_location")
    op.drop_column("suppliers", "tax_document_type")
    op.drop_column("suppliers", "is_overseas")
