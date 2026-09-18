# @author: Wendy Yang
# @date: 2026-09-19

"""Create named delivery-schedule tables for SO, PO, and SCO.

Revision ID: 20260821_0019
Revises: 20260821_0018
Create Date: 2026-08-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260821_0019"
down_revision: Union[str, Sequence[str], None] = "20260821_0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS orderdeliveryschedules CASCADE")

    op.create_table(
        "salesorderdeliveryschedules",
        sa.Column("schedule_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("so_item_id", sa.BigInteger(), nullable=False),
        sa.Column("sub_line_number", sa.String(length=10), nullable=True),
        sa.Column("ship_to_location_id", sa.String(length=50), nullable=True),
        sa.Column("scheduled_quantity", sa.Integer(), nullable=False),
        sa.Column("needed_delivery_date", sa.DateTime(), nullable=False),
        sa.Column("promised_ship_date", sa.DateTime(), nullable=True),
        sa.Column("requester_name", sa.String(length=100), nullable=True),
        sa.Column("tax_flag", sa.CHAR(length=1), nullable=True, server_default="N"),
        sa.Column("status", sa.String(length=30), nullable=True, server_default="PENDING"),
        sa.ForeignKeyConstraint(
            ["so_item_id"],
            ["salesorderitems.so_item_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["ship_to_location_id"],
            ["customerlocations.location_id"],
        ),
        sa.PrimaryKeyConstraint("schedule_id"),
    )
    op.create_index(
        "ix_salesorderdeliveryschedules_so_item_id",
        "salesorderdeliveryschedules",
        ["so_item_id"],
    )

    op.create_table(
        "purchaseorderdeliveryschedules",
        sa.Column("schedule_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("po_item_id", sa.BigInteger(), nullable=False),
        sa.Column("sub_line_number", sa.String(length=10), nullable=True),
        sa.Column("warehouse_id", sa.String(length=50), nullable=True),
        sa.Column("bin_id", sa.String(length=50), nullable=True),
        sa.Column("scheduled_quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("needed_delivery_date", sa.DateTime(), nullable=False),
        sa.Column("promised_delivery_date", sa.DateTime(), nullable=True),
        sa.Column("requester_name", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=True, server_default="PENDING"),
        sa.ForeignKeyConstraint(
            ["po_item_id"],
            ["purchaseorderitems.item_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.warehouse_id"]),
        sa.ForeignKeyConstraint(["bin_id"], ["binlocations.bin_id"]),
        sa.PrimaryKeyConstraint("schedule_id"),
    )
    op.create_index(
        "ix_purchaseorderdeliveryschedules_po_item_id",
        "purchaseorderdeliveryschedules",
        ["po_item_id"],
    )

    op.create_table(
        "subcontractorderdeliveryschedules",
        sa.Column("schedule_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("sco_number", sa.String(length=50), nullable=False),
        sa.Column("sub_line_number", sa.String(length=10), nullable=True),
        sa.Column("warehouse_id", sa.String(length=50), nullable=True),
        sa.Column("bin_id", sa.String(length=50), nullable=True),
        sa.Column("scheduled_quantity", sa.Integer(), nullable=False),
        sa.Column("needed_return_date", sa.DateTime(), nullable=False),
        sa.Column("promised_return_date", sa.DateTime(), nullable=True),
        sa.Column("requester_name", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=True, server_default="PENDING"),
        sa.ForeignKeyConstraint(
            ["sco_number"],
            ["subcontractorders.sco_number"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.warehouse_id"]),
        sa.ForeignKeyConstraint(["bin_id"], ["binlocations.bin_id"]),
        sa.PrimaryKeyConstraint("schedule_id"),
    )
    op.create_index(
        "ix_subcontractorderdeliveryschedules_sco_number",
        "subcontractorderdeliveryschedules",
        ["sco_number"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_subcontractorderdeliveryschedules_sco_number",
        table_name="subcontractorderdeliveryschedules",
    )
    op.drop_table("subcontractorderdeliveryschedules")
    op.drop_index(
        "ix_purchaseorderdeliveryschedules_po_item_id",
        table_name="purchaseorderdeliveryschedules",
    )
    op.drop_table("purchaseorderdeliveryschedules")
    op.drop_index(
        "ix_salesorderdeliveryschedules_so_item_id",
        table_name="salesorderdeliveryschedules",
    )
    op.drop_table("salesorderdeliveryschedules")
