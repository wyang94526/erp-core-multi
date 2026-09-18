# @author: Wendy Yang
# @date: 2026-09-19

"""PO material-SCO linkage coverage plus inbound freight terms.

Revision ID: 20260911_0021
Revises: 20260911_0020
Create Date: 2026-09-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260911_0021"
down_revision: Union[str, Sequence[str], None] = "20260911_0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("purchaseorders", sa.Column("incoterms", sa.String(length=10), nullable=True))
    op.add_column(
        "purchaseorders",
        sa.Column(
            "freight_terms",
            sa.String(length=30),
            nullable=False,
            server_default="PREPAID_ON_PO",
        ),
    )
    op.add_column(
        "purchaseorders",
        sa.Column("carrier_account", sa.String(length=50), nullable=True),
    )
    op.create_check_constraint(
        "chk_po_freight_terms",
        "purchaseorders",
        "freight_terms IN ('PREPAID_ON_PO', 'THIRD_PARTY_COLLECT', 'ROUTING_ACCOUNT')",
    )
    op.create_index("ix_purchaseorders_sco_number", "purchaseorders", ["sco_number"])

    op.add_column(
        "purchaseorderitems",
        sa.Column("sco_component_id", sa.BigInteger(), nullable=True),
    )
    op.add_column("purchaseorderitems", sa.Column("uom", sa.String(length=20), nullable=True))
    op.add_column(
        "purchaseorderitems",
        sa.Column("description", sa.String(length=255), nullable=True),
    )
    op.create_foreign_key(
        "fk_po_item_sco_component",
        "purchaseorderitems",
        "subcontractordercomponents",
        ["sco_component_id"],
        ["sco_component_id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_purchaseorderitems_sco_component_id",
        "purchaseorderitems",
        ["sco_component_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_purchaseorderitems_sco_component_id", table_name="purchaseorderitems")
    op.drop_constraint("fk_po_item_sco_component", "purchaseorderitems", type_="foreignkey")
    op.drop_column("purchaseorderitems", "description")
    op.drop_column("purchaseorderitems", "uom")
    op.drop_column("purchaseorderitems", "sco_component_id")
    op.drop_index("ix_purchaseorders_sco_number", table_name="purchaseorders")
    op.drop_constraint("chk_po_freight_terms", "purchaseorders", type_="check")
    op.drop_column("purchaseorders", "carrier_account")
    op.drop_column("purchaseorders", "freight_terms")
    op.drop_column("purchaseorders", "incoterms")
