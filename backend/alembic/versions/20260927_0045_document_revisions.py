# @author: Wendy Yang
# @date: 2026-09-27

"""Same-number revision snapshots and field-level change logs for SO/PO/SCO.

Revision ID: 20260927_0045
Revises: 20260924_0044
Create Date: 2026-09-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260927_0045"
down_revision: Union[str, Sequence[str], None] = "20260924_0044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "salesorders",
        sa.Column("revision_number", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "salesorders",
        sa.Column("root_document_id", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "purchaseorders",
        sa.Column("revision_number", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "purchaseorders",
        sa.Column("root_document_id", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "subcontractorders",
        sa.Column("revision_number", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "subcontractorders",
        sa.Column("root_document_id", sa.String(length=50), nullable=True),
    )

    op.execute("UPDATE salesorders SET root_document_id = sales_order_id WHERE root_document_id IS NULL")
    op.execute("UPDATE purchaseorders SET root_document_id = po_number WHERE root_document_id IS NULL")
    op.execute(
        """
        UPDATE subcontractorders
        SET root_document_id = sco_number,
            revision_number = COALESCE(amendment_number, 0)
        WHERE root_document_id IS NULL
        """
    )

    op.alter_column("salesorders", "root_document_id", existing_type=sa.String(length=50), nullable=False)
    op.alter_column("purchaseorders", "root_document_id", existing_type=sa.String(length=50), nullable=False)
    op.alter_column("subcontractorders", "root_document_id", existing_type=sa.String(length=50), nullable=False)

    op.create_index("ix_salesorders_root_document_id", "salesorders", ["root_document_id"])
    op.create_index("ix_purchaseorders_root_document_id", "purchaseorders", ["root_document_id"])
    op.create_index("ix_subcontractorders_root_document_id", "subcontractorders", ["root_document_id"])

    op.create_table(
        "document_revisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("document_type", sa.String(length=30), nullable=False),
        sa.Column("document_id", sa.String(length=50), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("root_document_id", sa.String(length=50), nullable=False),
        sa.Column("snapshot_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.UniqueConstraint(
            "document_type",
            "document_id",
            "revision_number",
            name="uq_document_revisions_doc_rev",
        ),
    )
    op.create_index(
        "ix_document_revisions_document",
        "document_revisions",
        ["document_type", "document_id"],
    )

    op.create_table(
        "document_change_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("document_type", sa.String(length=30), nullable=False),
        sa.Column("document_id", sa.String(length=50), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("field_name", sa.String(length=120), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index(
        "ix_document_change_logs_document",
        "document_change_logs",
        ["document_type", "document_id", "created_at"],
    )

    op.execute("ALTER TABLE approval_audit_log DROP CONSTRAINT IF EXISTS chk_approval_audit_action")
    op.create_check_constraint(
        "chk_approval_audit_action",
        "approval_audit_log",
        "action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED', 'AMENDED', 'RECALLED', 'REVISED')",
    )


def downgrade() -> None:
    op.execute("ALTER TABLE approval_audit_log DROP CONSTRAINT IF EXISTS chk_approval_audit_action")
    op.create_check_constraint(
        "chk_approval_audit_action",
        "approval_audit_log",
        "action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED', 'AMENDED', 'RECALLED')",
    )
    op.drop_index("ix_document_change_logs_document", table_name="document_change_logs")
    op.drop_table("document_change_logs")
    op.drop_index("ix_document_revisions_document", table_name="document_revisions")
    op.drop_table("document_revisions")
    op.drop_index("ix_subcontractorders_root_document_id", table_name="subcontractorders")
    op.drop_index("ix_purchaseorders_root_document_id", table_name="purchaseorders")
    op.drop_index("ix_salesorders_root_document_id", table_name="salesorders")
    op.drop_column("subcontractorders", "root_document_id")
    op.drop_column("subcontractorders", "revision_number")
    op.drop_column("purchaseorders", "root_document_id")
    op.drop_column("purchaseorders", "revision_number")
    op.drop_column("salesorders", "root_document_id")
    op.drop_column("salesorders", "revision_number")
