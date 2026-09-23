# @author: Wendy Yang
# @date: 2026-09-23

"""Store imported trial-balance ending balances by period and account.

Revision ID: 20260923_0040
Revises: 20260918_0039
Create Date: 2026-09-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260923_0040"
down_revision: Union[str, Sequence[str], None] = "20260918_0039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "trial_balance_balances",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column(
            "account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chart_of_accounts.id"),
            nullable=False,
        ),
        sa.Column("ending_debit", sa.Numeric(15, 4), nullable=False, server_default=sa.text("0")),
        sa.Column("ending_credit", sa.Numeric(15, 4), nullable=False, server_default=sa.text("0")),
        sa.Column("ending_balance", sa.Numeric(15, 4), nullable=False, server_default=sa.text("0")),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default=sa.text("'USD'")),
        sa.Column("source_file", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "period",
            "account_id",
            "currency",
            name="uq_trial_balance_period_account",
        ),
    )


def downgrade() -> None:
    op.drop_table("trial_balance_balances")
