# @author: Wendy Yang
# @date: 2026-09-19

"""Add security question / answer for password recovery.

Revision ID: 20260812_0006
Revises: 20260806_0005
Create Date: 2026-08-12
"""

from typing import Sequence, Union

import bcrypt
from alembic import op
import sqlalchemy as sa

revision: str = "20260812_0006"
down_revision: Union[str, Sequence[str], None] = "20260806_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_QUESTION = "What is your favorite color?"
DEFAULT_ANSWER = "blue"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("security_question", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("security_answer_hash", sa.String(length=255), nullable=True),
    )

    answer_hash = bcrypt.hashpw(
        DEFAULT_ANSWER.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")
    op.execute(
        sa.text(
            """
            UPDATE users
            SET security_question = :question,
                security_answer_hash = :answer_hash
            WHERE security_question IS NULL
            """
        ).bindparams(question=DEFAULT_QUESTION, answer_hash=answer_hash)
    )


def downgrade() -> None:
    op.drop_column("users", "security_answer_hash")
    op.drop_column("users", "security_question")
