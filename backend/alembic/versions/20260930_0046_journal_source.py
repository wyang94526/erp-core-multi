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


def upgrade() -> None:
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
