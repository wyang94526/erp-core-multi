# @author: Wendy Yang
# @date: 2026-10-13

"""Audit document keys, lot numbers, and voided receivables.

Revision ID: 20261013_0077
Revises: 20261012_0076
Create Date: 2026-10-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261013_0077"
down_revision: Union[str, Sequence[str], None] = "20261012_0076"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("audit_logs", "record_id", existing_type=sa.Uuid(), nullable=True)
    op.add_column("audit_logs", sa.Column("document_key", sa.String(length=80), nullable=True))
    op.create_check_constraint(
        "chk_audit_logs_identity",
        "audit_logs",
        "record_id IS NOT NULL OR document_key IS NOT NULL",
    )
    op.add_column("stockmovements", sa.Column("lot_number", sa.String(length=80), nullable=True))
    op.add_column("item_fulfillment_lines", sa.Column("lot_number", sa.String(length=80), nullable=True))
    op.add_column("goods_receipt_lines", sa.Column("lot_number", sa.String(length=80), nullable=True))
    op.add_column("production_receipts", sa.Column("lot_number", sa.String(length=80), nullable=True))
    op.drop_constraint("chk_ar_invoice_status", "ar_invoices", type_="check")
    op.create_check_constraint(
        "chk_ar_invoice_status",
        "ar_invoices",
        "status IN ('Unpaid', 'Partial', 'Paid', 'Void')",
    )


def downgrade() -> None:
    op.execute("UPDATE ar_invoices SET status = 'Unpaid' WHERE status = 'Void'")
    op.drop_constraint("chk_ar_invoice_status", "ar_invoices", type_="check")
    op.create_check_constraint(
        "chk_ar_invoice_status",
        "ar_invoices",
        "status IN ('Unpaid', 'Partial', 'Paid')",
    )
    op.drop_column("production_receipts", "lot_number")
    op.drop_column("goods_receipt_lines", "lot_number")
    op.drop_column("item_fulfillment_lines", "lot_number")
    op.drop_column("stockmovements", "lot_number")
    op.drop_constraint("chk_audit_logs_identity", "audit_logs", type_="check")
    op.drop_column("audit_logs", "document_key")
    op.alter_column("audit_logs", "record_id", existing_type=sa.Uuid(), nullable=False)
