# @author: Wendy Yang
# @date: 2026-09-30

"""Backfill journal posting_rule_id from debit/credit account pairs.

Revision ID: 20260930_0048
Revises: 20260930_0047
Create Date: 2026-09-30
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260930_0048"
down_revision: Union[str, Sequence[str], None] = "20260930_0047"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        WITH debit_one AS (
            SELECT entry_id, (ARRAY_AGG(account_id))[1] AS account_id
            FROM ledger_postings
            WHERE COALESCE(debit, 0) > 0
            GROUP BY entry_id
            HAVING COUNT(DISTINCT account_id) = 1
        ),
        credit_one AS (
            SELECT entry_id, (ARRAY_AGG(account_id))[1] AS account_id
            FROM ledger_postings
            WHERE COALESCE(credit, 0) > 0
            GROUP BY entry_id
            HAVING COUNT(DISTINCT account_id) = 1
        ),
        matched AS (
            SELECT d.entry_id, (ARRAY_AGG(pr.id))[1] AS posting_rule_id
            FROM debit_one d
            JOIN credit_one c ON c.entry_id = d.entry_id
            JOIN posting_rules pr
              ON pr.debit_account_id = d.account_id
             AND pr.credit_account_id = c.account_id
            GROUP BY d.entry_id
            HAVING COUNT(DISTINCT pr.id) = 1
        )
        UPDATE journal_entries je
        SET posting_rule_id = matched.posting_rule_id
        FROM matched
        WHERE je.id = matched.entry_id
          AND je.posting_rule_id IS NULL
          AND je.source_document_type IS NOT NULL
        """
    )


def downgrade() -> None:
    pass
