"""Add manual journal header fields and finance create/submit rights.

Revision ID: 20260918_0037
Revises: 20260918_0036
Create Date: 2026-09-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260918_0037"
down_revision: Union[str, Sequence[str], None] = "20260918_0036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("journal_entries", sa.Column("posting_date", sa.Date(), nullable=True))
    op.add_column("journal_entries", sa.Column("reference", sa.String(length=100), nullable=True))
    op.add_column("ledger_postings", sa.Column("description", sa.Text(), nullable=True))
    op.execute(
        """
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('ROLE-FIN-APPR', 'PERM-JE-CREATE'),
    ('ROLE-FIN-APPR', 'PERM-JE-SUBMIT')
ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
DELETE FROM role_permissions
WHERE role_id = 'ROLE-FIN-APPR'
  AND permission_id IN ('PERM-JE-CREATE', 'PERM-JE-SUBMIT')
        """
    )
    op.drop_column("ledger_postings", "description")
    op.drop_column("journal_entries", "reference")
    op.drop_column("journal_entries", "posting_date")
