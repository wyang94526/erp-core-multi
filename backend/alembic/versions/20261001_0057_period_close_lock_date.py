# @author: Wendy Yang
# @date: 2026-10-01

"""Add period close lock date and finance manage permission.

Revision ID: 20261001_0057
Revises: 20261001_0056
Create Date: 2026-10-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20261001_0057"
down_revision: Union[str, Sequence[str], None] = "20261001_0056"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SETTINGS_ID = "00000000-0000-4000-8000-000000000001"


def upgrade() -> None:
    op.create_table(
        "finance_period_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("current_closing_date", sa.Date(), nullable=True),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            f"""
            INSERT INTO finance_period_settings (id, current_closing_date)
            VALUES ('{SETTINGS_ID}'::uuid, NULL)
            ON CONFLICT (id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO permissions (id, code, module, description) VALUES
                ('PERM-PERIOD-MANAGE', 'period:manage', 'journal',
                 'Set the finance period close / lock date')
            ON CONFLICT DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT 'ROLE-ADMIN', id FROM permissions WHERE id = 'PERM-PERIOD-MANAGE'
            ON CONFLICT DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id) VALUES
                ('ROLE-FIN-APPR', 'PERM-PERIOD-MANAGE'),
                ('ROLE-MANAGER', 'PERM-PERIOD-MANAGE')
            ON CONFLICT DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            DELETE FROM role_permissions
            WHERE permission_id = 'PERM-PERIOD-MANAGE'
            """
        )
    )
    op.execute(
        sa.text("DELETE FROM permissions WHERE id = 'PERM-PERIOD-MANAGE'")
    )
    op.drop_table("finance_period_settings")
