# @author: Wendy Yang
# @date: 2026-09-24

"""Approval workflow and edit lifecycle for bank transfers.

Revision ID: 20260924_0044
Revises: 20260924_0043
Create Date: 2026-09-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260924_0044"
down_revision: Union[str, Sequence[str], None] = "20260924_0043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bank_transfers",
        sa.Column(
            "approval_status",
            sa.String(length=30),
            nullable=False,
            server_default=sa.text("'DRAFT'"),
        ),
    )
    op.add_column(
        "bank_transfers",
        sa.Column("current_approval_step", sa.Integer(), nullable=True),
    )
    op.execute(
        """
        UPDATE bank_transfers
        SET approval_status = 'APPROVED'
        WHERE UPPER(status) = 'POSTED'
        """
    )
    op.execute(
        """
        INSERT INTO workflow_definition (id, module, min_amount, max_amount, is_active, name)
        VALUES
            ('WF-BT-MGR', 'BANK_TRANSFER', 0, 10000, TRUE, 'Bank Transfer Manager Approval'),
            ('WF-BT-EXEC', 'BANK_TRANSFER', 10000.01, NULL, TRUE, 'Bank Transfer Executive Approval')
        ON CONFLICT (id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO workflow_step (id, workflow_definition_id, step_number, step_name, required_role_id)
        VALUES
            ('WF-BT-MGR-1', 'WF-BT-MGR', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
            ('WF-BT-EXEC-1', 'WF-BT-EXEC', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
            ('WF-BT-EXEC-2', 'WF-BT-EXEC', 2, 'Executive Finance Approval', 'ROLE-FIN-APPR')
        ON CONFLICT (id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM workflow_step
        WHERE id IN ('WF-BT-MGR-1', 'WF-BT-EXEC-1', 'WF-BT-EXEC-2')
        """
    )
    op.execute(
        """
        DELETE FROM workflow_definition
        WHERE id IN ('WF-BT-MGR', 'WF-BT-EXEC')
        """
    )
    op.drop_column("bank_transfers", "current_approval_step")
    op.drop_column("bank_transfers", "approval_status")
