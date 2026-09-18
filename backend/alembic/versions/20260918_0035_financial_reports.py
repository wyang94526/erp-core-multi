# @author: Wendy Yang
# @date: 2026-09-19

"""Add financial report permission and optional budget book.

Revision ID: 20260918_0035
Revises: 20260918_0034
Create Date: 2026-09-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260918_0035"
down_revision: Union[str, Sequence[str], None] = "20260918_0034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
INSERT INTO permissions (id, code, module, description) VALUES
    ('PERM-REPORT-VIEW', 'report:view', 'report', 'View financial statements and management reports')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('ROLE-ADMIN', 'PERM-REPORT-VIEW'),
    ('ROLE-FIN-APPR', 'PERM-REPORT-VIEW'),
    ('ROLE-MANAGER', 'PERM-REPORT-VIEW')
ON CONFLICT DO NOTHING;
"""
    )

    op.create_table(
        "financial_budgets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("fiscal_year", sa.Integer(), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False, server_default=sa.text("''")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("chart_of_accounts.id"), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default=sa.text("'USD'")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "fiscal_year",
            "period",
            "account_id",
            "currency",
            name="uq_financial_budget_period_account",
        ),
    )


def downgrade() -> None:
    op.drop_table("financial_budgets")
    op.execute("DELETE FROM role_permissions WHERE permission_id = 'PERM-REPORT-VIEW'")
    op.execute("DELETE FROM permissions WHERE id = 'PERM-REPORT-VIEW'")
