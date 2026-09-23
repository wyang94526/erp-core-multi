# @author: Wendy Yang
# @date: 2026-09-23

"""Rename trial_balance_balances to gl_account_balances.

Revision ID: 20260923_0041
Revises: 20260923_0040
Create Date: 2026-09-23
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260923_0041"
down_revision: Union[str, Sequence[str], None] = "20260923_0040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.rename_table("trial_balance_balances", "gl_account_balances")
    op.execute(
        """
        ALTER TABLE gl_account_balances
        RENAME CONSTRAINT uq_trial_balance_period_account
        TO uq_gl_account_balance_period_account
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE gl_account_balances
        RENAME CONSTRAINT uq_gl_account_balance_period_account
        TO uq_trial_balance_period_account
        """
    )
    op.rename_table("gl_account_balances", "trial_balance_balances")
