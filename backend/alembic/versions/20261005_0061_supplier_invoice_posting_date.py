# @author: Wendy Yang
# @date: 2026-10-05

"""Add posting_date to supplier invoices for numbering and GL.

Revision ID: 20261005_0061
Revises: 20261005_0060
Create Date: 2026-10-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261005_0061"
down_revision: Union[str, Sequence[str], None] = "20261005_0060"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("supplier_invoices", sa.Column("posting_date", sa.Date(), nullable=True))
    op.execute(sa.text("UPDATE supplier_invoices SET posting_date = invoice_date WHERE posting_date IS NULL"))
    op.alter_column("supplier_invoices", "posting_date", existing_type=sa.Date(), nullable=False)


def downgrade() -> None:
    op.drop_column("supplier_invoices", "posting_date")
