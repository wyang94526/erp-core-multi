# Master Data

Customers, vendors (suppliers), items, BOMs, work centers, and warehouses are live
database records. Ask the AI for counts or lists — do not guess from this doc.

## Customers
Statuses: `ACTIVE`, `INACTIVE`, `ON_HOLD`.
Ask: "How many active customers?" · "List customers" · "Show CUST-…"

## Vendors
`supplier_id` (often `SUP-…`). `vendor_type`: material, subcontractor, both, service.
Status is typically `Active` / `Inactive`.
Ask: "How many vendors?" · "List subcontract vendors"

## Payment terms
Global master at `/payment-terms` (`GET /api/v1/payment-terms`). Codes such as
`NET30`, `P02`, `DUE_ON_RECEIPT`. Vendors, customers, POs, and AP/AR invoices store
`payment_term_id` plus a string snapshot. Due date = invoice date + `due_days`.
Ask: "List payment terms" · "What is vendor X payment term?"

## Items
SKU = `item_id` (e.g. `PROD-1001G`). Flags: `is_purchase_item`, `is_raw_material`,
`is_subcontract_assembly`. BOM versions live on `itembomheaders` (draft / active / obsolete)
with component lines on `itembomcomponents`.
Ask: "How many items with BOM details?" · "Show BOM for PROD-1020G"

## Work centers & warehouses
Work centers are used by subcontractors. Warehouses have bins.
Ask: "How many work centers?" · "List warehouses"
