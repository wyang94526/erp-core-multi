# @author: Wendy Yang
# @date: 2026-09-19

"""Add customers.preferred_shipping_method for sales-order header defaulting.

Revision ID: 20260821_0018
Revises: 20260820_0017
Create Date: 2026-08-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260821_0018"
down_revision: Union[str, Sequence[str], None] = "20260820_0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "customers",
        sa.Column("preferred_shipping_method", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("customers", "preferred_shipping_method")
