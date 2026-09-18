-- ========================================================
-- RBAC + MULTI-STAGE WORKFLOW
-- Runs after 02-approval-workflow.sql on fresh DB init.
-- ========================================================

-- Departments
CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO departments (id, name) VALUES
    ('DEPT-SALES', 'Sales'),
    ('DEPT-PURCH', 'Purchasing'),
    ('DEPT-SCO', 'Subcontracting'),
    ('DEPT-FIN', 'Finance'),
    ('DEPT-ADMIN', 'Administration')
ON CONFLICT DO NOTHING;

-- Expanded roles (keep ROLE-ADMIN; add specialized roles)
INSERT INTO roles (role_id, role_name, description) VALUES
    ('ROLE-ADMIN', 'Admin', 'Full system access'),
    ('ROLE-UNASSIGNED', 'Unassigned', 'Self-registered user awaiting role assignment by an admin'),
    ('ROLE-SALES-REP', 'Sales Rep', 'Create and submit sales orders'),
    ('ROLE-SALES-MGR', 'Sales Manager', 'Approve sales orders (manager band)'),
    ('ROLE-PURCH-AGENT', 'Purchasing Agent', 'Create and submit purchase orders'),
    ('ROLE-PURCH-MGR', 'Purchasing Manager', 'Approve purchase orders (manager band)'),
    ('ROLE-SCO-SUP', 'Subcontract Supervisor', 'Create, submit, and approve subcontract orders'),
    ('ROLE-FIN-APPR', 'Finance Approver', 'Executive / finance approval step')
ON CONFLICT DO NOTHING;

-- Permissions
CREATE TABLE IF NOT EXISTS permissions (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    module VARCHAR(50) NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id VARCHAR(50) NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id VARCHAR(50) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id VARCHAR(50) NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- Users extensions
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS department_id VARCHAR(50) REFERENCES departments(id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_status'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT chk_users_status
            CHECK (status IN ('ACTIVE', 'INACTIVE'));
    END IF;
END $$;

-- Migrate legacy users.role_id into user_roles
INSERT INTO user_roles (user_id, role_id)
SELECT id, role_id FROM users WHERE role_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Map legacy ROLE-MANAGER / ROLE-CLERK to new roles where present
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, 'ROLE-SALES-MGR'
FROM users u
WHERE u.role_id = 'ROLE-MANAGER'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, 'ROLE-PURCH-MGR'
FROM users u
WHERE u.role_id = 'ROLE-MANAGER'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, 'ROLE-FIN-APPR'
FROM users u
WHERE u.role_id = 'ROLE-MANAGER'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, 'ROLE-SALES-REP'
FROM users u
WHERE u.role_id = 'ROLE-CLERK'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, 'ROLE-PURCH-AGENT'
FROM users u
WHERE u.role_id = 'ROLE-CLERK'
ON CONFLICT DO NOTHING;

-- Drop legacy single role_id (after migration)
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_role_id;
ALTER TABLE users DROP COLUMN IF EXISTS role_id;

-- Workflow definitions
CREATE TABLE IF NOT EXISTS workflow_definition (
    id VARCHAR(50) PRIMARY KEY,
    module VARCHAR(50) NOT NULL,
    min_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    max_amount NUMERIC(14, 2),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_def_module
    ON workflow_definition (module, is_active);

CREATE TABLE IF NOT EXISTS workflow_step (
    id VARCHAR(50) PRIMARY KEY,
    workflow_definition_id VARCHAR(50) NOT NULL
        REFERENCES workflow_definition(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    required_role_id VARCHAR(50) REFERENCES roles(role_id),
    required_permission VARCHAR(100),
    UNIQUE (workflow_definition_id, step_number),
    CONSTRAINT chk_workflow_step_gate CHECK (
        required_role_id IS NOT NULL OR required_permission IS NOT NULL
    )
);

-- Evolve approval_history → approval_audit_log
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'approval_history'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'approval_audit_log'
    ) THEN
        ALTER TABLE approval_history RENAME TO approval_audit_log;
    END IF;
END $$;

ALTER TABLE approval_audit_log
    ADD COLUMN IF NOT EXISTS step_number INTEGER;

-- Remap legacy actions
UPDATE approval_audit_log SET action = 'SUBMITTED' WHERE action = 'SUBMIT';
UPDATE approval_audit_log SET action = 'APPROVED' WHERE action = 'APPROVE';
UPDATE approval_audit_log SET action = 'REJECTED' WHERE action = 'DECLINE';

ALTER TABLE approval_audit_log DROP CONSTRAINT IF EXISTS chk_approval_history_action;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_approval_audit_action'
    ) THEN
        ALTER TABLE approval_audit_log ADD CONSTRAINT chk_approval_audit_action
            CHECK (action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED', 'AMENDED'));
    END IF;
END $$;

-- current_approval_step on all approval documents
ALTER TABLE salesorders ADD COLUMN IF NOT EXISTS current_approval_step INTEGER;
ALTER TABLE purchaseorders ADD COLUMN IF NOT EXISTS current_approval_step INTEGER;
ALTER TABLE subcontractorders ADD COLUMN IF NOT EXISTS current_approval_step INTEGER;
ALTER TABLE ar_invoices ADD COLUMN IF NOT EXISTS current_approval_step INTEGER;
ALTER TABLE ap_bills ADD COLUMN IF NOT EXISTS current_approval_step INTEGER;
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS current_approval_step INTEGER;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS current_approval_step INTEGER;

-- Replace approval_rules with workflow engine
DROP TABLE IF EXISTS approval_rules CASCADE;

-- Permission catalog
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

-- Role → permission matrix
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
    ('ROLE-FIN-APPR', 'PERM-JE-CREATE'),
    ('ROLE-FIN-APPR', 'PERM-JE-SUBMIT'),
    ('ROLE-FIN-APPR', 'PERM-JE-APPROVE'),
    ('ROLE-FIN-APPR', 'PERM-SCO-VIEW'),
    ('ROLE-FIN-APPR', 'PERM-SCO-APPROVE')
ON CONFLICT DO NOTHING;

-- Workflow definitions for money modules
-- Helper pattern per module: Step 1 ($0–$10,000) / EXEC ($10,000.01+)

-- SALES_ORDER
INSERT INTO workflow_definition (id, module, min_amount, max_amount, is_active, name) VALUES
    ('WF-SO-MGR', 'SALES_ORDER', 0, 10000, TRUE, 'SO Manager Approval'),
    ('WF-SO-EXEC', 'SALES_ORDER', 10000.01, NULL, TRUE, 'SO Executive Approval')
ON CONFLICT DO NOTHING;

INSERT INTO workflow_step (id, workflow_definition_id, step_number, step_name, required_role_id) VALUES
    ('WF-SO-MGR-1', 'WF-SO-MGR', 1, 'Manager Approval', 'ROLE-SALES-MGR'),
    ('WF-SO-EXEC-1', 'WF-SO-EXEC', 1, 'Manager Approval', 'ROLE-SALES-MGR'),
    ('WF-SO-EXEC-2', 'WF-SO-EXEC', 2, 'Finance Approval', 'ROLE-FIN-APPR')
ON CONFLICT DO NOTHING;

-- PURCHASE_ORDER
INSERT INTO workflow_definition (id, module, min_amount, max_amount, is_active, name) VALUES
    ('WF-PO-MGR', 'PURCHASE_ORDER', 0, 10000, TRUE, 'PO Manager Approval'),
    ('WF-PO-EXEC', 'PURCHASE_ORDER', 10000.01, NULL, TRUE, 'PO Executive Approval')
ON CONFLICT DO NOTHING;

INSERT INTO workflow_step (id, workflow_definition_id, step_number, step_name, required_role_id) VALUES
    ('WF-PO-MGR-1', 'WF-PO-MGR', 1, 'Manager Approval', 'ROLE-PURCH-MGR'),
    ('WF-PO-EXEC-1', 'WF-PO-EXEC', 1, 'Manager Approval', 'ROLE-PURCH-MGR'),
    ('WF-PO-EXEC-2', 'WF-PO-EXEC', 2, 'Finance Approval', 'ROLE-FIN-APPR')
ON CONFLICT DO NOTHING;

-- SUBCONTRACT_ORDER
INSERT INTO workflow_definition (id, module, min_amount, max_amount, is_active, name) VALUES
    ('WF-SCO-STD', 'SUBCONTRACT_ORDER', 0, 10000, TRUE, 'SCO Supervisor Approval'),
    ('WF-SCO-EXEC', 'SUBCONTRACT_ORDER', 10000.01, NULL, TRUE, 'SCO Executive Approval')
ON CONFLICT DO NOTHING;

INSERT INTO workflow_step (id, workflow_definition_id, step_number, step_name, required_role_id) VALUES
    ('WF-SCO-STD-1', 'WF-SCO-STD', 1, 'Supervisor Approval', 'ROLE-SCO-SUP'),
    ('WF-SCO-EXEC-1', 'WF-SCO-EXEC', 1, 'Supervisor Approval', 'ROLE-SCO-SUP'),
    ('WF-SCO-EXEC-2', 'WF-SCO-EXEC', 2, 'Finance Approval', 'ROLE-FIN-APPR')
ON CONFLICT DO NOTHING;

-- AR_INVOICE
INSERT INTO workflow_definition (id, module, min_amount, max_amount, is_active, name) VALUES
    ('WF-AR-MGR', 'AR_INVOICE', 0, 10000, TRUE, 'AR Manager Approval'),
    ('WF-AR-EXEC', 'AR_INVOICE', 10000.01, NULL, TRUE, 'AR Executive Approval')
ON CONFLICT DO NOTHING;

INSERT INTO workflow_step (id, workflow_definition_id, step_number, step_name, required_role_id) VALUES
    ('WF-AR-MGR-1', 'WF-AR-MGR', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-AR-EXEC-1', 'WF-AR-EXEC', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-AR-EXEC-2', 'WF-AR-EXEC', 2, 'Executive Finance Approval', 'ROLE-FIN-APPR')
ON CONFLICT DO NOTHING;

-- AP_BILL
INSERT INTO workflow_definition (id, module, min_amount, max_amount, is_active, name) VALUES
    ('WF-AP-MGR', 'AP_BILL', 0, 10000, TRUE, 'AP Manager Approval'),
    ('WF-AP-EXEC', 'AP_BILL', 10000.01, NULL, TRUE, 'AP Executive Approval')
ON CONFLICT DO NOTHING;

INSERT INTO workflow_step (id, workflow_definition_id, step_number, step_name, required_role_id) VALUES
    ('WF-AP-MGR-1', 'WF-AP-MGR', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-AP-EXEC-1', 'WF-AP-EXEC', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-AP-EXEC-2', 'WF-AP-EXEC', 2, 'Executive Finance Approval', 'ROLE-FIN-APPR')
ON CONFLICT DO NOTHING;

-- CASH_TRANSACTION
INSERT INTO workflow_definition (id, module, min_amount, max_amount, is_active, name) VALUES
    ('WF-CASH-MGR', 'CASH_TRANSACTION', 0, 10000, TRUE, 'Cash Manager Approval'),
    ('WF-CASH-EXEC', 'CASH_TRANSACTION', 10000.01, NULL, TRUE, 'Cash Executive Approval')
ON CONFLICT DO NOTHING;

INSERT INTO workflow_step (id, workflow_definition_id, step_number, step_name, required_role_id) VALUES
    ('WF-CASH-MGR-1', 'WF-CASH-MGR', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-CASH-EXEC-1', 'WF-CASH-EXEC', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-CASH-EXEC-2', 'WF-CASH-EXEC', 2, 'Executive Finance Approval', 'ROLE-FIN-APPR')
ON CONFLICT DO NOTHING;

-- JOURNAL_ENTRY
INSERT INTO workflow_definition (id, module, min_amount, max_amount, is_active, name) VALUES
    ('WF-JE-MGR', 'JOURNAL_ENTRY', 0, 10000, TRUE, 'JE Manager Approval'),
    ('WF-JE-EXEC', 'JOURNAL_ENTRY', 10000.01, NULL, TRUE, 'JE Executive Approval')
ON CONFLICT DO NOTHING;

INSERT INTO workflow_step (id, workflow_definition_id, step_number, step_name, required_role_id) VALUES
    ('WF-JE-MGR-1', 'WF-JE-MGR', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-JE-EXEC-1', 'WF-JE-EXEC', 1, 'Finance Approval', 'ROLE-FIN-APPR'),
    ('WF-JE-EXEC-2', 'WF-JE-EXEC', 2, 'Executive Finance Approval', 'ROLE-FIN-APPR')
ON CONFLICT DO NOTHING;
