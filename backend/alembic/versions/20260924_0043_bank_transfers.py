# @author: Wendy Yang
# @date: 2026-09-24

"""Internal bank transfers between company bank accounts.

Revision ID: 20260924_0043
Revises: 20260924_0042
Create Date: 2026-09-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260924_0043"
down_revision: Union[str, Sequence[str], None] = "20260924_0042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bank_transfers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("from_account_id", sa.String(length=50), nullable=False),
        sa.Column("to_account_id", sa.String(length=50), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("transfer_date", sa.Date(), nullable=False),
        sa.Column("reference_number", sa.String(length=100), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'DRAFT'"),
        ),
        sa.Column("journal_entry_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["from_account_id"],
            ["bank_accounts.bank_account_id"],
            name="fk_bank_transfers_from_account_id",
        ),
        sa.ForeignKeyConstraint(
            ["to_account_id"],
            ["bank_accounts.bank_account_id"],
            name="fk_bank_transfers_to_account_id",
        ),
        sa.ForeignKeyConstraint(
            ["journal_entry_id"],
            ["journal_entries.id"],
            name="fk_bank_transfers_journal_entry_id",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "from_account_id <> to_account_id",
            name="chk_bank_transfer_distinct_accounts",
        ),
        sa.CheckConstraint("amount > 0", name="chk_bank_transfer_amount_positive"),
        sa.CheckConstraint("status IN ('DRAFT', 'POSTED')", name="chk_bank_transfer_status"),
    )
    op.create_index(
        "ix_bank_transfers_transfer_date",
        "bank_transfers",
        ["transfer_date"],
    )
    op.create_index("ix_bank_transfers_status", "bank_transfers", ["status"])


def downgrade() -> None:
    op.drop_index("ix_bank_transfers_status", table_name="bank_transfers")
    op.drop_index("ix_bank_transfers_transfer_date", table_name="bank_transfers")
    op.drop_table("bank_transfers")
