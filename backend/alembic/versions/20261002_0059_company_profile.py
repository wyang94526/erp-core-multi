# @author: Wendy Yang
# @date: 2026-10-02

"""Company letterhead profile: contact, bill/ship addresses, and logo metadata.

Revision ID: 20261002_0059
Revises: 20261002_0058
Create Date: 2026-10-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "20261002_0059"
down_revision: Union[str, Sequence[str], None] = "20261002_0058"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SETTINGS_ID = "00000000-0000-4000-8000-000000000002"


def upgrade() -> None:
    op.create_table(
        "company_profile",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("company_name", sa.String(255), nullable=False, server_default="Grand-Tek Technology USA"),
        sa.Column("contact_name", sa.String(255), nullable=True),
        sa.Column("contact_email", sa.String(255), nullable=True),
        sa.Column("contact_phone", sa.String(50), nullable=True),
        sa.Column("bill_to", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("ship_to", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("logo_stored_filename", sa.String(255), nullable=True),
        sa.Column("logo_original_filename", sa.String(255), nullable=True),
        sa.Column("logo_content_type", sa.String(100), nullable=True),
        sa.Column("logo_file_size", sa.Integer(), nullable=True),
        sa.Column("updated_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.execute(
        sa.text(
            f"""
            INSERT INTO company_profile (id, company_name, contact_name, contact_email, contact_phone, bill_to, ship_to)
            VALUES (
              '{SETTINGS_ID}'::uuid,
              'Grand-Tek Technology USA',
              'Accounts Payable',
              'ap@grand-tek.com',
              '+1 (949) 000-0000',
              '{{"location_name":"Grand-Tek Technology USA","attention_to":"Accounts Payable","address_line1":"358 Fairview Way","address_line2":"","city":"Milpitas","state":"CA","postal_code":"95035","country":"USA","contact_person":"Accounts Payable","contact_email":"ap@grand-tek.com","contact_phone":"+1 (949) 000-0000"}}'::jsonb,
              '{{"location_name":"Grand-Tek Receiving","attention_to":"Receiving Dock","address_line1":"358 Fairview Way","address_line2":"","city":"Milpitas","state":"CA","postal_code":"95035","country":"USA","contact_person":"Receiving","contact_email":"receiving@grand-tek.com","contact_phone":""}}'::jsonb
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_table("company_profile")
