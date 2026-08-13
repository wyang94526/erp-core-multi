# Subcontract Orders

Subcontract orders (SCOs) send an assembly / finished item to a subcontract vendor with a material kit exploded from the item’s Material BOM.

## Statuses
Operational `status` values commonly include: `PLANNED`, `ISSUED`, `PARTIALLY_ISSUED`, `COMPLETED`, `CANCELLED`.
Approval workflow uses `approval_status` and `current_approval_step` (starts as `DRAFT` on create).
Billing uses `billing_status` (`UNBILLED`, `PARTIALLY_BILLED`, `FULLY_BILLED`) after supplier invoices.

## Creating a subcontract order
Required fields:
- `sco_number` (unique)
- `supplier_id` (subcontract vendor)
- `item_id` (assembly with a Material BOM / subcontract kit)
- `quantity_ordered` (positive integer)
- optional `unit_price`, `expected_return_date`, `notes`

On create, component lines are auto-built from BOM × quantity (including scrap / yield loss).

## Permissions
- `subcontract:view` — list/detail
- `subcontract:create` — create/edit
- `subcontract:submit` / `subcontract:approve` — workflow actions

## AI tool tips
Ask: "list subcontract orders" or "show SCO-2026-0001".
To draft via AI:
- Clone: "create Subcontract Order like SCO-2026-0001 with x 2"
- New: "create subcontract order for SUP-… item PROD-1020G quantity 50"
