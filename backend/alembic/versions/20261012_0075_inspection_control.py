# @author: Wendy Yang
# @date: 2026-10-12

"""Closed-loop inspection control: one lot, quarantine, plans, and quality roles.

Revision ID: 20261012_0075
Revises: 20261012_0074
Create Date: 2026-10-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261012_0075"
down_revision: Union[str, Sequence[str], None] = "20261012_0074"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "warehouses",
        sa.Column("stock_class", sa.String(20), server_default="unrestricted", nullable=False),
    )
    op.create_check_constraint(
        "chk_warehouse_stock_class",
        "warehouses",
        "stock_class IN ('unrestricted', 'quarantine', 'scrap')",
    )
    op.add_column(
        "production_receipts",
        sa.Column("stock_disposition", sa.String(20), server_default="unposted", nullable=False),
    )
    op.add_column(
        "production_receipts",
        sa.Column("completion_counted", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "production_receipts",
        sa.Column("received_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_production_receipt_received_by",
        "production_receipts",
        "users",
        ["received_by_user_id"],
        ["id"],
    )
    op.create_check_constraint(
        "chk_production_receipt_disposition",
        "production_receipts",
        "stock_disposition IN ('unposted', 'unrestricted', 'quarantine')",
    )
    op.execute(
        """
        UPDATE production_receipts
        SET stock_disposition = CASE WHEN posted_to_stock THEN 'unrestricted' ELSE 'unposted' END,
            completion_counted = posted_to_stock
        """
    )
    op.add_column(
        "inspections",
        sa.Column("prior_inspection_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_inspection_prior",
        "inspections",
        "inspections",
        ["prior_inspection_id"],
        ["id"],
    )
    op.create_index(
        "uq_inspection_open_source",
        "inspections",
        ["company_id", "source_type", "source_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.add_column("inspection_results", sa.Column("method", sa.String(20), nullable=True))
    op.add_column("inspection_results", sa.Column("min_value", sa.Numeric(14, 4), nullable=True))
    op.add_column("inspection_results", sa.Column("max_value", sa.Numeric(14, 4), nullable=True))
    op.add_column("inspection_results", sa.Column("unit", sa.String(20), nullable=True))
    op.create_table(
        "inspection_plans",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("item_id", sa.String(50), sa.ForeignKey("items.item_id"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("characteristic", sa.String(150), nullable=False),
        sa.Column("method", sa.String(20), nullable=False),
        sa.Column("min_value", sa.Numeric(14, 4), nullable=True),
        sa.Column("max_value", sa.Numeric(14, 4), nullable=True),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.Column("options", sa.String(255), nullable=True),
        sa.Column("pass_options", sa.String(255), nullable=True),
        sa.CheckConstraint("method IN ('numeric', 'attribute')", name="chk_inspection_plan_method"),
        sa.CheckConstraint("sequence > 0", name="chk_inspection_plan_sequence_pos"),
        sa.UniqueConstraint("company_id", "item_id", "characteristic", name="uq_inspection_plan_characteristic"),
    )
    op.create_index("ix_inspection_plans_company_id", "inspection_plans", ["company_id"])
    op.create_index("ix_inspection_plans_item_id", "inspection_plans", ["item_id"])
    op.create_table(
        "reinspection_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("inspection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("inspections.id"), nullable=False),
        sa.Column("source_type", sa.String(30), nullable=False),
        sa.Column("source_id", sa.String(50), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("requested_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("decided_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'consumed')",
            name="chk_reinspection_status",
        ),
    )
    op.create_index("ix_reinspection_requests_company_id", "reinspection_requests", ["company_id"])
    op.execute(
        """
        INSERT INTO permissions (id, code, module, description) VALUES
            ('PERM-INSP-DECIDE', 'inspection:decide', 'quality', 'Accept or reject an inspection lot'),
            ('PERM-INSP-REOPEN', 'inspection:reopen', 'quality', 'Approve a re-inspection after a lot is closed')
        ON CONFLICT (id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO roles (role_id, role_name, description) VALUES
            ('ROLE-QC-INSP', 'Quality Inspector', 'Record inspection measurements and accept or reject a lot'),
            ('ROLE-QC-MGR', 'Quality Manager', 'Approve re-inspection and maintain inspection plans')
        ON CONFLICT (role_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT role_id, permission_id
        FROM (
            VALUES
                ('ROLE-QC-INSP', 'PERM-INSP-VIEW'),
                ('ROLE-QC-INSP', 'PERM-INSP-DECIDE'),
                ('ROLE-QC-MGR', 'PERM-INSP-VIEW'),
                ('ROLE-QC-MGR', 'PERM-INSP-DECIDE'),
                ('ROLE-QC-MGR', 'PERM-INSP-REOPEN')
        ) AS wanted(role_id, permission_id)
        WHERE NOT EXISTS (
            SELECT 1 FROM role_permissions rp
            WHERE rp.role_id = wanted.role_id AND rp.permission_id = wanted.permission_id
        )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_permissions
        WHERE permission_id IN ('PERM-INSP-DECIDE', 'PERM-INSP-REOPEN')
           OR role_id IN ('ROLE-QC-INSP', 'ROLE-QC-MGR')
        """
    )
    op.execute("DELETE FROM permissions WHERE id IN ('PERM-INSP-DECIDE', 'PERM-INSP-REOPEN')")
    op.execute("DELETE FROM roles WHERE role_id IN ('ROLE-QC-INSP', 'ROLE-QC-MGR')")
    op.drop_table("reinspection_requests")
    op.drop_index("ix_inspection_plans_item_id", table_name="inspection_plans")
    op.drop_index("ix_inspection_plans_company_id", table_name="inspection_plans")
    op.drop_table("inspection_plans")
    op.drop_column("inspection_results", "unit")
    op.drop_column("inspection_results", "max_value")
    op.drop_column("inspection_results", "min_value")
    op.drop_column("inspection_results", "method")
    op.drop_index("uq_inspection_open_source", table_name="inspections")
    op.drop_constraint("fk_inspection_prior", "inspections", type_="foreignkey")
    op.drop_column("inspections", "prior_inspection_id")
    op.drop_constraint("chk_production_receipt_disposition", "production_receipts", type_="check")
    op.drop_constraint("fk_production_receipt_received_by", "production_receipts", type_="foreignkey")
    op.drop_column("production_receipts", "received_by_user_id")
    op.drop_column("production_receipts", "completion_counted")
    op.drop_column("production_receipts", "stock_disposition")
    op.drop_constraint("chk_warehouse_stock_class", "warehouses", type_="check")
    op.drop_column("warehouses", "stock_class")
