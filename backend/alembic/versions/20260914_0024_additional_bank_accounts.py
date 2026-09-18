# @author: Wendy Yang
# @date: 2026-09-19

"""Additional company bank accounts for cash payment selection.

Revision ID: 20260914_0024
Revises: 20260914_0023
Create Date: 2026-09-14
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260914_0024"
down_revision: Union[str, Sequence[str], None] = "20260914_0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO bank_accounts (
            bank_account_id, bank_name, account_name, account_number, routing_number, is_default, is_active
        ) VALUES
            ('BANK-PAYROLL', 'Amerant Bank', 'Payroll', '0000003198', '067000123', false, true),
            ('BANK-RESERVE', 'First Citizens Bank', 'Reserve', '0000007701', '053100300', false, true)
        ON CONFLICT (bank_account_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM bank_accounts
        WHERE bank_account_id IN ('BANK-PAYROLL', 'BANK-RESERVE')
          AND NOT EXISTS (
              SELECT 1 FROM cash_transactions
              WHERE cash_transactions.bank_account_id = bank_accounts.bank_account_id
          )
        """
    )
