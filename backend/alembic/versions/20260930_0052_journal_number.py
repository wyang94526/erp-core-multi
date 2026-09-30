# @author: Wendy Yang
# @date: 2026-09-30

"""Add journal_number for UG11-YYMMXXXX assignment.

Revision ID: 20260930_0052
Revises: 20260930_0051
Create Date: 2026-09-30
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260930_0052"
down_revision: Union[str, Sequence[str], None] = "20260930_0051"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("journal_entries", sa.Column("journal_number", sa.String(length=50), nullable=True))
    op.create_index(
        "ix_journal_entries_journal_number",
        "journal_entries",
        ["journal_number"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_journal_entries_journal_number", table_name="journal_entries")
    op.drop_column("journal_entries", "journal_number")
