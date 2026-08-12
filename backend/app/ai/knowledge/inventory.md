# Inventory

Item master is the `items` table. Internal SKU is `item_id` (e.g. PROD-1001G).
Customer part number is separate (`customer_part_number`).

## Stock fields
- `on_hand_quantity`
- `allocated_quantity`
- `on_order_quantity`
- `available_to_promise` (ATP) ≈ on_hand - allocated + on_order
- Status: `In Stock`, `Low Stock`, `Out of Stock` (based on reorder point)

Stock is stored per warehouse/bin in `inventory_stock`, with company-wide cache on `items.on_hand_quantity`.

## Common questions
- "What is stock for PROD-1020G?"
- "Summarize inventory levels"
- "Which items are low stock?"
