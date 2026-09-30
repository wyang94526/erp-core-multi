# @author: Wendy Yang
# @date: 2026-09-30

"""Move P&L close posting to year-end; month-end is adjustments only.

Revision ID: 20260930_0050
Revises: 20260930_0049
Create Date: 2026-09-30
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text
from sqlalchemy.orm import Session

revision: str = "20260930_0050"
down_revision: Union[str, Sequence[str], None] = "20260930_0049"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    session = Session(bind=bind)
    from app.models import PostingRule
    from app.services.posting_rules import _ensure_account, ensure_default_posting_rules

    session.execute(
        text(
            """
            UPDATE posting_rules
            SET is_active = false,
                name = 'Deprecated — monthly P&L close moved to year-end',
                updated_at = NOW()
            WHERE rule_code = 'MEC_CLOSE'
            """
        )
    )
    ensure_default_posting_rules(session)

    sales = _ensure_account(session, "4110001", "Sales Revenue", "Revenue")
    retained = _ensure_account(
        session,
        "3350",
        "Retained earnings-unappropriated (or accumulated deficit)",
        "Equity",
    )
    yec = session.query(PostingRule).filter(PostingRule.rule_code == "YEC_CLOSE").first()
    if yec is not None:
        yec.debit_account_id = sales.id
        yec.credit_account_id = retained.id
        yec.name = "Year-end close — P&L to retained earnings"
        yec.is_active = True
    session.flush()


def downgrade() -> None:
    bind = op.get_bind()
    session = Session(bind=bind)
    from app.models import PostingRule
    from app.services.posting_rules import _ensure_account

    ni = _ensure_account(
        session, "3353", "Net income or loss for current period-BS", "Equity"
    )
    retained = _ensure_account(
        session,
        "3350",
        "Retained earnings-unappropriated (or accumulated deficit)",
        "Equity",
    )
    yec = session.query(PostingRule).filter(PostingRule.rule_code == "YEC_CLOSE").first()
    if yec is not None:
        yec.debit_account_id = ni.id
        yec.credit_account_id = retained.id
        yec.name = "Year-end close — current-period NI to retained earnings"
        yec.is_active = True
    session.execute(
        text(
            """
            UPDATE posting_rules
            SET is_active = true,
                name = 'Month-end close — P&L to current-period net income',
                updated_at = NOW()
            WHERE rule_code = 'MEC_CLOSE'
            """
        )
    )
    session.execute(
        text(
            """
            UPDATE posting_rules
            SET is_active = false, updated_at = NOW()
            WHERE rule_code IN (
                'MEC_GRNI_ACCRUAL_TRADE', 'MEC_GRNI_ACCRUAL_RELATED',
                'MEC_PREPAY', 'MEC_ACCRUAL', 'MEC_DEPRECIATION',
                'MEC_FX_REVAL', 'YEC_NI_CLEAR'
            )
            """
        )
    )
    session.flush()
