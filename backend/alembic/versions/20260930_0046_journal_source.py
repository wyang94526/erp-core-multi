# @author: Wendy Yang
# @date: 2026-09-30

"""Add structural source fields on journal entries.

Revision ID: 20260930_0046
Revises: 20260927_0045
Create Date: 2026-09-30
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

revision: str = "20260930_0046"
down_revision: Union[str, Sequence[str], None] = "20260927_0045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SOURCE_TYPES = (
    "GOODS_RECEIPT",
    "SUPPLIER_INVOICE",
    "SALES_INVOICE",
    "SALES_CREDIT",
    "AR_PAYMENT",
    "AP_PAYMENT",
    "BANK_TRANSFER",
    "MONTH_END_CLOSE",
    "YEAR_END_CLOSE",
)


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    return bool(
        bind.execute(
            sa.text("SELECT to_regclass(:name)"),
            {"name": f"public.{table_name}"},
        ).scalar()
    )


def _ensure_posting_rules() -> None:
    """Windows/init-script DBs may have stamped 0039 without creating the table."""
    if _table_exists("posting_rules"):
        return
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
    session = Session(bind=op.get_bind())
    from app.services.posting_rules import ensure_default_posting_rules

    ensure_default_posting_rules(session)
    session.flush()


def upgrade() -> None:
    _ensure_posting_rules()
    op.add_column(
        "journal_entries",
        sa.Column(
            "is_system_generated",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "journal_entries",
        sa.Column("source_document_type", sa.String(length=40), nullable=True),
    )
    op.add_column(
        "journal_entries",
        sa.Column("source_record_id", sa.String(length=80), nullable=True),
    )
    op.add_column(
        "journal_entries",
        sa.Column("posting_rule_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_journal_entries_posting_rule_id",
        "journal_entries",
        "posting_rules",
        ["posting_rule_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "chk_journal_entries_source_document_type",
        "journal_entries",
        "source_document_type IS NULL OR source_document_type IN ("
        + ", ".join(f"'{value}'" for value in SOURCE_TYPES)
        + ")",
    )
    op.create_index(
        "ix_journal_entries_source_document",
        "journal_entries",
        ["source_document_type", "source_record_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_journal_entries_source_document", table_name="journal_entries")
    op.drop_constraint("chk_journal_entries_source_document_type", "journal_entries", type_="check")
    op.drop_constraint("fk_journal_entries_posting_rule_id", "journal_entries", type_="foreignkey")
    op.drop_column("journal_entries", "posting_rule_id")
    op.drop_column("journal_entries", "source_record_id")
    op.drop_column("journal_entries", "source_document_type")
    op.drop_column("journal_entries", "is_system_generated")
