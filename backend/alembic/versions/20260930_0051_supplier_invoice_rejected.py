# @author: Wendy Yang
# @date: 2026-09-30

"""Allow supplier invoices to be REJECTED so they can be edited and resubmitted.

Revision ID: 20260930_0051
Revises: 20260930_0050
Create Date: 2026-09-30
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260930_0051"
down_revision: Union[str, Sequence[str], None] = "20260930_0050"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("chk_supplier_invoice_status", "supplier_invoices", type_="check")
    op.create_check_constraint(
        "chk_supplier_invoice_status",
        "supplier_invoices",
        "status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'PAID', 'CANCELLED')",
    )


def downgrade() -> None:
    op.drop_constraint("chk_supplier_invoice_status", "supplier_invoices", type_="check")
    op.create_check_constraint(
        "chk_supplier_invoice_status",
        "supplier_invoices",
        "status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED')",
    )
