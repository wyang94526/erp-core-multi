"""Rename mistyped PUB61- sales order IDs to PU61-.

Revision ID: 20260918_0033
Revises: 20260917_0032
Create Date: 2026-09-18
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

from app.services.document_sequences import remap_legacy_sales_order_id

revision: str = "20260918_0033"
down_revision: Union[str, Sequence[str], None] = "20260917_0032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LOOSE_ID_UPDATES = (
    "UPDATE approval_audit_log SET document_id = :new WHERE document_id = :old",
    "UPDATE document_attachments SET document_id = :new WHERE document_id = :old",
    "UPDATE cash_transactions SET reference_id = :new WHERE reference_id = :old",
    "UPDATE journal_entries SET description = replace(description, :old, :new) "
    "WHERE description LIKE '%' || :old || '%'",
)


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        text(
            """
            SELECT sales_order_id
            FROM salesorders
            WHERE sales_order_id LIKE 'PUB61-%'
            """
        )
    ).fetchall()
    remaps = {
        old_id: remap_legacy_sales_order_id(old_id)
        for (old_id,) in rows
        if remap_legacy_sales_order_id(old_id) != old_id
    }
    if not remaps:
        return

    originals = _enable_update_cascade(conn, [("salesorders", "sales_order_id")])
    try:
        _two_phase_rewrite(conn, "salesorders", "sales_order_id", remaps)
        for sql in _LOOSE_ID_UPDATES:
            table_name = sql.split()[1]
            if conn.execute(
                text("SELECT to_regclass(:name)"),
                {"name": f"public.{table_name}"},
            ).scalar():
                _rewrite(conn, sql, remaps)
    finally:
        _restore_foreign_keys(conn, originals)


def downgrade() -> None:
    # Corrected IDs are the new canonical form.
    return


def _rewrite(conn, sql: str, remaps: dict[str, str]) -> None:
    statement = text(sql)
    for old_id, new_id in remaps.items():
        conn.execute(statement, {"old": old_id, "new": new_id})


def _two_phase_rewrite(conn, table: str, column: str, remaps: dict[str, str]) -> None:
    current = {
        row[0]
        for row in conn.execute(text(f'SELECT "{column}" FROM "{table}"')).fetchall()
    }
    applicable = {old_id: new_id for old_id, new_id in remaps.items() if old_id in current}
    if not applicable:
        return
    temps = {old_id: f"__MIG{index:04d}__" for index, old_id in enumerate(applicable, start=1)}
    sql = f'UPDATE "{table}" SET "{column}" = :new WHERE "{column}" = :old'
    _rewrite(conn, sql, temps)
    _rewrite(conn, sql, {temps[old_id]: new_id for old_id, new_id in applicable.items()})


def _enable_update_cascade(conn, parents: list[tuple[str, str]]) -> list[dict]:
    originals: list[dict] = []
    for table_name, column_name in parents:
        rows = conn.execute(
            text(
                """
                SELECT
                    con.conname AS constraint_name,
                    rel_child.relname AS child_table,
                    att_child.attname AS child_column,
                    CASE con.confdeltype
                        WHEN 'c' THEN 'CASCADE'
                        WHEN 'n' THEN 'SET NULL'
                        WHEN 'd' THEN 'SET DEFAULT'
                        WHEN 'r' THEN 'RESTRICT'
                        ELSE 'NO ACTION'
                    END AS delete_rule,
                    CASE con.confupdtype
                        WHEN 'c' THEN 'CASCADE'
                        WHEN 'n' THEN 'SET NULL'
                        WHEN 'd' THEN 'SET DEFAULT'
                        WHEN 'r' THEN 'RESTRICT'
                        ELSE 'NO ACTION'
                    END AS update_rule
                FROM pg_constraint AS con
                JOIN pg_class AS rel_child ON rel_child.oid = con.conrelid
                JOIN pg_class AS rel_parent ON rel_parent.oid = con.confrelid
                JOIN pg_namespace AS nsp ON nsp.oid = rel_child.relnamespace
                JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON TRUE
                JOIN unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord)
                  ON fk.ord = ck.ord
                JOIN pg_attribute AS att_child
                  ON att_child.attrelid = rel_child.oid
                 AND att_child.attnum = ck.attnum
                JOIN pg_attribute AS att_parent
                  ON att_parent.attrelid = rel_parent.oid
                 AND att_parent.attnum = fk.attnum
                WHERE con.contype = 'f'
                  AND nsp.nspname = 'public'
                  AND rel_parent.relname = :table_name
                  AND att_parent.attname = :column_name
                """
            ),
            {"table_name": table_name, "column_name": column_name},
        ).mappings()
        for row in rows:
            info = dict(row)
            info["parent_table"] = table_name
            info["parent_column"] = column_name
            originals.append(info)
            if (info["update_rule"] or "").upper() == "CASCADE":
                continue
            _recreate_fk(conn, info, on_update="CASCADE")
    return originals


def _restore_foreign_keys(conn, originals: list[dict]) -> None:
    for info in originals:
        if (info["update_rule"] or "").upper() == "CASCADE":
            continue
        _recreate_fk(conn, info, on_update=info["update_rule"] or "NO ACTION")


def _recreate_fk(conn, info: dict, on_update: str) -> None:
    delete_rule = info["delete_rule"] or "NO ACTION"
    conn.execute(
        text(
            f'ALTER TABLE "{info["child_table"]}" DROP CONSTRAINT "{info["constraint_name"]}"'
        )
    )
    conn.execute(
        text(
            f'ALTER TABLE "{info["child_table"]}" '
            f'ADD CONSTRAINT "{info["constraint_name"]}" '
            f'FOREIGN KEY ("{info["child_column"]}") '
            f'REFERENCES "{info["parent_table"]}" ("{info["parent_column"]}") '
            f"ON UPDATE {on_update} ON DELETE {delete_rule}"
        )
    )
