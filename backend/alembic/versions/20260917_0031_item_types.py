"""Item catalog types for inventory vs non-stock / service SKUs.

Revision ID: 20260917_0031
Revises: 20260917_0030
Create Date: 2026-09-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260917_0031"
down_revision: Union[str, Sequence[str], None] = "20260917_0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SERVICE_SKUS = (
    "MISC",
    "MISCELLANEOUS",
    "FREIGHT",
    "FRT",
    "FREIGHT-IN",
    "FREIGHTIN",
    "SVC-FREIGHT",
)


def upgrade() -> None:
    op.add_column(
        "items",
        sa.Column(
            "item_type",
            sa.String(length=20),
            nullable=False,
            server_default="INVENTORY",
        ),
    )
    op.create_check_constraint(
        "chk_items_item_type",
        "items",
        "item_type IN ('INVENTORY', 'NON_INVENTORY', 'SERVICE')",
    )
    op.alter_column("items", "uom", existing_type=sa.String(length=20), nullable=True)

    conn = op.get_bind()
    sku_list = ", ".join(f"'{sku}'" for sku in SERVICE_SKUS)
    conn.execute(
        sa.text(
            f"""
            UPDATE items
            SET item_type = 'SERVICE'
            WHERE upper(replace(item_id, ' ', '')) IN ({sku_list})
               OR upper(replace(coalesce(customer_part_number, ''), ' ', '')) IN ({sku_list})
            """
        )
    )

    conn.execute(
        sa.text(
            """
            INSERT INTO items (
                item_id, customer_part_number, description, uom, item_type,
                is_purchase_item, is_raw_material, is_subcontract_assembly, is_outside_processed
            )
            VALUES
                ('MISC', 'MISC', 'Miscellaneous charge', 'SVC', 'SERVICE', true, false, false, false),
                ('FREIGHT', 'FREIGHT', 'Freight / shipping charge', 'SVC', 'SERVICE', true, false, false, false)
            ON CONFLICT (item_id) DO UPDATE
            SET item_type = 'SERVICE',
                is_purchase_item = true,
                description = COALESCE(NULLIF(items.description, ''), EXCLUDED.description),
                uom = COALESCE(items.uom, EXCLUDED.uom)
            """
        )
    )

    op.drop_constraint("chk_si_line_qty_pos", "supplier_invoice_lines", type_="check")
    op.create_check_constraint(
        "chk_si_line_qty_pos",
        "supplier_invoice_lines",
        "quantity_billed >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("chk_si_line_qty_pos", "supplier_invoice_lines", type_="check")
    op.create_check_constraint(
        "chk_si_line_qty_pos",
        "supplier_invoice_lines",
        "quantity_billed > 0",
    )
    op.drop_constraint("chk_items_item_type", "items", type_="check")
    op.drop_column("items", "item_type")
