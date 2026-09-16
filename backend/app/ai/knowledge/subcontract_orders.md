# Subcontract Orders

A subcontract order (SCO) is a vendor document that can cover multiple finished assemblies from one Customer Sales Order. Each SCO line is a Sales Order item. The Material BOM explodes per line. Vendor labor / shipping / admin charges are a flexible cost sheet on that line (minutes × SF rate / 60 + margin).

## Statuses
Operational `status` values commonly include: `PLANNED`, `PARTIALLY_ISSUED`, `MATERIALS_ISSUED`, `PARTIALLY_RECEIVED`, `COMPLETED`, `CANCELLED`.
Approval workflow uses `approval_status` and `current_approval_step` (starts as `DRAFT` on create). Approval amount is the document total (sum of line totals).
Billing uses `billing_status` (`UNBILLED`, `PARTIALLY_BILLED`, `FULLY_BILLED`) after supplier invoices.

## Creating a subcontract order
Preferred payload:
- `supplier_id`, optional `sales_order_id` (the server assigns `sco_number` as `UP23-{YY}{MM}{XXXX}` from the order date)
- `lines[]` each with `so_item_id`, `item_id`, `quantity_ordered`, optional `bom_header_id`, `charges[]`, `components[]`

Legacy single-item create (`item_id` + `quantity_ordered`) still works and is stored as one line.

Cost sheet rows are free-text (default template: Receiving/IQC, Assembly, Inventory & Shipment, Admin, Margin). `cost_per_unit = minutes × sf_rate / 60` unless a flat cost is entered.

Cost sheet edits are allowed while `approval_status` is `DRAFT` or `REJECTED`. After approval, `POST /api/v1/subcontract-orders/{sco_number}/amend` (permission `subcontract:submit`) reopens the same SCO as Draft, increments `amendment_number`, and writes an `AMENDED` approval-history row. Linked Material POs stay. Issue materials can continue during the amendment. Supplier invoices still require `APPROVED`. Re-submit the updated cost sheet through the normal approval workflow.

Receiving finished goods (`POST /{sco_number}/receive-goods`) posts warehouse stock via `inventory.receive_stock` (same path as PO receipts) and GRNI. Sales-order fulfillment issues that warehouse quantity, not the item-master cache.

SO-line allocation: remaining = SO qty − SUM(non-cancelled SCO line qty) for that `so_item_id`.

## Permissions
- `subcontract:view` — list/detail
- `subcontract:create` — create/edit
- `subcontract:submit` / `subcontract:approve` — workflow actions

## AI tool tips
Ask: "list subcontract orders" or "show SCO-2026-0001".
To draft via AI:
- Clone: "create Subcontract Order like SCO-2026-0001 with x 2"
- New: "create subcontract order for SUP-… item PROD-1020G quantity 50"
