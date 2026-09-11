"""Link subcontract orders to sales-order lines and per-line cost sheets.

Revision ID: 20260911_0020
Revises: 20260821_0019
Create Date: 2026-09-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260911_0020"
down_revision: Union[str, Sequence[str], None] = "20260821_0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "subcontractorders",
        sa.Column("sales_order_id", sa.String(length=50), nullable=True),
    )
    op.create_foreign_key(
        "fk_sco_sales_order",
        "subcontractorders",
        "salesorders",
        ["sales_order_id"],
        ["sales_order_id"],
    )
    op.create_index("ix_sco_sales_order_id", "subcontractorders", ["sales_order_id"])

    op.create_table(
        "subcontractorderitems",
        sa.Column("sco_line_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("sco_number", sa.String(length=50), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=False),
        sa.Column("so_item_id", sa.BigInteger(), nullable=True),
        sa.Column("item_id", sa.String(length=50), nullable=False),
        sa.Column("bom_header_id", sa.BigInteger(), nullable=True),
        sa.Column("quantity_ordered", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 4), server_default="0", nullable=False),
        sa.Column("margin_percent", sa.Numeric(8, 4), server_default="0", nullable=False),
        sa.Column("margin_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("cost_subtotal", sa.Numeric(12, 4), server_default="0", nullable=False),
        sa.Column("tax_exempt", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("tax_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("line_total", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("sco_line_id"),
        sa.ForeignKeyConstraint(
            ["sco_number"],
            ["subcontractorders.sco_number"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["so_item_id"],
            ["salesorderitems.so_item_id"],
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["items.item_id"],
        ),
        sa.ForeignKeyConstraint(
            ["bom_header_id"],
            ["itembomheaders.bom_header_id"],
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("sco_number", "line_number", name="uq_sco_line_number"),
        sa.CheckConstraint("quantity_ordered > 0", name="chk_sco_line_qty_positive"),
    )
    op.create_index("ix_sco_items_so_item", "subcontractorderitems", ["so_item_id"])
    op.execute(
        """
        CREATE UNIQUE INDEX uq_sco_line_so_item
        ON subcontractorderitems (sco_number, so_item_id)
        WHERE so_item_id IS NOT NULL
        """
    )

    op.execute(
        """
        INSERT INTO subcontractorderitems (
            sco_number, line_number, item_id, bom_header_id, quantity_ordered,
            unit_price, line_total
        )
        SELECT
            sco_number,
            1,
            item_id,
            bom_header_id,
            quantity_ordered,
            COALESCE(unit_price, 0),
            ROUND(COALESCE(unit_price, 0) * quantity_ordered, 2)
        FROM subcontractorders
        """
    )

    op.create_table(
        "subcontractorderlinecharges",
        sa.Column("sco_charge_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("sco_line_id", sa.BigInteger(), nullable=False),
        sa.Column("line_no", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("detail_explanation", sa.Text(), nullable=True),
        sa.Column("labor_minutes", sa.Numeric(8, 2), nullable=True),
        sa.Column("sf_rate", sa.Numeric(12, 4), nullable=True),
        sa.Column("cost_per_unit", sa.Numeric(12, 4), server_default="0", nullable=False),
        sa.Column("margin_percent", sa.Numeric(8, 4), nullable=True),
        sa.Column("is_margin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.PrimaryKeyConstraint("sco_charge_id"),
        sa.ForeignKeyConstraint(
            ["sco_line_id"],
            ["subcontractorderitems.sco_line_id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("sco_line_id", "line_no", name="uq_sco_charge_line_no"),
    )

    op.add_column(
        "subcontractordercomponents",
        sa.Column("sco_line_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "subcontractordercomponents",
        sa.Column("quantity_required_bom", sa.Numeric(12, 4), nullable=True),
    )
    op.add_column(
        "subcontractordercomponents",
        sa.Column("is_overridden", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "subcontractordercomponents",
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.execute(
        """
        UPDATE subcontractordercomponents c
        SET sco_line_id = i.sco_line_id
        FROM subcontractorderitems i
        WHERE i.sco_number = c.sco_number
        """
    )
    op.alter_column("subcontractordercomponents", "sco_line_id", nullable=False)
    op.create_foreign_key(
        "fk_sco_component_line",
        "subcontractordercomponents",
        "subcontractorderitems",
        ["sco_line_id"],
        ["sco_line_id"],
        ondelete="CASCADE",
    )
    op.drop_constraint("unique_component_per_sco", "subcontractordercomponents", type_="unique")
    op.create_unique_constraint(
        "unique_component_per_sco_line",
        "subcontractordercomponents",
        ["sco_line_id", "component_item_id"],
    )

    op.add_column(
        "materialissuelines",
        sa.Column("sco_line_id", sa.BigInteger(), nullable=True),
    )
    op.execute(
        """
        UPDATE materialissuelines mil
        SET sco_line_id = i.sco_line_id
        FROM materialissues mi
        JOIN subcontractorderitems i ON i.sco_number = mi.sco_number
        WHERE mil.issue_id = mi.issue_id
        """
    )
    op.create_foreign_key(
        "fk_material_issue_line_sco_line",
        "materialissuelines",
        "subcontractorderitems",
        ["sco_line_id"],
        ["sco_line_id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "componentissuelogs",
        sa.Column("sco_line_id", sa.BigInteger(), nullable=True),
    )
    op.execute(
        """
        UPDATE componentissuelogs l
        SET sco_line_id = i.sco_line_id
        FROM subcontractorderitems i
        WHERE i.sco_number = l.sco_number
        """
    )
    op.create_foreign_key(
        "fk_component_issue_log_sco_line",
        "componentissuelogs",
        "subcontractorderitems",
        ["sco_line_id"],
        ["sco_line_id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "finishedgoodsreceipts",
        sa.Column("sco_line_id", sa.BigInteger(), nullable=True),
    )
    op.execute(
        """
        UPDATE finishedgoodsreceipts r
        SET sco_line_id = i.sco_line_id
        FROM subcontractorderitems i
        WHERE i.sco_number = r.sco_number
        """
    )
    op.create_foreign_key(
        "fk_fg_receipt_sco_line",
        "finishedgoodsreceipts",
        "subcontractorderitems",
        ["sco_line_id"],
        ["sco_line_id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_fg_receipt_sco_line", "finishedgoodsreceipts", type_="foreignkey")
    op.drop_column("finishedgoodsreceipts", "sco_line_id")
    op.drop_constraint("fk_component_issue_log_sco_line", "componentissuelogs", type_="foreignkey")
    op.drop_column("componentissuelogs", "sco_line_id")
    op.drop_constraint("fk_material_issue_line_sco_line", "materialissuelines", type_="foreignkey")
    op.drop_column("materialissuelines", "sco_line_id")

    op.drop_constraint("unique_component_per_sco_line", "subcontractordercomponents", type_="unique")
    op.create_unique_constraint(
        "unique_component_per_sco",
        "subcontractordercomponents",
        ["sco_number", "component_item_id"],
    )
    op.drop_constraint("fk_sco_component_line", "subcontractordercomponents", type_="foreignkey")
    op.drop_column("subcontractordercomponents", "notes")
    op.drop_column("subcontractordercomponents", "is_overridden")
    op.drop_column("subcontractordercomponents", "quantity_required_bom")
    op.drop_column("subcontractordercomponents", "sco_line_id")

    op.drop_table("subcontractorderlinecharges")
    op.execute("DROP INDEX IF EXISTS uq_sco_line_so_item")
    op.drop_index("ix_sco_items_so_item", table_name="subcontractorderitems")
    op.drop_table("subcontractorderitems")

    op.drop_index("ix_sco_sales_order_id", table_name="subcontractorders")
    op.drop_constraint("fk_sco_sales_order", "subcontractorders", type_="foreignkey")
    op.drop_column("subcontractorders", "sales_order_id")
