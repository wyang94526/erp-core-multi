# @author: Wendy Yang
# @date: 2026-10-01

"""Track receipt-line costs and invoice billing status for GR-level AP.

Revision ID: 20261001_0054
Revises: 20260930_0053
Create Date: 2026-10-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261001_0054"
down_revision: Union[str, Sequence[str], None] = "20260930_0053"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "goods_receipt_lines",
        sa.Column(
            "allocated_landed_cost",
            sa.Numeric(12, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "goods_receipt_lines",
        sa.Column("actual_unit_cost", sa.Numeric(12, 4), nullable=True),
    )
    op.add_column(
        "goods_receipt_lines",
        sa.Column(
            "quantity_invoiced",
            sa.Numeric(12, 4),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "goods_receipt_lines",
        sa.Column(
            "billing_status",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'UNBILLED'"),
        ),
    )
    op.create_check_constraint(
        "chk_gr_line_billing_status",
        "goods_receipt_lines",
        "billing_status IN ('UNBILLED', 'PARTIALLY_BILLED', 'FULLY_BILLED')",
    )
    op.execute(
        sa.text("UPDATE goods_receipt_lines SET actual_unit_cost = unit_cost WHERE actual_unit_cost IS NULL")
    )
    op.execute(
        sa.text(
            """
            WITH billed AS (
                SELECT
                    si.source_type,
                    si.source_order_id,
                    sil.item_id,
                    SUM(sil.quantity_billed) AS qty_billed
                FROM supplier_invoice_lines sil
                JOIN supplier_invoices si ON si.id = sil.invoice_id
                WHERE si.status <> 'CANCELLED'
                  AND si.invoice_type = 'PO_MATCHED'
                GROUP BY si.source_type, si.source_order_id, sil.item_id
            ),
            ranked AS (
                SELECT
                    grl.id,
                    gr.source_type,
                    gr.source_order_id,
                    grl.item_id,
                    grl.quantity_received,
                    SUM(grl.quantity_received) OVER (
                        PARTITION BY gr.source_type, gr.source_order_id, grl.item_id
                        ORDER BY gr.receipt_date, gr.id, grl.id
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS running_recv
                FROM goods_receipt_lines grl
                JOIN goods_receipts gr ON gr.id = grl.receipt_id
                WHERE gr.status = 'POSTED'
            )
            UPDATE goods_receipt_lines grl
            SET quantity_invoiced = GREATEST(
                0,
                LEAST(
                    ranked.quantity_received,
                    billed.qty_billed - (ranked.running_recv - ranked.quantity_received)
                )
            )
            FROM ranked
            JOIN billed
              ON billed.source_type = ranked.source_type
             AND billed.source_order_id = ranked.source_order_id
             AND billed.item_id = ranked.item_id
            WHERE grl.id = ranked.id
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE goods_receipt_lines
            SET billing_status = CASE
                WHEN quantity_invoiced <= 0 THEN 'UNBILLED'
                WHEN quantity_invoiced >= quantity_received THEN 'FULLY_BILLED'
                ELSE 'PARTIALLY_BILLED'
            END
            """
        )
    )


def downgrade() -> None:
    op.drop_constraint("chk_gr_line_billing_status", "goods_receipt_lines", type_="check")
    op.drop_column("goods_receipt_lines", "billing_status")
    op.drop_column("goods_receipt_lines", "quantity_invoiced")
    op.drop_column("goods_receipt_lines", "actual_unit_cost")
    op.drop_column("goods_receipt_lines", "allocated_landed_cost")
