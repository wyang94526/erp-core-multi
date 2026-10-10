-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================================
-- 1. BASE TABLES (No Foreign Key Dependencies)
-- ========================================================

DROP TABLE IF EXISTS users CASCADE;
-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    security_question VARCHAR(255),
    security_answer_hash VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DROP TABLE IF EXISTS security_question_options CASCADE;
CREATE TABLE IF NOT EXISTS security_question_options (
    id SERIAL PRIMARY KEY,
    question_text VARCHAR(255) UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO security_question_options (sort_order, question_text) VALUES
  (10, 'What is your favorite color?'),
  (20, 'What is your mother''s surname?'),
  (30, 'What is your favorite place visited?'),
  (40, 'What was the name of your first pet?'),
  (50, 'In what city were you born?'),
  (60, 'What was the make of your first car?'),
  (70, 'What is the name of the street you grew up on?'),
  (80, 'What was your childhood nickname?')
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS chart_of_accounts CASCADE;
-- Chart of Accounts
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_code VARCHAR(50) UNIQUE NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50) NOT NULL, -- Asset, Liability, Equity, Revenue, Expense
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
INSERT INTO chart_of_accounts (account_code, account_name, account_type)
VALUES ('1103', 'Cash in Banks', 'Asset')
ON CONFLICT (account_code) DO NOTHING;

DROP TABLE IF EXISTS gl_account_balances CASCADE;
CREATE TABLE IF NOT EXISTS gl_account_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period VARCHAR(7) NOT NULL,
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
    ending_debit NUMERIC(15, 4) NOT NULL DEFAULT 0,
    ending_credit NUMERIC(15, 4) NOT NULL DEFAULT 0,
    ending_balance NUMERIC(15, 4) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    source_file VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_gl_account_balance_period_account UNIQUE (period, account_id, currency)
);

DROP TABLE IF EXISTS financial_budgets CASCADE;
CREATE TABLE IF NOT EXISTS financial_budgets (
    id UUID PRIMARY KEY,
    fiscal_year INTEGER NOT NULL,
    period VARCHAR(7) NOT NULL DEFAULT '',
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
    amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_financial_budget_period_account UNIQUE (fiscal_year, period, account_id, currency)
);

DROP TABLE IF EXISTS payment_terms CASCADE;
CREATE TABLE IF NOT EXISTS payment_terms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    description VARCHAR(255) NOT NULL,
    due_days INTEGER NOT NULL DEFAULT 30,
    discount_days INTEGER,
    discount_percentage NUMERIC(5, 2),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT chk_payment_terms_due_days CHECK (due_days >= 0),
    CONSTRAINT chk_payment_terms_discount_days CHECK (discount_days IS NULL OR discount_days >= 0),
    CONSTRAINT chk_payment_terms_discount_pct CHECK (
        discount_percentage IS NULL OR (discount_percentage >= 0 AND discount_percentage <= 100)
    )
);
INSERT INTO payment_terms (code, description, due_days, is_active) VALUES
    ('NET15', 'Net 15 Days', 15, TRUE),
    ('NET30', 'Net 30 Days', 30, TRUE),
    ('NET60', 'Net 60 Days', 60, TRUE),
    ('NET90', 'Net 90 Days', 90, TRUE),
    ('DUE_ON_RECEIPT', 'Due on Receipt', 0, TRUE),
    ('P02', 'Payment on 2nd of following month', 32, TRUE),
    ('P10', 'Payment on 10th of following month', 40, TRUE),
    ('ADVANCE', 'Advance Payment', 0, TRUE)
ON CONFLICT (code) DO NOTHING;

-- (legacy stub products table removed; item master is `items` below)

DROP TABLE IF EXISTS audit_logs CASCADE;
-- Centralized System-Wide Audit Log
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(10) NOT NULL, -- INSERT, UPDATE, DELETE
    old_data JSONB,
    new_data JSONB,
    user_id UUID,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


DROP TABLE IF EXISTS journal_entries CASCADE;
-- Double-Entry Journal Entries
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    description TEXT NOT NULL,
    posted_by_user_id UUID REFERENCES users(id),
    -- Finance module additions: accounting period (YYYY-MM) and posting workflow status
    period VARCHAR(7),
    posting_date DATE,
    reference VARCHAR(100),
    posting_status VARCHAR(20) NOT NULL DEFAULT 'Posted'
);


DROP TABLE IF EXISTS ledger_postings CASCADE;
-- Ledger Postings (Debits and Credits must balance to 0)
CREATE TABLE IF NOT EXISTS ledger_postings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    account_id UUID REFERENCES chart_of_accounts(id),
    debit NUMERIC(15, 4) DEFAULT 0.0000,
    credit NUMERIC(15, 4) DEFAULT 0.0000,
    currency VARCHAR(3) DEFAULT 'USD',
    description TEXT,
    CONSTRAINT check_balanced_line CHECK (
        (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
    )
);

-- ========================================================
-- 3. CRM, SALES, & PROCUREMENT TABLES
-- ========================================================

DROP TABLE IF EXISTS Suppliers CASCADE;
DROP TABLE IF EXISTS work_centers CASCADE;
CREATE TABLE work_centers (
    work_center_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    warehouse_id VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO work_centers (work_center_id, name, is_active) VALUES
    ('WC-OUTSIDE-01', 'Outside Processing', TRUE),
    ('WC-PLATING-01', 'Plating / Finishing', TRUE);

-- New: Suppliers / Vendors Table
CREATE TABLE Suppliers (
    supplier_id VARCHAR(50) PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(100),
    contact_email VARCHAR(255),
    phone_number VARCHAR(50),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    postal_code VARCHAR(20),
    country VARCHAR(50),
    vendor_number_ext VARCHAR(50),
    payment_terms VARCHAR(50) DEFAULT 'Net 30',
    payment_term_id UUID REFERENCES payment_terms(id),
    status VARCHAR(20) DEFAULT 'Active',
    vendor_type VARCHAR(20) NOT NULL DEFAULT 'material',
    tax_id VARCHAR(50),
    tax_document_type VARCHAR(64),
    is_overseas BOOLEAN NOT NULL DEFAULT FALSE,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    ap_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
    payment_method VARCHAR(20),
    incoterms VARCHAR(10),
    incoterm_location VARCHAR(150),
    country_of_origin VARCHAR(50),
    bank_name VARCHAR(150),
    swift_code VARCHAR(11),
    iban_account_number VARCHAR(64),
    bank_address TEXT,
    intermediary_bank_name VARCHAR(150),
    intermediary_swift_code VARCHAR(11),
    intermediary_routing_aba VARCHAR(20),
    lead_time_days INTEGER NOT NULL DEFAULT 0,
    work_center_id VARCHAR(50) REFERENCES work_centers(work_center_id) ON DELETE SET NULL,
    consignment_stock_loc_id VARCHAR(50),
    standard_scrap_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    iso_certified BOOLEAN NOT NULL DEFAULT FALSE,
    qc_status VARCHAR(20) NOT NULL DEFAULT 'approved',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_supplier_vendor_type CHECK (vendor_type IN ('material', 'subcontractor', 'both', 'service')),
    CONSTRAINT chk_supplier_payment_method CHECK (payment_method IS NULL OR payment_method IN ('wire', 'ach', 'check', 'credit_card')),
    CONSTRAINT chk_supplier_qc_status CHECK (qc_status IN ('approved', 'probation', 'blocked')),
    CONSTRAINT chk_supplier_tax_document_type CHECK (
        tax_document_type IS NULL OR tax_document_type IN
        ('W-8BEN-E', 'W-8BEN', 'Certificate of Foreign Status', 'Other', 'W-9')
    )
);

DROP TABLE IF EXISTS customer_certifications CASCADE;
DROP TABLE IF EXISTS Customers CASCADE;
-- 1. Customers (manufacturing / commercial master)
CREATE TABLE Customers (
    customer_id VARCHAR(50) PRIMARY KEY,       -- e.g., 'CUST-DENSO-001'
    customer_number_ext VARCHAR(50),           -- DENSO's Supplier No: '20001668172'
    company_name VARCHAR(255) NOT NULL,        -- 'DENSO Products and Services...'
    tax_id_type VARCHAR(16),                   -- EIN, TIN, VAT, SSN, OTHER
    tax_id VARCHAR(64),
    industry_type VARCHAR(100),                -- Automotive, Electronics, Industrial
    facility_type VARCHAR(100),                -- OEM, Tier-1, Contract Manufacturer
    website VARCHAR(255),
    primary_contact_name VARCHAR(255),
    primary_email VARCHAR(255),
    primary_phone VARCHAR(50),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    credit_limit DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    payment_terms VARCHAR(50),                 -- NET30, NET60, ADVANCE
    payment_term_id UUID REFERENCES payment_terms(id),
    preferred_incoterms VARCHAR(10),           -- FOB, CIF, EXW, DDP
    tax_exempt BOOLEAN NOT NULL DEFAULT FALSE,
    tax_exempt_certificate_id VARCHAR(100),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_customers_tax_id_type CHECK (tax_id_type IS NULL OR tax_id_type IN ('EIN', 'TIN', 'VAT', 'SSN', 'OTHER'))
);
CREATE INDEX ix_customers_tax_id ON Customers (tax_id);
CREATE INDEX ix_customers_primary_email ON Customers (primary_email);


DROP TABLE IF EXISTS CustomerLocations CASCADE;

-- 2. Unified Customer Locations (Billing & Shipping)
-- Physical table name stays CustomerLocations (customerlocations) so existing
-- sales-order FKs remain valid. This is the manufacturing Bill-To / Ship-To child.
CREATE TABLE CustomerLocations (
    location_id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) REFERENCES Customers(customer_id) ON DELETE CASCADE,
    location_type VARCHAR(20) NOT NULL,        -- 'BILL_TO', 'SHIP_TO', or 'BOTH'
    location_code VARCHAR(50),                 -- e.g., 'HQ-BILLING', 'PLANT-01'
    location_name VARCHAR(150) NOT NULL,       -- e.g., 'Austin Assembly Plant'
    attention_to VARCHAR(100),                 -- e.g., 'Accounts Payable' or 'Receiving Dept'
    address_line1 VARCHAR(255) NOT NULL,
    address_line2 VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100),                        -- state / province (API: state_province)
    postal_code VARCHAR(32) NOT NULL,
    country VARCHAR(50) NOT NULL,
    contact_person VARCHAR(150),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    tax_id VARCHAR(64),                        -- entity-specific billing / VAT
    shipping_instructions TEXT,                -- dock notes, receiving hours
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT chk_location_type CHECK (location_type IN ('BILL_TO', 'SHIP_TO', 'BOTH'))
);
CREATE INDEX ix_customerlocations_customer_id ON CustomerLocations (customer_id);


CREATE TABLE customer_certifications (
    id BIGSERIAL PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL REFERENCES Customers(customer_id) ON DELETE CASCADE,
    certification_name VARCHAR(100) NOT NULL,  -- ISO 9001, IATF 16949, ISO 14001
    certificate_number VARCHAR(100),
    valid_until DATE
);
CREATE INDEX ix_customer_certifications_customer_id ON customer_certifications (customer_id);


DROP TABLE IF EXISTS items CASCADE;
-- 4. Item Master (catalog)
CREATE TABLE items (
    item_id VARCHAR(50) PRIMARY KEY,           -- Internal SKU / Item ID
    customer_part_number VARCHAR(50) NOT NULL, -- DENSO Part No: 'LAY95172-0780'
    description TEXT,                          
    uom VARCHAR(20) DEFAULT 'Each',
    unit_price NUMERIC(12, 2),
    on_hand_quantity INT DEFAULT 0,            -- Quantity physically in stock (raw material or finished good)
    wip_quantity INT DEFAULT 0,                -- Quantity currently out at a subcontractor (work-in-progress)
    item_type VARCHAR(20) NOT NULL DEFAULT 'INVENTORY', -- INVENTORY | NON_INVENTORY | SERVICE
    is_outside_processed BOOLEAN NOT NULL DEFAULT FALSE, -- Legacy: 3rd-party/outside processed assemblies
    is_purchase_item BOOLEAN NOT NULL DEFAULT FALSE,      -- Available on Purchase Orders
    is_subcontract_assembly BOOLEAN NOT NULL DEFAULT FALSE, -- Finished/semi FG built via subcontract
    is_raw_material BOOLEAN NOT NULL DEFAULT FALSE,        -- Purchased/raw component stock
    CONSTRAINT chk_items_item_type CHECK (item_type IN ('INVENTORY', 'NON_INVENTORY', 'SERVICE'))
);

INSERT INTO items (item_id, customer_part_number, description, uom, item_type, is_purchase_item)
VALUES
    ('MISC', 'MISC', 'Miscellaneous charge', 'SVC', 'SERVICE', TRUE),
    ('FREIGHT', 'FREIGHT', 'Freight / shipping charge', 'SVC', 'SERVICE', TRUE)
ON CONFLICT (item_id) DO NOTHING;



-- 5. Sales Orders Header
CREATE TABLE SalesOrders (
    sales_order_id VARCHAR(50) PRIMARY KEY,   -- Internal SO #
    customer_id VARCHAR(50) REFERENCES Customers(customer_id),
    
    -- Updated Foreign Keys mapping to the unified CustomerLocations table
    bill_to_location_id VARCHAR(50) REFERENCES CustomerLocations(location_id),
    ship_to_location_id VARCHAR(50) REFERENCES CustomerLocations(location_id),
    
    customer_po_number VARCHAR(50) NOT NULL,   
    po_revision_number INT DEFAULT 0,          
    order_date DATE NOT NULL,
    customer_revision_date DATE, 
    
    -- Commercial & Freight Terms
    payment_terms VARCHAR(50),
    payment_term_id UUID REFERENCES payment_terms(id),
    freight_terms VARCHAR(50),                 
    shipping_method VARCHAR(50),               
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Customer Contact Info
    buyer_contact_name VARCHAR(100),           
    buyer_contact_email VARCHAR(150),          
    
    -- Status & Financial Tracking
    status VARCHAR(30) DEFAULT 'DRAFT',     -- 'DRAFT', 'RECEIVED', 'APPROVED', 'CANCELLED', etc.
    total_amount DECIMAL(12, 2) NOT NULL,      
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


DROP TABLE IF EXISTS SalesOrderItems CASCADE;
-- 6. Sales Order Line Items
CREATE TABLE SalesOrderItems (
    so_item_id BIGSERIAL PRIMARY KEY,
    sales_order_id VARCHAR(50) REFERENCES SalesOrders(sales_order_id) ON DELETE CASCADE,
    line_number INT NOT NULL,                  
    item_id VARCHAR(50) REFERENCES items(item_id),
    customer_part_number VARCHAR(50),
    
    quantity_ordered INT NOT NULL,             
    unit_price DECIMAL(10, 4) NOT NULL,        
    tax_amount DECIMAL(10, 2) DEFAULT 0.00,    
    total_amount DECIMAL(12, 2) NOT NULL,      
    
    CONSTRAINT unique_line_per_so UNIQUE (sales_order_id, line_number)
);

DROP TABLE IF EXISTS SalesOrderDeliverySchedules CASCADE;
-- Split customer deliveries for one sales-order line
CREATE TABLE SalesOrderDeliverySchedules (
    schedule_id BIGSERIAL PRIMARY KEY,
    so_item_id BIGINT NOT NULL REFERENCES SalesOrderItems(so_item_id) ON DELETE CASCADE,
    sub_line_number VARCHAR(10),
    ship_to_location_id VARCHAR(50) REFERENCES CustomerLocations(location_id),
    scheduled_quantity INT NOT NULL,
    needed_delivery_date TIMESTAMP NOT NULL,
    promised_ship_date TIMESTAMP,
    requester_name VARCHAR(100),
    tax_flag CHAR(1) DEFAULT 'N',
    status VARCHAR(30) DEFAULT 'PENDING'
);

-- ========================================================
-- 4. SUBCONTRACTING / OUTSIDE PROCESSING TABLES
-- ========================================================

DROP TABLE IF EXISTS itembomcomponents CASCADE;
DROP TABLE IF EXISTS itembomheaders CASCADE;
-- 7. Versioned Bill of Materials: header per revision, lines per version
CREATE TABLE itembomheaders (
    bom_header_id BIGSERIAL PRIMARY KEY,
    parent_item_id VARCHAR(50) NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    version_no INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- draft, active, obsolete
    effective_from DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_item_bom_version UNIQUE (parent_item_id, version_no),
    CONSTRAINT chk_bom_header_status CHECK (status IN ('draft', 'active', 'obsolete')),
    CONSTRAINT chk_bom_header_version_pos CHECK (version_no > 0)
);
CREATE UNIQUE INDEX uq_one_active_bom_per_item ON itembomheaders (parent_item_id) WHERE status = 'active';

CREATE TABLE itembomcomponents (
    bom_id BIGSERIAL PRIMARY KEY,
    bom_header_id BIGINT NOT NULL REFERENCES itembomheaders(bom_header_id) ON DELETE CASCADE,
    parent_item_id VARCHAR(50) NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    component_item_id VARCHAR(50) REFERENCES items(item_id),   -- Set for 'Material' rows only
    component_code VARCHAR(50),                        -- Set for 'Labor' / 'Outside Service' rows only (predefined codes, not real Items)
    quantity_per NUMERIC(12, 4) NOT NULL DEFAULT 1,   -- Qty of component required per 1 unit of parent
    item_type VARCHAR(30) NOT NULL DEFAULT 'Material', -- 'Material', 'Labor', or 'Outside Service'
    scrap_factor NUMERIC(8, 4) NOT NULL DEFAULT 0,     -- Extra material allowance (0.05 = +5%)
    yield_loss_percentage NUMERIC(8, 4) NOT NULL DEFAULT 0, -- Expected yield loss %
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_bom_line UNIQUE (bom_header_id, component_item_id, component_code),
    CONSTRAINT chk_bom_not_self_referencing CHECK (parent_item_id <> component_item_id),
    CONSTRAINT chk_bom_component_ref CHECK (
        (item_type = 'Material' AND component_item_id IS NOT NULL AND component_code IS NULL) OR
        (item_type IN ('Labor', 'Outside Service') AND component_code IS NOT NULL AND component_item_id IS NULL)
    )
);

DROP TABLE IF EXISTS VendorItemMappings CASCADE;
-- Vendor catalog: which suppliers sell which purchase items, and at what cost/terms
CREATE TABLE VendorItemMappings (
    mapping_id BIGSERIAL PRIMARY KEY,
    supplier_id VARCHAR(50) NOT NULL REFERENCES Suppliers(supplier_id),
    item_id VARCHAR(50) NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    vendor_sku VARCHAR(100),
    unit_cost NUMERIC(12, 4),
    minimum_order_qty NUMERIC(12, 4) NOT NULL DEFAULT 1,
    lead_time_days INT NOT NULL DEFAULT 0,
    is_primary_vendor BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_vendor_item_mapping UNIQUE (supplier_id, item_id)
);



DROP TABLE IF EXISTS SubcontractOrders CASCADE;
-- 8. Subcontract Order (SCO) Header — sending a finished/semi-finished product out for outside processing
CREATE TABLE SubcontractOrders (
    sco_number VARCHAR(50) PRIMARY KEY,
    supplier_id VARCHAR(50) NOT NULL REFERENCES Suppliers(supplier_id),
    sales_order_id VARCHAR(50) REFERENCES salesorders(sales_order_id),
    item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),  -- First / shim finished good
    bom_header_id BIGINT REFERENCES itembomheaders(bom_header_id) ON DELETE SET NULL,

    quantity_ordered INT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',  -- PLANNED, MATERIALS_ISSUED, PARTIALLY_RECEIVED, COMPLETED, CANCELLED

    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_return_date DATE,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS SubcontractOrderComponents CASCADE;
-- 9. Subcontract Order Components — auto-populated from the BOM at SCO creation time
DROP TABLE IF EXISTS SubcontractOrderItems CASCADE;
CREATE TABLE SubcontractOrderItems (
    sco_line_id BIGSERIAL PRIMARY KEY,
    sco_number VARCHAR(50) NOT NULL REFERENCES SubcontractOrders(sco_number) ON DELETE CASCADE,
    line_number INT NOT NULL,
    so_item_id BIGINT REFERENCES salesorderitems(so_item_id),
    item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),
    bom_header_id BIGINT REFERENCES itembomheaders(bom_header_id) ON DELETE SET NULL,
    quantity_ordered INT NOT NULL CHECK (quantity_ordered > 0),
    unit_price NUMERIC(12, 4) NOT NULL DEFAULT 0,
    margin_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
    margin_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    cost_subtotal NUMERIC(12, 4) NOT NULL DEFAULT 0,
    tax_exempt BOOLEAN NOT NULL DEFAULT TRUE,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    line_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    CONSTRAINT uq_sco_line_number UNIQUE (sco_number, line_number)
);
CREATE UNIQUE INDEX uq_sco_line_so_item ON SubcontractOrderItems (sco_number, so_item_id) WHERE so_item_id IS NOT NULL;

DROP TABLE IF EXISTS SubcontractOrderLineCharges CASCADE;
CREATE TABLE SubcontractOrderLineCharges (
    sco_charge_id BIGSERIAL PRIMARY KEY,
    sco_line_id BIGINT NOT NULL REFERENCES SubcontractOrderItems(sco_line_id) ON DELETE CASCADE,
    line_no INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    detail_explanation TEXT,
    labor_minutes NUMERIC(8, 2),
    sf_rate NUMERIC(12, 4),
    cost_per_unit NUMERIC(12, 4) NOT NULL DEFAULT 0,
    margin_percent NUMERIC(8, 4),
    is_margin BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_sco_charge_line_no UNIQUE (sco_line_id, line_no)
);

CREATE TABLE SubcontractOrderComponents (
    sco_component_id BIGSERIAL PRIMARY KEY,
    sco_number VARCHAR(50) NOT NULL REFERENCES SubcontractOrders(sco_number) ON DELETE CASCADE,
    sco_line_id BIGINT NOT NULL REFERENCES SubcontractOrderItems(sco_line_id) ON DELETE CASCADE,
    component_item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),

    quantity_required NUMERIC(12, 4) NOT NULL,
    quantity_required_bom NUMERIC(12, 4),
    quantity_issued NUMERIC(12, 4) NOT NULL DEFAULT 0,
    is_overridden BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,

    CONSTRAINT unique_component_per_sco_line UNIQUE (sco_line_id, component_item_id)
);

DROP TABLE IF EXISTS MaterialIssues CASCADE;
-- 10. Material Issues — header record for a shipment of raw materials sent to a subcontractor
CREATE TABLE MaterialIssues (
    issue_id VARCHAR(50) PRIMARY KEY,
    sco_number VARCHAR(50) NOT NULL REFERENCES SubcontractOrders(sco_number),
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS MaterialIssueLines CASCADE;
-- 11. Material Issue Lines — deducts on_hand_quantity, increments wip_quantity for each component issued
CREATE TABLE MaterialIssueLines (
    issue_line_id BIGSERIAL PRIMARY KEY,
    issue_id VARCHAR(50) NOT NULL REFERENCES MaterialIssues(issue_id) ON DELETE CASCADE,
    sco_line_id BIGINT REFERENCES SubcontractOrderItems(sco_line_id) ON DELETE SET NULL,
    component_item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),
    quantity_issued NUMERIC(12, 4) NOT NULL CHECK (quantity_issued > 0)
);

DROP TABLE IF EXISTS ComponentIssueLogs CASCADE;
-- Durable audit log of components issued to subcontractors (mirrors MaterialIssueLines + SCO context)
CREATE TABLE ComponentIssueLogs (
    log_id BIGSERIAL PRIMARY KEY,
    sco_number VARCHAR(50) NOT NULL REFERENCES SubcontractOrders(sco_number),
    sco_line_id BIGINT REFERENCES SubcontractOrderItems(sco_line_id) ON DELETE SET NULL,
    issue_id VARCHAR(50) NOT NULL REFERENCES MaterialIssues(issue_id) ON DELETE CASCADE,
    component_item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),
    quantity_issued NUMERIC(12, 4) NOT NULL CHECK (quantity_issued > 0),
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

DROP TABLE IF EXISTS FinishedGoodsReceipts CASCADE;
-- 12. Finished Goods Receipts — deducts wip_quantity, increments on_hand_quantity of the finished product
CREATE TABLE FinishedGoodsReceipts (
    receipt_id VARCHAR(50) PRIMARY KEY,
    sco_number VARCHAR(50) NOT NULL REFERENCES SubcontractOrders(sco_number),
    sco_line_id BIGINT REFERENCES SubcontractOrderItems(sco_line_id) ON DELETE SET NULL,
    quantity_received INT NOT NULL CHECK (quantity_received > 0),
    receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================================
-- 5. PROCUREMENT: PURCHASE ORDERS
-- ========================================================

DROP TABLE IF EXISTS PurchaseOrders CASCADE;
-- 13. Purchase Order Header — an order placed with a Supplier/Vendor
CREATE TABLE PurchaseOrders (
    po_number VARCHAR(50) PRIMARY KEY,
    supplier_id VARCHAR(50) NOT NULL REFERENCES Suppliers(supplier_id),
    po_type VARCHAR(20) NOT NULL DEFAULT 'MATERIAL',
    bom_header_id BIGINT REFERENCES itembomheaders(bom_header_id),
    sco_number VARCHAR(50) REFERENCES subcontractorders(sco_number),

    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    payment_terms VARCHAR(50) DEFAULT 'Net 30',
    payment_term_id UUID REFERENCES payment_terms(id),
    status VARCHAR(20) NOT NULL DEFAULT 'Draft', -- 'Draft', 'Submitted', 'Approved', 'Void'

    shipping_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
    discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage', -- 'percentage' or 'fixed'
    discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
    incoterms VARCHAR(10),
    freight_terms VARCHAR(30) NOT NULL DEFAULT 'PREPAID_ON_PO',
    carrier_account VARCHAR(50),

    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_po_status CHECK (status IN ('Draft', 'Submitted', 'Approved', 'Void')),
    CONSTRAINT chk_po_discount_type CHECK (discount_type IN ('percentage', 'fixed')),
    CONSTRAINT chk_po_type CHECK (po_type IN ('MATERIAL', 'SUBCONTRACT')),
    CONSTRAINT chk_po_freight_terms CHECK (
        freight_terms IN ('PREPAID_ON_PO', 'THIRD_PARTY_COLLECT', 'ROUTING_ACCOUNT')
    )
);

DROP TABLE IF EXISTS PurchaseOrderItems CASCADE;
-- 14. Purchase Order Line Items
CREATE TABLE PurchaseOrderItems (
    item_id BIGSERIAL PRIMARY KEY,
    po_number VARCHAR(50) NOT NULL REFERENCES PurchaseOrders(po_number) ON DELETE CASCADE,

    sku VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    uom VARCHAR(20),
    bom_header_id BIGINT REFERENCES itembomheaders(bom_header_id),
    sco_component_id BIGINT REFERENCES subcontractordercomponents(sco_component_id) ON DELETE SET NULL,
    quantity NUMERIC(12, 4) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 4) NOT NULL DEFAULT 0,
    tax_rate NUMERIC(6, 3) NOT NULL DEFAULT 0,

    line_subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    line_tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
    line_total NUMERIC(12, 2) NOT NULL DEFAULT 0
);

-- ========================================================
-- 6. FINANCE MODULE: ACCOUNTS RECEIVABLE / PAYABLE / CASH
-- ========================================================

DROP TABLE IF EXISTS ar_invoices CASCADE;
-- 15. Accounts Receivable Invoice — auto-generated when a Sales Order is Approved
CREATE TABLE ar_invoices (
    invoice_id VARCHAR(50) PRIMARY KEY,
    sales_order_id VARCHAR(50) NOT NULL REFERENCES SalesOrders(sales_order_id),
    customer_id VARCHAR(50) NOT NULL REFERENCES Customers(customer_id),

    amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Unpaid', -- Unpaid, Partial, Paid
    due_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_ar_invoice_status CHECK (status IN ('Unpaid', 'Partial', 'Paid'))
);

DROP TABLE IF EXISTS ap_bills CASCADE;
-- 16. Accounts Payable Bill — auto-generated when a Purchase Order is Approved
CREATE TABLE ap_bills (
    bill_id VARCHAR(50) PRIMARY KEY,
    purchase_order_id VARCHAR(50) NOT NULL REFERENCES PurchaseOrders(po_number),
    vendor_id VARCHAR(50) NOT NULL REFERENCES Suppliers(supplier_id),

    amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Unpaid', -- Unpaid, Partial, Paid
    due_date DATE NOT NULL,
    payment_term_id UUID REFERENCES payment_terms(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_ap_bill_status CHECK (status IN ('Unpaid', 'Partial', 'Paid'))
);

DROP TABLE IF EXISTS cash_transactions CASCADE;
DROP TABLE IF EXISTS bank_accounts CASCADE;

CREATE TABLE bank_accounts (
    bank_account_id VARCHAR(50) PRIMARY KEY,
    bank_name VARCHAR(150) NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(34) NOT NULL,
    routing_number VARCHAR(34),
    account_type VARCHAR(20) NOT NULL DEFAULT 'CHECKING',
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    gl_account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_bank_account_type CHECK (
        account_type IN ('CHECKING', 'SAVINGS', 'MONEY_MARKET', 'OTHER')
    ),
    CONSTRAINT chk_bank_account_currency CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX uq_bank_accounts_one_default
    ON bank_accounts (is_default)
    WHERE is_default = TRUE;
CREATE INDEX ix_bank_accounts_gl_account_id ON bank_accounts (gl_account_id);

INSERT INTO bank_accounts (
    bank_account_id, bank_name, account_name, account_number, routing_number,
    account_type, currency, gl_account_id, is_default, is_active
) VALUES
    ('BANK-OPERATING', 'Amerant Bank', 'Operating', '0000008420', '067000123',
     'CHECKING', 'USD', (SELECT id FROM chart_of_accounts WHERE account_code = '1103'), TRUE, TRUE),
    ('BANK-PAYROLL', 'Amerant Bank', 'Payroll', '0000003198', '067000123',
     'CHECKING', 'USD', (SELECT id FROM chart_of_accounts WHERE account_code = '1103'), FALSE, TRUE),
    ('BANK-RESERVE', 'First Citizens Bank', 'Reserve', '0000007701', '053100300',
     'SAVINGS', 'USD', (SELECT id FROM chart_of_accounts WHERE account_code = '1103'), FALSE, TRUE);

-- 17. Cash Management Ledger — records Check Issue (AP payment) / Check Deposit (AR payment)
CREATE TABLE cash_transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(20) NOT NULL, -- 'Check Issue' or 'Check Deposit'
    reference_id VARCHAR(50) NOT NULL, -- AR Invoice ID or AP Bill ID (polymorphic, no strict FK)
    amount NUMERIC(12, 2) NOT NULL,
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    bank_account_id VARCHAR(50) REFERENCES bank_accounts(bank_account_id),
    payment_method VARCHAR(20) NOT NULL DEFAULT 'CHECK',
    instrument_ref_no VARCHAR(50),
    entity_name VARCHAR(255),
    clearing_status VARCHAR(20) NOT NULL DEFAULT 'CLEARED',

    CONSTRAINT chk_cash_transaction_type CHECK (type IN ('Check Issue', 'Check Deposit')),
    CONSTRAINT chk_cash_payment_method CHECK (payment_method IN ('CHECK', 'WIRE', 'ACH', 'CARD')),
    CONSTRAINT chk_cash_clearing_status CHECK (clearing_status IN ('PENDING', 'CLEARED', 'VOID'))
);

-- ========================================================
-- 7. INVENTORY & WAREHOUSE MANAGEMENT
-- ========================================================

DROP TABLE IF EXISTS StockMovements CASCADE;
DROP TABLE IF EXISTS InventoryStock CASCADE;
DROP TABLE IF EXISTS BinLocations CASCADE;
DROP TABLE IF EXISTS Warehouses CASCADE;

-- 18. Warehouses — physical storage sites
CREATE TABLE Warehouses (
    warehouse_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    address VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO Warehouses (warehouse_id, name, code, address, is_active)
VALUES ('WH-MAIN', 'Main Warehouse', 'MAIN', NULL, TRUE)
ON CONFLICT (warehouse_id) DO NOTHING;

-- 19. Bin Locations — storage bins within a warehouse
CREATE TABLE BinLocations (
    bin_id VARCHAR(50) PRIMARY KEY,
    warehouse_id VARCHAR(50) NOT NULL REFERENCES Warehouses(warehouse_id) ON DELETE CASCADE,
    bin_code VARCHAR(50) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_bin_per_warehouse UNIQUE (warehouse_id, bin_code)
);

INSERT INTO BinLocations (bin_id, warehouse_id, bin_code, description, is_active)
VALUES ('BIN-RECEIVING', 'WH-MAIN', 'RECEIVING', 'Default receiving bin', TRUE)
ON CONFLICT (bin_id) DO NOTHING;

DROP TABLE IF EXISTS PurchaseOrderDeliverySchedules CASCADE;
-- Split vendor deliveries for one purchase-order line
CREATE TABLE PurchaseOrderDeliverySchedules (
    schedule_id BIGSERIAL PRIMARY KEY,
    po_item_id BIGINT NOT NULL REFERENCES PurchaseOrderItems(item_id) ON DELETE CASCADE,
    sub_line_number VARCHAR(10),
    warehouse_id VARCHAR(50) REFERENCES Warehouses(warehouse_id),
    bin_id VARCHAR(50) REFERENCES BinLocations(bin_id),
    scheduled_quantity NUMERIC(12, 4) NOT NULL,
    needed_delivery_date TIMESTAMP NOT NULL,
    promised_delivery_date TIMESTAMP,
    requester_name VARCHAR(100),
    status VARCHAR(30) DEFAULT 'PENDING'
);

DROP TABLE IF EXISTS SubcontractOrderDeliverySchedules CASCADE;
-- Split finished-good return dates for one subcontract order
CREATE TABLE SubcontractOrderDeliverySchedules (
    schedule_id BIGSERIAL PRIMARY KEY,
    sco_number VARCHAR(50) NOT NULL REFERENCES SubcontractOrders(sco_number) ON DELETE CASCADE,
    sub_line_number VARCHAR(10),
    warehouse_id VARCHAR(50) REFERENCES Warehouses(warehouse_id),
    bin_id VARCHAR(50) REFERENCES BinLocations(bin_id),
    scheduled_quantity INT NOT NULL,
    needed_return_date TIMESTAMP NOT NULL,
    promised_return_date TIMESTAMP,
    requester_name VARCHAR(100),
    status VARCHAR(30) DEFAULT 'PENDING'
);

ALTER TABLE work_centers
    ADD CONSTRAINT fk_work_centers_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES Warehouses(warehouse_id);

ALTER TABLE Suppliers
    ADD CONSTRAINT fk_suppliers_consignment_stock_loc
    FOREIGN KEY (consignment_stock_loc_id) REFERENCES BinLocations(bin_id) ON DELETE SET NULL;

-- 20. Inventory Stock — on-hand / allocated / on-order qty per product + bin
--     items.on_hand_quantity remains the company-wide aggregate cache
CREATE TABLE InventoryStock (
    stock_id VARCHAR(50) PRIMARY KEY,
    item_id VARCHAR(50) NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    warehouse_id VARCHAR(50) NOT NULL REFERENCES Warehouses(warehouse_id),
    bin_id VARCHAR(50) NOT NULL REFERENCES BinLocations(bin_id),
    on_hand_quantity INT NOT NULL DEFAULT 0,
    allocated_quantity INT NOT NULL DEFAULT 0,  -- reserved for open Sales Orders
    on_order_quantity INT NOT NULL DEFAULT 0,   -- open Purchase Orders
    reorder_point INT NOT NULL DEFAULT 0,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,  -- primary pick location for the product
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_item_bin UNIQUE (item_id, bin_id),
    CONSTRAINT chk_inventory_qty_nonneg CHECK (
        on_hand_quantity >= 0
        AND allocated_quantity >= 0
        AND on_order_quantity >= 0
        AND reorder_point >= 0
    )
);

-- 21. Stock Movements — receipts, issues, adjustments, transfers
CREATE TABLE StockMovements (
    movement_id VARCHAR(50) PRIMARY KEY,
    item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),
    movement_type VARCHAR(20) NOT NULL,
    quantity INT NOT NULL,                      -- signed: +receipt / -issue
    warehouse_id VARCHAR(50) NOT NULL REFERENCES Warehouses(warehouse_id),
    bin_id VARCHAR(50) NOT NULL REFERENCES BinLocations(bin_id),
    reference VARCHAR(50),                     -- PO / SO / ADJ / XFER id
    notes TEXT,
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_stock_movement_type CHECK (
        movement_type IN ('Receipt', 'Issue', 'Adjustment', 'Transfer')
    )
);

-- ========================================================
-- 8. ORDER-TO-CASH: ITEM FULFILLMENTS & SALES INVOICES
-- ========================================================

DROP TABLE IF EXISTS sales_invoice_lines CASCADE;
DROP TABLE IF EXISTS sales_invoices CASCADE;
DROP TABLE IF EXISTS item_fulfillment_lines CASCADE;
DROP TABLE IF EXISTS item_fulfillments CASCADE;

CREATE TABLE item_fulfillments (
    id SERIAL PRIMARY KEY,
    fulfillment_number VARCHAR(50) NOT NULL UNIQUE,
    sales_order_id VARCHAR(50) NOT NULL REFERENCES SalesOrders(sales_order_id),
    customer_id VARCHAR(50) NOT NULL REFERENCES Customers(customer_id),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    shipped_date DATE,
    carrier VARCHAR(100),
    tracking_number VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_item_fulfillment_status CHECK (
        status IN ('DRAFT', 'PICKED', 'PACKED', 'SHIPPED')
    )
);
CREATE INDEX ix_item_fulfillments_sales_order_id ON item_fulfillments(sales_order_id);

CREATE TABLE item_fulfillment_lines (
    id SERIAL PRIMARY KEY,
    fulfillment_id INT NOT NULL REFERENCES item_fulfillments(id) ON DELETE CASCADE,
    sales_order_line_id BIGINT NOT NULL REFERENCES SalesOrderItems(so_item_id),
    item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),
    quantity_fulfilled INT NOT NULL,

    CONSTRAINT chk_fulfillment_qty_pos CHECK (quantity_fulfilled > 0)
);

CREATE TABLE sales_invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    sales_order_id VARCHAR(50) NOT NULL REFERENCES SalesOrders(sales_order_id),
    fulfillment_id INT REFERENCES item_fulfillments(id),
    customer_id VARCHAR(50) NOT NULL REFERENCES Customers(customer_id),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    payment_terms VARCHAR(50),
    payment_term_id UUID REFERENCES payment_terms(id),
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    outstanding_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ar_invoice_id VARCHAR(50) REFERENCES ar_invoices(invoice_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_sales_invoice_status CHECK (
        status IN ('DRAFT', 'APPROVED', 'PAID', 'VOID')
    )
);
CREATE INDEX ix_sales_invoices_sales_order_id ON sales_invoices(sales_order_id);

CREATE TABLE sales_invoice_lines (
    id SERIAL PRIMARY KEY,
    invoice_id INT NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),
    description VARCHAR(255),
    quantity INT NOT NULL,
    unit_price NUMERIC(12, 4) NOT NULL,
    line_subtotal NUMERIC(12, 2) NOT NULL,

    CONSTRAINT chk_sales_invoice_line_qty_pos CHECK (quantity > 0)
);



-- ========================================================
-- 9. PROCURE-TO-PAY: GOODS RECEIPTS & SUPPLIER INVOICES
-- ========================================================

ALTER TABLE purchaseorders ADD COLUMN IF NOT EXISTS billing_status VARCHAR(30) NOT NULL DEFAULT 'UNBILLED';
ALTER TABLE purchaseorders ADD COLUMN IF NOT EXISTS incoterms VARCHAR(10);
ALTER TABLE purchaseorders ADD COLUMN IF NOT EXISTS freight_terms VARCHAR(30) NOT NULL DEFAULT 'PREPAID_ON_PO';
ALTER TABLE purchaseorders ADD COLUMN IF NOT EXISTS carrier_account VARCHAR(50);
ALTER TABLE purchaseorderitems ADD COLUMN IF NOT EXISTS sco_component_id BIGINT;
ALTER TABLE purchaseorderitems ADD COLUMN IF NOT EXISTS uom VARCHAR(20);
ALTER TABLE purchaseorderitems ADD COLUMN IF NOT EXISTS description VARCHAR(255);
ALTER TABLE subcontractorders ADD COLUMN IF NOT EXISTS billing_status VARCHAR(30) NOT NULL DEFAULT 'UNBILLED';
ALTER TABLE subcontractorders ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE subcontractorders ADD COLUMN IF NOT EXISTS amendment_number INT NOT NULL DEFAULT 0;

ALTER TABLE ap_bills ALTER COLUMN purchase_order_id DROP NOT NULL;
ALTER TABLE ap_bills ADD COLUMN IF NOT EXISTS supplier_invoice_id INT;
ALTER TABLE ap_bills ADD COLUMN IF NOT EXISTS source_type VARCHAR(30);
ALTER TABLE ap_bills ADD COLUMN IF NOT EXISTS source_order_id VARCHAR(50);

DROP TABLE IF EXISTS supplier_invoice_lines CASCADE;
DROP TABLE IF EXISTS supplier_invoices CASCADE;
DROP TABLE IF EXISTS goods_receipt_lines CASCADE;
DROP TABLE IF EXISTS goods_receipts CASCADE;

CREATE TABLE goods_receipts (
    id SERIAL PRIMARY KEY,
    receipt_number VARCHAR(50) NOT NULL UNIQUE,
    source_type VARCHAR(30) NOT NULL,
    source_order_id VARCHAR(50) NOT NULL,
    vendor_id VARCHAR(50) NOT NULL REFERENCES Suppliers(supplier_id),
    receipt_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'POSTED',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_goods_receipt_source_type CHECK (source_type IN ('PURCHASE_ORDER', 'SUBCONTRACT_ORDER')),
    CONSTRAINT chk_goods_receipt_status CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED'))
);
CREATE INDEX ix_goods_receipts_source ON goods_receipts(source_type, source_order_id);

CREATE TABLE goods_receipt_lines (
    id SERIAL PRIMARY KEY,
    receipt_id INT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    source_line_id BIGINT,
    item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),
    description VARCHAR(255),
    quantity_received NUMERIC(12, 4) NOT NULL,
    unit_cost NUMERIC(12, 4) NOT NULL,
    line_amount NUMERIC(12, 2) NOT NULL,
    CONSTRAINT chk_gr_line_qty_pos CHECK (quantity_received > 0)
);

CREATE TABLE supplier_invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    vendor_id VARCHAR(50) NOT NULL REFERENCES Suppliers(supplier_id),
    invoice_type VARCHAR(20) NOT NULL DEFAULT 'PO_MATCHED',
    source_type VARCHAR(30) NOT NULL,
    source_order_id VARCHAR(50),
    vendor_invoice_number VARCHAR(100),
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    payment_term_id UUID REFERENCES payment_terms(id),
    payment_terms VARCHAR(50),
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    freight_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    outstanding_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    ap_bill_id VARCHAR(50) REFERENCES ap_bills(bill_id),
    match_warnings TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_supplier_invoice_type CHECK (invoice_type IN ('PO_MATCHED', 'LANDED_COST', 'EXPENSE')),
    CONSTRAINT chk_supplier_invoice_source_type CHECK (source_type IN ('PURCHASE_ORDER', 'SUBCONTRACT_ORDER', 'NON_PO')),
    CONSTRAINT chk_supplier_invoice_status CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED'))
);
CREATE INDEX ix_supplier_invoices_source ON supplier_invoices(source_type, source_order_id);

CREATE TABLE supplier_invoice_lines (
    id SERIAL PRIMARY KEY,
    invoice_id INT NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
    source_line_id BIGINT,
    item_id VARCHAR(50) REFERENCES items(item_id),
    description VARCHAR(255),
    quantity_billed NUMERIC(12, 4) NOT NULL,
    unit_price NUMERIC(12, 4) NOT NULL,
    line_subtotal NUMERIC(12, 2) NOT NULL,
    goods_receipt_line_id INT REFERENCES goods_receipt_lines(id),
    CONSTRAINT chk_si_line_qty_pos CHECK (quantity_billed >= 0)
);

CREATE TABLE IF NOT EXISTS supplier_invoice_distributions (
    id SERIAL PRIMARY KEY,
    invoice_id INT NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
    gl_account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
    department_id VARCHAR(50),
    amount NUMERIC(12, 2) NOT NULL,
    description VARCHAR(255),
    goods_receipt_id INT REFERENCES goods_receipts(id),
    goods_receipt_line_id INT REFERENCES goods_receipt_lines(id),
    CONSTRAINT chk_si_dist_amount_pos CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS ix_si_distributions_invoice ON supplier_invoice_distributions(invoice_id);

DO $$ BEGIN
  ALTER TABLE ap_bills
    ADD CONSTRAINT fk_ap_bills_supplier_invoice_id
    FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoices(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS document_sequences (
    doc_type VARCHAR(30) NOT NULL,
    year_month VARCHAR(6) NOT NULL,
    last_value INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (doc_type, year_month),
    CONSTRAINT chk_document_sequences_last_value CHECK (last_value >= 0),
    CONSTRAINT chk_document_sequences_year_month CHECK (year_month ~ '^[0-9]{6}$')
);

CREATE TABLE IF NOT EXISTS document_attachments (
    id SERIAL PRIMARY KEY,
    document_type VARCHAR(30) NOT NULL,
    document_id VARCHAR(50) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size INT NOT NULL,
    notes TEXT,
    uploaded_by_user_id UUID REFERENCES users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_document_attachment_file_size CHECK (file_size > 0)
);
CREATE INDEX IF NOT EXISTS ix_document_attachments_document
    ON document_attachments(document_type, document_id);
