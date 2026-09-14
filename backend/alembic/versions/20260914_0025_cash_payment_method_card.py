"""Allow credit-card disbursements on cash_transactions.

Revision ID: 20260914_0025
Revises: 20260914_0024
Create Date: 2026-09-14
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260914_0025"
down_revision: Union[str, Sequence[str], None] = "20260914_0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("chk_cash_payment_method", "cash_transactions", type_="check")
    op.create_check_constraint(
        "chk_cash_payment_method",
        "cash_transactions",
        "payment_method IN ('CHECK', 'WIRE', 'ACH', 'CARD')",
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE cash_transactions
        SET payment_method = 'CHECK'
        WHERE payment_method = 'CARD'
        """
    )
    op.drop_constraint("chk_cash_payment_method", "cash_transactions", type_="check")
    op.create_check_constraint(
        "chk_cash_payment_method",
        "cash_transactions",
        "payment_method IN ('CHECK', 'WIRE', 'ACH')",
    )
