# @author: Wendy Yang
# @date: 2026-09-19

"""Remap placeholder GL codes onto the standard chart, then drop them.

Revision ID: 20260918_0038
Revises: 20260918_0037
Create Date: 2026-09-18
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260918_0038"
down_revision: Union[str, Sequence[str], None] = "20260918_0037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PLACEHOLDERS = ("1000", "1100", "1300", "2000", "2105", "4000", "5100", "5200")


def upgrade() -> None:
    op.execute(
        """
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(code, ', ')
      INTO missing
      FROM unnest(ARRAY['1103','1172','1313','2171','2172','2181','2182','4110001','5146','5190']) AS code
     WHERE NOT EXISTS (
         SELECT 1 FROM chart_of_accounts WHERE account_code = code
     );
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'Standard chart accounts missing: %', missing;
    END IF;
END $$;
        """
    )

    # Related-party AP (Grand-Tek TP0002 / VBILL-2026-0002 / GR-2026-0001)
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2181')
FROM journal_entries je, chart_of_accounts old
WHERE lp.entry_id = je.id
  AND lp.account_id = old.id
  AND old.account_code = '2000'
  AND (
      je.description ILIKE '%VBILL-2026-0002%'
      OR je.description ILIKE '%GR-2026-0001%'
      OR je.description ILIKE '%PU62-26090001%'
  );
        """
    )
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2171')
FROM chart_of_accounts old
WHERE lp.account_id = old.id
  AND old.account_code = '2000';
        """
    )

    # Related-party GR/IR vs trade goods-received clearing
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2182')
FROM journal_entries je, chart_of_accounts old
WHERE lp.entry_id = je.id
  AND lp.account_id = old.id
  AND old.account_code = '2105'
  AND (
      je.description ILIKE '%VBILL-2026-0002%'
      OR je.description ILIKE '%GR-2026-0001%'
      OR je.description ILIKE '%PU62-26090001%'
  );
        """
    )
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2172')
FROM chart_of_accounts old
WHERE lp.account_id = old.id
  AND old.account_code = '2105';
        """
    )

    # Inventory placeholder: material / SCO processing / expense receipts
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1313')
FROM journal_entries je, chart_of_accounts old
WHERE lp.entry_id = je.id
  AND lp.account_id = old.id
  AND old.account_code = '1300'
  AND je.description ILIKE '%GR-2026-0001%';
        """
    )
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5146')
FROM journal_entries je, chart_of_accounts old
WHERE lp.entry_id = je.id
  AND lp.account_id = old.id
  AND old.account_code = '1300'
  AND je.description ILIKE '%GR-2026-0002%';
        """
    )
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5190')
FROM journal_entries je, chart_of_accounts old
WHERE lp.entry_id = je.id
  AND lp.account_id = old.id
  AND old.account_code = '1300'
  AND je.description ILIKE '%GR-2026-0003%';
        """
    )
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1313')
FROM chart_of_accounts old
WHERE lp.account_id = old.id
  AND old.account_code = '1300';
        """
    )

    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1172')
FROM chart_of_accounts old
WHERE lp.account_id = old.id
  AND old.account_code = '1100';
        """
    )
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '4110001')
FROM chart_of_accounts old
WHERE lp.account_id = old.id
  AND old.account_code = '4000';
        """
    )
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1103')
FROM chart_of_accounts old
WHERE lp.account_id = old.id
  AND old.account_code = '1000';
        """
    )
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5840')
FROM chart_of_accounts old
WHERE lp.account_id = old.id
  AND old.account_code = '5100';
        """
    )
    op.execute(
        """
UPDATE ledger_postings lp
SET account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5155')
FROM chart_of_accounts old
WHERE lp.account_id = old.id
  AND old.account_code = '5200';
        """
    )

    op.execute(
        """
UPDATE bank_accounts b
SET gl_account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1103')
FROM chart_of_accounts old
WHERE b.gl_account_id = old.id
  AND old.account_code = '1000';
        """
    )
    op.execute(
        """
UPDATE suppliers s
SET ap_account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2171')
FROM chart_of_accounts old
WHERE s.ap_account_id = old.id
  AND old.account_code = '2000';
        """
    )
    op.execute(
        """
UPDATE supplier_invoice_distributions d
SET gl_account_id = COALESCE(
    (SELECT id FROM chart_of_accounts WHERE account_code = CASE old.account_code
        WHEN '1000' THEN '1103'
        WHEN '1100' THEN '1172'
        WHEN '1300' THEN '1313'
        WHEN '2000' THEN '2171'
        WHEN '2105' THEN '2172'
        WHEN '4000' THEN '4110001'
        WHEN '5100' THEN '5840'
        WHEN '5200' THEN '5155'
    END),
    d.gl_account_id
)
FROM chart_of_accounts old
WHERE d.gl_account_id = old.id
  AND old.account_code IN ('1000','1100','1300','2000','2105','4000','5100','5200');
        """
    )
    op.execute(
        """
UPDATE financial_budgets b
SET account_id = COALESCE(
    (SELECT id FROM chart_of_accounts WHERE account_code = CASE old.account_code
        WHEN '1000' THEN '1103'
        WHEN '1100' THEN '1172'
        WHEN '1300' THEN '1313'
        WHEN '2000' THEN '2171'
        WHEN '2105' THEN '2172'
        WHEN '4000' THEN '4110001'
        WHEN '5100' THEN '5840'
        WHEN '5200' THEN '5155'
    END),
    b.account_id
)
FROM chart_of_accounts old
WHERE b.account_id = old.id
  AND old.account_code IN ('1000','1100','1300','2000','2105','4000','5100','5200');
        """
    )

    op.execute(
        """
DELETE FROM chart_of_accounts
WHERE account_code IN ('1000','1100','1300','2000','2105','4000','5100','5200');
        """
    )


def downgrade() -> None:
    # Placeholders are not restored; historical postings stay on the standard chart.
    pass
