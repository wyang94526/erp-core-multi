# @author: Wendy Yang
# @date: 2026-09-19

"""Map company bank accounts to Chart of Accounts for cash posting.

Revision ID: 20260918_0034
Revises: 20260918_0033
Create Date: 2026-09-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260918_0034"
down_revision: Union[str, Sequence[str], None] = "20260918_0033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "bank_accounts",
        "routing_number",
        existing_type=sa.String(length=9),
        type_=sa.String(length=34),
        existing_nullable=True,
    )
    op.add_column(
        "bank_accounts",
        sa.Column(
            "account_type",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'CHECKING'"),
        ),
    )
    op.add_column(
        "bank_accounts",
        sa.Column(
            "currency",
            sa.String(length=3),
            nullable=False,
            server_default=sa.text("'USD'"),
        ),
    )
    op.add_column(
        "bank_accounts",
        sa.Column("gl_account_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        """
        INSERT INTO chart_of_accounts (id, account_code, account_name, account_type)
        SELECT gen_random_uuid(), '1000', 'Cash', 'Asset'
        WHERE NOT EXISTS (
            SELECT 1 FROM chart_of_accounts WHERE account_code = '1000'
        )
        """
    )
    op.execute(
        """
        UPDATE bank_accounts
        SET gl_account_id = (
            SELECT id FROM chart_of_accounts WHERE account_code = '1000' LIMIT 1
        )
        WHERE gl_account_id IS NULL
        """
    )
    op.alter_column("bank_accounts", "gl_account_id", nullable=False)
    op.create_foreign_key(
        "fk_bank_accounts_gl_account_id",
        "bank_accounts",
        "chart_of_accounts",
        ["gl_account_id"],
        ["id"],
    )
    op.create_check_constraint(
        "chk_bank_account_type",
        "bank_accounts",
        "account_type IN ('CHECKING', 'SAVINGS', 'MONEY_MARKET', 'OTHER')",
    )
    op.create_check_constraint(
        "chk_bank_account_currency",
        "bank_accounts",
        "currency ~ '^[A-Z]{3}$'",
    )
    op.create_index(
        "ix_bank_accounts_gl_account_id",
        "bank_accounts",
        ["gl_account_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_bank_accounts_gl_account_id", table_name="bank_accounts")
    op.drop_constraint("chk_bank_account_currency", "bank_accounts", type_="check")
    op.drop_constraint("chk_bank_account_type", "bank_accounts", type_="check")
    op.drop_constraint("fk_bank_accounts_gl_account_id", "bank_accounts", type_="foreignkey")
    op.drop_column("bank_accounts", "gl_account_id")
    op.drop_column("bank_accounts", "currency")
    op.drop_column("bank_accounts", "account_type")
    op.alter_column(
        "bank_accounts",
        "routing_number",
        existing_type=sa.String(length=34),
        type_=sa.String(length=9),
        existing_nullable=True,
    )
