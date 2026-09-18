# @author: Wendy Yang
# @date: 2026-09-19

"""Add security_question_options catalog for choosable recovery questions.

Revision ID: 20260812_0007
Revises: 20260812_0006
Create Date: 2026-08-12
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260812_0007"
down_revision: Union[str, Sequence[str], None] = "20260812_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SEED_QUESTIONS = (
    (10, "What is your favorite color?"),
    (20, "What is your mother's surname?"),
    (30, "What is your favorite place visited?"),
    (40, "What was the name of your first pet?"),
    (50, "In what city were you born?"),
    (60, "What was the make of your first car?"),
    (70, "What is the name of the street you grew up on?"),
    (80, "What was your childhood nickname?"),
)


def upgrade() -> None:
    op.create_table(
        "security_question_options",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("question_text", sa.String(length=255), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("question_text"),
    )

    options = sa.table(
        "security_question_options",
        sa.column("question_text", sa.String),
        sa.column("is_active", sa.Boolean),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(
        options,
        [
            {
                "question_text": text,
                "is_active": True,
                "sort_order": sort_order,
            }
            for sort_order, text in SEED_QUESTIONS
        ],
    )


def downgrade() -> None:
    op.drop_table("security_question_options")
