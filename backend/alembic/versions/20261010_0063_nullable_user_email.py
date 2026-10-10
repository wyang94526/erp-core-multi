# @author: Wendy Yang
# @date: 2026-10-10

"""Allow the initial administrator to exist before a work email is chosen.

Revision ID: 20261010_0063
Revises: 20261010_0062
Create Date: 2026-10-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261010_0063"
down_revision: Union[str, Sequence[str], None] = "20261010_0062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "users",
        "email",
        existing_type=sa.String(length=255),
        nullable=True,
    )


def downgrade() -> None:
    op.execute("DELETE FROM users WHERE email IS NULL")
    op.alter_column(
        "users",
        "email",
        existing_type=sa.String(length=255),
        nullable=False,
    )
