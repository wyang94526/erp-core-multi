# @author: Wendy Yang
# @date: 2026-09-19

"""Purchase item catalog: classification flags, vendor mappings, BOM scrap factors.

Revision ID: 20260804_0002
Revises: 20260804_0001
Create Date: 2026-08-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260804_0002"
down_revision: Union[str, Sequence[str], None] = "20260804_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("is_purchase_item", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "products",
        sa.Column(
            "is_subcontract_assembly",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "products",
        sa.Column("is_raw_material", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # Backfill assemblies from legacy outside-processed flag
    op.execute(
        """
        UPDATE products
        SET is_subcontract_assembly = TRUE
        WHERE is_outside_processed = TRUE
        """
    )

    op.add_column(
        "productbomcomponents",
        sa.Column("scrap_factor", sa.Numeric(8, 4), nullable=False, server_default="0"),
    )
    op.add_column(
        "productbomcomponents",
        sa.Column(
            "yield_loss_percentage",
            sa.Numeric(8, 4),
            nullable=False,
            server_default="0",
        ),
    )

    op.create_table(
        "vendoritemmappings",
        sa.Column("mapping_id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("supplier_id", sa.String(length=50), nullable=False),
        sa.Column("product_id", sa.String(length=50), nullable=False),
        sa.Column("vendor_sku", sa.String(length=100), nullable=True),
        sa.Column("unit_cost", sa.Numeric(12, 4), nullable=True),
        sa.Column("minimum_order_qty", sa.Numeric(12, 4), nullable=False, server_default="1"),
        sa.Column("lead_time_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_primary_vendor", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.supplier_id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.product_id"], ondelete="CASCADE"),
        sa.UniqueConstraint("supplier_id", "product_id", name="uq_vendor_item_mapping"),
    )

    # Component issue log: durable audit of each issue line (mirrors MaterialIssueLines
    # with SCO context denormalized for reporting).
    op.create_table(
        "componentissuelogs",
        sa.Column("log_id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("sco_number", sa.String(length=50), nullable=False),
        sa.Column("issue_id", sa.String(length=50), nullable=False),
        sa.Column("component_product_id", sa.String(length=50), nullable=False),
        sa.Column("quantity_issued", sa.Numeric(12, 4), nullable=False),
        sa.Column(
            "issued_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["sco_number"], ["subcontractorders.sco_number"]),
        sa.ForeignKeyConstraint(["issue_id"], ["materialissues.issue_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["component_product_id"], ["products.product_id"]),
        sa.CheckConstraint("quantity_issued > 0", name="chk_component_issue_log_qty"),
    )


def downgrade() -> None:
    op.drop_table("componentissuelogs")
    op.drop_table("vendoritemmappings")
    op.drop_column("productbomcomponents", "yield_loss_percentage")
    op.drop_column("productbomcomponents", "scrap_factor")
    op.drop_column("products", "is_raw_material")
    op.drop_column("products", "is_subcontract_assembly")
    op.drop_column("products", "is_purchase_item")
