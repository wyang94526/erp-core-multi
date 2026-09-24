# @author: Wendy Yang
# @date: 2026-09-24

"""Optional tracking PO on Non-PO supplier invoices and AP bills.

Revision ID: 20260924_0042
Revises: 20260923_0041
Create Date: 2026-09-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260924_0042"
down_revision: Union[str, Sequence[str], None] = "20260923_0041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "supplier_invoices",
        sa.Column("reference_po_number", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "ap_bills",
        sa.Column("reference_po_number", sa.String(length=50), nullable=True),
    )
    op.execute(
        """
        UPDATE supplier_invoices
        SET reference_po_number = source_order_id
        WHERE source_type = 'NON_PO'
          AND source_order_id IS NOT NULL
          AND btrim(source_order_id) <> ''
          AND reference_po_number IS NULL
        """
    )
    op.execute(
        """
        UPDATE ap_bills
        SET reference_po_number = COALESCE(purchase_order_id, source_order_id)
        WHERE source_type = 'NON_PO'
          AND reference_po_number IS NULL
          AND COALESCE(purchase_order_id, source_order_id) IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column("ap_bills", "reference_po_number")
    op.drop_column("supplier_invoices", "reference_po_number")
