"""Seed a default warehouse and receiving bin when inventory masters are empty.

Revision ID: 20260915_0026
Revises: 20260914_0025
Create Date: 2026-09-15
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260915_0026"
down_revision: Union[str, Sequence[str], None] = "20260914_0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO warehouses (warehouse_id, name, code, address, is_active)
        SELECT 'WH-MAIN', 'Main Warehouse', 'MAIN', NULL, true
        WHERE NOT EXISTS (SELECT 1 FROM warehouses)
        """
    )
    op.execute(
        """
        INSERT INTO binlocations (bin_id, warehouse_id, bin_code, description, is_active)
        SELECT 'BIN-RECEIVING', w.warehouse_id, 'RECEIVING', 'Default receiving bin', true
        FROM warehouses AS w
        WHERE NOT EXISTS (
            SELECT 1 FROM binlocations AS b WHERE b.warehouse_id = w.warehouse_id
        )
        ORDER BY w.code
        LIMIT 1
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM binlocations
        WHERE bin_id = 'BIN-RECEIVING'
          AND NOT EXISTS (
              SELECT 1 FROM inventorystock WHERE inventorystock.bin_id = binlocations.bin_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM stockmovements WHERE stockmovements.bin_id = binlocations.bin_id
          )
        """
    )
    op.execute(
        """
        DELETE FROM warehouses
        WHERE warehouse_id = 'WH-MAIN'
          AND NOT EXISTS (
              SELECT 1 FROM binlocations WHERE binlocations.warehouse_id = warehouses.warehouse_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM inventorystock WHERE inventorystock.warehouse_id = warehouses.warehouse_id
          )
        """
    )
