# @author: Wendy Yang
# @date: 2026-10-11

"""Master route library, routing revision on production orders, and routing permissions.

Revision ID: 20261011_0070
Revises: 20261011_0069
Create Date: 2026-10-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_0070"
down_revision: Union[str, Sequence[str], None] = "20261011_0069"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "standard_operations",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("operation_code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("work_center_id", sa.String(length=50), nullable=True),
        sa.Column("setup_minutes", sa.Numeric(10, 2), server_default=sa.text("0"), nullable=False),
        sa.Column("run_minutes_per_unit", sa.Numeric(10, 4), server_default=sa.text("0"), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["work_center_id"], ["work_centers.work_center_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "operation_code", name="uq_standard_operation_code"),
        sa.CheckConstraint("setup_minutes >= 0", name="chk_standard_operation_setup_nonneg"),
        sa.CheckConstraint("run_minutes_per_unit >= 0", name="chk_standard_operation_run_nonneg"),
    )
    op.create_index("ix_standard_operations_company_id", "standard_operations", ["company_id"])
    op.create_table(
        "master_routings",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("routing_code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'draft'"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "routing_code", "version_no", name="uq_master_routing_version"),
        sa.CheckConstraint("version_no > 0", name="chk_master_routing_version_pos"),
        sa.CheckConstraint("status IN ('draft', 'active', 'obsolete')", name="chk_master_routing_status"),
    )
    op.create_index("ix_master_routings_company_id", "master_routings", ["company_id"])
    op.create_index(
        "uq_one_active_master_routing",
        "master_routings",
        ["company_id", "routing_code"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_table(
        "master_routing_operations",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("master_routing_id", sa.BigInteger(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("standard_operation_id", sa.BigInteger(), nullable=True),
        sa.Column("work_center_id", sa.String(length=50), nullable=True),
        sa.Column("operation_name", sa.String(length=150), nullable=False),
        sa.Column("setup_minutes", sa.Numeric(10, 2), server_default=sa.text("0"), nullable=False),
        sa.Column("run_minutes_per_unit", sa.Numeric(10, 4), server_default=sa.text("0"), nullable=False),
        sa.ForeignKeyConstraint(["master_routing_id"], ["master_routings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["standard_operation_id"], ["standard_operations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["work_center_id"], ["work_centers.work_center_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("master_routing_id", "sequence", name="uq_master_routing_sequence"),
        sa.CheckConstraint("sequence > 0", name="chk_master_routing_op_sequence_pos"),
        sa.CheckConstraint("setup_minutes >= 0", name="chk_master_routing_op_setup_nonneg"),
        sa.CheckConstraint("run_minutes_per_unit >= 0", name="chk_master_routing_op_run_nonneg"),
    )
    op.create_index("ix_master_routing_operations_master_routing_id", "master_routing_operations", ["master_routing_id"])
    op.add_column("itembomheaders", sa.Column("applied_master_routing_id", sa.BigInteger(), nullable=True))
    op.add_column("itembomheaders", sa.Column("applied_routing_code", sa.String(length=50), nullable=True))
    op.add_column("itembomheaders", sa.Column("applied_routing_version", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_itembomheaders_applied_master_routing_id",
        "itembomheaders",
        "master_routings",
        ["applied_master_routing_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("production_orders", sa.Column("master_routing_id", sa.BigInteger(), nullable=True))
    op.add_column("production_orders", sa.Column("routing_code", sa.String(length=50), nullable=True))
    op.add_column("production_orders", sa.Column("routing_version_no", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_production_orders_master_routing_id",
        "production_orders",
        "master_routings",
        ["master_routing_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        INSERT INTO permissions (id, code, module, description) VALUES
            ('PERM-ROUTE-VIEW', 'routing:view', 'production', 'View the route library and work instructions'),
            ('PERM-ROUTE-EDIT', 'routing:edit', 'production', 'Maintain master routings and apply them to a BOM')
        ON CONFLICT (id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT role_id, permission_id
        FROM (
            VALUES
                ('ROLE-ADMIN', 'PERM-ROUTE-VIEW'),
                ('ROLE-ADMIN', 'PERM-ROUTE-EDIT'),
                ('ROLE-MANAGER', 'PERM-ROUTE-VIEW'),
                ('ROLE-MANAGER', 'PERM-ROUTE-EDIT'),
                ('ROLE-SCO-SUP', 'PERM-ROUTE-VIEW')
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
        WHERE permission_id IN ('PERM-ROUTE-VIEW', 'PERM-ROUTE-EDIT')
        """
    )
    op.execute("DELETE FROM permissions WHERE id IN ('PERM-ROUTE-VIEW', 'PERM-ROUTE-EDIT')")
    op.drop_constraint("fk_production_orders_master_routing_id", "production_orders", type_="foreignkey")
    op.drop_column("production_orders", "routing_version_no")
    op.drop_column("production_orders", "routing_code")
    op.drop_column("production_orders", "master_routing_id")
    op.drop_constraint("fk_itembomheaders_applied_master_routing_id", "itembomheaders", type_="foreignkey")
    op.drop_column("itembomheaders", "applied_routing_version")
    op.drop_column("itembomheaders", "applied_routing_code")
    op.drop_column("itembomheaders", "applied_master_routing_id")
    op.drop_index("ix_master_routing_operations_master_routing_id", table_name="master_routing_operations")
    op.drop_table("master_routing_operations")
    op.drop_index("uq_one_active_master_routing", table_name="master_routings")
    op.drop_index("ix_master_routings_company_id", table_name="master_routings")
    op.drop_table("master_routings")
    op.drop_index("ix_standard_operations_company_id", table_name="standard_operations")
    op.drop_table("standard_operations")
