# @author: Wendy Yang
# @date: 2026-10-11

"""Companies, exchange rates, production orders, and inspections.

Revision ID: 20261011_0064
Revises: 20261010_0063
Create Date: 2026-10-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261011_0064"
down_revision: Union[str, Sequence[str], None] = "20261010_0063"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_COMPANY_ID = "11111111-1111-4111-8111-111111111111"

_MASTER_TABLES = ("items", "warehouses", "customers", "suppliers")
_DOCUMENT_TABLES = (
    "salesorders",
    "purchaseorders",
    "subcontractorders",
    "goods_receipts",
    "journal_entries",
    "company_profile",
)


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(20), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("base_currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_table(
        "user_companies",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        f"""
        INSERT INTO companies (id, code, name, base_currency, is_active)
        SELECT '{DEFAULT_COMPANY_ID}'::uuid,
               'DEFAULT',
               COALESCE(
                   (SELECT company_name FROM company_profile ORDER BY updated_at DESC NULLS LAST LIMIT 1),
                   'Default Company'
               ),
               'USD',
               true
        WHERE NOT EXISTS (SELECT 1 FROM companies WHERE code = 'DEFAULT')
        """
    )
    op.execute(
        sa.text(
            """
            INSERT INTO user_companies (user_id, company_id, is_default)
            SELECT u.id, c.id, true
            FROM users u
            JOIN companies c ON c.code = 'DEFAULT'
            WHERE NOT EXISTS (
                SELECT 1 FROM user_companies uc WHERE uc.user_id = u.id
            )
            """
        )
    )

    for table in _MASTER_TABLES + _DOCUMENT_TABLES:
        op.add_column(table, sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_company_id",
            table,
            "companies",
            ["company_id"],
            ["id"],
        )
        op.execute(
            f"UPDATE {table} SET company_id = '{DEFAULT_COMPANY_ID}'::uuid WHERE company_id IS NULL"
        )
        if table in _MASTER_TABLES:
            op.alter_column(table, "company_id", nullable=False)
        op.create_index(f"ix_{table}_company_id", table, ["company_id"])

    op.add_column(
        "items",
        sa.Column("requires_inspection", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "exchange_rates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quote_currency", sa.String(3), nullable=False),
        sa.Column("rate_to_base", sa.Numeric(18, 8), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("company_id", "quote_currency", "effective_date", name="uq_exchange_rate_company_currency_date"),
        sa.CheckConstraint("rate_to_base > 0", name="chk_exchange_rate_positive"),
        sa.CheckConstraint("source IN ('manual', 'frankfurter')", name="chk_exchange_rate_source"),
    )
    op.create_index("ix_exchange_rates_company_id", "exchange_rates", ["company_id"])

    op.create_table(
        "bom_routing_operations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("bom_header_id", sa.BigInteger(), sa.ForeignKey("itembomheaders.bom_header_id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("work_center_id", sa.String(50), sa.ForeignKey("work_centers.work_center_id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("setup_minutes", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("run_minutes_per_unit", sa.Numeric(10, 4), nullable=False, server_default="0"),
        sa.UniqueConstraint("bom_header_id", "sequence", name="uq_bom_routing_sequence"),
        sa.CheckConstraint("sequence > 0", name="chk_bom_routing_sequence_pos"),
        sa.CheckConstraint("setup_minutes >= 0", name="chk_bom_routing_setup_nonneg"),
        sa.CheckConstraint("run_minutes_per_unit >= 0", name="chk_bom_routing_run_nonneg"),
    )
    op.create_index("ix_bom_routing_operations_bom_header_id", "bom_routing_operations", ["bom_header_id"])

    op.create_table(
        "production_orders",
        sa.Column("production_order_id", sa.String(50), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("item_id", sa.String(50), sa.ForeignKey("items.item_id"), nullable=False),
        sa.Column("bom_header_id", sa.BigInteger(), sa.ForeignKey("itembomheaders.bom_header_id", ondelete="SET NULL"), nullable=True),
        sa.Column("warehouse_id", sa.String(50), sa.ForeignKey("warehouses.warehouse_id"), nullable=True),
        sa.Column("qty_ordered", sa.Integer(), nullable=False),
        sa.Column("qty_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("planned_start", sa.Date(), nullable=True),
        sa.Column("planned_end", sa.Date(), nullable=True),
        sa.Column("transaction_currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("exchange_rate", sa.Numeric(18, 8), nullable=True),
        sa.Column("rate_date", sa.Date(), nullable=True),
        sa.Column("transaction_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("base_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.CheckConstraint("qty_ordered > 0", name="chk_production_order_qty_pos"),
        sa.CheckConstraint("qty_completed >= 0", name="chk_production_order_completed_nonneg"),
        sa.CheckConstraint(
            "status IN ('draft', 'released', 'in_process', 'completed', 'closed')",
            name="chk_production_order_status",
        ),
    )
    op.create_index("ix_production_orders_company_id", "production_orders", ["company_id"])

    op.create_table(
        "production_order_materials",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("production_order_id", sa.String(50), sa.ForeignKey("production_orders.production_order_id", ondelete="CASCADE"), nullable=False),
        sa.Column("component_item_id", sa.String(50), sa.ForeignKey("items.item_id"), nullable=True),
        sa.Column("component_code", sa.String(50), nullable=True),
        sa.Column("item_type", sa.String(30), nullable=False, server_default="Material"),
        sa.Column("quantity_required", sa.Numeric(12, 4), nullable=False),
        sa.Column("quantity_issued", sa.Numeric(12, 4), nullable=False, server_default="0"),
    )
    op.create_index("ix_production_order_materials_order", "production_order_materials", ["production_order_id"])

    op.create_table(
        "production_issues",
        sa.Column("issue_id", sa.String(50), primary_key=True),
        sa.Column("production_order_id", sa.String(50), sa.ForeignKey("production_orders.production_order_id", ondelete="CASCADE"), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=False, server_default=sa.text("CURRENT_DATE")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("ix_production_issues_order", "production_issues", ["production_order_id"])

    op.create_table(
        "production_issue_lines",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("issue_id", sa.String(50), sa.ForeignKey("production_issues.issue_id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_id", sa.BigInteger(), sa.ForeignKey("production_order_materials.id", ondelete="SET NULL"), nullable=True),
        sa.Column("component_item_id", sa.String(50), sa.ForeignKey("items.item_id"), nullable=False),
        sa.Column("quantity_issued", sa.Numeric(12, 4), nullable=False),
        sa.CheckConstraint("quantity_issued > 0", name="chk_production_issue_qty_pos"),
    )

    op.create_table(
        "production_receipts",
        sa.Column("receipt_id", sa.String(50), primary_key=True),
        sa.Column("production_order_id", sa.String(50), sa.ForeignKey("production_orders.production_order_id", ondelete="CASCADE"), nullable=False),
        sa.Column("quantity_received", sa.Integer(), nullable=False),
        sa.Column("receipt_date", sa.Date(), nullable=False, server_default=sa.text("CURRENT_DATE")),
        sa.Column("posted_to_stock", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.CheckConstraint("quantity_received > 0", name="chk_production_receipt_qty_pos"),
    )
    op.create_index("ix_production_receipts_order", "production_receipts", ["production_order_id"])

    op.create_table(
        "inspections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("source_type", sa.String(30), nullable=False),
        sa.Column("source_id", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("inspector_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("inspected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.CheckConstraint(
            "source_type IN ('production_receipt', 'goods_receipt')",
            name="chk_inspection_source_type",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected')",
            name="chk_inspection_status",
        ),
    )
    op.create_index("ix_inspections_company_id", "inspections", ["company_id"])

    op.create_table(
        "inspection_results",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("inspection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("inspections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("characteristic", sa.String(150), nullable=False),
        sa.Column("specification", sa.String(255), nullable=True),
        sa.Column("measured_value", sa.String(255), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_inspection_results_inspection_id", "inspection_results", ["inspection_id"])

    op.execute(
        """
        INSERT INTO permissions (id, code, module, description) VALUES
            ('PERM-PROD-VIEW', 'production:view', 'production', 'View and run production orders'),
            ('PERM-INSP-VIEW', 'inspection:view', 'quality', 'View and record inspections')
        ON CONFLICT (id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT role_id, permission_id
        FROM (
            VALUES
                ('ROLE-ADMIN', 'PERM-PROD-VIEW'),
                ('ROLE-ADMIN', 'PERM-INSP-VIEW'),
                ('ROLE-SCO-SUP', 'PERM-PROD-VIEW'),
                ('ROLE-SCO-SUP', 'PERM-INSP-VIEW')
        ) AS wanted(role_id, permission_id)
        WHERE EXISTS (SELECT 1 FROM roles r WHERE r.role_id = wanted.role_id)
          AND EXISTS (SELECT 1 FROM permissions p WHERE p.id = wanted.permission_id)
          AND NOT EXISTS (
              SELECT 1 FROM role_permissions rp
              WHERE rp.role_id = wanted.role_id AND rp.permission_id = wanted.permission_id
          )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_permissions
        WHERE permission_id IN ('PERM-PROD-VIEW', 'PERM-INSP-VIEW')
        """
    )
    op.execute("DELETE FROM permissions WHERE id IN ('PERM-PROD-VIEW', 'PERM-INSP-VIEW')")
    op.drop_table("inspection_results")
    op.drop_table("inspections")
    op.drop_table("production_receipts")
    op.drop_table("production_issue_lines")
    op.drop_table("production_issues")
    op.drop_table("production_order_materials")
    op.drop_table("production_orders")
    op.drop_table("bom_routing_operations")
    op.drop_table("exchange_rates")
    op.drop_column("items", "requires_inspection")
    for table in _DOCUMENT_TABLES + _MASTER_TABLES:
        op.drop_index(f"ix_{table}_company_id", table_name=table)
        op.drop_constraint(f"fk_{table}_company_id", table, type_="foreignkey")
        op.drop_column(table, "company_id")
    op.drop_table("user_companies")
    op.drop_table("companies")
