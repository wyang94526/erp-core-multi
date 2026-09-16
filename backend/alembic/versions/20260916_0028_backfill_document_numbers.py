"""Rename existing SO/PO/SCO/sales-invoice IDs to PREFIX+YY+MM+XXXX.

Revision ID: 20260916_0028
Revises: 20260916_0027
Create Date: 2026-09-16
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

from app.services.document_sequences import (
    DOC_INVOICE,
    DOC_PURCHASE_ORDER,
    DOC_SALES_ORDER,
    DOC_SUBCONTRACT_ORDER,
    DOCUMENT_PREFIXES,
    plan_document_renames,
)

revision: str = "20260916_0028"
down_revision: Union[str, Sequence[str], None] = "20260916_0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LOOSE_ID_UPDATES = (
    "UPDATE approval_audit_log SET document_id = :new WHERE document_id = :old",
    "UPDATE document_attachments SET document_id = :new WHERE document_id = :old",
    "UPDATE cash_transactions SET reference_id = :new WHERE reference_id = :old",
    "UPDATE goods_receipts SET source_order_id = :new WHERE source_order_id = :old",
    "UPDATE supplier_invoices SET source_order_id = :new WHERE source_order_id = :old",
    "UPDATE ap_bills SET source_order_id = :new WHERE source_order_id = :old",
    "UPDATE stockmovements SET reference = :new WHERE reference = :old",
    "UPDATE journal_entries SET description = replace(description, :old, :new) "
    "WHERE description LIKE '%' || :old || '%'",
)


def upgrade() -> None:
    conn = op.get_bind()
    remaps: dict[str, str] = {}
    counters: dict[str, dict[str, int]] = {}

    remaps.update(
        _plan(
            conn,
            """
            SELECT sales_order_id, order_date, created_at
            FROM salesorders
            """,
            DOCUMENT_PREFIXES[DOC_SALES_ORDER],
            counters,
            DOC_SALES_ORDER,
        )
    )
    remaps.update(
        _plan(
            conn,
            """
            SELECT po_number, order_date, created_at
            FROM purchaseorders
            """,
            DOCUMENT_PREFIXES[DOC_PURCHASE_ORDER],
            counters,
            DOC_PURCHASE_ORDER,
        )
    )
    remaps.update(
        _plan(
            conn,
            """
            SELECT sco_number, order_date, created_at
            FROM subcontractorders
            """,
            DOCUMENT_PREFIXES[DOC_SUBCONTRACT_ORDER],
            counters,
            DOC_SUBCONTRACT_ORDER,
        )
    )
    remaps.update(
        _plan(
            conn,
            """
            SELECT invoice_number, issue_date, created_at
            FROM sales_invoices
            """,
            DOCUMENT_PREFIXES[DOC_INVOICE],
            counters,
            DOC_INVOICE,
        )
    )

    if remaps:
        originals = _enable_update_cascade(
            conn,
            [
                ("salesorders", "sales_order_id"),
                ("purchaseorders", "po_number"),
                ("subcontractorders", "sco_number"),
                ("ar_invoices", "invoice_id"),
            ],
        )
        try:
            _two_phase_rewrite(conn, "salesorders", "sales_order_id", remaps)
            _two_phase_rewrite(conn, "purchaseorders", "po_number", remaps)
            _two_phase_rewrite(conn, "subcontractorders", "sco_number", remaps)
            _two_phase_rewrite(conn, "sales_invoices", "invoice_number", remaps)
            _two_phase_rewrite(conn, "ar_invoices", "invoice_id", remaps)
            for sql in _LOOSE_ID_UPDATES:
                table_name = sql.split()[1]
                if conn.execute(
                    text("SELECT to_regclass(:name)"),
                    {"name": f"public.{table_name}"},
                ).scalar():
                    _rewrite(conn, sql, remaps)
        finally:
            _restore_foreign_keys(conn, originals)

    _seed_counters(conn, counters)


def downgrade() -> None:
    # Old IDs are not retained after the backfill.
    return


def _plan(conn, sql: str, prefix: str, counters: dict[str, dict[str, int]], doc_type: str) -> dict[str, str]:
    rows = conn.execute(text(sql)).fetchall()
    changes, last_value = plan_document_renames(
        [(row[0], row[1], row[2]) for row in rows],
        prefix,
    )
    counters[doc_type] = last_value
    return changes


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


def _seed_counters(conn, counters: dict[str, dict[str, int]]) -> None:
    for doc_type, by_month in counters.items():
        for year_month, last_value in by_month.items():
            conn.execute(
                text(
                    """
                    INSERT INTO document_sequences (doc_type, year_month, last_value)
                    VALUES (:doc_type, :year_month, :last_value)
                    ON CONFLICT (doc_type, year_month)
                    DO UPDATE SET last_value = GREATEST(
                        document_sequences.last_value,
                        EXCLUDED.last_value
                    )
                    """
                ),
                {
                    "doc_type": doc_type,
                    "year_month": year_month,
                    "last_value": last_value,
                },
            )
