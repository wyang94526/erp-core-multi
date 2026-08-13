# Purchase Orders

## Statuses
Operational `status` values: `Draft`, `Submitted`, `Approved`, `Void`.
Approval workflow uses `approval_status` and `current_approval_step`.
Billing uses `billing_status` (`UNBILLED`, `PARTIALLY_BILLED`, `FULLY_BILLED`) after supplier invoices.

## Creating a purchase order
Required fields:
- `po_number` (unique)
- `supplier_id` (vendor)
- at least one line with `sku`, `quantity`, `unit_price`, line totals

Default create status is `Draft`. Submitting enters the approval workflow.

## Procure-to-Pay
After approval: **Receive Goods** (inventory + GRNI), then **Create Bill / Supplier Invoice**,
approve the bill (GRNI → AP), then pay (AP → Cash).

## Permissions
- `po:view` — list/detail
- `po:create` — create/edit drafts
- `po:submit` / `po:approve` — workflow actions

## AI tool tips
Ask: "list purchase orders with status Approved" or "show PO-26060001".
To draft via AI:
- Clone: "create Purchase Order like PO-P2P-1C772F with x 100"
- New: "create draft PO for SUP-… with 2x PROD-1001G"
