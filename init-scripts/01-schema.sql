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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DROP TABLE IF EXISTS chart_of_accounts CASCADE;
-- Chart of Accounts
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_code VARCHAR(50) UNIQUE NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50) NOT NULL, -- Asset, Liability, Equity, Revenue, Expense
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DROP TABLE IF EXISTS products CASCADE;
-- Inventory / Products
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    stock_quantity INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


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
    posted_by_user_id UUID REFERENCES users(id)
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
    CONSTRAINT check_balanced_line CHECK (
        (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
    )
);

-- ========================================================
-- 3. CRM, SALES, & PROCUREMENT TABLES
-- ========================================================

DROP TABLE IF EXISTS Suppliers CASCADE;
-- New: Suppliers / Vendors Table
CREATE TABLE Suppliers (
    supplier_id VARCHAR(50) PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(100),
    contact_email VARCHAR(150),
    phone_number VARCHAR(50),
    address_line1 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    postal_code VARCHAR(20),
    country VARCHAR(50),
    vendor_number_ext VARCHAR(50),
    payment_terms VARCHAR(50) DEFAULT 'Net 30',
    status VARCHAR(20) DEFAULT 'Active'
);

DROP TABLE IF EXISTS Customers CASCADE;
-- 1. Customers Table (Simplified, billing removed)
CREATE TABLE Customers (
    customer_id VARCHAR(50) PRIMARY KEY,       -- e.g., 'CUST-DENSO-001'
    customer_number_ext VARCHAR(50),           -- DENSO's Supplier No: '20001668172'
    company_name VARCHAR(255) NOT NULL         -- 'DENSO Products and Services...'
);


DROP TABLE IF EXISTS CustomerLocations CASCADE;

-- 2. Unified Customer Locations (Billing & Shipping)
CREATE TABLE CustomerLocations (
    location_id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) REFERENCES Customers(customer_id) ON DELETE CASCADE,
    location_type VARCHAR(20) NOT NULL,        -- 'BILL_TO', 'SHIP_TO', or 'BOTH'
    location_name VARCHAR(100),                -- e.g., 'Long Beach Plant' or 'HQ'
    attention_to VARCHAR(100),                 -- e.g., 'Accounts Payable' or 'Receiving Dept'
    address_line1 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    postal_code VARCHAR(20),
    country VARCHAR(50),
    contact_email VARCHAR(150),                -- Billing email or Shipping contact email
    
    CONSTRAINT chk_location_type CHECK (location_type IN ('BILL_TO', 'SHIP_TO', 'BOTH'))
);


DROP TABLE IF EXISTS Products CASCADE;
-- 4. Internal Products & Customer Part Cross-Reference
CREATE TABLE Products (
    product_id VARCHAR(50) PRIMARY KEY,        -- Internal SKU
    customer_part_number VARCHAR(50) NOT NULL, -- DENSO Part No: 'LAY95172-0780'
    description TEXT,                          
    uom VARCHAR(20) DEFAULT 'Each',
    unit_price NUMERIC(12, 2),
    on_hand_quantity INT DEFAULT 0,            -- Quantity physically in stock (raw material or finished good)
    wip_quantity INT DEFAULT 0                 -- Quantity currently out at a subcontractor (work-in-progress)
);


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
    
    -- Commercial & Freight Terms
    payment_terms VARCHAR(50),                 
    freight_terms VARCHAR(50),                 
    shipping_method VARCHAR(50),               
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Customer Contact Info
    buyer_contact_name VARCHAR(100),           
    buyer_contact_email VARCHAR(150),          
    
    -- Status & Financial Tracking
    status VARCHAR(30) DEFAULT 'RECEIVED',     -- 'RECEIVED', 'CANCELLED', etc.
    total_amount DECIMAL(12, 2) NOT NULL,      
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


DROP TABLE IF EXISTS SalesOrderItems CASCADE;
-- 6. Sales Order Line Items
CREATE TABLE SalesOrderItems (
    so_item_id BIGSERIAL PRIMARY KEY,
    sales_order_id VARCHAR(50) REFERENCES SalesOrders(sales_order_id) ON DELETE CASCADE,
    line_number INT NOT NULL,                  
    product_id VARCHAR(50) REFERENCES Products(product_id),
    
    quantity_ordered INT NOT NULL,             
    unit_price DECIMAL(10, 4) NOT NULL,        
    tax_amount DECIMAL(10, 2) DEFAULT 0.00,    
    total_amount DECIMAL(12, 2) NOT NULL,      
    
    CONSTRAINT unique_line_per_so UNIQUE (sales_order_id, line_number)
);

-- ========================================================
-- 4. SUBCONTRACTING / OUTSIDE PROCESSING TABLES
-- ========================================================

DROP TABLE IF EXISTS ProductBOMComponents CASCADE;
-- 7. Master Bill of Materials: which components make up a finished product
CREATE TABLE ProductBOMComponents (
    bom_id BIGSERIAL PRIMARY KEY,
    parent_product_id VARCHAR(50) NOT NULL REFERENCES Products(product_id) ON DELETE CASCADE,
    component_product_id VARCHAR(50) NOT NULL REFERENCES Products(product_id),
    quantity_per NUMERIC(12, 4) NOT NULL DEFAULT 1,   -- Qty of component required per 1 unit of parent
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_bom_line UNIQUE (parent_product_id, component_product_id),
    CONSTRAINT chk_bom_not_self_referencing CHECK (parent_product_id <> component_product_id)
);

DROP TABLE IF EXISTS SubcontractOrders CASCADE;
-- 8. Subcontract Order (SCO) Header — sending a finished/semi-finished product out for outside processing
CREATE TABLE SubcontractOrders (
    sco_number VARCHAR(50) PRIMARY KEY,
    supplier_id VARCHAR(50) NOT NULL REFERENCES Suppliers(supplier_id),
    product_id VARCHAR(50) NOT NULL REFERENCES Products(product_id),  -- The finished good being subcontracted

    quantity_ordered INT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',  -- PLANNED, MATERIALS_ISSUED, PARTIALLY_RECEIVED, COMPLETED, CANCELLED

    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_return_date DATE,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS SubcontractOrderComponents CASCADE;
-- 9. Subcontract Order Components — auto-populated from the BOM at SCO creation time
CREATE TABLE SubcontractOrderComponents (
    sco_component_id BIGSERIAL PRIMARY KEY,
    sco_number VARCHAR(50) NOT NULL REFERENCES SubcontractOrders(sco_number) ON DELETE CASCADE,
    component_product_id VARCHAR(50) NOT NULL REFERENCES Products(product_id),

    quantity_required NUMERIC(12, 4) NOT NULL,   -- quantity_per (BOM) * SCO quantity_ordered
    quantity_issued NUMERIC(12, 4) NOT NULL DEFAULT 0,

    CONSTRAINT unique_component_per_sco UNIQUE (sco_number, component_product_id)
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
    component_product_id VARCHAR(50) NOT NULL REFERENCES Products(product_id),
    quantity_issued NUMERIC(12, 4) NOT NULL CHECK (quantity_issued > 0)
);

DROP TABLE IF EXISTS FinishedGoodsReceipts CASCADE;
-- 12. Finished Goods Receipts — deducts wip_quantity, increments on_hand_quantity of the finished product
CREATE TABLE FinishedGoodsReceipts (
    receipt_id VARCHAR(50) PRIMARY KEY,
    sco_number VARCHAR(50) NOT NULL REFERENCES SubcontractOrders(sco_number),
    quantity_received INT NOT NULL CHECK (quantity_received > 0),
    receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

