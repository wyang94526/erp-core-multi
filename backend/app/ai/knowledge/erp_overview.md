# GTT-USA ERP Overview

GTT-USA ERP covers master data, sales, purchasing, subcontract manufacturing, inventory,
accounts receivable/payable, cash, and general ledger with multi-stage approval workflows.

## Modules
- **Sales & Purchasing**: Sales Orders, Item Fulfillments, Purchase Orders, Goods Receipts
- **Manufacturing**: Subcontract Orders, Work Centers, Item BOMs
- **Entities & Catalog**: Customers, Vendors, Items (SKU = `item_id`)
- **Inventory**: Stock on-hand, ATP, movements, warehouses/bins
- **Finance**: Chart of accounts, sales invoices, AR invoices, supplier invoices, AP bills, cash, GL journals
- **Administration**: Users, roles, permissions, approval workflow bands

## Authentication
Users sign in with email/password and receive a JWT. Role-based navigation and
permission codes gate actions (e.g. `sales_order:view`, `sales_order:create`).

## AI Assistant
The embedded assistant can look up **live counts and records across the whole ERP**
(customers, vendors, items/BOMs, orders, inventory, finance), search this documentation,
and propose draft sales, purchase, or subcontract orders that require user confirmation before save.

Count examples:
- "How many active customers?"
- "How many items with BOM details?"
- "How many unpaid AR invoices?"

Clone examples:
- "create PO like PO-XXXX with x 100"
- "create Subcontract Order like SCO-XXXX with x 2"
