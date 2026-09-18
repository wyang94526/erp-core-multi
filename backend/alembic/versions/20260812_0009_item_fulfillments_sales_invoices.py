# @author: Wendy Yang
# @date: 2026-09-19

"""Add item fulfillments and sales invoices for Order-to-Cash.

Revision ID: 20260812_0009
Revises: 20260812_0008
Create Date: 2026-08-12
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260812_0009"
down_revision: Union[str, Sequence[str], None] = "20260812_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "item_fulfillments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("fulfillment_number", sa.String(length=50), nullable=False),
        sa.Column("sales_order_id", sa.String(length=50), nullable=False),
        sa.Column("customer_id", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="DRAFT"),
        sa.Column("shipped_date", sa.Date(), nullable=True),
        sa.Column("carrier", sa.String(length=100), nullable=True),
        sa.Column("tracking_number", sa.String(length=100), nullable=True),
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
        sa.ForeignKeyConstraint(["sales_order_id"], ["salesorders.sales_order_id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.customer_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fulfillment_number"),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'PICKED', 'PACKED', 'SHIPPED')",
            name="chk_item_fulfillment_status",
        ),
    )
    op.create_index("ix_item_fulfillments_sales_order_id", "item_fulfillments", ["sales_order_id"])

    op.create_table(
        "item_fulfillment_lines",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("fulfillment_id", sa.Integer(), nullable=False),
        sa.Column("sales_order_line_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.String(length=50), nullable=False),
        sa.Column("quantity_fulfilled", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["fulfillment_id"], ["item_fulfillments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sales_order_line_id"], ["salesorderitems.so_item_id"]),
        sa.ForeignKeyConstraint(["item_id"], ["items.item_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("quantity_fulfilled > 0", name="chk_fulfillment_qty_pos"),
    )

    op.create_table(
        "sales_invoices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("invoice_number", sa.String(length=50), nullable=False),
        sa.Column("sales_order_id", sa.String(length=50), nullable=False),
        sa.Column("fulfillment_id", sa.Integer(), nullable=True),
        sa.Column("customer_id", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="DRAFT"),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("payment_terms", sa.String(length=50), nullable=True),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("outstanding_balance", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("ar_invoice_id", sa.String(length=50), nullable=True),
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
        sa.ForeignKeyConstraint(["sales_order_id"], ["salesorders.sales_order_id"]),
        sa.ForeignKeyConstraint(["fulfillment_id"], ["item_fulfillments.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.customer_id"]),
        sa.ForeignKeyConstraint(["ar_invoice_id"], ["ar_invoices.invoice_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invoice_number"),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'APPROVED', 'PAID', 'VOID')",
            name="chk_sales_invoice_status",
        ),
    )
    op.create_index("ix_sales_invoices_sales_order_id", "sales_invoices", ["sales_order_id"])

    op.create_table(
        "sales_invoice_lines",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.String(length=50), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 4), nullable=False),
        sa.Column("line_subtotal", sa.Numeric(12, 2), nullable=False),
        sa.ForeignKeyConstraint(["invoice_id"], ["sales_invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["items.item_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("quantity > 0", name="chk_sales_invoice_line_qty_pos"),
    )


def downgrade() -> None:
    op.drop_table("sales_invoice_lines")
    op.drop_index("ix_sales_invoices_sales_order_id", table_name="sales_invoices")
    op.drop_table("sales_invoices")
    op.drop_table("item_fulfillment_lines")
    op.drop_index("ix_item_fulfillments_sales_order_id", table_name="item_fulfillments")
    op.drop_table("item_fulfillments")
