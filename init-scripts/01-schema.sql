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
    is_outside_processed BOOLEAN NOT NULL DEFAULT FALSE, -- Legacy: 3rd-party/outside processed assemblies
    is_purchase_item BOOLEAN NOT NULL DEFAULT FALSE,      -- Available on Purchase Orders
    is_subcontract_assembly BOOLEAN NOT NULL DEFAULT FALSE, -- Finished/semi FG built via subcontract
    is_raw_material BOOLEAN NOT NULL DEFAULT FALSE         -- Purchased/raw component stock
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
    
    quantity_ordered INT NOT NULL,             
    unit_price DECIMAL(10, 4) NOT NULL,        
    tax_amount DECIMAL(10, 2) DEFAULT 0.00,    
    total_amount DECIMAL(12, 2) NOT NULL,      
    
    CONSTRAINT unique_line_per_so UNIQUE (sales_order_id, line_number)
);

-- ========================================================
-- 4. SUBCONTRACTING / OUTSIDE PROCESSING TABLES
-- ========================================================

DROP TABLE IF EXISTS itembomcomponents CASCADE;
-- 7. Master Bill of Materials: which components make up a finished product
CREATE TABLE itembomcomponents (
    bom_id BIGSERIAL PRIMARY KEY,
    parent_item_id VARCHAR(50) NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    component_item_id VARCHAR(50) REFERENCES items(item_id),   -- Set for 'Material' rows only
    component_code VARCHAR(50),                        -- Set for 'Labor' / 'Outside Service' rows only (predefined codes, not real Items)
    quantity_per NUMERIC(12, 4) NOT NULL DEFAULT 1,   -- Qty of component required per 1 unit of parent
    item_type VARCHAR(30) NOT NULL DEFAULT 'Material', -- 'Material', 'Labor', or 'Outside Service'
    scrap_factor NUMERIC(8, 4) NOT NULL DEFAULT 0,     -- Extra material allowance (0.05 = +5%)
    yield_loss_percentage NUMERIC(8, 4) NOT NULL DEFAULT 0, -- Expected yield loss %
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT unique_bom_line UNIQUE (parent_item_id, component_item_id, component_code),
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
    item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),  -- The finished good being subcontracted

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
    component_item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),

    quantity_required NUMERIC(12, 4) NOT NULL,   -- quantity_per (BOM) * SCO quantity_ordered
    quantity_issued NUMERIC(12, 4) NOT NULL DEFAULT 0,

    CONSTRAINT unique_component_per_sco UNIQUE (sco_number, component_item_id)
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
    component_item_id VARCHAR(50) NOT NULL REFERENCES items(item_id),
    quantity_issued NUMERIC(12, 4) NOT NULL CHECK (quantity_issued > 0)
);

DROP TABLE IF EXISTS ComponentIssueLogs CASCADE;
-- Durable audit log of components issued to subcontractors (mirrors MaterialIssueLines + SCO context)
CREATE TABLE ComponentIssueLogs (
    log_id BIGSERIAL PRIMARY KEY,
    sco_number VARCHAR(50) NOT NULL REFERENCES SubcontractOrders(sco_number),
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

    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    payment_terms VARCHAR(50) DEFAULT 'Net 30',
    status VARCHAR(20) NOT NULL DEFAULT 'Draft', -- 'Draft', 'Submitted', 'Approved', 'Void'

    shipping_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
    discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage', -- 'percentage' or 'fixed'
    discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0,

    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_po_status CHECK (status IN ('Draft', 'Submitted', 'Approved', 'Void')),
    CONSTRAINT chk_po_discount_type CHECK (discount_type IN ('percentage', 'fixed'))
);

DROP TABLE IF EXISTS PurchaseOrderItems CASCADE;
-- 14. Purchase Order Line Items
CREATE TABLE PurchaseOrderItems (
    item_id BIGSERIAL PRIMARY KEY,
    po_number VARCHAR(50) NOT NULL REFERENCES PurchaseOrders(po_number) ON DELETE CASCADE,

    sku VARCHAR(100) NOT NULL,
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_ap_bill_status CHECK (status IN ('Unpaid', 'Partial', 'Paid'))
);

DROP TABLE IF EXISTS cash_transactions CASCADE;
-- 17. Cash Management Ledger — records Check Issue (AP payment) / Check Deposit (AR payment)
CREATE TABLE cash_transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(20) NOT NULL, -- 'Check Issue' or 'Check Deposit'
    reference_id VARCHAR(50) NOT NULL, -- AR Invoice ID or AP Bill ID (polymorphic, no strict FK)
    amount NUMERIC(12, 2) NOT NULL,
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    bank_account_id VARCHAR(50),

    CONSTRAINT chk_cash_transaction_type CHECK (type IN ('Check Issue', 'Check Deposit'))
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


