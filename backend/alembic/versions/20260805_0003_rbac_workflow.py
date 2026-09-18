# @author: Wendy Yang
# @date: 2026-09-19

"""RBAC permissions, user_roles, multi-stage workflows.

Revision ID: 20260805_0003
Revises: 20260804_0002
Create Date: 2026-08-05
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260805_0003"
down_revision: Union[str, Sequence[str], None] = "20260804_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "departments",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.execute(
        """
        INSERT INTO departments (id, name) VALUES
          ('DEPT-SALES', 'Sales'),
          ('DEPT-PURCH', 'Purchasing'),
          ('DEPT-SCO', 'Subcontracting'),
          ('DEPT-FIN', 'Finance'),
          ('DEPT-ADMIN', 'Administration')
        ON CONFLICT DO NOTHING
        """
    )

    op.execute(
        """
        INSERT INTO roles (role_id, role_name, description) VALUES
          ('ROLE-ADMIN', 'Admin', 'Full system access'),
          ('ROLE-SALES-REP', 'Sales Rep', 'Create and submit sales orders'),
          ('ROLE-SALES-MGR', 'Sales Manager', 'Approve sales orders (manager band)'),
          ('ROLE-PURCH-AGENT', 'Purchasing Agent', 'Create and submit purchase orders'),
          ('ROLE-PURCH-MGR', 'Purchasing Manager', 'Approve purchase orders (manager band)'),
          ('ROLE-SCO-SUP', 'Subcontract Supervisor', 'Create, submit, and approve subcontract orders'),
          ('ROLE-FIN-APPR', 'Finance Approver', 'Executive / finance approval step')
        ON CONFLICT DO NOTHING
        """
    )

    op.create_table(
        "permissions",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("code", sa.String(100), nullable=False, unique=True),
        sa.Column("module", sa.String(50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.create_table(
        "role_permissions",
        sa.Column("role_id", sa.String(50), sa.ForeignKey("roles.role_id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "permission_id",
            sa.String(50),
            sa.ForeignKey("permissions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role_id", sa.String(50), sa.ForeignKey("roles.role_id", ondelete="CASCADE"), primary_key=True),
    )

    op.add_column(
        "users",
        sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
    )
    op.add_column("users", sa.Column("department_id", sa.String(50), nullable=True))
    op.create_foreign_key(
        "fk_users_department_id",
        "users",
        "departments",
        ["department_id"],
        ["id"],
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_status'
            ) THEN
                ALTER TABLE users ADD CONSTRAINT chk_users_status
                    CHECK (status IN ('ACTIVE', 'INACTIVE'));
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        INSERT INTO user_roles (user_id, role_id)
        SELECT id, role_id FROM users WHERE role_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO user_roles (user_id, role_id)
        SELECT u.id, m.new_role
        FROM users u
        CROSS JOIN (VALUES
          ('ROLE-MANAGER', 'ROLE-SALES-MGR'),
          ('ROLE-MANAGER', 'ROLE-PURCH-MGR'),
          ('ROLE-MANAGER', 'ROLE-FIN-APPR'),
          ('ROLE-CLERK', 'ROLE-SALES-REP'),
          ('ROLE-CLERK', 'ROLE-PURCH-AGENT')
        ) AS m(old_role, new_role)
        WHERE u.role_id = m.old_role
        ON CONFLICT DO NOTHING
        """
    )

    # Drop legacy role_id regardless of FK constraint name
    op.execute(
        """
        DO $$
        DECLARE
            r RECORD;
        BEGIN
            FOR r IN
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'users'::regclass
                  AND contype = 'f'
                  AND pg_get_constraintdef(oid) ILIKE '%role_id%'
            LOOP
                EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', r.conname);
            END LOOP;
        END $$;
        """
    )
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS role_id")

    op.create_table(
        "workflow_definition",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("module", sa.String(50), nullable=False),
        sa.Column("min_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("max_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("name", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_workflow_def_module", "workflow_definition", ["module", "is_active"])

    op.create_table(
        "workflow_step",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column(
            "workflow_definition_id",
            sa.String(50),
            sa.ForeignKey("workflow_definition.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("step_name", sa.String(100), nullable=False),
        sa.Column("required_role_id", sa.String(50), sa.ForeignKey("roles.role_id"), nullable=True),
        sa.Column("required_permission", sa.String(100), nullable=True),
        sa.UniqueConstraint("workflow_definition_id", "step_number"),
        sa.CheckConstraint(
            "required_role_id IS NOT NULL OR required_permission IS NOT NULL",
            name="chk_workflow_step_gate",
        ),
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables WHERE table_name = 'approval_history'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.tables WHERE table_name = 'approval_audit_log'
            ) THEN
                ALTER TABLE approval_history RENAME TO approval_audit_log;
            END IF;
        END $$;
        """
    )
    op.add_column("approval_audit_log", sa.Column("step_number", sa.Integer(), nullable=True))
    # Drop old check before remapping action values
    op.execute("ALTER TABLE approval_audit_log DROP CONSTRAINT IF EXISTS chk_approval_history_action")
    op.execute("ALTER TABLE approval_audit_log DROP CONSTRAINT IF EXISTS chk_approval_audit_action")
    op.execute("UPDATE approval_audit_log SET action = 'SUBMITTED' WHERE action = 'SUBMIT'")
    op.execute("UPDATE approval_audit_log SET action = 'APPROVED' WHERE action = 'APPROVE'")
    op.execute("UPDATE approval_audit_log SET action = 'REJECTED' WHERE action = 'DECLINE'")
    op.execute(
        """
        ALTER TABLE approval_audit_log ADD CONSTRAINT chk_approval_audit_action
            CHECK (action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED'))
        """
    )

    for table in (
        "salesorders",
        "purchaseorders",
        "subcontractorders",
        "ar_invoices",
        "ap_bills",
        "cash_transactions",
        "journal_entries",
    ):
        op.add_column(table, sa.Column("current_approval_step", sa.Integer(), nullable=True))

    op.drop_table("approval_rules")
    op.execute(_seed_sql())


def _seed_sql() -> str:
    return """
INSERT INTO permissions (id, code, module, description) VALUES
    ('PERM-ADMIN-MANAGE', 'admin:manage', 'admin', 'Access Admin RBAC UI and mutate roles/workflows'),
    ('PERM-SO-VIEW', 'sales_order:view', 'sales_order', 'View sales orders'),
    ('PERM-SO-CREATE', 'sales_order:create', 'sales_order', 'Create/edit draft sales orders'),
    ('PERM-SO-SUBMIT', 'sales_order:submit', 'sales_order', 'Submit sales orders for approval'),
    ('PERM-SO-APPROVE', 'sales_order:approve', 'sales_order', 'Approve/reject sales orders'),
    ('PERM-PO-VIEW', 'po:view', 'po', 'View purchase orders'),
    ('PERM-PO-CREATE', 'po:create', 'po', 'Create/edit draft purchase orders'),
    ('PERM-PO-SUBMIT', 'po:submit_for_approval', 'po', 'Submit purchase orders for approval'),
    ('PERM-PO-APPROVE', 'po:approve', 'po', 'Approve/reject purchase orders'),
    ('PERM-SCO-VIEW', 'subcontract:view', 'subcontract', 'View subcontract orders'),
    ('PERM-SCO-CREATE', 'subcontract:create', 'subcontract', 'Create/edit draft subcontract orders'),
    ('PERM-SCO-SUBMIT', 'subcontract:submit', 'subcontract', 'Submit subcontract orders'),
    ('PERM-SCO-APPROVE', 'subcontract:approve', 'subcontract', 'Approve/reject subcontract orders'),
    ('PERM-AR-VIEW', 'ar_invoice:view', 'ar_invoice', 'View AR invoices'),
    ('PERM-AR-CREATE', 'ar_invoice:create', 'ar_invoice', 'Create AR invoices'),
    ('PERM-AR-SUBMIT', 'ar_invoice:submit', 'ar_invoice', 'Submit AR invoices'),
    ('PERM-AR-APPROVE', 'ar_invoice:approve', 'ar_invoice', 'Approve/reject AR invoices'),
    ('PERM-AP-VIEW', 'ap_bill:view', 'ap_bill', 'View AP bills'),
    ('PERM-AP-CREATE', 'ap_bill:create', 'ap_bill', 'Create AP bills'),
    ('PERM-AP-SUBMIT', 'ap_bill:submit', 'ap_bill', 'Submit AP bills'),
    ('PERM-AP-APPROVE', 'ap_bill:approve', 'ap_bill', 'Approve/reject AP bills'),
    ('PERM-CASH-VIEW', 'cash:view', 'cash', 'View cash transactions'),
    ('PERM-CASH-CREATE', 'cash:create', 'cash', 'Create cash transactions'),
    ('PERM-CASH-SUBMIT', 'cash:submit', 'cash', 'Submit cash transactions'),
    ('PERM-CASH-APPROVE', 'cash:approve', 'cash', 'Approve/reject cash transactions'),
    ('PERM-JE-VIEW', 'journal:view', 'journal', 'View journal entries'),
    ('PERM-JE-CREATE', 'journal:create', 'journal', 'Create journal entries'),
    ('PERM-JE-SUBMIT', 'journal:submit', 'journal', 'Submit journal entries'),
    ('PERM-JE-APPROVE', 'journal:approve', 'journal', 'Approve/reject journal entries')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'ROLE-ADMIN', id FROM permissions
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('ROLE-SALES-REP', 'PERM-SO-VIEW'),
    ('ROLE-SALES-REP', 'PERM-SO-CREATE'),
    ('ROLE-SALES-REP', 'PERM-SO-SUBMIT'),
    ('ROLE-SALES-MGR', 'PERM-SO-VIEW'),
    ('ROLE-SALES-MGR', 'PERM-SO-CREATE'),
    ('ROLE-SALES-MGR', 'PERM-SO-SUBMIT'),
    ('ROLE-SALES-MGR', 'PERM-SO-APPROVE'),
    ('ROLE-PURCH-AGENT', 'PERM-PO-VIEW'),
    ('ROLE-PURCH-AGENT', 'PERM-PO-CREATE'),
    ('ROLE-PURCH-AGENT', 'PERM-PO-SUBMIT'),
    ('ROLE-PURCH-MGR', 'PERM-PO-VIEW'),
    ('ROLE-PURCH-MGR', 'PERM-PO-CREATE'),
    ('ROLE-PURCH-MGR', 'PERM-PO-SUBMIT'),
    ('ROLE-PURCH-MGR', 'PERM-PO-APPROVE'),
    ('ROLE-SCO-SUP', 'PERM-SCO-VIEW'),
    ('ROLE-SCO-SUP', 'PERM-SCO-CREATE'),
    ('ROLE-SCO-SUP', 'PERM-SCO-SUBMIT'),
    ('ROLE-SCO-SUP', 'PERM-SCO-APPROVE'),
    ('ROLE-FIN-APPR', 'PERM-SO-VIEW'),
    ('ROLE-FIN-APPR', 'PERM-SO-APPROVE'),
    ('ROLE-FIN-APPR', 'PERM-PO-VIEW'),
    ('ROLE-FIN-APPR', 'PERM-PO-APPROVE'),
    ('ROLE-FIN-APPR', 'PERM-AR-VIEW'),
    ('ROLE-FIN-APPR', 'PERM-AR-APPROVE'),
    ('ROLE-FIN-APPR', 'PERM-AP-VIEW'),
    ('ROLE-FIN-APPR', 'PERM-AP-APPROVE'),
    ('ROLE-FIN-APPR', 'PERM-CASH-VIEW'),
    ('ROLE-FIN-APPR', 'PERM-CASH-APPROVE'),
    ('ROLE-FIN-APPR', 'PERM-JE-VIEW'),
    ('ROLE-FIN-APPR', 'PERM-JE-APPROVE'),
    ('ROLE-FIN-APPR', 'PERM-SCO-VIEW'),
    ('ROLE-FIN-APPR', 'PERM-SCO-APPROVE')
ON CONFLICT DO NOTHING;

INSERT INTO workflow_definition (id, module, min_amount, max_amount, is_active, name) VALUES
    ('WF-SO-AUTO', 'SALES_ORDER', 0, 1000, TRUE, 'SO Auto-Approve'),
    ('WF-SO-MGR', 'SALES_ORDER', 1000.01, 10000, TRUE, 'SO Manager Approval'),
    ('WF-SO-EXEC', 'SALES_ORDER', 10000.01, NULL, TRUE, 'SO Executive Approval'),
    ('WF-PO-AUTO', 'PURCHASE_ORDER', 0, 1000, TRUE, 'PO Auto-Approve'),
    ('WF-PO-MGR', 'PURCHASE_ORDER', 1000.01, 10000, TRUE, 'PO Manager Approval'),
    ('WF-PO-EXEC', 'PURCHASE_ORDER', 10000.01, NULL, TRUE, 'PO Executive Approval'),
    ('WF-SCO-AUTO', 'SUBCONTRACT_ORDER', 0, 10, TRUE, 'SCO Auto-Approve'),
    ('WF-SCO-STD', 'SUBCONTRACT_ORDER', 10.01, 100, TRUE, 'SCO Supervisor Approval'),
    ('WF-SCO-EXEC', 'SUBCONTRACT_ORDER', 100.01, NULL, TRUE, 'SCO Executive Approval'),
    ('WF-AR-AUTO', 'AR_INVOICE', 0, 1000, TRUE, 'AR Auto-Approve'),
    ('WF-AR-MGR', 'AR_INVOICE', 1000.01, 10000, TRUE, 'AR Manager Approval'),
    ('WF-AR-EXEC', 'AR_INVOICE', 10000.01, NULL, TRUE, 'AR Executive Approval'),
    ('WF-AP-AUTO', 'AP_BILL', 0, 1000, TRUE, 'AP Auto-Approve'),
    ('WF-AP-MGR', 'AP_BILL', 1000.01, 10000, TRUE, 'AP Manager Approval'),
    ('WF-AP-EXEC', 'AP_BILL', 10000.01, NULL, TRUE, 'AP Executive Approval'),
    ('WF-CASH-AUTO', 'CASH_TRANSACTION', 0, 1000, TRUE, 'Cash Auto-Approve'),
    ('WF-CASH-MGR', 'CASH_TRANSACTION', 1000.01, 10000, TRUE, 'Cash Manager Approval'),
    ('WF-CASH-EXEC', 'CASH_TRANSACTION', 10000.01, NULL, TRUE, 'Cash Executive Approval'),
    ('WF-JE-AUTO', 'JOURNAL_ENTRY', 0, 1000, TRUE, 'JE Auto-Approve'),
    ('WF-JE-MGR', 'JOURNAL_ENTRY', 1000.01, 10000, TRUE, 'JE Manager Approval'),
    ('WF-JE-EXEC', 'JOURNAL_ENTRY', 10000.01, NULL, TRUE, 'JE Executive Approval')
ON CONFLICT DO NOTHING;

INSERT INTO workflow_step (id, workflow_definition_id, step_number, step_name, required_role_id) VALUES
    ('WF-SO-MGR-1', 'WF-SO-MGR', 1, 'Manager Approval', 'ROLE-SALES-MGR'),
    ('WF-SO-EXEC-1', 'WF-SO-EXEC', 1, 'Manager Approval', 'ROLE-SALES-MGR'),
    ('WF-SO-EXEC-2', 'WF-SO-EXEC', 2, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-PO-MGR-1', 'WF-PO-MGR', 1, 'Manager Approval', 'ROLE-PURCH-MGR'),
    ('WF-PO-EXEC-1', 'WF-PO-EXEC', 1, 'Manager Approval', 'ROLE-PURCH-MGR'),
    ('WF-PO-EXEC-2', 'WF-PO-EXEC', 2, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-SCO-STD-1', 'WF-SCO-STD', 1, 'Supervisor Approval', 'ROLE-SCO-SUP'),
    ('WF-SCO-EXEC-1', 'WF-SCO-EXEC', 1, 'Supervisor Approval', 'ROLE-SCO-SUP'),
    ('WF-SCO-EXEC-2', 'WF-SCO-EXEC', 2, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-AR-MGR-1', 'WF-AR-MGR', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-AR-EXEC-1', 'WF-AR-EXEC', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-AR-EXEC-2', 'WF-AR-EXEC', 2, 'Executive Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-AP-MGR-1', 'WF-AP-MGR', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-AP-EXEC-1', 'WF-AP-EXEC', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-AP-EXEC-2', 'WF-AP-EXEC', 2, 'Executive Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-CASH-MGR-1', 'WF-CASH-MGR', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-CASH-EXEC-1', 'WF-CASH-EXEC', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-CASH-EXEC-2', 'WF-CASH-EXEC', 2, 'Executive Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-JE-MGR-1', 'WF-JE-MGR', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-JE-EXEC-1', 'WF-JE-EXEC', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-JE-EXEC-2', 'WF-JE-EXEC', 2, 'Executive Finance Approval', 'ROLE-FIN-APPR')
ON CONFLICT DO NOTHING;
"""


def downgrade() -> None:
    op.execute("DELETE FROM workflow_step")
    op.execute("DELETE FROM workflow_definition")
    op.drop_table("workflow_step")
    op.drop_table("workflow_definition")
    for table in (
        "salesorders",
        "purchaseorders",
        "subcontractorders",
        "ar_invoices",
        "ap_bills",
        "cash_transactions",
        "journal_entries",
    ):
        op.drop_column(table, "current_approval_step")
    op.execute("ALTER TABLE approval_audit_log RENAME TO approval_history")
    op.drop_column("approval_history", "step_number")
    op.add_column("users", sa.Column("role_id", sa.String(50), nullable=True))
    op.create_foreign_key("fk_users_role_id", "users", "roles", ["role_id"], ["role_id"])
    op.drop_constraint("fk_users_department_id", "users", type_="foreignkey")
    op.drop_column("users", "department_id")
    op.drop_column("users", "status")
    op.drop_table("user_roles")
    op.drop_table("role_permissions")
    op.drop_table("permissions")
    op.drop_table("departments")
    op.create_table(
        "approval_rules",
        sa.Column("rule_id", sa.String(50), primary_key=True),
        sa.Column("module", sa.String(50), nullable=False),
        sa.Column("role_id", sa.String(50), sa.ForeignKey("roles.role_id", ondelete="CASCADE"), nullable=False),
        sa.Column("max_amount_limit", sa.Numeric(14, 2), nullable=True),
        sa.Column("can_submit", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("can_approve", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("requires_secondary_approval", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("module", "role_id", name="unique_approval_rule_module_role"),
    )
