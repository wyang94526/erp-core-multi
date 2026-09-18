# @author: Wendy Yang
# @date: 2026-09-19

"""Extend suppliers for material vs subcontractor master data.

Revision ID: 20260818_0013
Revises: 20260818_0012
Create Date: 2026-08-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260818_0013"
down_revision: Union[str, Sequence[str], None] = "20260818_0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "work_centers",
        sa.Column("work_center_id", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("warehouse_id", sa.String(length=50), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.warehouse_id"]),
        sa.PrimaryKeyConstraint("work_center_id"),
    )
    op.execute(
        """
        INSERT INTO work_centers (work_center_id, name, is_active)
        VALUES
            ('WC-OUTSIDE-01', 'Outside Processing', true),
            ('WC-PLATING-01', 'Plating / Finishing', true)
        ON CONFLICT (work_center_id) DO NOTHING
        """
    )

    op.add_column(
        "suppliers",
        sa.Column("vendor_type", sa.String(length=20), nullable=False, server_default=sa.text("'material'")),
    )
    op.add_column("suppliers", sa.Column("tax_id", sa.String(length=50), nullable=True))
    op.add_column(
        "suppliers",
        sa.Column("currency", sa.String(length=3), nullable=False, server_default=sa.text("'USD'")),
    )
    op.add_column("suppliers", sa.Column("ap_account_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("suppliers", sa.Column("payment_method", sa.String(length=20), nullable=True))
    op.add_column("suppliers", sa.Column("incoterms", sa.String(length=10), nullable=True))
    op.add_column(
        "suppliers",
        sa.Column("lead_time_days", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column("suppliers", sa.Column("work_center_id", sa.String(length=50), nullable=True))
    op.add_column("suppliers", sa.Column("consignment_stock_loc_id", sa.String(length=50), nullable=True))
    op.add_column(
        "suppliers",
        sa.Column("standard_scrap_rate", sa.Numeric(5, 2), nullable=False, server_default=sa.text("0.00")),
    )
    op.add_column(
        "suppliers",
        sa.Column("iso_certified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "suppliers",
        sa.Column("qc_status", sa.String(length=20), nullable=False, server_default=sa.text("'approved'")),
    )
    op.add_column("suppliers", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("suppliers", sa.Column("address_line2", sa.String(length=255), nullable=True))
    op.add_column(
        "suppliers",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.add_column(
        "suppliers",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.alter_column(
        "suppliers",
        "contact_email",
        existing_type=sa.String(length=150),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
    op.create_foreign_key(
        "fk_suppliers_ap_account_id",
        "suppliers",
        "chart_of_accounts",
        ["ap_account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_suppliers_work_center_id",
        "suppliers",
        "work_centers",
        ["work_center_id"],
        ["work_center_id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_suppliers_consignment_stock_loc_id",
        "suppliers",
        "binlocations",
        ["consignment_stock_loc_id"],
        ["bin_id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "chk_supplier_vendor_type",
        "suppliers",
        "vendor_type IN ('material', 'subcontractor', 'both', 'service')",
    )
    op.create_check_constraint(
        "chk_supplier_payment_method",
        "suppliers",
        "payment_method IS NULL OR payment_method IN ('wire', 'ach', 'check', 'credit_card')",
    )
    op.create_check_constraint(
        "chk_supplier_qc_status",
        "suppliers",
        "qc_status IN ('approved', 'probation', 'blocked')",
    )
    op.execute(
        """
        UPDATE suppliers
        SET vendor_type = 'subcontractor'
        WHERE supplier_id = 'SUP-SUBCON-01' AND vendor_type = 'material'
        """
    )


def downgrade() -> None:
    op.drop_constraint("chk_supplier_qc_status", "suppliers", type_="check")
    op.drop_constraint("chk_supplier_payment_method", "suppliers", type_="check")
    op.drop_constraint("chk_supplier_vendor_type", "suppliers", type_="check")
    op.drop_constraint("fk_suppliers_consignment_stock_loc_id", "suppliers", type_="foreignkey")
    op.drop_constraint("fk_suppliers_work_center_id", "suppliers", type_="foreignkey")
    op.drop_constraint("fk_suppliers_ap_account_id", "suppliers", type_="foreignkey")
    op.alter_column(
        "suppliers",
        "contact_email",
        existing_type=sa.String(length=255),
        type_=sa.String(length=150),
        existing_nullable=True,
    )
    op.drop_column("suppliers", "updated_at")
    op.drop_column("suppliers", "created_at")
    op.drop_column("suppliers", "address_line2")
    op.drop_column("suppliers", "notes")
    op.drop_column("suppliers", "qc_status")
    op.drop_column("suppliers", "iso_certified")
    op.drop_column("suppliers", "standard_scrap_rate")
    op.drop_column("suppliers", "consignment_stock_loc_id")
    op.drop_column("suppliers", "work_center_id")
    op.drop_column("suppliers", "lead_time_days")
    op.drop_column("suppliers", "incoterms")
    op.drop_column("suppliers", "payment_method")
    op.drop_column("suppliers", "ap_account_id")
    op.drop_column("suppliers", "currency")
    op.drop_column("suppliers", "tax_id")
    op.drop_column("suppliers", "vendor_type")
    op.drop_table("work_centers")
