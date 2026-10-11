# @author: Wendy Yang
# @date: 2026-10-11

"""Shop-floor actuals on production routing steps.

Revision ID: 20261011_0072
Revises: 20261011_0071
Create Date: 2026-10-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_0072"
down_revision: Union[str, Sequence[str], None] = "20261011_0071"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "production_orders",
        sa.Column("backflushed_units", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.create_check_constraint(
        "chk_production_order_backflush_nonneg",
        "production_orders",
        "backflushed_units >= 0",
    )
    op.add_column("production_order_routing", sa.Column("company_id", sa.Uuid(), nullable=True))
    op.add_column(
        "production_order_routing",
        sa.Column("setup_minutes_actual", sa.Numeric(12, 2), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "production_order_routing",
        sa.Column("run_minutes_actual", sa.Numeric(12, 2), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "production_order_routing",
        sa.Column("good_quantity", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "production_order_routing",
        sa.Column("scrap_quantity", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "production_order_routing",
        sa.Column("rework_quantity", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column("production_order_routing", sa.Column("scrap_reason_code", sa.String(length=40), nullable=True))
    op.add_column(
        "production_order_routing",
        sa.Column("labor_hours", sa.Numeric(12, 4), server_default=sa.text("0"), nullable=False),
    )
    op.add_column("production_order_routing", sa.Column("operator_user_id", sa.Uuid(), nullable=True))
    op.add_column("production_order_routing", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("production_order_routing", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        """
        UPDATE production_order_routing AS step
        SET company_id = orders.company_id
        FROM production_orders AS orders
        WHERE orders.production_order_id = step.production_order_id
        """
    )
    op.alter_column("production_order_routing", "company_id", nullable=False)
    op.create_foreign_key(
        "fk_production_routing_company",
        "production_order_routing",
        "companies",
        ["company_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_production_routing_operator",
        "production_order_routing",
        "users",
        ["operator_user_id"],
        ["id"],
    )
    op.create_index("ix_production_order_routing_company_id", "production_order_routing", ["company_id"])
    op.create_check_constraint(
        "chk_production_routing_setup_actual_nonneg", "production_order_routing", "setup_minutes_actual >= 0"
    )
    op.create_check_constraint(
        "chk_production_routing_run_actual_nonneg", "production_order_routing", "run_minutes_actual >= 0"
    )
    op.create_check_constraint("chk_production_routing_good_nonneg", "production_order_routing", "good_quantity >= 0")
    op.create_check_constraint("chk_production_routing_scrap_nonneg", "production_order_routing", "scrap_quantity >= 0")
    op.create_check_constraint(
        "chk_production_routing_rework_nonneg", "production_order_routing", "rework_quantity >= 0"
    )
    op.create_check_constraint("chk_production_routing_labor_nonneg", "production_order_routing", "labor_hours >= 0")

    op.create_table(
        "production_step_labor_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("routing_step_id", sa.BigInteger(), nullable=False),
        sa.Column("production_order_id", sa.String(length=50), nullable=False),
        sa.Column("operator_user_id", sa.Uuid(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("labor_hours", sa.Numeric(12, 4), server_default=sa.text("0"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.CheckConstraint("labor_hours >= 0", name="chk_step_labor_hours_nonneg"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["operator_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["routing_step_id"], ["production_order_routing.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_production_step_labor_logs_company_id", "production_step_labor_logs", ["company_id"])
    op.create_index("ix_production_step_labor_logs_routing_step_id", "production_step_labor_logs", ["routing_step_id"])

    op.create_table(
        "production_step_scrap",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("routing_step_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("reason_code", sa.String(length=40), nullable=False),
        sa.Column("defect_class", sa.String(length=40), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.CheckConstraint("quantity > 0", name="chk_step_scrap_qty_pos"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["routing_step_id"], ["production_order_routing.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_production_step_scrap_company_id", "production_step_scrap", ["company_id"])
    op.create_index("ix_production_step_scrap_routing_step_id", "production_step_scrap", ["routing_step_id"])

    op.create_table(
        "production_material_backflushes",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("production_order_id", sa.String(length=50), nullable=False),
        sa.Column("routing_step_id", sa.BigInteger(), nullable=False),
        sa.Column("material_id", sa.BigInteger(), nullable=True),
        sa.Column("component_item_id", sa.String(length=50), nullable=True),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("lot_number", sa.String(length=80), nullable=True),
        sa.Column("serial_number", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.CheckConstraint("quantity > 0", name="chk_backflush_qty_pos"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["component_item_id"], ["items.item_id"]),
        sa.ForeignKeyConstraint(["material_id"], ["production_order_materials.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["production_order_id"], ["production_orders.production_order_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["routing_step_id"], ["production_order_routing.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_production_material_backflushes_company_id", "production_material_backflushes", ["company_id"])
    op.create_index(
        "ix_production_material_backflushes_production_order_id",
        "production_material_backflushes",
        ["production_order_id"],
    )
    op.create_index(
        "ix_production_material_backflushes_routing_step_id",
        "production_material_backflushes",
        ["routing_step_id"],
    )

    op.create_table(
        "production_step_quality",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("routing_step_id", sa.BigInteger(), nullable=False),
        sa.Column("characteristic", sa.String(length=150), nullable=False),
        sa.Column("specification", sa.String(length=255), nullable=True),
        sa.Column("measured_value", sa.String(length=255), nullable=True),
        sa.Column("passed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("defect_class", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["routing_step_id"], ["production_order_routing.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_production_step_quality_company_id", "production_step_quality", ["company_id"])
    op.create_index("ix_production_step_quality_routing_step_id", "production_step_quality", ["routing_step_id"])

    op.create_table(
        "production_step_downtime",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("routing_step_id", sa.BigInteger(), nullable=False),
        sa.Column("reason_code", sa.String(length=40), nullable=False),
        sa.Column("minutes", sa.Numeric(12, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.CheckConstraint("minutes > 0", name="chk_step_downtime_minutes_pos"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["routing_step_id"], ["production_order_routing.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_production_step_downtime_company_id", "production_step_downtime", ["company_id"])
    op.create_index("ix_production_step_downtime_routing_step_id", "production_step_downtime", ["routing_step_id"])

    op.create_table(
        "production_step_parameters",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("routing_step_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("value", sa.String(length=80), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["routing_step_id"], ["production_order_routing.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_production_step_parameters_company_id", "production_step_parameters", ["company_id"])
    op.create_index(
        "ix_production_step_parameters_routing_step_id", "production_step_parameters", ["routing_step_id"]
    )


def downgrade() -> None:
    op.drop_table("production_step_parameters")
    op.drop_table("production_step_downtime")
    op.drop_table("production_step_quality")
    op.drop_table("production_material_backflushes")
    op.drop_table("production_step_scrap")
    op.drop_table("production_step_labor_logs")
    op.drop_constraint("fk_production_routing_operator", "production_order_routing", type_="foreignkey")
    op.drop_constraint("fk_production_routing_company", "production_order_routing", type_="foreignkey")
    op.drop_index("ix_production_order_routing_company_id", table_name="production_order_routing")
    for name in (
        "chk_production_routing_labor_nonneg",
        "chk_production_routing_rework_nonneg",
        "chk_production_routing_scrap_nonneg",
        "chk_production_routing_good_nonneg",
        "chk_production_routing_run_actual_nonneg",
        "chk_production_routing_setup_actual_nonneg",
    ):
        op.drop_constraint(name, "production_order_routing", type_="check")
    for column in (
        "completed_at",
        "started_at",
        "operator_user_id",
        "labor_hours",
        "scrap_reason_code",
        "rework_quantity",
        "scrap_quantity",
        "good_quantity",
        "run_minutes_actual",
        "setup_minutes_actual",
        "company_id",
    ):
        op.drop_column("production_order_routing", column)
    op.drop_constraint("chk_production_order_backflush_nonneg", "production_orders", type_="check")
    op.drop_column("production_orders", "backflushed_units")
