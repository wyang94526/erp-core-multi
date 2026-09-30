# @author: Wendy Yang
# @date: 2026-09-30

"""Add BANK_TRANSFER posting rule and stamp existing transfer journals.

Revision ID: 20260930_0049
Revises: 20260930_0048
Create Date: 2026-09-30
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text
from sqlalchemy.orm import Session

revision: str = "20260930_0049"
down_revision: Union[str, Sequence[str], None] = "20260930_0048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    session = Session(bind=bind)
    from app.services.posting_rules import ensure_default_posting_rules

    ensure_default_posting_rules(session)
    session.flush()
    session.execute(
        text(
            """
            UPDATE journal_entries je
            SET posting_rule_id = pr.id
            FROM posting_rules pr
            WHERE pr.rule_code = 'BANK_TRANSFER'
              AND je.source_document_type = 'BANK_TRANSFER'
              AND je.posting_rule_id IS NULL
            """
        )
    )


def downgrade() -> None:
    pass
