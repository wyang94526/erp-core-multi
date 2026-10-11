# @author: Wendy Yang
# @date: 2026-10-11

"""One letterhead profile per company.

Revision ID: 20261011_0068
Revises: 20261011_0067
Create Date: 2026-10-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_0068"
down_revision: Union[str, Sequence[str], None] = "20261011_0067"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "uq_company_profile_company_id",
        "company_profile",
        ["company_id"],
        unique=True,
        postgresql_where=sa.text("company_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_company_profile_company_id", table_name="company_profile")
