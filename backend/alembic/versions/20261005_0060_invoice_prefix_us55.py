# @author: Wendy Yang
# @date: 2026-10-05

"""Rename mistyped USS5- sales invoice IDs to US55-.

Revision ID: 20261005_0060
Revises: 20261002_0059
Create Date: 2026-10-05
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

from app.services.document_sequences import remap_legacy_invoice_id

revision: str = "20261005_0060"
down_revision: Union[str, Sequence[str], None] = "20261002_0059"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ID_QUERIES = (
    "SELECT invoice_number FROM sales_invoices WHERE invoice_number LIKE 'USS5-%'",
    "SELECT invoice_id FROM ar_invoices WHERE invoice_id LIKE 'USS5-%'",
    "SELECT ar_invoice_id FROM sales_invoices WHERE ar_invoice_id LIKE 'USS5-%'",
    "SELECT reference_id FROM cash_transactions WHERE reference_id LIKE 'USS5-%'",
    "SELECT reference FROM journal_entries WHERE reference LIKE 'USS5-%'",
    "SELECT source_record_id FROM journal_entries WHERE source_record_id LIKE 'USS5-%'",
    "SELECT document_id FROM approval_audit_log WHERE document_id LIKE 'USS5-%'",
    "SELECT document_id FROM document_attachments WHERE document_id LIKE 'USS5-%'",
    "SELECT document_id FROM document_revisions WHERE document_id LIKE 'USS5-%'",
    "SELECT root_document_id FROM document_revisions WHERE root_document_id LIKE 'USS5-%'",
    "SELECT document_id FROM document_change_logs WHERE document_id LIKE 'USS5-%'",
)

_LOOSE_ID_UPDATES = (
    "UPDATE approval_audit_log SET document_id = :new WHERE document_id = :old",
    "UPDATE document_attachments SET document_id = :new WHERE document_id = :old",
    "UPDATE cash_transactions SET reference_id = :new WHERE reference_id = :old",
    "UPDATE journal_entries SET reference = :new WHERE reference = :old",
    "UPDATE journal_entries SET source_record_id = :new WHERE source_record_id = :old",
    "UPDATE document_revisions SET document_id = :new WHERE document_id = :old",
    "UPDATE document_revisions SET root_document_id = :new WHERE root_document_id = :old",
    "UPDATE document_change_logs SET document_id = :new WHERE document_id = :old",
    "UPDATE journal_entries SET description = replace(description, :old, :new) "
    "WHERE description LIKE '%' || :old || '%'",
)


def upgrade() -> None:
    conn = op.get_bind()
    ids: set[str] = set()
    for sql in _ID_QUERIES:
        table_name = sql.split()[3]
        if not _table_exists(conn, table_name):
            continue
        for (value,) in conn.execute(text(sql)).fetchall():
            if value:
                ids.add(str(value))
    remaps = {
        old_id: remap_legacy_invoice_id(old_id)
        for old_id in ids
        if remap_legacy_invoice_id(old_id) != old_id
    }
    if not remaps:
        return

    originals = _enable_update_cascade(conn, [("ar_invoices", "invoice_id")])
    try:
        _two_phase_rewrite(conn, "ar_invoices", "invoice_id", remaps)
        _two_phase_rewrite(conn, "sales_invoices", "invoice_number", remaps)
        for sql in _LOOSE_ID_UPDATES:
            table_name = sql.split()[1]
            if _table_exists(conn, table_name):
                _rewrite(conn, sql, remaps)
    finally:
        _restore_foreign_keys(conn, originals)


def downgrade() -> None:
    return


def _table_exists(conn, table_name: str) -> bool:
    return bool(
        conn.execute(
            text("SELECT to_regclass(:name)"),
            {"name": f"public.{table_name}"},
        ).scalar()
    )


def _rewrite(conn, sql: str, remaps: dict[str, str]) -> None:
    statement = text(sql)
    for old_id, new_id in remaps.items():
        conn.execute(statement, {"old": old_id, "new": new_id})


def _two_phase_rewrite(conn, table: str, column: str, remaps: dict[str, str]) -> None:
    if not _table_exists(conn, table):
        return
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
        if not _table_exists(conn, table_name):
            continue
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
