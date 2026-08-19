"""Add customers.tax_id_type alongside tax_id.

Revision ID: 20260819_0015
Revises: 20260818_0013
Create Date: 2026-08-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260819_0015"
down_revision: Union[str, Sequence[str], None] = "20260818_0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("tax_id_type", sa.String(length=16), nullable=True))
    op.create_check_constraint(
        "chk_customers_tax_id_type",
        "customers",
        "tax_id_type IS NULL OR tax_id_type IN ('EIN', 'TIN', 'VAT', 'SSN', 'OTHER')",
    )


def downgrade() -> None:
    op.drop_constraint("chk_customers_tax_id_type", "customers", type_="check")
    op.drop_column("customers", "tax_id_type")
