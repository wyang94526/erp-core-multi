# @author: Wendy Yang
# @date: 2026-09-19

"""Persisted document number counters per type and year-month.

Revision ID: 20260916_0027
Revises: 20260915_0026
Create Date: 2026-09-16
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260916_0027"
down_revision: Union[str, Sequence[str], None] = "20260915_0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_sequences",
        sa.Column("doc_type", sa.String(length=30), nullable=False),
        sa.Column("year_month", sa.String(length=6), nullable=False),
        sa.Column("last_value", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("doc_type", "year_month", name="pk_document_sequences"),
        sa.CheckConstraint("last_value >= 0", name="chk_document_sequences_last_value"),
        sa.CheckConstraint(
            "year_month ~ '^[0-9]{6}$'",
            name="chk_document_sequences_year_month",
        ),
    )


def downgrade() -> None:
    op.drop_table("document_sequences")
