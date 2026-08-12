# GTT-USA ERP Overview

GTT-USA ERP covers sales orders, purchase orders, subcontract orders, inventory,
accounts receivable/payable, cash, and general ledger with multi-stage approval workflows.

## Modules
- **Sales & Purchasing**: Sales Orders, Purchase Orders, Subcontract Orders
- **Entities & Catalog**: Customers, Vendors, Items (SKU = `item_id`)
- **Inventory**: Stock on-hand, ATP, movements, warehouses/bins
- **Finance**: Chart of accounts, AR invoices, AP bills, cash, GL journals
- **Administration**: Users, roles, permissions, approval workflow bands

## Authentication
Users sign in with email/password and receive a JWT. Role-based navigation and
permission codes gate actions (e.g. `sales_order:view`, `sales_order:create`).

## AI Assistant
The embedded assistant can look up live sales orders and inventory, search this
documentation, and propose draft sales orders that require user confirmation before save.
