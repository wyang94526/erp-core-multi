# @author: Wendy Yang
# @date: 2026-10-02

"""Add soft-close and hard-close dates for period states.

Revision ID: 20261002_0058
Revises: 20261001_0057
Create Date: 2026-10-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261002_0058"
down_revision: Union[str, Sequence[str], None] = "20261001_0057"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("finance_period_settings", sa.Column("soft_close_date", sa.Date(), nullable=True))
    op.add_column("finance_period_settings", sa.Column("hard_close_date", sa.Date(), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE finance_period_settings
            SET hard_close_date = current_closing_date,
                soft_close_date = current_closing_date
            WHERE current_closing_date IS NOT NULL
            """
        )
    )
    op.create_check_constraint(
        "chk_finance_period_hard_le_soft",
        "finance_period_settings",
        "hard_close_date IS NULL OR soft_close_date IS NULL OR hard_close_date <= soft_close_date",
    )


def downgrade() -> None:
    op.drop_constraint("chk_finance_period_hard_le_soft", "finance_period_settings", type_="check")
    op.drop_column("finance_period_settings", "hard_close_date")
    op.drop_column("finance_period_settings", "soft_close_date")
