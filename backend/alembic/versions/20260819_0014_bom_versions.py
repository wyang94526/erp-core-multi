# @author: Wendy Yang
# @date: 2026-09-19

"""Versioned BOMs: header per assembly revision, pin SCOs to a version.

Revision ID: 20260819_0014
Revises: 20260819_0016
Create Date: 2026-08-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260819_0014"
down_revision: Union[str, Sequence[str], None] = "20260819_0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "itembomheaders",
        sa.Column("bom_header_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("parent_item_id", sa.String(length=50), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'active'")),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.CheckConstraint("status IN ('draft', 'active', 'obsolete')", name="chk_bom_header_status"),
        sa.CheckConstraint("version_no > 0", name="chk_bom_header_version_pos"),
        sa.ForeignKeyConstraint(["parent_item_id"], ["items.item_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("bom_header_id"),
        sa.UniqueConstraint("parent_item_id", "version_no", name="uq_item_bom_version"),
    )
    op.create_index("ix_itembomheaders_parent_item_id", "itembomheaders", ["parent_item_id"])
    op.create_index(
        "uq_one_active_bom_per_item",
        "itembomheaders",
        ["parent_item_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )

    op.execute(
        """
        INSERT INTO itembomheaders (parent_item_id, version_no, status, effective_from)
        SELECT DISTINCT parent_item_id, 1, 'active', CURRENT_DATE
        FROM itembomcomponents
        """
    )

    op.add_column("itembomcomponents", sa.Column("bom_header_id", sa.BigInteger(), nullable=True))
    op.execute(
        """
        UPDATE itembomcomponents AS c
        SET bom_header_id = h.bom_header_id
        FROM itembomheaders AS h
        WHERE h.parent_item_id = c.parent_item_id
        """
    )
    op.alter_column("itembomcomponents", "bom_header_id", nullable=False)
    op.create_foreign_key(
        "itembomcomponents_bom_header_id_fkey",
        "itembomcomponents",
        "itembomheaders",
        ["bom_header_id"],
        ["bom_header_id"],
        ondelete="CASCADE",
    )
    op.drop_constraint("unique_bom_line", "itembomcomponents", type_="unique")
    op.create_unique_constraint(
        "unique_bom_line",
        "itembomcomponents",
        ["bom_header_id", "component_item_id", "component_code"],
    )
    op.create_index("ix_itembomcomponents_bom_header_id", "itembomcomponents", ["bom_header_id"])

    op.add_column("subcontractorders", sa.Column("bom_header_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "subcontractorders_bom_header_id_fkey",
        "subcontractorders",
        "itembomheaders",
        ["bom_header_id"],
        ["bom_header_id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        UPDATE subcontractorders AS s
        SET bom_header_id = h.bom_header_id
        FROM itembomheaders AS h
        WHERE h.parent_item_id = s.item_id
          AND h.status = 'active'
        """
    )


def downgrade() -> None:
    op.drop_constraint("subcontractorders_bom_header_id_fkey", "subcontractorders", type_="foreignkey")
    op.drop_column("subcontractorders", "bom_header_id")

    op.drop_index("ix_itembomcomponents_bom_header_id", table_name="itembomcomponents")
    op.drop_constraint("unique_bom_line", "itembomcomponents", type_="unique")
    op.create_unique_constraint(
        "unique_bom_line",
        "itembomcomponents",
        ["parent_item_id", "component_item_id", "component_code"],
    )
    op.drop_constraint("itembomcomponents_bom_header_id_fkey", "itembomcomponents", type_="foreignkey")
    op.drop_column("itembomcomponents", "bom_header_id")

    op.drop_index("uq_one_active_bom_per_item", table_name="itembomheaders")
    op.drop_index("ix_itembomheaders_parent_item_id", table_name="itembomheaders")
    op.drop_table("itembomheaders")
