"""
Master seed script for the core ERP demo data.

Builds one linked end-to-end story:

  Customer SO  → demands finished kit PROD-1020G (+ spare components)
  Purchase PO  → buys raw components PROD-1001G / PROD-1010G
  BOM + SCO    → outside-processes those components into PROD-1020G
  Inventory    → warehouses/bins/stock/movements for the same products,
                 with allocated (SO) and on-order (PO) quantities

Creates:
  - User, Customer (GTT USA) + Bill-To / Ship-To
  - Suppliers: membrane (materials) + subcontract processor
  - Products: PROD-1001G, PROD-1010G (components), PROD-1020G (FG assembly)
  - BOM for PROD-1020G (1x 1001G + 1x 1010G per kit)
  - Sales Order SO-26060004 (APPROVED → AR Invoice)
  - Purchase Order PO-2026-0001 (Approved → AP Bill)
  - Chart of Accounts + AR/AP payments → Cash transactions + GL journal entries
  - Subcontract Order SCO-2026-0001 with a partial material issue
  - Warehouses / bins / inventory stock / stock movements

Run with the backend server already running, e.g.:
    cd backend && uvicorn app.main:app --reload
then in another terminal:
    python backend/seed_db.py
"""

import requests

BASE_URL = "http://127.0.0.1:8000/api/v1"

# Populated after users are seeded so approval calls act as Admin.
_SESSION_HEADERS: dict[str, str] = {}


def _report(label: str, r: requests.Response) -> None:
    print(f"{label} Response: {r.status_code}")
    if r.status_code not in (200, 201):
        print(f"  -> Error details: {r.text}")


def _post(path: str, json=None):
    return requests.post(f"{BASE_URL}{path}", json=json, headers=_SESSION_HEADERS)


def _get(path: str):
    return requests.get(f"{BASE_URL}{path}", headers=_SESSION_HEADERS)


def seed_data():
    print("🌱 Starting database seed...")

    # ------------------------------------------------------------------
    # 1. Users (with RBAC roles) / Customer / Locations
    #    Roles/permissions/workflows come from migration / init-script 03
    # ------------------------------------------------------------------
    users = [
        {
            "email": "wendy.yang@grand-tek.com",
            "full_name": "Wendy Yang",
            "department_id": "DEPT-ADMIN",
            "role_ids": ["ROLE-ADMIN"],
        },
        {
            "email": "sales.rep@grand-tek.com",
            "full_name": "Sam SalesRep",
            "department_id": "DEPT-SALES",
            "role_ids": ["ROLE-SALES-REP"],
        },
        {
            "email": "sales.mgr@grand-tek.com",
            "full_name": "Morgan SalesMgr",
            "department_id": "DEPT-SALES",
            "role_ids": ["ROLE-SALES-MGR"],
        },
        {
            "email": "purch.agent@grand-tek.com",
            "full_name": "Pat PurchAgent",
            "department_id": "DEPT-PURCH",
            "role_ids": ["ROLE-PURCH-AGENT"],
        },
        {
            "email": "purch.mgr@grand-tek.com",
            "full_name": "Perry PurchMgr",
            "department_id": "DEPT-PURCH",
            "role_ids": ["ROLE-PURCH-MGR"],
        },
        {
            "email": "sco.sup@grand-tek.com",
            "full_name": "Sky ScoSupervisor",
            "department_id": "DEPT-SCO",
            "role_ids": ["ROLE-SCO-SUP"],
        },
        {
            "email": "finance@grand-tek.com",
            "full_name": "Fran Finance",
            "department_id": "DEPT-FIN",
            "role_ids": ["ROLE-FIN-APPR"],
        },
    ]
    for user_data in users:
        r_user = requests.post(f"{BASE_URL}/users", json=user_data)
        _report(f"User {user_data['email']}", r_user)

    # Resolve Admin user id for subsequent privileged API calls
    r_users = requests.get(f"{BASE_URL}/users")
    if r_users.status_code == 200:
        for u in r_users.json():
            if u.get("email") == "wendy.yang@grand-tek.com":
                _SESSION_HEADERS["X-User-Id"] = u["id"]
                print(f"✅ Acting as Admin user {u['id']}")
                break

    customer_data = {
        "customer_id": "CUST-GTT-USA",
        "company_name": "GTT USA, Inc.",
    }
    r_cust = requests.post(f"{BASE_URL}/customers", json=customer_data)
    _report("Customer", r_cust)

    bill_to = {
        "location_id": "LOC-GTT-BILL-01",
        "customer_id": "CUST-GTT-USA",
        "location_type": "BILL_TO",
        "address_line1": "358 Fairview Way",
        "city": "Milpitas",
        "state": "CA",
        "postal_code": "95035",
        "country": "USA",
    }
    ship_to = {
        "location_id": "LOC-GTT-SHIP-01",
        "customer_id": "CUST-GTT-USA",
        "location_type": "SHIP_TO",
        "address_line1": "41300 Boyce Road",
        "city": "FREMONT",
        "state": "CA",
        "postal_code": "94538",
        "country": "USA",
    }
    r_bill = requests.post(f"{BASE_URL}/customer-locations/", json=bill_to)
    _report("Bill-To Location", r_bill)
    r_ship = requests.post(f"{BASE_URL}/customer-locations/", json=ship_to)
    _report("Ship-To Location", r_ship)

    # Additional demo customers + locations (so SO form dropdowns work for DENSO, etc.)
    extra_customers = [
        {"customer_id": "CUST-001", "customer_number_ext": "1510988888", "company_name": "DENSO"},
        {"customer_id": "CUST-0002", "company_name": "Texas Power Dalls"},
    ]
    for cust in extra_customers:
        r = requests.post(f"{BASE_URL}/customers", json=cust)
        _report(f"Customer {cust['customer_id']}", r)

    extra_locations = [
        {
            "location_id": "LOC-DENSO-BILL-01",
            "customer_id": "CUST-001",
            "location_type": "BILL_TO",
            "location_name": "DENSO HQ Billing",
            "address_line1": "24777 Denso Drive",
            "city": "Southfield",
            "state": "MI",
            "postal_code": "48033",
            "country": "USA",
        },
        {
            "location_id": "LOC-DENSO-SHIP-01",
            "customer_id": "CUST-001",
            "location_type": "SHIP_TO",
            "location_name": "DENSO Plant Ship-To",
            "address_line1": "1 Denso Way",
            "city": "Battle Creek",
            "state": "MI",
            "postal_code": "49037",
            "country": "USA",
        },
        {
            "location_id": "LOC-TPD-BILL-01",
            "customer_id": "CUST-0002",
            "location_type": "BILL_TO",
            "location_name": "Texas Power Billing",
            "address_line1": "500 Energy Plaza",
            "city": "Dallas",
            "state": "TX",
            "postal_code": "75201",
            "country": "USA",
        },
        {
            "location_id": "LOC-TPD-SHIP-01",
            "customer_id": "CUST-0002",
            "location_type": "SHIP_TO",
            "location_name": "Texas Power Warehouse",
            "address_line1": "1200 Industrial Blvd",
            "city": "Dallas",
            "state": "TX",
            "postal_code": "75207",
            "country": "USA",
        },
    ]
    for loc in extra_locations:
        r = requests.post(f"{BASE_URL}/customer-locations/", json=loc)
        _report(f"Location {loc['location_id']}", r)

    # ------------------------------------------------------------------
    # 2. Suppliers — materials vendor + outside processor
    # ------------------------------------------------------------------
    suppliers = [
        {
            "supplier_id": "SUP-MEMBRANE-01",
            "company_name": "Membrane Tech Supplier Co.",
            "contact_name": "Jason Lin",
            "contact_email": "jason.lin@membranetech.example.com",
            "phone_number": "+886-3-5555-6789",
            "city": "Hsinchu",
            "country": "Taiwan",
            "payment_terms": "Net 30",
            "status": "Active",
        },
        {
            "supplier_id": "SUP-SUBCON-01",
            "company_name": "Precision Outside Processing Co.",
            "contact_name": "Alan Chen",
            "contact_email": "alan.chen@precisionop.example.com",
            "phone_number": "+886-2-5555-1234",
            "city": "Taipei",
            "country": "Taiwan",
            "payment_terms": "Net 30",
            "status": "Active",
        },
    ]
    for supplier in suppliers:
        r_sup = requests.post(f"{BASE_URL}/suppliers/", json=supplier)
        _report(f"Supplier {supplier['supplier_id']}", r_sup)

    # ------------------------------------------------------------------
    # 3. Products
    #    PROD-1001G / PROD-1010G = components (on-hand so SCO can issue)
    #    PROD-1020G = finished kit (outside-processed assembly)
    # ------------------------------------------------------------------
    products = [
        {
            "item_id": "PROD-1001G",
            "customer_part_number": "1001G00001710",
            "description": "Enclosure, Bottom Cover, RSU-5941 For NEX",
            "uom": "PCS",
            "unit_price": 37.53,
            "on_hand_quantity": 250,
            "wip_quantity": 0,
            "is_outside_processed": False,
            "is_purchase_item": True,
            "is_raw_material": True,
            "is_subcontract_assembly": False,
        },
        {
            "item_id": "PROD-1010G",
            "customer_part_number": "1010G00001180",
            "description": "Metal Adapter Board, GLB M-Smart M25x4 For NEX",
            "uom": "PCS",
            "unit_price": 10.52,
            "on_hand_quantity": 250,
            "wip_quantity": 0,
            "is_outside_processed": False,
            "is_purchase_item": True,
            "is_raw_material": True,
            "is_subcontract_assembly": False,
        },
        {
            "item_id": "PROD-1020G",
            "customer_part_number": "1020G00000520",
            "description": "Assy KIT,M-SMART,LED 3 in 1_Reset For NEX",
            "uom": "PCS",
            "unit_price": 25.50,
            "on_hand_quantity": 0,
            "wip_quantity": 0,
            "is_outside_processed": True,
            "is_purchase_item": False,
            "is_raw_material": False,
            "is_subcontract_assembly": True,
        },
    ]
    for p in products:
        r_p = requests.post(f"{BASE_URL}/items", json=p)
        _report(f"Item {p['item_id']}", r_p)

    # ------------------------------------------------------------------
    # 4. BOM — 1 finished kit needs 1x enclosure + 1x adapter board
    # ------------------------------------------------------------------
    bom_lines = [
        {
            "component_item_id": "PROD-1001G",
            "quantity_per": 1,
            "item_type": "Material",
        },
        {
            "component_item_id": "PROD-1010G",
            "quantity_per": 1,
            "item_type": "Material",
        },
    ]
    for line in bom_lines:
        r_bom = requests.post(f"{BASE_URL}/items/PROD-1020G/bom", json=line)
        _report(f"BOM {line['component_item_id']} -> PROD-1020G", r_bom)

    # ------------------------------------------------------------------
    # 4b. Vendor item mappings (purchase catalog)
    # ------------------------------------------------------------------
    vendor_maps = [
        {
            "supplier_id": "SUP-MEMBRANE-01",
            "item_id": "PROD-1001G",
            "vendor_sku": "MEM-1001",
            "unit_cost": 32.5,
            "minimum_order_qty": 10,
            "lead_time_days": 14,
            "is_primary_vendor": True,
        },
        {
            "supplier_id": "SUP-MEMBRANE-01",
            "item_id": "PROD-1010G",
            "vendor_sku": "ADP-1010",
            "unit_cost": 9.8,
            "minimum_order_qty": 10,
            "lead_time_days": 10,
            "is_primary_vendor": True,
        },
    ]
    for vm in vendor_maps:
        r_vm = requests.post(f"{BASE_URL}/items/{vm['item_id']}/vendors", json=vm)
        _report(f"Vendor map {vm['item_id']} <- {vm['supplier_id']}", r_vm)

    # ------------------------------------------------------------------
    # 5. Sales Order — create DRAFT then approve via workflow (AR invoice)
    #    Amount 4952.50 → manager band (Sales Manager / Admin)
    # ------------------------------------------------------------------
    # Line totals: 100*25.50 + 50*37.53 + 50*10.52 = 2550 + 1876.50 + 526 = 4952.50
    sales_order_data = {
        "sales_order_id": "SO-26060004",
        "customer_id": "CUST-GTT-USA",
        "bill_to_location_id": "LOC-GTT-BILL-01",
        "ship_to_location_id": "LOC-GTT-SHIP-01",
        "customer_po_number": "PU62-26060004",
        "po_revision_number": 0,
        "order_date": "2026-06-26",
        "payment_terms": "Net 30",
        "freight_terms": "FCA TW",
        "currency": "USD",
        "status": "DRAFT",
        "total_amount": 4952.50,
        "items": [
            {
                "line_number": 1,
                "item_id": "PROD-1020G",
                "quantity_ordered": 100,
                "unit_price": 25.50,
                "total_amount": 2550.00,
            },
            {
                "line_number": 2,
                "item_id": "PROD-1001G",
                "quantity_ordered": 50,
                "unit_price": 37.53,
                "total_amount": 1876.50,
            },
            {
                "line_number": 3,
                "item_id": "PROD-1010G",
                "quantity_ordered": 50,
                "unit_price": 10.52,
                "total_amount": 526.00,
            },
        ],
    }
    r_so = _post("/sales-orders", sales_order_data)
    _report("Sales Order", r_so)
    if r_so.status_code in (200, 201):
        print("✅ Sales Order SO-26060004 created (demands 100x PROD-1020G kits)")
        r_sub = _post(
            "/transactions/so/SO-26060004/submit",
            {"comments": "Seed submit SO"},
        )
        _report("SO Submit", r_sub)
        r_apr = _post(
            "/transactions/so/SO-26060004/approve",
            {"comments": "Seed approve SO"},
        )
        _report("SO Approve", r_apr)

    # ------------------------------------------------------------------
    # 6. Purchase Order — create Draft then approve via workflow (AP bill)
    #    Amount 9650 → manager band (Purchasing Manager / Admin)
    # ------------------------------------------------------------------
    purchase_order_data = {
        "po_number": "PO-2026-0001",
        "supplier_id": "SUP-MEMBRANE-01",
        "order_date": "2026-06-20",
        "expected_delivery_date": "2026-07-20",
        "payment_terms": "Net 30",
        "status": "Draft",
        "shipping_fee": 50.00,
        "discount_type": "percentage",
        "discount_value": 0,
        "subtotal": 9600.00,
        "total_tax": 0,
        "discount_amount": 0,
        "grand_total": 9650.00,
        "notes": (
            "Component purchase for SO-26060004 / SCO-2026-0001: "
            "PROD-1001G + PROD-1010G used to build PROD-1020G kits."
        ),
        "items": [
            {
                "sku": "PROD-1001G",
                "quantity": 200,
                "unit_price": 30.00,
                "tax_rate": 0,
                "line_subtotal": 6000.00,
                "line_tax": 0,
                "line_total": 6000.00,
            },
            {
                "sku": "PROD-1010G",
                "quantity": 200,
                "unit_price": 18.00,
                "tax_rate": 0,
                "line_subtotal": 3600.00,
                "line_tax": 0,
                "line_total": 3600.00,
            },
        ],
    }
    r_po = _post("/purchase-orders", purchase_order_data)
    _report("Purchase Order", r_po)
    if r_po.status_code in (200, 201):
        print("✅ Purchase Order PO-2026-0001 created (200x each component)")
        r_sub = _post(
            "/transactions/po/PO-2026-0001/submit",
            {"comments": "Seed submit PO"},
        )
        _report("PO Submit", r_sub)
        r_apr = _post(
            "/transactions/po/PO-2026-0001/approve",
            {"comments": "Seed approve PO"},
        )
        _report("PO Approve", r_apr)

    # ------------------------------------------------------------------
    # 7. Subcontract Order — build 100 finished kits from the BOM
    #    Partial material issue so the SCO is mid-flight in the UI.
    # ------------------------------------------------------------------
    sco_data = {
        "sco_number": "SCO-2026-0001",
        "supplier_id": "SUP-SUBCON-01",
        "item_id": "PROD-1020G",
        "quantity_ordered": 100,
        "order_date": "2026-07-01",
        "expected_return_date": "2026-07-20",
        "notes": (
            "Outside processing for SO-26060004 finished kits. "
            "Components sourced via PO-2026-0001."
        ),
    }
    r_sco = _post("/subcontract-orders", sco_data)
    _report("Subcontract Order", r_sco)

    if r_sco.status_code in (200, 201):
        print("✅ Subcontract Order SCO-2026-0001 created for 100x PROD-1020G")
        r_sub = _post(
            "/transactions/subcontract/SCO-2026-0001/submit",
            {"comments": "Submit SCO for outside processing approval"},
        )
        _report("SCO Submit", r_sub)
        r_apr = _post(
            "/transactions/subcontract/SCO-2026-0001/approve",
            {"comments": "Approved for material issue"},
        )
        _report("SCO Approve", r_apr)

        # Partial issue: enough for 50 kits (BOM is 1:1 each component)
        issue_data = {
            "issue_id": "ISSUE-2026-0001",
            "issue_date": "2026-07-02",
            "notes": "First material shipment to subcontractor for SCO-2026-0001.",
            "lines": [
                {"component_item_id": "PROD-1001G", "quantity_issued": 50},
                {"component_item_id": "PROD-1010G", "quantity_issued": 50},
            ],
        }
        r_issue = _post(
            "/subcontract-orders/SCO-2026-0001/issue-materials",
            issue_data,
        )
        _report("Material Issue ISSUE-2026-0001", r_issue)
        if r_issue.status_code in (200, 201):
            print("✅ Partial material issue recorded (50 of each component → WIP)")

    # ------------------------------------------------------------------
    # 8. Finance — Chart of Accounts, then pay AR/AP so Cash + GL are seeded
    #    (Cash transactions and journal entries are only created on payment.)
    # ------------------------------------------------------------------
    chart_of_accounts = [
        {"account_code": "1000", "account_name": "Cash", "account_type": "Asset"},
        {"account_code": "1100", "account_name": "Accounts Receivable", "account_type": "Asset"},
        {"account_code": "2000", "account_name": "Accounts Payable", "account_type": "Liability"},
        {"account_code": "4000", "account_name": "Sales Revenue", "account_type": "Revenue"},
        {"account_code": "5000", "account_name": "Cost of Goods Sold", "account_type": "Expense"},
    ]
    for acct in chart_of_accounts:
        r_acct = requests.post(f"{BASE_URL}/accounts", json=acct)
        _report(f"Account {acct['account_code']} {acct['account_name']}", r_acct)

    r_ar = requests.get(f"{BASE_URL}/ar-invoices")
    _report("AR Invoices List", r_ar)
    ar_invoices = r_ar.json() if r_ar.status_code == 200 else []
    print(f"  -> {len(ar_invoices)} AR invoice(s) found")

    r_ap = requests.get(f"{BASE_URL}/ap-bills")
    _report("AP Bills List", r_ap)
    ap_bills = r_ap.json() if r_ap.status_code == 200 else []
    print(f"  -> {len(ap_bills)} AP bill(s) found")

    # Receive customer payment on the SO-linked AR invoice → Check Deposit + JE
    for inv in ar_invoices:
        if inv.get("status") == "Paid":
            continue
        r_pay = requests.post(f"{BASE_URL}/ar-invoices/{inv['invoice_id']}/pay")
        _report(f"AR Payment {inv['invoice_id']}", r_pay)
        if r_pay.status_code in (200, 201):
            print(f"✅ AR payment received for {inv['invoice_id']} "
                  f"(Cash Deposit + GL Debit Cash / Credit AR)")

    # Pay the vendor AP bill → Check Issue + JE
    for bill in ap_bills:
        if bill.get("status") == "Paid":
            continue
        r_pay = requests.post(f"{BASE_URL}/ap-bills/{bill['bill_id']}/pay")
        _report(f"AP Payment {bill['bill_id']}", r_pay)
        if r_pay.status_code in (200, 201):
            print(f"✅ AP payment made for {bill['bill_id']} "
                  f"(Cash Issue + GL Debit AP / Credit Cash)")

    r_cash = requests.get(f"{BASE_URL}/cash-transactions")
    _report("Cash Transactions List", r_cash)
    if r_cash.status_code == 200:
        print(f"  -> {len(r_cash.json())} cash transaction(s) found")

    r_je = requests.get(f"{BASE_URL}/journal-entries")
    _report("Journal Entries List", r_je)
    if r_je.status_code == 200:
        print(f"  -> {len(r_je.json())} journal entry(ies) found")

    r_coa = requests.get(f"{BASE_URL}/accounts")
    _report("Chart of Accounts List", r_coa)
    if r_coa.status_code == 200:
        print(f"  -> {len(r_coa.json())} account(s) found")

    # ------------------------------------------------------------------
    # 9. Inventory — reflect post-issue on-hand, SO allocation, PO on-order
    #    Component on_hand after issue: 250 - 50 = 200
    # ------------------------------------------------------------------
    warehouses = [
        {
            "warehouse_id": "WH-001",
            "name": "Main Distribution Center",
            "code": "MDC",
            "address": "1200 Industrial Pkwy, San Jose, CA",
            "is_active": True,
        },
        {
            "warehouse_id": "WH-002",
            "name": "East Coast Hub",
            "code": "ECH",
            "address": "450 Logistics Blvd, Newark, NJ",
            "is_active": True,
        },
    ]
    for wh in warehouses:
        r_wh = requests.post(f"{BASE_URL}/inventory/warehouses", json=wh)
        _report(f"Warehouse {wh['warehouse_id']}", r_wh)

    bins = [
        {
            "bin_id": "BIN-001",
            "warehouse_id": "WH-001",
            "bin_code": "A-01-01",
            "description": "Finished goods aisle A",
            "is_active": True,
        },
        {
            "bin_id": "BIN-002",
            "warehouse_id": "WH-001",
            "bin_code": "B-01-02",
            "description": "Raw materials aisle B",
            "is_active": True,
        },
        {
            "bin_id": "BIN-003",
            "warehouse_id": "WH-002",
            "bin_code": "E-01-01",
            "description": "East coast bulk storage",
            "is_active": True,
        },
    ]
    for bin_row in bins:
        r_bin = requests.post(f"{BASE_URL}/inventory/bins", json=bin_row)
        _report(f"Bin {bin_row['bin_id']}", r_bin)

    stock_rows = [
        {
            "stock_id": "STK-1001G-MDC",
            "item_id": "PROD-1001G",
            "warehouse_id": "WH-001",
            "bin_id": "BIN-002",
            "on_hand_quantity": 200,       # 250 created - 50 issued to SCO
            "allocated_quantity": 50,      # SO spare-parts demand
            "on_order_quantity": 200,      # open PO-2026-0001
            "reorder_point": 80,
            "is_primary": True,
        },
        {
            "stock_id": "STK-1010G-MDC",
            "item_id": "PROD-1010G",
            "warehouse_id": "WH-001",
            "bin_id": "BIN-002",
            "on_hand_quantity": 200,
            "allocated_quantity": 50,
            "on_order_quantity": 200,
            "reorder_point": 80,
            "is_primary": True,
        },
        {
            "stock_id": "STK-1020G-MDC",
            "item_id": "PROD-1020G",
            "warehouse_id": "WH-001",
            "bin_id": "BIN-001",
            "on_hand_quantity": 0,         # waiting on SCO return
            "allocated_quantity": 100,     # SO finished-kit demand
            "on_order_quantity": 0,
            "reorder_point": 25,
            "is_primary": True,
        },
    ]
    for stock in stock_rows:
        r_stk = requests.post(f"{BASE_URL}/inventory/stock", json=stock)
        _report(f"Stock {stock['stock_id']}", r_stk)

    movements = [
        {
            "movement_id": "MOV-SEED-001",
            "item_id": "PROD-1001G",
            "movement_type": "Receipt",
            "quantity": 250,
            "warehouse_id": "WH-001",
            "bin_id": "BIN-002",
            "reference": "PO-2026-0001",
            "notes": "Initial component stock supporting SO/SCO demand",
            "movement_date": "2026-06-25",
        },
        {
            "movement_id": "MOV-SEED-002",
            "item_id": "PROD-1010G",
            "movement_type": "Receipt",
            "quantity": 250,
            "warehouse_id": "WH-001",
            "bin_id": "BIN-002",
            "reference": "PO-2026-0001",
            "notes": "Initial component stock supporting SO/SCO demand",
            "movement_date": "2026-06-25",
        },
        {
            "movement_id": "MOV-SEED-003",
            "item_id": "PROD-1001G",
            "movement_type": "Issue",
            "quantity": -50,
            "warehouse_id": "WH-001",
            "bin_id": "BIN-002",
            "reference": "SCO-2026-0001",
            "notes": "Issued to subcontractor via ISSUE-2026-0001",
            "movement_date": "2026-07-02",
        },
        {
            "movement_id": "MOV-SEED-004",
            "item_id": "PROD-1010G",
            "movement_type": "Issue",
            "quantity": -50,
            "warehouse_id": "WH-001",
            "bin_id": "BIN-002",
            "reference": "SCO-2026-0001",
            "notes": "Issued to subcontractor via ISSUE-2026-0001",
            "movement_date": "2026-07-02",
        },
        {
            "movement_id": "MOV-SEED-005",
            "item_id": "PROD-1020G",
            "movement_type": "Adjustment",
            "quantity": 0,
            "warehouse_id": "WH-001",
            "bin_id": "BIN-001",
            "reference": "SO-26060004",
            "notes": "FG reserved for sales order; awaiting SCO return",
            "movement_date": "2026-07-03",
        },
    ]
    for mov in movements:
        # Skip zero-qty adjustment placeholder if API rejects it — use a tiny receipt note instead
        if mov["quantity"] == 0:
            continue
        r_mov = requests.post(f"{BASE_URL}/inventory/movements", json=mov)
        _report(f"Movement {mov['movement_id']}", r_mov)

    # ------------------------------------------------------------------
    # 10. Summary verification
    # ------------------------------------------------------------------
    r_inv = requests.get(f"{BASE_URL}/inventory/stock")
    _report("Inventory Stock List", r_inv)
    if r_inv.status_code == 200:
        print(f"  -> {len(r_inv.json())} inventory stock product(s) found")
        for row in r_inv.json():
            print(
                f"     {row['item_id']}: on_hand={row['on_hand_quantity']} "
                f"alloc={row['allocated_quantity']} on_order={row['on_order_quantity']} "
                f"ATP={row['available_to_promise']} [{row['status']}]"
            )

    r_sco_get = requests.get(f"{BASE_URL}/subcontract-orders/SCO-2026-0001")
    _report("Subcontract Order Detail", r_sco_get)
    if r_sco_get.status_code == 200:
        sco = r_sco_get.json()
        print(f"  -> SCO status={sco.get('status')} product={sco.get('item_id')} "
              f"qty={sco.get('quantity_ordered')} components={len(sco.get('components', []))}")

    print()
    print("🌱 Done. Linked demo chain:")
    print("   SO-26060004  → demands PROD-1020G (100) + spares → AR Invoice (Paid)")
    print("   PO-2026-0001 → buys PROD-1001G / PROD-1010G (200 each) → AP Bill (Paid)")
    print("   Cash / GL    → AR Check Deposit + AP Check Issue journal entries")
    print("   SCO-2026-0001 → builds PROD-1020G from those components (partial issue)")
    print("   Inventory     → same products with allocated / on-order / movements")


if __name__ == "__main__":
    seed_data()
