"""Add RBAC roles and approval workflow tables/columns.

Revision ID: 20260804_0001
Revises:
Create Date: 2026-08-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260804_0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("role_id", sa.String(length=50), primary_key=True),
        sa.Column("role_name", sa.String(length=100), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.execute(
        """
        INSERT INTO roles (role_id, role_name, description) VALUES
          ('ROLE-ADMIN', 'Admin', 'Full approval rights across all modules'),
          ('ROLE-MANAGER', 'Manager', 'Approve up to configured thresholds'),
          ('ROLE-CLERK', 'Clerk', 'Create and submit documents for approval')
        ON CONFLICT DO NOTHING
        """
    )

    op.add_column(
        "users",
        sa.Column("role_id", sa.String(length=50), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_role_id",
        "users",
        "roles",
        ["role_id"],
        ["role_id"],
    )

    op.create_table(
        "approval_rules",
        sa.Column("rule_id", sa.String(length=50), primary_key=True),
        sa.Column("module", sa.String(length=50), nullable=False),
        sa.Column("role_id", sa.String(length=50), nullable=False),
        sa.Column("max_amount_limit", sa.Numeric(14, 2), nullable=True),
        sa.Column("can_submit", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("can_approve", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "requires_secondary_approval",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["role_id"], ["roles.role_id"], ondelete="CASCADE"),
        sa.UniqueConstraint("module", "role_id", name="unique_approval_rule_module_role"),
    )

    op.create_table(
        "approval_history",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("document_type", sa.String(length=50), nullable=False),
        sa.Column("document_id", sa.String(length=50), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("performed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("comments", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["performed_by_user_id"], ["users.id"]),
        sa.CheckConstraint(
            "action IN ('SUBMIT', 'APPROVE', 'DECLINE')",
            name="chk_approval_history_action",
        ),
    )
    op.create_index(
        "idx_approval_history_document",
        "approval_history",
        ["document_type", "document_id"],
    )

    for table in (
        "salesorders",
        "purchaseorders",
        "subcontractorders",
        "ar_invoices",
        "ap_bills",
        "cash_transactions",
        "journal_entries",
    ):
        op.add_column(
            table,
            sa.Column(
                "approval_status",
                sa.String(length=30),
                nullable=False,
                server_default="DRAFT",
            ),
        )


def downgrade() -> None:
    for table in (
        "journal_entries",
        "cash_transactions",
        "ap_bills",
        "ar_invoices",
        "subcontractorders",
        "purchaseorders",
        "salesorders",
    ):
        op.drop_column(table, "approval_status")

    op.drop_index("idx_approval_history_document", table_name="approval_history")
    op.drop_table("approval_history")
    op.drop_table("approval_rules")
    op.drop_constraint("fk_users_role_id", "users", type_="foreignkey")
    op.drop_column("users", "role_id")
    op.drop_table("roles")
