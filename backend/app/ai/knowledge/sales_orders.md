# Sales Orders

## Statuses
Operational `status` values typically include: `DRAFT`, `SUBMITTED`, `APPROVED`, `CANCELLED`.
Approval workflow uses `approval_status` and `current_approval_step`.

## Creating an order
Required fields:
- `sales_order_id` (unique)
- `customer_id`
- `bill_to_location_id`, `ship_to_location_id` (must belong to customer)
- `customer_po_number`
- `order_date`
- at least one line item with `item_id`, `quantity_ordered`, `unit_price`, `total_amount`

Default create status is `DRAFT`. Submitting enters the approval workflow based on amount bands.

## Permissions
- `sales_order:view` — list/detail
- `sales_order:create` — create drafts
- `sales_order:submit` / `sales_order:approve` — workflow actions

## AI tool tips
Ask: "list sales orders with status DRAFT" or "show SO-26060004".
To draft via AI: "create draft order for CUST-GTT-USA with 2x PROD-1001G".
