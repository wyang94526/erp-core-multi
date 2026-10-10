# @author: Wendy Yang
# @date: 2026-10-10

"""Require the bootstrap administrator to change the initial password.

Revision ID: 20261010_0062
Revises: 20261005_0061
Create Date: 2026-10-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261010_0062"
down_revision: Union[str, Sequence[str], None] = "20261005_0061"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
