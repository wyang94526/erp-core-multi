# @author: Wendy Yang
# @date: 2026-09-19

"""SCO cost-sheet amendment: revision counter plus AMENDED audit action.

Revision ID: 20260911_0022
Revises: 20260911_0021
Create Date: 2026-09-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260911_0022"
down_revision: Union[str, Sequence[str], None] = "20260911_0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "subcontractorders",
        sa.Column("amendment_number", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute("ALTER TABLE approval_audit_log DROP CONSTRAINT IF EXISTS chk_approval_audit_action")
    op.create_check_constraint(
        "chk_approval_audit_action",
        "approval_audit_log",
        "action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED', 'AMENDED')",
    )


def downgrade() -> None:
    op.drop_constraint("chk_approval_audit_action", "approval_audit_log", type_="check")
    op.create_check_constraint(
        "chk_approval_audit_action",
        "approval_audit_log",
        "action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED')",
    )
    op.drop_column("subcontractorders", "amendment_number")
