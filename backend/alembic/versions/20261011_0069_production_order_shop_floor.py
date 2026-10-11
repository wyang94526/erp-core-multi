# @author: Wendy Yang
# @date: 2026-10-11

"""Production order sales link, scrap, due date, component snapshot, and routing.

Revision ID: 20261011_0069
Revises: 20261011_0068
Create Date: 2026-10-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_0069"
down_revision: Union[str, Sequence[str], None] = "20261011_0068"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("production_orders", sa.Column("sales_order_id", sa.String(length=50), nullable=True))
    op.add_column(
        "production_orders",
        sa.Column("scrapped_qty", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column("production_orders", sa.Column("due_date", sa.Date(), nullable=True))
    op.create_foreign_key(
        "fk_production_orders_sales_order_id",
        "production_orders",
        "salesorders",
        ["sales_order_id"],
        ["sales_order_id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "chk_production_order_scrapped_nonneg",
        "production_orders",
        "scrapped_qty >= 0",
    )
    op.drop_constraint("chk_production_order_status", "production_orders", type_="check")
    op.create_check_constraint(
        "chk_production_order_status",
        "production_orders",
        "status IN ('draft', 'released', 'in_process', 'completed', 'closed', 'cancelled')",
    )
    op.add_column("production_order_materials", sa.Column("warehouse_id", sa.String(length=50), nullable=True))
    op.add_column(
        "production_order_materials",
        sa.Column(
            "lot_serial_tracking_required",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.create_foreign_key(
        "fk_production_order_materials_warehouse_id",
        "production_order_materials",
        "warehouses",
        ["warehouse_id"],
        ["warehouse_id"],
    )
    op.create_table(
        "production_order_routing",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("production_order_id", sa.String(length=50), nullable=False),
        sa.Column("operation_sequence", sa.Integer(), nullable=False),
        sa.Column("work_center_id", sa.String(length=50), nullable=True),
        sa.Column("operation_name", sa.String(length=150), nullable=False),
        sa.Column("setup_time", sa.Numeric(12, 2), server_default=sa.text("0"), nullable=False),
        sa.Column("run_time", sa.Numeric(12, 2), server_default=sa.text("0"), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'pending'"), nullable=False),
        sa.ForeignKeyConstraint(
            ["production_order_id"],
            ["production_orders.production_order_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["work_center_id"], ["work_centers.work_center_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("operation_sequence > 0", name="chk_production_routing_sequence_pos"),
        sa.CheckConstraint("setup_time >= 0", name="chk_production_routing_setup_nonneg"),
        sa.CheckConstraint("run_time >= 0", name="chk_production_routing_run_nonneg"),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'completed')",
            name="chk_production_routing_status",
        ),
    )
    op.create_index(
        "ix_production_order_routing_production_order_id",
        "production_order_routing",
        ["production_order_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_production_order_routing_production_order_id", table_name="production_order_routing")
    op.drop_table("production_order_routing")
    op.drop_constraint("fk_production_order_materials_warehouse_id", "production_order_materials", type_="foreignkey")
    op.drop_column("production_order_materials", "lot_serial_tracking_required")
    op.drop_column("production_order_materials", "warehouse_id")
    op.drop_constraint("chk_production_order_status", "production_orders", type_="check")
    op.create_check_constraint(
        "chk_production_order_status",
        "production_orders",
        "status IN ('draft', 'released', 'in_process', 'completed', 'closed')",
    )
    op.drop_constraint("chk_production_order_scrapped_nonneg", "production_orders", type_="check")
    op.drop_constraint("fk_production_orders_sales_order_id", "production_orders", type_="foreignkey")
    op.drop_column("production_orders", "due_date")
    op.drop_column("production_orders", "scrapped_qty")
    op.drop_column("production_orders", "sales_order_id")
