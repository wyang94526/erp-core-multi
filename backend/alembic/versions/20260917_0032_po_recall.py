# @author: Wendy Yang
# @date: 2026-09-19

"""Allow RECALLED on approval audit log for PO reopen.

Revision ID: 20260917_0032
Revises: 20260917_0031
Create Date: 2026-09-17
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260917_0032"
down_revision: Union[str, Sequence[str], None] = "20260917_0031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE approval_audit_log DROP CONSTRAINT IF EXISTS chk_approval_audit_action")
    op.create_check_constraint(
        "chk_approval_audit_action",
        "approval_audit_log",
        "action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED', 'AMENDED', 'RECALLED')",
    )


def downgrade() -> None:
    op.execute("ALTER TABLE approval_audit_log DROP CONSTRAINT IF EXISTS chk_approval_audit_action")
    op.create_check_constraint(
        "chk_approval_audit_action",
        "approval_audit_log",
        "action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED', 'AMENDED')",
    )
