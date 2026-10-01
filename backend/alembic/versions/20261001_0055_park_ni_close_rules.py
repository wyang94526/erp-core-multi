# @author: Wendy Yang
# @date: 2026-10-01

"""Replace close-rule seed data with 3353/3354 current-period NI parking.

Revision ID: 20261001_0055
Revises: 20261001_0054
Create Date: 2026-10-01
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text
from sqlalchemy.orm import Session

revision: str = "20261001_0055"
down_revision: Union[str, Sequence[str], None] = "20261001_0054"
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
            UPDATE journal_entries
            SET posting_rule_id = NULL
            WHERE posting_rule_id IN (
                SELECT id FROM posting_rules
                WHERE rule_code = 'MEC_CLOSE'
                   OR (event_code = 'MONTH_END_CLOSE' AND variant = 'CLOSE')
            )
            """
        )
    )
    session.execute(
        text(
            """
            DELETE FROM posting_rules
            WHERE rule_code = 'MEC_CLOSE'
               OR (event_code = 'MONTH_END_CLOSE' AND variant = 'CLOSE')
            """
        )
    )
    session.flush()
    ensure_default_posting_rules(session)

    sales = _ensure_account(session, "4110001", "Sales Revenue", "Revenue")
    retained = _ensure_account(
        session,
        "3350",
        "Retained earnings-unappropriated (or accumulated deficit)",
        "Equity",
    )
    ni_bs = _ensure_account(
        session, "3353", "Net income or loss for current period-BS", "Equity"
    )
    ni_is = _ensure_account(
        session, "3354", "Net income or loss for current period-IS", "Equity"
    )

    yec = session.query(PostingRule).filter(PostingRule.rule_code == "YEC_CLOSE").first()
    if yec is not None:
        yec.debit_account_id = sales.id
        yec.credit_account_id = retained.id
        yec.name = "Year-end close — clear P&L to retained earnings"
        yec.is_active = True

    reverse = session.query(PostingRule).filter(PostingRule.rule_code == "YEC_NI_CLEAR").first()
    if reverse is not None:
        reverse.debit_account_id = ni_bs.id
        reverse.credit_account_id = ni_is.id
        reverse.name = "Year-end close — reverse monthly current-period NI"
        reverse.is_active = True

    park = session.query(PostingRule).filter(PostingRule.rule_code == "MEC_PARK_NI").first()
    if park is not None:
        park.debit_account_id = ni_is.id
        park.credit_account_id = ni_bs.id
        park.name = "Park Current Period Net Income"
        park.is_active = True

    session.flush()


def downgrade() -> None:
    bind = op.get_bind()
    session = Session(bind=bind)
    from app.models import PostingRule
    from app.services.posting_rules import _ensure_account

    session.execute(text("DELETE FROM posting_rules WHERE rule_code = 'MEC_PARK_NI'"))

    retained = _ensure_account(
        session,
        "3350",
        "Retained earnings-unappropriated (or accumulated deficit)",
        "Equity",
    )
    reverse = session.query(PostingRule).filter(PostingRule.rule_code == "YEC_NI_CLEAR").first()
    if reverse is not None:
        reverse.credit_account_id = retained.id
        reverse.name = "Year-end close — clear current-period NI into retained earnings"
    yec = session.query(PostingRule).filter(PostingRule.rule_code == "YEC_CLOSE").first()
    if yec is not None:
        yec.name = "Year-end close — P&L to retained earnings"
        yec.credit_account_id = retained.id
        yec.debit_account_id = _ensure_account(session, "4110001", "Sales Revenue", "Revenue").id
    session.flush()
