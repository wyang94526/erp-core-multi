# @author: Wendy Yang
# @date: 2026-10-01

"""Remove unused month-end adjustment posting rules.

Revision ID: 20261001_0056
Revises: 20261001_0055
Create Date: 2026-10-01
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "20261001_0056"
down_revision: Union[str, Sequence[str], None] = "20261001_0055"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MEC_ADJUSTMENT_CODES = (
    "MEC_GRNI_ACCRUAL_TRADE",
    "MEC_GRNI_ACCRUAL_RELATED",
    "MEC_PREPAY",
    "MEC_ACCRUAL",
    "MEC_DEPRECIATION",
    "MEC_FX_REVAL",
)


def upgrade() -> None:
    codes = ", ".join(f"'{code}'" for code in MEC_ADJUSTMENT_CODES)
    op.execute(
        text(
            f"""
            UPDATE journal_entries
            SET posting_rule_id = NULL
            WHERE posting_rule_id IN (
                SELECT id FROM posting_rules
                WHERE rule_code IN ({codes})
            )
            """
        )
    )
    op.execute(text(f"DELETE FROM posting_rules WHERE rule_code IN ({codes})"))


def downgrade() -> None:
    # Catalog no longer seeds these rules. Recreate via an older revision if needed.
    pass
