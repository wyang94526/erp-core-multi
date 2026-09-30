# @author: Wendy Yang
# @date: 2026-09-30

"""Backfill journal source fields from generated description/reference text.

Revision ID: 20260930_0047
Revises: 20260930_0046
Create Date: 2026-09-30
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260930_0047"
down_revision: Union[str, Sequence[str], None] = "20260930_0046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UPDATES = (
    (
        "MONTH_END_CLOSE",
        "description ILIKE '%month-end close%' OR COALESCE(reference, '') ILIKE 'MEC-%'",
    ),
    (
        "YEAR_END_CLOSE",
        "description ILIKE '%year-end close%' OR COALESCE(reference, '') ILIKE 'YEC-%'",
    ),
    (
        "BANK_TRANSFER",
        "description ILIKE '%bank transfer%' OR COALESCE(reference, '') ILIKE 'BTR-%'",
    ),
    (
        "GOODS_RECEIPT",
        "description ILIKE '%goods receipt%'",
    ),
    (
        "SUPPLIER_INVOICE",
        "description ILIKE '%supplier invoice%' OR description ILIKE '%GRNI clear%'",
    ),
    (
        "SALES_INVOICE",
        "description ILIKE '%sales invoice%'",
    ),
    (
        "SALES_CREDIT",
        "description ILIKE '%credit memo%'",
    ),
    (
        "AR_PAYMENT",
        "description ILIKE '%AR payment%'",
    ),
    (
        "AP_PAYMENT",
        "description ILIKE '%AP payment%'",
    ),
)


def upgrade() -> None:
    for source_type, matcher in UPDATES:
        op.execute(
            f"""
            UPDATE journal_entries
            SET
                is_system_generated = true,
                source_document_type = '{source_type}',
                source_record_id = COALESCE(NULLIF(source_record_id, ''), NULLIF(reference, ''))
            WHERE source_document_type IS NULL
              AND ({matcher})
            """
        )


def downgrade() -> None:
    pass
