# @author: Wendy Yang
# @date: 2026-09-19

"""Add ROLE-UNASSIGNED for self-registered users awaiting admin assignment.

Revision ID: 20260812_0008
Revises: 20260812_0007
Create Date: 2026-08-12
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260812_0008"
down_revision: Union[str, Sequence[str], None] = "20260812_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO roles (role_id, role_name, description) VALUES
          ('ROLE-UNASSIGNED', 'Unassigned', 'Self-registered user awaiting role assignment by an admin')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM user_roles WHERE role_id = 'ROLE-UNASSIGNED'")
    op.execute("DELETE FROM roles WHERE role_id = 'ROLE-UNASSIGNED'")
