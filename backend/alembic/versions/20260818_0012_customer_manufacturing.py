"""Expand customers for manufacturing master data (locations + certifications).

Revision ID: 20260818_0012
Revises: 20260817_0011
Create Date: 2026-08-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260818_0012"
down_revision: Union[str, Sequence[str], None] = "20260817_0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("tax_id", sa.String(length=64), nullable=True))
    op.add_column("customers", sa.Column("industry_type", sa.String(length=100), nullable=True))
    op.add_column("customers", sa.Column("facility_type", sa.String(length=100), nullable=True))
    op.add_column("customers", sa.Column("website", sa.String(length=255), nullable=True))
    op.add_column("customers", sa.Column("primary_contact_name", sa.String(length=255), nullable=True))
    op.add_column("customers", sa.Column("primary_email", sa.String(length=255), nullable=True))
    op.add_column("customers", sa.Column("primary_phone", sa.String(length=50), nullable=True))
    op.add_column(
        "customers",
        sa.Column("currency", sa.String(length=3), nullable=False, server_default=sa.text("'USD'")),
    )
    op.add_column(
        "customers",
        sa.Column("credit_limit", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0.00")),
    )
    op.add_column("customers", sa.Column("payment_terms", sa.String(length=50), nullable=True))
    op.add_column("customers", sa.Column("preferred_incoterms", sa.String(length=10), nullable=True))
    op.add_column(
        "customers",
        sa.Column("tax_exempt", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "customers",
        sa.Column("tax_exempt_certificate_id", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "customers",
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'ACTIVE'")),
    )
    op.add_column(
        "customers",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.add_column(
        "customers",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("ix_customers_tax_id", "customers", ["tax_id"])
    op.create_index("ix_customers_primary_email", "customers", ["primary_email"])

    op.add_column("customerlocations", sa.Column("location_code", sa.String(length=50), nullable=True))
    op.add_column("customerlocations", sa.Column("address_line2", sa.String(length=255), nullable=True))
    op.add_column("customerlocations", sa.Column("contact_person", sa.String(length=150), nullable=True))
    op.add_column("customerlocations", sa.Column("contact_phone", sa.String(length=50), nullable=True))
    op.add_column(
        "customerlocations",
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("customerlocations", sa.Column("tax_id", sa.String(length=64), nullable=True))
    op.add_column("customerlocations", sa.Column("shipping_instructions", sa.Text(), nullable=True))
    op.add_column(
        "customerlocations",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.add_column(
        "customerlocations",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.alter_column(
        "customerlocations",
        "location_name",
        existing_type=sa.String(length=100),
        type_=sa.String(length=150),
        existing_nullable=True,
    )
    op.alter_column(
        "customerlocations",
        "state",
        existing_type=sa.String(length=50),
        type_=sa.String(length=100),
        existing_nullable=True,
    )
    op.alter_column(
        "customerlocations",
        "postal_code",
        existing_type=sa.String(length=20),
        type_=sa.String(length=32),
        existing_nullable=True,
    )
    op.alter_column(
        "customerlocations",
        "contact_email",
        existing_type=sa.String(length=150),
        type_=sa.String(length=255),
        existing_nullable=True,
    )

    op.execute(
        """
        UPDATE customerlocations
        SET location_name = COALESCE(NULLIF(BTRIM(location_name), ''), location_id)
        WHERE location_name IS NULL OR BTRIM(location_name) = ''
        """
    )
    op.execute(
        """
        UPDATE customerlocations
        SET address_line1 = COALESCE(NULLIF(BTRIM(address_line1), ''), 'Address pending')
        WHERE address_line1 IS NULL OR BTRIM(address_line1) = ''
        """
    )
    op.execute(
        """
        UPDATE customerlocations
        SET city = COALESCE(NULLIF(BTRIM(city), ''), 'N/A')
        WHERE city IS NULL OR BTRIM(city) = ''
        """
    )
    op.execute(
        """
        UPDATE customerlocations
        SET postal_code = COALESCE(NULLIF(BTRIM(postal_code), ''), '00000')
        WHERE postal_code IS NULL OR BTRIM(postal_code) = ''
        """
    )
    op.execute(
        """
        UPDATE customerlocations
        SET country = COALESCE(NULLIF(BTRIM(country), ''), 'USA')
        WHERE country IS NULL OR BTRIM(country) = ''
        """
    )

    op.alter_column(
        "customerlocations",
        "location_name",
        existing_type=sa.String(length=150),
        nullable=False,
    )
    op.alter_column(
        "customerlocations",
        "address_line1",
        existing_type=sa.String(length=255),
        nullable=False,
    )
    op.alter_column(
        "customerlocations",
        "city",
        existing_type=sa.String(length=100),
        nullable=False,
    )
    op.alter_column(
        "customerlocations",
        "postal_code",
        existing_type=sa.String(length=32),
        nullable=False,
    )
    op.alter_column(
        "customerlocations",
        "country",
        existing_type=sa.String(length=50),
        nullable=False,
    )
    op.create_index("ix_customerlocations_customer_id", "customerlocations", ["customer_id"])

    op.create_table(
        "customer_certifications",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("customer_id", sa.String(length=50), nullable=False),
        sa.Column("certification_name", sa.String(length=100), nullable=False),
        sa.Column("certificate_number", sa.String(length=100), nullable=True),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.customer_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_customer_certifications_customer_id",
        "customer_certifications",
        ["customer_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_customer_certifications_customer_id", table_name="customer_certifications")
    op.drop_table("customer_certifications")

    op.drop_index("ix_customerlocations_customer_id", table_name="customerlocations")
    op.alter_column(
        "customerlocations",
        "country",
        existing_type=sa.String(length=50),
        nullable=True,
    )
    op.alter_column(
        "customerlocations",
        "postal_code",
        existing_type=sa.String(length=32),
        type_=sa.String(length=20),
        nullable=True,
    )
    op.alter_column(
        "customerlocations",
        "city",
        existing_type=sa.String(length=100),
        nullable=True,
    )
    op.alter_column(
        "customerlocations",
        "address_line1",
        existing_type=sa.String(length=255),
        nullable=True,
    )
    op.alter_column(
        "customerlocations",
        "location_name",
        existing_type=sa.String(length=150),
        type_=sa.String(length=100),
        nullable=True,
    )
    op.alter_column(
        "customerlocations",
        "contact_email",
        existing_type=sa.String(length=255),
        type_=sa.String(length=150),
        existing_nullable=True,
    )
    op.alter_column(
        "customerlocations",
        "state",
        existing_type=sa.String(length=100),
        type_=sa.String(length=50),
        existing_nullable=True,
    )
    op.drop_column("customerlocations", "updated_at")
    op.drop_column("customerlocations", "created_at")
    op.drop_column("customerlocations", "shipping_instructions")
    op.drop_column("customerlocations", "tax_id")
    op.drop_column("customerlocations", "is_default")
    op.drop_column("customerlocations", "contact_phone")
    op.drop_column("customerlocations", "contact_person")
    op.drop_column("customerlocations", "address_line2")
    op.drop_column("customerlocations", "location_code")

    op.drop_index("ix_customers_primary_email", table_name="customers")
    op.drop_index("ix_customers_tax_id", table_name="customers")
    op.drop_column("customers", "updated_at")
    op.drop_column("customers", "created_at")
    op.drop_column("customers", "status")
    op.drop_column("customers", "tax_exempt_certificate_id")
    op.drop_column("customers", "tax_exempt")
    op.drop_column("customers", "preferred_incoterms")
    op.drop_column("customers", "payment_terms")
    op.drop_column("customers", "credit_limit")
    op.drop_column("customers", "currency")
    op.drop_column("customers", "primary_phone")
    op.drop_column("customers", "primary_email")
    op.drop_column("customers", "primary_contact_name")
    op.drop_column("customers", "website")
    op.drop_column("customers", "facility_type")
    op.drop_column("customers", "industry_type")
    op.drop_column("customers", "tax_id")
