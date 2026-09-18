# @author: Wendy Yang
# @date: 2026-09-19

"""Payment terms master table, FKs, seed, and string backfill.

Revision ID: 20260917_0030
Revises: 20260917_0029
Create Date: 2026-09-17
"""

from __future__ import annotations

import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260917_0030"
down_revision: Union[str, Sequence[str], None] = "20260917_0029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SEED_TERMS = (
    ("NET15", "Net 15 Days", 15),
    ("NET30", "Net 30 Days", 30),
    ("NET60", "Net 60 Days", 60),
    ("NET90", "Net 90 Days", 90),
    ("DUE_ON_RECEIPT", "Due on Receipt", 0),
    ("P02", "Payment on 2nd of following month", 32),
    ("P10", "Payment on 10th of following month", 40),
    ("ADVANCE", "Advance Payment", 0),
)

ALIASES = {
    "NET30": "NET30",
    "N30": "NET30",
    "NET030": "NET30",
    "T010": "NET30",
    "T10": "NET30",
    "M020": "NET30",
    "NET15": "NET15",
    "N15": "NET15",
    "NET015": "NET15",
    "NET60": "NET60",
    "N60": "NET60",
    "NET060": "NET60",
    "T020": "NET60",
    "T20": "NET60",
    "NET90": "NET90",
    "N90": "NET90",
    "NET090": "NET90",
    "T030": "NET90",
    "T30": "NET90",
    "DUEONRECEIPT": "DUE_ON_RECEIPT",
    "DUEONRCPT": "DUE_ON_RECEIPT",
    "COD": "DUE_ON_RECEIPT",
    "CIA": "DUE_ON_RECEIPT",
    "T000": "DUE_ON_RECEIPT",
    "T00": "DUE_ON_RECEIPT",
    "P02": "P02",
    "P2": "P02",
    "P10": "P10",
    "ADVANCE": "ADVANCE",
    "PREPAID": "ADVANCE",
}

FK_TABLES = (
    "suppliers",
    "customers",
    "purchaseorders",
    "salesorders",
    "supplier_invoices",
    "ap_bills",
    "sales_invoices",
)


def _norm(raw: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def _due_days(raw: str) -> int:
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits:
        try:
            return max(0, int(digits))
        except ValueError:
            pass
    return 30


def upgrade() -> None:
    op.create_table(
        "payment_terms",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("due_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("discount_days", sa.Integer(), nullable=True),
        sa.Column("discount_percentage", sa.Numeric(5, 2), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("code", name="uq_payment_terms_code"),
        sa.CheckConstraint("due_days >= 0", name="chk_payment_terms_due_days"),
        sa.CheckConstraint(
            "discount_days IS NULL OR discount_days >= 0",
            name="chk_payment_terms_discount_days",
        ),
        sa.CheckConstraint(
            "discount_percentage IS NULL OR (discount_percentage >= 0 AND discount_percentage <= 100)",
            name="chk_payment_terms_discount_pct",
        ),
    )

    conn = op.get_bind()
    for code, description, due_days in SEED_TERMS:
        conn.execute(
            sa.text(
                """
                INSERT INTO payment_terms (code, description, due_days, is_active)
                VALUES (:code, :description, :due_days, true)
                ON CONFLICT (code) DO NOTHING
                """
            ),
            {"code": code, "description": description, "due_days": due_days},
        )

    for table in FK_TABLES:
        op.add_column(
            table,
            sa.Column("payment_term_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            f"fk_{table}_payment_term_id",
            table,
            "payment_terms",
            ["payment_term_id"],
            ["id"],
        )

    inspector = sa.inspect(conn)
    si_cols = {col["name"] for col in inspector.get_columns("supplier_invoices")}
    if "payment_terms" not in si_cols:
        op.add_column(
            "supplier_invoices",
            sa.Column("payment_terms", sa.String(length=50), nullable=True),
        )

    code_to_id = {
        row[0]: row[1]
        for row in conn.execute(sa.text("SELECT code, id FROM payment_terms")).fetchall()
    }

    string_tables = (
        "suppliers",
        "customers",
        "purchaseorders",
        "salesorders",
        "sales_invoices",
        "supplier_invoices",
    )
    distinct_values: set[str] = set()
    for table in string_tables:
        inspector = sa.inspect(conn)
        cols = {col["name"] for col in inspector.get_columns(table)}
        if "payment_terms" not in cols:
            continue
        rows = conn.execute(
            sa.text(f"SELECT DISTINCT payment_terms FROM {table} WHERE payment_terms IS NOT NULL")
        ).fetchall()
        for (value,) in rows:
            if value and str(value).strip():
                distinct_values.add(str(value).strip())

    for raw in sorted(distinct_values):
        mapped = ALIASES.get(_norm(raw))
        if mapped and mapped in code_to_id:
            continue
        code = mapped or _norm(raw)[:20] or "CUSTOM"
        if code in code_to_id:
            continue
        description = raw[:255]
        due_days = _due_days(raw)
        conn.execute(
            sa.text(
                """
                INSERT INTO payment_terms (code, description, due_days, is_active)
                VALUES (:code, :description, :due_days, true)
                ON CONFLICT (code) DO NOTHING
                """
            ),
            {"code": code, "description": description, "due_days": due_days},
        )
        row = conn.execute(
            sa.text("SELECT id FROM payment_terms WHERE code = :code"),
            {"code": code},
        ).fetchone()
        if row:
            code_to_id[code] = row[0]

    def resolve_id(raw: str | None):
        if not raw or not str(raw).strip():
            return None
        mapped = ALIASES.get(_norm(raw)) or _norm(raw)[:20]
        return code_to_id.get(mapped)

    for table in string_tables:
        inspector = sa.inspect(conn)
        cols = {col["name"] for col in inspector.get_columns(table)}
        if "payment_terms" not in cols:
            continue
        rows = conn.execute(
            sa.text(f"SELECT DISTINCT payment_terms FROM {table} WHERE payment_terms IS NOT NULL")
        ).fetchall()
        for (value,) in rows:
            term_id = resolve_id(value)
            if term_id is None:
                continue
            snapshot = ALIASES.get(_norm(value)) or _norm(value)[:20]
            if snapshot not in code_to_id:
                snapshot = value
            conn.execute(
                sa.text(
                    f"""
                    UPDATE {table}
                    SET payment_term_id = :term_id,
                        payment_terms = :snapshot
                    WHERE payment_terms = :raw
                    """
                ),
                {"term_id": term_id, "snapshot": snapshot, "raw": value},
            )

    conn.execute(
        sa.text(
            """
            UPDATE supplier_invoices si
            SET payment_term_id = s.payment_term_id,
                payment_terms = COALESCE(si.payment_terms, s.payment_terms)
            FROM suppliers s
            WHERE si.vendor_id = s.supplier_id
              AND si.payment_term_id IS NULL
              AND s.payment_term_id IS NOT NULL
            """
        )
    )

    conn.execute(
        sa.text(
            """
            UPDATE ap_bills b
            SET payment_term_id = COALESCE(
                (SELECT si.payment_term_id FROM supplier_invoices si WHERE si.id = b.supplier_invoice_id),
                (SELECT po.payment_term_id FROM purchaseorders po WHERE po.po_number = b.purchase_order_id),
                (SELECT s.payment_term_id FROM suppliers s WHERE s.supplier_id = b.vendor_id)
            )
            WHERE b.payment_term_id IS NULL
            """
        )
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    si_cols = {col["name"] for col in inspector.get_columns("supplier_invoices")}
    if "payment_terms" in si_cols:
        op.drop_column("supplier_invoices", "payment_terms")
    for table in reversed(FK_TABLES):
        op.drop_constraint(f"fk_{table}_payment_term_id", table, type_="foreignkey")
        op.drop_column(table, "payment_term_id")
    op.drop_table("payment_terms")
