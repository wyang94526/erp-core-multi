"""Remove auto-approve amount bands; route $0–$10,000 to Step 1.

Revision ID: 20260918_0036
Revises: 20260918_0035
Create Date: 2026-09-18
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260918_0036"
down_revision: Union[str, Sequence[str], None] = "20260918_0035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_AUTO_IDS = (
    "WF-SO-AUTO",
    "WF-PO-AUTO",
    "WF-SCO-AUTO",
    "WF-AR-AUTO",
    "WF-AP-AUTO",
    "WF-CASH-AUTO",
    "WF-JE-AUTO",
)

_STEP1_IDS = (
    "WF-SO-MGR",
    "WF-PO-MGR",
    "WF-AR-MGR",
    "WF-AP-MGR",
    "WF-CASH-MGR",
    "WF-JE-MGR",
)


def upgrade() -> None:
    auto_list = ", ".join(f"'{wid}'" for wid in _AUTO_IDS)
    step1_list = ", ".join(f"'{wid}'" for wid in _STEP1_IDS)
    op.execute(f"DELETE FROM workflow_step WHERE workflow_definition_id IN ({auto_list})")
    op.execute(f"DELETE FROM workflow_definition WHERE id IN ({auto_list})")
    op.execute(
        f"UPDATE workflow_definition SET min_amount = 0 WHERE id IN ({step1_list})"
    )
    op.execute(
        """
        UPDATE workflow_definition
        SET min_amount = 0, max_amount = 10000
        WHERE id = 'WF-SCO-STD'
        """
    )
    op.execute(
        """
        UPDATE workflow_definition
        SET min_amount = 10000.01
        WHERE id = 'WF-SCO-EXEC'
        """
    )


def downgrade() -> None:
    step1_list = ", ".join(f"'{wid}'" for wid in _STEP1_IDS)
    op.execute(
        f"UPDATE workflow_definition SET min_amount = 1000.01 WHERE id IN ({step1_list})"
    )
    op.execute(
        """
        UPDATE workflow_definition
        SET min_amount = 10.01, max_amount = 100
        WHERE id = 'WF-SCO-STD'
        """
    )
    op.execute(
        """
        UPDATE workflow_definition
        SET min_amount = 100.01
        WHERE id = 'WF-SCO-EXEC'
        """
    )
    op.execute(
        """
INSERT INTO workflow_definition (id, module, min_amount, max_amount, is_active, name) VALUES
    ('WF-SO-AUTO', 'SALES_ORDER', 0, 1000, TRUE, 'SO Auto-Approve'),
    ('WF-PO-AUTO', 'PURCHASE_ORDER', 0, 1000, TRUE, 'PO Auto-Approve'),
    ('WF-SCO-AUTO', 'SUBCONTRACT_ORDER', 0, 10, TRUE, 'SCO Auto-Approve'),
    ('WF-AR-AUTO', 'AR_INVOICE', 0, 1000, TRUE, 'AR Auto-Approve'),
    ('WF-AP-AUTO', 'AP_BILL', 0, 1000, TRUE, 'AP Auto-Approve'),
    ('WF-CASH-AUTO', 'CASH_TRANSACTION', 0, 1000, TRUE, 'Cash Auto-Approve'),
    ('WF-JE-AUTO', 'JOURNAL_ENTRY', 0, 1000, TRUE, 'JE Auto-Approve')
ON CONFLICT DO NOTHING
        """
    )
