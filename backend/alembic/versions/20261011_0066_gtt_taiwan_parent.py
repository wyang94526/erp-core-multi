# @author: Wendy Yang
# @date: 2026-10-11

"""Example group: GTT in Taiwan, with operating subsidiaries.

The document letterhead is not a company. This instance's example setup is a
Taiwan parent and four subsidiaries. Existing masters stay on GTT-US.

Revision ID: 20261011_0066
Revises: 20261011_0065
Create Date: 2026-10-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_0066"
down_revision: Union[str, Sequence[str], None] = "20261011_0065"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USA_ID = "11111111-1111-4111-8111-111111111111"


def upgrade() -> None:
    op.add_column("companies", sa.Column("country", sa.String(80), nullable=True))
    op.execute(
        f"""
        UPDATE companies
        SET code = 'GTT-US',
            name = 'Grand-Tek Technology US',
            country = 'United States',
            base_currency = 'USD'
        WHERE id = '{USA_ID}'::uuid OR code IN ('GTT-USA', 'DEFAULT')
        """
    )
    op.execute(
        """
        UPDATE companies
        SET name = 'Grand-Tek Technology',
            country = 'Taiwan',
            base_currency = 'TWD'
        WHERE code = 'GTT'
        """
    )
    op.execute(
        """
        UPDATE companies SET country = 'China' WHERE code = 'GTT-CHINA';
        UPDATE companies SET country = 'Japan' WHERE code = 'GTT-JAPAN';
        UPDATE companies SET country = 'Vietnam' WHERE code = 'GTT-VIETNAM';
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        UPDATE companies
        SET code = 'GTT-USA',
            name = 'Grand-Tek Technology USA',
            base_currency = 'USD'
        WHERE id = '{USA_ID}'::uuid AND code = 'GTT-US'
        """
    )
    op.execute(
        """
        UPDATE companies
        SET name = 'Grand-Tek Technology',
            base_currency = 'USD'
        WHERE code = 'GTT'
        """
    )
    op.drop_column("companies", "country")
