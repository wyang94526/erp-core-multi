"""Add document_attachments for supporting files on any ERP document.

Revision ID: 20260817_0011
Revises: 20260812_0010
Create Date: 2026-08-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260817_0011"
down_revision: Union[str, Sequence[str], None] = "20260812_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_attachments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("document_type", sa.String(length=30), nullable=False),
        sa.Column("document_id", sa.String(length=50), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("uploaded_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("file_size > 0", name="chk_document_attachment_file_size"),
    )
    op.create_index(
        "ix_document_attachments_document",
        "document_attachments",
        ["document_type", "document_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_document_attachments_document", table_name="document_attachments")
    op.drop_table("document_attachments")
