# @author: Wendy Yang
# @date: 2026-09-30

"""Allow cancelling remaining quantity after a partial shipment or receipt.

Revision ID: 20260930_0053
Revises: 20260930_0052
Create Date: 2026-09-30
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260930_0053"
down_revision: Union[str, Sequence[str], None] = "20260930_0052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "salesorders",
        sa.Column("remaining_closed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("salesorders", sa.Column("remaining_closed_at", sa.DateTime(), nullable=True))
    op.add_column(
        "salesorders",
        sa.Column("closed_billable_amount", sa.Numeric(12, 2), nullable=True),
    )
    op.add_column(
        "purchaseorders",
        sa.Column("remaining_closed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("purchaseorders", sa.Column("remaining_closed_at", sa.DateTime(), nullable=True))
    op.add_column(
        "subcontractorders",
        sa.Column("remaining_closed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "subcontractorders",
        sa.Column("remaining_closed_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("subcontractorders", "remaining_closed_at")
    op.drop_column("subcontractorders", "remaining_closed")
    op.drop_column("purchaseorders", "remaining_closed_at")
    op.drop_column("purchaseorders", "remaining_closed")
    op.drop_column("salesorders", "closed_billable_amount")
    op.drop_column("salesorders", "remaining_closed_at")
    op.drop_column("salesorders", "remaining_closed")
