# @author: Wendy Yang
# @date: 2026-09-19

"""Add goods receipts and supplier invoices for Procure-to-Pay.

Revision ID: 20260812_0010
Revises: 20260812_0009
Create Date: 2026-08-12
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260812_0010"
down_revision: Union[str, Sequence[str], None] = "20260812_0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "purchaseorders",
        sa.Column("billing_status", sa.String(length=30), server_default="UNBILLED", nullable=False),
    )
    op.add_column(
        "subcontractorders",
        sa.Column("billing_status", sa.String(length=30), server_default="UNBILLED", nullable=False),
    )
    op.add_column(
        "subcontractorders",
        sa.Column("unit_price", sa.Numeric(12, 4), server_default="0", nullable=False),
    )

    op.alter_column("ap_bills", "purchase_order_id", existing_type=sa.String(length=50), nullable=True)
    op.add_column("ap_bills", sa.Column("supplier_invoice_id", sa.Integer(), nullable=True))
    op.add_column("ap_bills", sa.Column("source_type", sa.String(length=30), nullable=True))
    op.add_column("ap_bills", sa.Column("source_order_id", sa.String(length=50), nullable=True))

    op.create_table(
        "goods_receipts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("receipt_number", sa.String(length=50), nullable=False),
        sa.Column("source_type", sa.String(length=30), nullable=False),
        sa.Column("source_order_id", sa.String(length=50), nullable=False),
        sa.Column("vendor_id", sa.String(length=50), nullable=False),
        sa.Column("receipt_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="POSTED"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["vendor_id"], ["suppliers.supplier_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("receipt_number"),
        sa.CheckConstraint(
            "source_type IN ('PURCHASE_ORDER', 'SUBCONTRACT_ORDER')",
            name="chk_goods_receipt_source_type",
        ),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'POSTED', 'CANCELLED')",
            name="chk_goods_receipt_status",
        ),
    )
    op.create_index("ix_goods_receipts_source", "goods_receipts", ["source_type", "source_order_id"])

    op.create_table(
        "goods_receipt_lines",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("receipt_id", sa.Integer(), nullable=False),
        sa.Column("source_line_id", sa.BigInteger(), nullable=True),
        sa.Column("item_id", sa.String(length=50), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("quantity_received", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(12, 4), nullable=False),
        sa.Column("line_amount", sa.Numeric(12, 2), nullable=False),
        sa.ForeignKeyConstraint(["receipt_id"], ["goods_receipts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["items.item_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("quantity_received > 0", name="chk_gr_line_qty_pos"),
    )

    op.create_table(
        "supplier_invoices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("invoice_number", sa.String(length=50), nullable=False),
        sa.Column("vendor_id", sa.String(length=50), nullable=False),
        sa.Column("source_type", sa.String(length=30), nullable=False),
        sa.Column("source_order_id", sa.String(length=50), nullable=False),
        sa.Column("vendor_invoice_number", sa.String(length=100), nullable=True),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="DRAFT"),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("freight_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("outstanding_balance", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="USD"),
        sa.Column("ap_bill_id", sa.String(length=50), nullable=True),
        sa.Column("match_warnings", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["vendor_id"], ["suppliers.supplier_id"]),
        sa.ForeignKeyConstraint(["ap_bill_id"], ["ap_bills.bill_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invoice_number"),
        sa.CheckConstraint(
            "source_type IN ('PURCHASE_ORDER', 'SUBCONTRACT_ORDER')",
            name="chk_supplier_invoice_source_type",
        ),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED')",
            name="chk_supplier_invoice_status",
        ),
    )
    op.create_index(
        "ix_supplier_invoices_source",
        "supplier_invoices",
        ["source_type", "source_order_id"],
    )
    op.create_index("ix_supplier_invoices_vendor_id", "supplier_invoices", ["vendor_id"])
    op.create_index("ix_supplier_invoices_status", "supplier_invoices", ["status"])

    op.create_table(
        "supplier_invoice_lines",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("source_line_id", sa.BigInteger(), nullable=True),
        sa.Column("item_id", sa.String(length=50), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("quantity_billed", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 4), nullable=False),
        sa.Column("line_subtotal", sa.Numeric(12, 2), nullable=False),
        sa.Column("goods_receipt_line_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["invoice_id"], ["supplier_invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["items.item_id"]),
        sa.ForeignKeyConstraint(["goods_receipt_line_id"], ["goods_receipt_lines.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("quantity_billed > 0", name="chk_si_line_qty_pos"),
    )

    op.create_foreign_key(
        "fk_ap_bills_supplier_invoice_id",
        "ap_bills",
        "supplier_invoices",
        ["supplier_invoice_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_ap_bills_supplier_invoice_id", "ap_bills", type_="foreignkey")
    op.drop_table("supplier_invoice_lines")
    op.drop_index("ix_supplier_invoices_status", table_name="supplier_invoices")
    op.drop_index("ix_supplier_invoices_vendor_id", table_name="supplier_invoices")
    op.drop_index("ix_supplier_invoices_source", table_name="supplier_invoices")
    op.drop_table("supplier_invoices")
    op.drop_table("goods_receipt_lines")
    op.drop_index("ix_goods_receipts_source", table_name="goods_receipts")
    op.drop_table("goods_receipts")
    op.drop_column("ap_bills", "source_order_id")
    op.drop_column("ap_bills", "source_type")
    op.drop_column("ap_bills", "supplier_invoice_id")
    op.alter_column("ap_bills", "purchase_order_id", existing_type=sa.String(length=50), nullable=False)
    op.drop_column("subcontractorders", "unit_price")
    op.drop_column("subcontractorders", "billing_status")
    op.drop_column("purchaseorders", "billing_status")
