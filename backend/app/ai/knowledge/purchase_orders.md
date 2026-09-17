# Purchase Orders

## Statuses
Operational `status` values: `Draft`, `Submitted`, `Approved`, `Void`.
Approval workflow uses `approval_status` and `current_approval_step`.
Billing uses `billing_status` (`UNBILLED`, `PARTIALLY_BILLED`, `FULLY_BILLED`) after supplier invoices.

## Creating a purchase order
Required fields:
- `supplier_id` (vendor)
- at least one line with `sku`, `quantity`, `unit_price`, line totals

The server assigns `po_number` on create as `PU62-{YY}{MM}{XXXX}` from the order date (not the system date). Do not invent a PO number.

Default create status is `Draft`. Submitting enters the approval workflow.

## Material PO linked to a subcontract order (外發加工單)
`purchaseorders.sco_number` links either:
- a **Material PO** buying kit components for an open subcontract order, or
- a **Subcontract PO** buying outside-processing service from the subcontractor.

On a Material PO, the vendor is the **goods supplier**, not the subcontractor. Import remaining BOM demand with
`GET /api/v1/subcontract-orders/{sco_number}/unfulfilled-components`. Remaining qty subtracts other non-Void
Material POs for the same `sco_component_id` (including Draft). Lines store `sco_component_id` and snapshot `uom`.
Imported unit price uses vendor item cost (selected vendor, then any mapping), then last non-void PO price,
then item catalog `unit_price`.

## Freight terms
`freight_terms`:
- `PREPAID_ON_PO` — `shipping_fee` is payable to this vendor and included in `grand_total`
- `THIRD_PARTY_COLLECT` / `ROUTING_ACCOUNT` — `shipping_fee` is estimated 3PL freight and **excluded** from vendor `grand_total`

Supplier invoices default `freight_amount` from vendor-payable freight only (0 when 3rd-party/routing).
Submit requires `carrier_account` when freight is 3rd-party or routing.

## Procure-to-Pay
After approval: **Receive Goods** (inventory + GRNI), then **Create Bill / Supplier Invoice**,
approve the bill (GRNI → AP), then pay (AP → Cash). Freight, customs duty, rent, and similar
charges without a PO use **Create Non-PO Invoice** (`LANDED_COST` or `EXPENSE`).

## Permissions
- `po:view` — list/detail
- `po:create` — create/edit drafts
- `po:submit` / `po:approve` — workflow actions

## AI tool tips
Ask: "list purchase orders with status Approved" or "show PO-26060001".
To draft via AI:
- Clone: "create Purchase Order like PO-P2P-1C772F with x 100"
- New: "create draft PO for SUP-… with 2x PROD-1001G"
