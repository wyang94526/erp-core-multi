-- ========================================================
-- APPROVAL WORKFLOW / RBAC
-- Runs after 01-schema.sql on fresh DB init.
-- ========================================================

DROP TABLE IF EXISTS approval_history CASCADE;
DROP TABLE IF EXISTS approval_rules CASCADE;

-- Roles must exist before users.role_id FK; recreate roles then alter users.
DROP TABLE IF EXISTS roles CASCADE;

CREATE TABLE roles (
    role_id VARCHAR(50) PRIMARY KEY,
    role_name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed core roles (idempotent via insert in seed_db; here for FK readiness)
INSERT INTO roles (role_id, role_name, description) VALUES
    ('ROLE-ADMIN', 'Admin', 'Full approval rights across all modules'),
    ('ROLE-MANAGER', 'Manager', 'Approve up to configured thresholds'),
    ('ROLE-CLERK', 'Clerk', 'Create and submit documents for approval')
ON CONFLICT DO NOTHING;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role_id VARCHAR(50) REFERENCES roles(role_id);

CREATE TABLE approval_rules (
    rule_id VARCHAR(50) PRIMARY KEY,
    module VARCHAR(50) NOT NULL,
    role_id VARCHAR(50) NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    max_amount_limit NUMERIC(14, 2),           -- NULL = unlimited
    can_submit BOOLEAN NOT NULL DEFAULT TRUE,
    can_approve BOOLEAN NOT NULL DEFAULT FALSE,
    requires_secondary_approval BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_approval_rule_module_role UNIQUE (module, role_id)
);

CREATE TABLE approval_history (
    id BIGSERIAL PRIMARY KEY,
    document_type VARCHAR(50) NOT NULL,       -- sales-orders, purchase-orders, ...
    document_id VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,               -- SUBMIT | APPROVE | DECLINE
    performed_by_user_id UUID REFERENCES users(id),
    comments TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT chk_approval_history_action CHECK (
        action IN ('SUBMIT', 'APPROVE', 'DECLINE')
    )
);

CREATE INDEX idx_approval_history_document
    ON approval_history (document_type, document_id);

-- Shared approval lifecycle column on domain documents
-- DRAFT -> PENDING_APPROVAL -> APPROVED | REJECTED | CANCELLED

ALTER TABLE salesorders
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE purchaseorders
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE subcontractorders
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE ar_invoices
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE ap_bills
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE cash_transactions
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT';
