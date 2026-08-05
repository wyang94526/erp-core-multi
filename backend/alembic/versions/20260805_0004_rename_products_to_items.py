"""Rename products item master to items (product_id -> item_id).

Revision ID: 20260805_0004
Revises: 20260805_0003
Create Date: 2026-08-05
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260805_0004"
down_revision: Union[str, Sequence[str], None] = "20260805_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop FKs that reference products.product_id (names vary by how they were created)
    op.execute(
        """
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN
                SELECT c.conname, c.conrelid::regclass AS tbl
                FROM pg_constraint c
                JOIN pg_class ref ON ref.oid = c.confrelid
                WHERE c.contype = 'f'
                  AND ref.relname = 'products'
            LOOP
                EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
            END LOOP;
        END $$;
        """
    )

    # Rename master table + PK column
    op.execute('ALTER TABLE products RENAME TO items')
    op.execute('ALTER TABLE items RENAME COLUMN product_id TO item_id')
    op.execute('ALTER INDEX IF EXISTS products_pkey RENAME TO items_pkey')

    # Child column renames
    op.execute('ALTER TABLE salesorderitems RENAME COLUMN product_id TO item_id')
    op.execute('ALTER TABLE vendoritemmappings RENAME COLUMN product_id TO item_id')
    op.execute('ALTER TABLE subcontractorders RENAME COLUMN product_id TO item_id')
    op.execute('ALTER TABLE inventorystock RENAME COLUMN product_id TO item_id')
    op.execute('ALTER TABLE stockmovements RENAME COLUMN product_id TO item_id')

    op.execute('ALTER TABLE productbomcomponents RENAME TO itembomcomponents')
    op.execute('ALTER TABLE itembomcomponents RENAME COLUMN parent_product_id TO parent_item_id')
    op.execute('ALTER TABLE itembomcomponents RENAME COLUMN component_product_id TO component_item_id')

    op.execute(
        'ALTER TABLE subcontractordercomponents RENAME COLUMN component_product_id TO component_item_id'
    )
    op.execute(
        'ALTER TABLE materialissuelines RENAME COLUMN component_product_id TO component_item_id'
    )
    op.execute(
        'ALTER TABLE componentissuelogs RENAME COLUMN component_product_id TO component_item_id'
    )

    # Constraint renames where names are stable
    op.execute(
        'ALTER TABLE inventorystock RENAME CONSTRAINT unique_product_bin TO unique_item_bin'
    )

    # Recreate FKs → items(item_id)
    op.execute(
        """
        ALTER TABLE salesorderitems
            ADD CONSTRAINT salesorderitems_item_id_fkey
            FOREIGN KEY (item_id) REFERENCES items(item_id);
        """
    )
    op.execute(
        """
        ALTER TABLE vendoritemmappings
            ADD CONSTRAINT vendoritemmappings_item_id_fkey
            FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE;
        """
    )
    op.execute(
        """
        ALTER TABLE subcontractorders
            ADD CONSTRAINT subcontractorders_item_id_fkey
            FOREIGN KEY (item_id) REFERENCES items(item_id);
        """
    )
    op.execute(
        """
        ALTER TABLE inventorystock
            ADD CONSTRAINT inventorystock_item_id_fkey
            FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE;
        """
    )
    op.execute(
        """
        ALTER TABLE stockmovements
            ADD CONSTRAINT stockmovements_item_id_fkey
            FOREIGN KEY (item_id) REFERENCES items(item_id);
        """
    )
    op.execute(
        """
        ALTER TABLE itembomcomponents
            ADD CONSTRAINT itembomcomponents_parent_item_id_fkey
            FOREIGN KEY (parent_item_id) REFERENCES items(item_id) ON DELETE CASCADE;
        """
    )
    op.execute(
        """
        ALTER TABLE itembomcomponents
            ADD CONSTRAINT itembomcomponents_component_item_id_fkey
            FOREIGN KEY (component_item_id) REFERENCES items(item_id);
        """
    )
    op.execute(
        """
        ALTER TABLE subcontractordercomponents
            ADD CONSTRAINT subcontractordercomponents_component_item_id_fkey
            FOREIGN KEY (component_item_id) REFERENCES items(item_id);
        """
    )
    op.execute(
        """
        ALTER TABLE materialissuelines
            ADD CONSTRAINT materialissuelines_component_item_id_fkey
            FOREIGN KEY (component_item_id) REFERENCES items(item_id);
        """
    )
    op.execute(
        """
        ALTER TABLE componentissuelogs
            ADD CONSTRAINT componentissuelogs_component_item_id_fkey
            FOREIGN KEY (component_item_id) REFERENCES items(item_id);
        """
    )

    # Refresh CHECK constraints that referenced old column names
    op.execute('ALTER TABLE itembomcomponents DROP CONSTRAINT IF EXISTS chk_bom_not_self_referencing')
    op.execute(
        """
        ALTER TABLE itembomcomponents
            ADD CONSTRAINT chk_bom_not_self_referencing
            CHECK (parent_item_id <> component_item_id)
        """
    )
    op.execute('ALTER TABLE itembomcomponents DROP CONSTRAINT IF EXISTS chk_bom_component_ref')
    op.execute(
        """
        ALTER TABLE itembomcomponents
            ADD CONSTRAINT chk_bom_component_ref CHECK (
                (item_type = 'Material' AND component_item_id IS NOT NULL AND component_code IS NULL)
                OR
                (item_type IN ('Labor', 'Outside Service')
                 AND component_item_id IS NULL AND component_code IS NOT NULL)
            )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN
                SELECT c.conname, c.conrelid::regclass AS tbl
                FROM pg_constraint c
                JOIN pg_class ref ON ref.oid = c.confrelid
                WHERE c.contype = 'f'
                  AND ref.relname = 'items'
            LOOP
                EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
            END LOOP;
        END $$;
        """
    )

    op.execute('ALTER TABLE itembomcomponents DROP CONSTRAINT IF EXISTS chk_bom_not_self_referencing')
    op.execute('ALTER TABLE itembomcomponents DROP CONSTRAINT IF EXISTS chk_bom_component_ref')

    op.execute(
        'ALTER TABLE componentissuelogs RENAME COLUMN component_item_id TO component_product_id'
    )
    op.execute(
        'ALTER TABLE materialissuelines RENAME COLUMN component_item_id TO component_product_id'
    )
    op.execute(
        'ALTER TABLE subcontractordercomponents RENAME COLUMN component_item_id TO component_product_id'
    )
    op.execute('ALTER TABLE itembomcomponents RENAME COLUMN parent_item_id TO parent_product_id')
    op.execute('ALTER TABLE itembomcomponents RENAME COLUMN component_item_id TO component_product_id')
    op.execute('ALTER TABLE itembomcomponents RENAME TO productbomcomponents')

    op.execute('ALTER TABLE stockmovements RENAME COLUMN item_id TO product_id')
    op.execute('ALTER TABLE inventorystock RENAME COLUMN item_id TO product_id')
    op.execute('ALTER TABLE subcontractorders RENAME COLUMN item_id TO product_id')
    op.execute('ALTER TABLE vendoritemmappings RENAME COLUMN item_id TO product_id')
    op.execute('ALTER TABLE salesorderitems RENAME COLUMN item_id TO product_id')

    op.execute('ALTER TABLE items RENAME COLUMN item_id TO product_id')
    op.execute('ALTER TABLE items RENAME TO products')
    op.execute('ALTER INDEX IF EXISTS items_pkey RENAME TO products_pkey')
    op.execute(
        'ALTER TABLE inventorystock RENAME CONSTRAINT unique_item_bin TO unique_product_bin'
    )

    # Recreate original-style FKs (best-effort)
    op.execute(
        'ALTER TABLE salesorderitems ADD CONSTRAINT salesorderitems_product_id_fkey '
        'FOREIGN KEY (product_id) REFERENCES products(product_id)'
    )
    op.execute(
        'ALTER TABLE vendoritemmappings ADD CONSTRAINT vendoritemmappings_product_id_fkey '
        'FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE'
    )
    op.execute(
        'ALTER TABLE subcontractorders ADD CONSTRAINT subcontractorders_product_id_fkey '
        'FOREIGN KEY (product_id) REFERENCES products(product_id)'
    )
    op.execute(
        'ALTER TABLE inventorystock ADD CONSTRAINT inventorystock_product_id_fkey '
        'FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE'
    )
    op.execute(
        'ALTER TABLE stockmovements ADD CONSTRAINT stockmovements_product_id_fkey '
        'FOREIGN KEY (product_id) REFERENCES products(product_id)'
    )
    op.execute(
        'ALTER TABLE productbomcomponents ADD CONSTRAINT productbomcomponents_parent_product_id_fkey '
        'FOREIGN KEY (parent_product_id) REFERENCES products(product_id) ON DELETE CASCADE'
    )
    op.execute(
        'ALTER TABLE productbomcomponents ADD CONSTRAINT productbomcomponents_component_product_id_fkey '
        'FOREIGN KEY (component_product_id) REFERENCES products(product_id)'
    )
    op.execute(
        'ALTER TABLE subcontractordercomponents ADD CONSTRAINT subcontractordercomponents_component_product_id_fkey '
        'FOREIGN KEY (component_product_id) REFERENCES products(product_id)'
    )
    op.execute(
        'ALTER TABLE materialissuelines ADD CONSTRAINT materialissuelines_component_product_id_fkey '
        'FOREIGN KEY (component_product_id) REFERENCES products(product_id)'
    )
    op.execute(
        'ALTER TABLE componentissuelogs ADD CONSTRAINT componentissuelogs_component_product_id_fkey '
        'FOREIGN KEY (component_product_id) REFERENCES products(product_id)'
    )
    op.execute(
        """
        ALTER TABLE productbomcomponents
            ADD CONSTRAINT chk_bom_not_self_referencing
            CHECK (parent_product_id <> component_product_id)
        """
    )
    op.execute(
        """
        ALTER TABLE productbomcomponents
            ADD CONSTRAINT chk_bom_component_ref CHECK (
                (item_type = 'Material' AND component_product_id IS NOT NULL AND component_code IS NULL)
                OR
                (item_type IN ('Labor', 'Outside Service')
                 AND component_product_id IS NULL AND component_code IS NOT NULL)
            )
        """
    )
