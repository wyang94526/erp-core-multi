# @author: Wendy Yang
# @date: 2026-09-19

"""Add password_hash and updated_at for user authentication.

Revision ID: 20260806_0005
Revises: 20260805_0004
Create Date: 2026-08-06
"""

from typing import Sequence, Union

import bcrypt
from alembic import op
import sqlalchemy as sa

revision: str = "20260806_0005"
down_revision: Union[str, Sequence[str], None] = "20260805_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_PASSWORD = "Password123!"


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
    )

    hashed = bcrypt.hashpw(DEFAULT_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    op.execute(
        sa.text("UPDATE users SET password_hash = :hash WHERE password_hash IS NULL").bindparams(
            hash=hashed
        )
    )
    op.alter_column("users", "password_hash", nullable=False)

    # Ensure legacy Manager role exists for nav RBAC rules
    op.execute(
        """
        INSERT INTO roles (role_id, role_name, description) VALUES
          ('ROLE-MANAGER', 'Manager', 'Cross-functional manager access')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_column("users", "updated_at")
    op.drop_column("users", "password_hash")
