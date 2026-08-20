"""SO customer revision date / P/N snapshot and PO subcontract type.

Revision ID: 20260820_0017
Revises: 20260819_0014
Create Date: 2026-08-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260820_0017"
down_revision: Union[str, Sequence[str], None] = "20260819_0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("salesorders", sa.Column("customer_revision_date", sa.Date(), nullable=True))
    op.add_column(
        "salesorderitems",
        sa.Column("customer_part_number", sa.String(length=50), nullable=True),
    )
    op.execute(
        """
        UPDATE salesorderitems soi
        SET customer_part_number = i.customer_part_number
        FROM items i
        WHERE soi.item_id = i.item_id
          AND (soi.customer_part_number IS NULL OR soi.customer_part_number = '')
        """
    )

    op.add_column(
        "purchaseorders",
        sa.Column("po_type", sa.String(length=20), nullable=False, server_default="MATERIAL"),
    )
    op.add_column("purchaseorders", sa.Column("bom_header_id", sa.BigInteger(), nullable=True))
    op.add_column("purchaseorders", sa.Column("sco_number", sa.String(length=50), nullable=True))
    op.create_check_constraint(
        "chk_po_type",
        "purchaseorders",
        "po_type IN ('MATERIAL', 'SUBCONTRACT')",
    )
    op.create_foreign_key(
        "fk_po_bom_header",
        "purchaseorders",
        "itembomheaders",
        ["bom_header_id"],
        ["bom_header_id"],
    )
    op.create_foreign_key(
        "fk_po_sco_number",
        "purchaseorders",
        "subcontractorders",
        ["sco_number"],
        ["sco_number"],
    )

    op.add_column(
        "purchaseorderitems",
        sa.Column("bom_header_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_po_item_bom_header",
        "purchaseorderitems",
        "itembomheaders",
        ["bom_header_id"],
        ["bom_header_id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_po_item_bom_header", "purchaseorderitems", type_="foreignkey")
    op.drop_column("purchaseorderitems", "bom_header_id")
    op.drop_constraint("fk_po_sco_number", "purchaseorders", type_="foreignkey")
    op.drop_constraint("fk_po_bom_header", "purchaseorders", type_="foreignkey")
    op.drop_constraint("chk_po_type", "purchaseorders", type_="check")
    op.drop_column("purchaseorders", "sco_number")
    op.drop_column("purchaseorders", "bom_header_id")
    op.drop_column("purchaseorders", "po_type")
    op.drop_column("salesorderitems", "customer_part_number")
    op.drop_column("salesorders", "customer_revision_date")
