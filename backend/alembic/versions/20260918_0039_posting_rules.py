# @author: Wendy Yang
# @date: 2026-09-19

"""Create posting_rules and seed the standard TIPTOP debit/credit catalog.

Revision ID: 20260918_0039
Revises: 20260918_0038
Create Date: 2026-09-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

revision: str = "20260918_0039"
down_revision: Union[str, Sequence[str], None] = "20260918_0038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "posting_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("rule_code", sa.String(length=50), nullable=False),
        sa.Column("event_code", sa.String(length=40), nullable=False),
        sa.Column("variant", sa.String(length=40), nullable=False),
        sa.Column("party_scope", sa.String(length=20), nullable=False, server_default="ANY"),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("debit_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("credit_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.CheckConstraint(
            "party_scope IN ('TRADE', 'RELATED', 'ANY')",
            name="chk_posting_rules_party_scope",
        ),
        sa.CheckConstraint(
            "debit_account_id <> credit_account_id",
            name="chk_posting_rules_distinct_accounts",
        ),
        sa.ForeignKeyConstraint(
            ["debit_account_id"],
            ["chart_of_accounts.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["credit_account_id"],
            ["chart_of_accounts.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("rule_code"),
        sa.UniqueConstraint("event_code", "variant", "party_scope", name="uq_posting_rules_event"),
    )
    op.create_index(
        "ix_posting_rules_event_variant",
        "posting_rules",
        ["event_code", "variant"],
    )
    bind = op.get_bind()
    session = Session(bind=bind)
    from app.services.posting_rules import ensure_default_posting_rules

    ensure_default_posting_rules(session)
    session.flush()


def downgrade() -> None:
    op.drop_index("ix_posting_rules_event_variant", table_name="posting_rules")
    op.drop_table("posting_rules")
