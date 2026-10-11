# @author: Wendy Yang
# @date: 2026-10-11

"""Per-company document number prefixes. Existing numbers are left unchanged.

Revision ID: 20261011_0071
Revises: 20261011_0070
Create Date: 2026-10-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_0071"
down_revision: Union[str, Sequence[str], None] = "20261011_0070"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULTS = (
    ("SALES_ORDER", "PU61-"),
    ("PURCHASE_ORDER", "PU62-"),
    ("SUBCONTRACT_ORDER", "UP23-"),
    ("INVOICE", "US55-"),
    ("FULFILLMENT", "US51-"),
    ("GOODS_RECEIPT", "PU67-"),
    ("MATERIAL_ISSUE", "UM31-"),
    ("FINISHED_GOODS_RECEIPT", "UP72-"),
    ("BILL", "UX13-"),
    ("JOURNAL", "UG11-"),
    ("PRODUCTION_ORDER", "MP01-"),
    ("PRODUCTION_ISSUE", "MP02-"),
    ("PRODUCTION_RECEIPT", "MP03-"),
)


def upgrade() -> None:
    op.create_table(
        "company_document_prefixes",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("doc_type", sa.String(length=40), nullable=False),
        sa.Column("prefix", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("company_id", "doc_type"),
        sa.UniqueConstraint("company_id", "prefix", name="uq_company_document_prefix"),
    )
    values = ", ".join(f"('{doc_type}', '{prefix}')" for doc_type, prefix in _DEFAULTS)
    op.execute(
        f"""
        INSERT INTO company_document_prefixes (company_id, doc_type, prefix)
        SELECT c.id, v.doc_type, v.prefix
        FROM companies c
        CROSS JOIN (VALUES {values}) AS v(doc_type, prefix)
        """
    )


def downgrade() -> None:
    op.drop_table("company_document_prefixes")
