# @author: Wendy Yang
# @date: 2026-10-12

"""Inspection reference document and updated timestamp.

Revision ID: 20261012_0074
Revises: 20261011_0073
Create Date: 2026-10-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261012_0074"
down_revision: Union[str, Sequence[str], None] = "20261011_0073"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("inspections", sa.Column("reference_document", sa.String(50), nullable=True))
    op.add_column(
        "inspections",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.execute("UPDATE inspections SET updated_at = created_at")
    op.execute(
        """
        UPDATE inspections AS inspection
        SET reference_document = receipt.production_order_id
        FROM production_receipts AS receipt
        WHERE inspection.source_type = 'production_receipt'
          AND inspection.source_id = receipt.receipt_id
          AND inspection.reference_document IS NULL
        """
    )
    op.execute(
        """
        UPDATE inspections AS inspection
        SET reference_document = receipt.source_order_id
        FROM goods_receipts AS receipt
        WHERE inspection.source_type = 'goods_receipt'
          AND inspection.source_id = receipt.receipt_number
          AND inspection.reference_document IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("inspections", "updated_at")
    op.drop_column("inspections", "reference_document")
