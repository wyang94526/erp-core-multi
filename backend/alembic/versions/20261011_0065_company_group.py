# @author: Wendy Yang
# @date: 2026-10-11

"""GTT parent company and operating subsidiaries.

Revision ID: 20261011_0065
Revises: 20261011_0064
Create Date: 2026-10-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261011_0065"
down_revision: Union[str, Sequence[str], None] = "20261011_0064"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USA_ID = "11111111-1111-4111-8111-111111111111"
PARENT_ID = "22222222-2222-4222-8222-222222222222"
CHINA_ID = "33333333-3333-4333-8333-333333333333"
JAPAN_ID = "44444444-4444-4444-8444-444444444444"
VIETNAM_ID = "55555555-5555-4555-8555-555555555555"


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("parent_company_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_companies_parent_company_id",
        "companies",
        "companies",
        ["parent_company_id"],
        ["id"],
    )
    op.create_index("ix_companies_parent_company_id", "companies", ["parent_company_id"])
    op.create_check_constraint(
        "chk_companies_parent_not_self",
        "companies",
        "parent_company_id IS NULL OR parent_company_id <> id",
    )

    op.execute(
        f"""
        UPDATE companies
        SET code = 'GTT-USA',
            name = CASE
                WHEN name IN ('Default Company', 'DEFAULT') THEN 'Grand-Tek Technology USA'
                ELSE name
            END
        WHERE id = '{USA_ID}'::uuid OR code = 'DEFAULT'
        """
    )
    op.execute(
        f"""
        INSERT INTO companies (id, code, name, base_currency, is_active)
        VALUES
            ('{PARENT_ID}'::uuid, 'GTT', 'Grand-Tek Technology', 'USD', true),
            ('{CHINA_ID}'::uuid, 'GTT-CHINA', 'Grand-Tek Technology China', 'CNY', true),
            ('{JAPAN_ID}'::uuid, 'GTT-JAPAN', 'Grand-Tek Technology Japan', 'JPY', true),
            ('{VIETNAM_ID}'::uuid, 'GTT-VIETNAM', 'Grand-Tek Technology Vietnam', 'VND', true)
        ON CONFLICT (code) DO NOTHING
        """
    )
    op.execute(
        f"""
        UPDATE companies
        SET parent_company_id = '{PARENT_ID}'::uuid
        WHERE code IN ('GTT-USA', 'GTT-CHINA', 'GTT-JAPAN', 'GTT-VIETNAM')
          AND id <> '{PARENT_ID}'::uuid
        """
    )
    op.execute(
        f"""
        INSERT INTO user_companies (user_id, company_id, is_default)
        SELECT u.id, c.id, false
        FROM users u
        JOIN companies c ON c.code IN ('GTT', 'GTT-USA', 'GTT-CHINA', 'GTT-JAPAN', 'GTT-VIETNAM')
        WHERE NOT EXISTS (
            SELECT 1 FROM user_companies uc
            WHERE uc.user_id = u.id AND uc.company_id = c.id
        )
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        DELETE FROM user_companies
        WHERE company_id IN (
            '{PARENT_ID}'::uuid,
            '{CHINA_ID}'::uuid,
            '{JAPAN_ID}'::uuid,
            '{VIETNAM_ID}'::uuid
        )
        """
    )
    op.execute(
        """
        UPDATE companies
        SET parent_company_id = NULL
        WHERE code IN ('GTT-USA', 'GTT-CHINA', 'GTT-JAPAN', 'GTT-VIETNAM')
        """
    )
    op.execute(
        f"""
        DELETE FROM companies
        WHERE id IN (
            '{PARENT_ID}'::uuid,
            '{CHINA_ID}'::uuid,
            '{JAPAN_ID}'::uuid,
            '{VIETNAM_ID}'::uuid
        )
        """
    )
    op.execute(
        f"""
        UPDATE companies
        SET code = 'DEFAULT'
        WHERE id = '{USA_ID}'::uuid AND code = 'GTT-USA'
        """
    )
    op.drop_constraint("chk_companies_parent_not_self", "companies", type_="check")
    op.drop_index("ix_companies_parent_company_id", table_name="companies")
    op.drop_constraint("fk_companies_parent_company_id", "companies", type_="foreignkey")
    op.drop_column("companies", "parent_company_id")
