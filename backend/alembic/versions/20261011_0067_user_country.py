# @author: Wendy Yang
# @date: 2026-10-11

"""Store the country chosen at registration.

Revision ID: 20261011_0067
Revises: 20261011_0066
Create Date: 2026-10-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_0067"
down_revision: Union[str, Sequence[str], None] = "20261011_0066"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("country", sa.String(80), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "country")
