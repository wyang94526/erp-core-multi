# @author: Wendy Yang
# @date: 2026-10-11

"""Hourly rate on work centers.

Revision ID: 20261011_0073
Revises: 20261011_0072
Create Date: 2026-10-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_0073"
down_revision: Union[str, Sequence[str], None] = "20261011_0072"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "work_centers",
        sa.Column("hourly_rate", sa.Numeric(12, 2), server_default=sa.text("0"), nullable=False),
    )
    op.create_check_constraint("chk_work_center_rate_nonneg", "work_centers", "hourly_rate >= 0")


def downgrade() -> None:
    op.drop_constraint("chk_work_center_rate_nonneg", "work_centers", type_="check")
    op.drop_column("work_centers", "hourly_rate")
