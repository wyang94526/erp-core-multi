/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { ItemFulfillment, SalesOrder, SalesOrderItem } from '../types'

export function overFulfillmentMessage(ordered: number, itemId?: string): string {
  if (itemId) {
    return `Total fulfillment quantity cannot exceed the ordered quantity of ${ordered} for item ${itemId}.`
  }
  return `Total fulfillment quantity cannot exceed the ordered quantity of ${ordered}.`
}

export function remainingFulfillmentQty(
  order: Pick<SalesOrder, 'sales_order_id' | 'items'>,
  fulfillments: ItemFulfillment[],
): number {
  const already = fulfilledQtyByLine(fulfillments, order.sales_order_id)
  return (order.items || []).reduce((sum, item) => {
    const done = already[item.so_item_id] || 0
    return sum + Math.max(0, Number(item.quantity_ordered || 0) - done)
  }, 0)
}

export function isSalesOrderFullyFulfilled(
  order: Pick<SalesOrder, 'sales_order_id' | 'items'>,
  fulfillments: ItemFulfillment[],
): boolean {
  const items = order.items || []
  if (items.length === 0) return false
  return remainingFulfillmentQty(order, fulfillments) <= 0
}

export function fulfilledQtyByLine(
  fulfillments: ItemFulfillment[],
  salesOrderId: string,
  options?: { excludeFulfillmentId?: number },
): Record<number, number> {
  const already: Record<number, number> = {}
  for (const ful of fulfillments) {
    if (ful.sales_order_id !== salesOrderId) continue
    if (options?.excludeFulfillmentId != null && ful.id === options.excludeFulfillmentId) continue
    for (const line of ful.lines || []) {
      already[line.sales_order_line_id] =
        (already[line.sales_order_line_id] || 0) + Number(line.quantity_fulfilled || 0)
    }
  }
  return already
}

export type FulfillmentQtyError = {
  sales_order_line_id: number
  item_id: string
  ordered: number
  cumulative: number
  message: string
}

function soLineById(order: Pick<SalesOrder, 'items'>): Map<number, SalesOrderItem> {
  return new Map((order.items || []).map((item) => [item.so_item_id, item]))
}

export function validateFulfillmentAgainstOrder(
  order: Pick<SalesOrder, 'sales_order_id' | 'items'>,
  fulfillments: ItemFulfillment[],
  lines: Array<{ sales_order_line_id: number; item_id?: string; quantity_fulfilled: number }>,
  options?: { excludeFulfillmentId?: number },
): FulfillmentQtyError[] {
  const already = fulfilledQtyByLine(fulfillments, order.sales_order_id, options)
  const soLines = soLineById(order)
  const requested = new Map<number, { qty: number; item_id: string }>()
  for (const line of lines) {
    const prev = requested.get(line.sales_order_line_id)
    requested.set(line.sales_order_line_id, {
      qty: (prev?.qty || 0) + Number(line.quantity_fulfilled || 0),
      item_id: line.item_id || prev?.item_id || '',
    })
  }

  const errors: FulfillmentQtyError[] = []
  for (const [lineId, { qty, item_id }] of requested) {
    const soLine = soLines.get(lineId)
    const ordered = Number(soLine?.quantity_ordered ?? 0)
    const itemId = soLine?.item_id || item_id
    const cumulative = (already[lineId] || 0) + qty
    if (qty > 0 && cumulative > ordered) {
      errors.push({
        sales_order_line_id: lineId,
        item_id: itemId,
        ordered,
        cumulative,
        message: overFulfillmentMessage(ordered, itemId),
      })
    }
  }
  return errors
}
