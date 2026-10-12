# @author: Wendy Yang
# @date: 2026-10-12

"""Scrap, rework, legacy stock notes, and emergency quality alerts.

Revision ID: 20261012_0076
Revises: 20261012_0075
Create Date: 2026-10-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261012_0076"
down_revision: Union[str, Sequence[str], None] = "20261012_0075"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("chk_warehouse_stock_class", "warehouses", type_="check")
    op.create_check_constraint(
        "chk_warehouse_stock_class",
        "warehouses",
        "stock_class IN ('unrestricted', 'quarantine', 'scrap', 'rework')",
    )
    op.drop_constraint("chk_production_receipt_disposition", "production_receipts", type_="check")
    op.create_check_constraint(
        "chk_production_receipt_disposition",
        "production_receipts",
        "stock_disposition IN ('unposted', 'unrestricted', 'quarantine', 'scrap', 'rework')",
    )
    op.create_table(
        "quality_audit_notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("source_type", sa.String(30), nullable=False),
        sa.Column("source_id", sa.String(50), nullable=False),
        sa.Column("note_code", sa.String(40), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.CheckConstraint(
            "note_code IN ('Legacy_Stock_Override', 'Emergency_Override', 'Scrap', 'Rework')",
            name="chk_quality_audit_note_code",
        ),
    )
    op.create_index("ix_quality_audit_notes_company_id", "quality_audit_notes", ["company_id"])
    op.create_index("ix_quality_audit_notes_source_id", "quality_audit_notes", ["source_id"])
    op.create_table(
        "quality_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column(
            "audit_note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("quality_audit_notes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("recipient_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("recipient_role_id", sa.String(50), nullable=False, server_default="ROLE-MANAGER"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_quality_alerts_company_id", "quality_alerts", ["company_id"])
    op.execute(
        """
        INSERT INTO quality_audit_notes (id, company_id, source_type, source_id, note_code, message, created_at)
        SELECT gen_random_uuid(), picked.company_id, 'production_receipt', picked.receipt_id,
               'Legacy_Stock_Override',
               'Legacy_Stock_Override: this lot was rejected before quarantine posting, and the quantity is still in unrestricted stock.',
               NOW()
        FROM (
            SELECT DISTINCT ON (pr.receipt_id) pr.receipt_id, i.company_id
            FROM production_receipts pr
            JOIN inspections i
              ON i.source_type = 'production_receipt'
             AND i.source_id = pr.receipt_id
             AND i.status = 'rejected'
            WHERE pr.stock_disposition = 'unrestricted'
            ORDER BY pr.receipt_id, i.created_at DESC
        ) AS picked
        """
    )


def downgrade() -> None:
    op.drop_index("ix_quality_alerts_company_id", table_name="quality_alerts")
    op.drop_table("quality_alerts")
    op.drop_index("ix_quality_audit_notes_source_id", table_name="quality_audit_notes")
    op.drop_index("ix_quality_audit_notes_company_id", table_name="quality_audit_notes")
    op.drop_table("quality_audit_notes")
    op.drop_constraint("chk_production_receipt_disposition", "production_receipts", type_="check")
    op.create_check_constraint(
        "chk_production_receipt_disposition",
        "production_receipts",
        "stock_disposition IN ('unposted', 'unrestricted', 'quarantine')",
    )
    op.drop_constraint("chk_warehouse_stock_class", "warehouses", type_="check")
    op.create_check_constraint(
        "chk_warehouse_stock_class",
        "warehouses",
        "stock_class IN ('unrestricted', 'quarantine', 'scrap')",
    )
