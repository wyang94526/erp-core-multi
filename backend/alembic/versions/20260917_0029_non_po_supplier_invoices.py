"""Non-PO supplier invoices: invoice_type, nullable PO, GL distributions.

Revision ID: 20260917_0029
Revises: 20260916_0028
Create Date: 2026-09-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260917_0029"
down_revision: Union[str, Sequence[str], None] = "20260916_0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "supplier_invoices",
        sa.Column(
            "invoice_type",
            sa.String(length=20),
            nullable=False,
            server_default="PO_MATCHED",
        ),
    )
    op.execute(
        """
        UPDATE supplier_invoices
        SET invoice_type = 'PO_MATCHED'
        WHERE invoice_type IS NULL OR btrim(invoice_type) = ''
        """
    )
    op.alter_column("supplier_invoices", "source_order_id", existing_type=sa.String(length=50), nullable=True)
    op.alter_column("supplier_invoice_lines", "item_id", existing_type=sa.String(length=50), nullable=True)

    op.drop_constraint("chk_supplier_invoice_source_type", "supplier_invoices", type_="check")
    op.create_check_constraint(
        "chk_supplier_invoice_source_type",
        "supplier_invoices",
        "source_type IN ('PURCHASE_ORDER', 'SUBCONTRACT_ORDER', 'NON_PO')",
    )
    op.create_check_constraint(
        "chk_supplier_invoice_type",
        "supplier_invoices",
        "invoice_type IN ('PO_MATCHED', 'LANDED_COST', 'EXPENSE')",
    )

    op.create_table(
        "supplier_invoice_distributions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("gl_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("department_id", sa.String(length=50), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("goods_receipt_id", sa.Integer(), nullable=True),
        sa.Column("goods_receipt_line_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["invoice_id"], ["supplier_invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["gl_account_id"], ["chart_of_accounts.id"]),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"]),
        sa.ForeignKeyConstraint(["goods_receipt_id"], ["goods_receipts.id"]),
        sa.ForeignKeyConstraint(["goods_receipt_line_id"], ["goods_receipt_lines.id"]),
        sa.CheckConstraint("amount > 0", name="chk_si_dist_amount_pos"),
    )
    op.create_index(
        "ix_si_distributions_invoice",
        "supplier_invoice_distributions",
        ["invoice_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_si_distributions_invoice", table_name="supplier_invoice_distributions")
    op.drop_table("supplier_invoice_distributions")
    op.drop_constraint("chk_supplier_invoice_type", "supplier_invoices", type_="check")
    op.drop_constraint("chk_supplier_invoice_source_type", "supplier_invoices", type_="check")
    op.create_check_constraint(
        "chk_supplier_invoice_source_type",
        "supplier_invoices",
        "source_type IN ('PURCHASE_ORDER', 'SUBCONTRACT_ORDER')",
    )
    op.alter_column("supplier_invoice_lines", "item_id", existing_type=sa.String(length=50), nullable=False)
    op.execute("UPDATE supplier_invoices SET source_order_id = '' WHERE source_order_id IS NULL")
    op.alter_column("supplier_invoices", "source_order_id", existing_type=sa.String(length=50), nullable=False)
    op.drop_column("supplier_invoices", "invoice_type")
