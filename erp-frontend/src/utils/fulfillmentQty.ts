/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { ItemFulfillment, SalesOrder, SalesOrderItem, SubcontractOrder } from '../types'

export function overFulfillmentMessage(ordered: number, itemId?: string): string {
  if (itemId) {
    return `Total fulfillment quantity cannot exceed the ordered quantity of ${ordered} for item ${itemId}.`
  }
  return `Total fulfillment quantity cannot exceed the ordered quantity of ${ordered}.`
}

export function overScoReceiptMessage(
  received: number,
  itemId?: string,
  scoNumbers?: string[],
): string {
  const origin = scoNumbers?.length ? `subcontract ${scoNumbers.join(', ')}` : 'the linked subcontract'
  const item = itemId ? ` for item ${itemId}` : ''
  return `Cannot fulfill more than the ${received} received on ${origin}${item}. Ship the received quantity now; remaining quantity can be fulfilled after the next receipt.`
}

export function subcontractReceivedBySoLine(
  order: Pick<SalesOrder, 'items'>,
  subcontractOrders: SubcontractOrder[],
): Record<number, { received: number; scoNumbers: string[] }> {
  const soLinesByItem = new Map<string, number[]>()
  for (const item of order.items || []) {
    const ids = soLinesByItem.get(item.item_id) || []
    ids.push(item.so_item_id)
    soLinesByItem.set(item.item_id, ids)
  }

  const caps: Record<number, { received: number; scoNumbers: string[] }> = {}
  const add = (lineId: number | null | undefined, qty: number, scoNumber: string) => {
    if (lineId == null) return
    const current = caps[lineId] || { received: 0, scoNumbers: [] }
    if (!current.scoNumbers.includes(scoNumber)) current.scoNumbers.push(scoNumber)
    current.received += qty
    caps[lineId] = current
  }

  for (const sco of subcontractOrders) {
    if ((sco.status || '').toUpperCase() === 'CANCELLED') continue
    const recvByScoLine: Record<number, number> = {}
    let headerQty = 0
    for (const receipt of sco.finished_goods_receipts || []) {
      const qty = Number(receipt.quantity_received || 0)
      if (receipt.sco_line_id) {
        recvByScoLine[receipt.sco_line_id] = (recvByScoLine[receipt.sco_line_id] || 0) + qty
      } else {
        headerQty += qty
      }
    }
    const lines = sco.lines || []
    if (lines.length) {
      for (const line of lines) {
        const qty = recvByScoLine[line.sco_line_id] || 0
        if (line.so_item_id) add(line.so_item_id, qty, sco.sco_number)
        else (soLinesByItem.get(line.item_id) || []).forEach((id) => add(id, qty, sco.sco_number))
      }
      if (headerQty) {
        (soLinesByItem.get(sco.item_id) || []).forEach((id) => add(id, headerQty, sco.sco_number))
      }
    } else {
      const total = headerQty + Object.values(recvByScoLine).reduce((sum, qty) => sum + qty, 0)
      ;(soLinesByItem.get(sco.item_id) || []).forEach((id) => add(id, total, sco.sco_number))
    }
  }
  return caps
}

export function remainingFulfillmentQty(
  order: Pick<SalesOrder, 'sales_order_id' | 'items' | 'remaining_closed'>,
  fulfillments: ItemFulfillment[],
): number {
  if (order.remaining_closed) return 0
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
  options?: { excludeFulfillmentId?: number; statuses?: Iterable<string> },
): Record<number, number> {
  const allowed = options?.statuses
    ? new Set([...options.statuses].map((status) => status.toUpperCase()))
    : null
  const already: Record<number, number> = {}
  for (const ful of fulfillments) {
    if (ful.sales_order_id !== salesOrderId) continue
    if (options?.excludeFulfillmentId != null && ful.id === options.excludeFulfillmentId) continue
    if (allowed && !allowed.has((ful.status || '').toUpperCase())) continue
    for (const line of ful.lines || []) {
      already[line.sales_order_line_id] =
        (already[line.sales_order_line_id] || 0) + Number(line.quantity_fulfilled || 0)
    }
  }
  return already
}

export type SalesOrderLineQtyProgress = {
  so_item_id: number
  ordered: number
  fulfilled: number
  cancelled: number
}

export function salesOrderQtyProgress(
  order: Pick<SalesOrder, 'sales_order_id' | 'items'>,
  fulfillments: ItemFulfillment[],
): {
  byLine: Record<number, SalesOrderLineQtyProgress>
  ordered: number
  fulfilled: number
  cancelled: number
} {
  const fulfilled = fulfilledQtyByLine(fulfillments, order.sales_order_id, {
    statuses: ['PICKED', 'PACKED', 'SHIPPED'],
  })
  const byLine: Record<number, SalesOrderLineQtyProgress> = {}
  let orderedTotal = 0
  let fulfilledTotal = 0
  let cancelledTotal = 0
  for (const item of order.items || []) {
    const ordered = Number(item.quantity_ordered || 0)
    const shipped = fulfilled[item.so_item_id] || 0
    const cancelled = Math.max(0, ordered - shipped)
    byLine[item.so_item_id] = {
      so_item_id: item.so_item_id,
      ordered,
      fulfilled: shipped,
      cancelled,
    }
    orderedTotal += ordered
    fulfilledTotal += shipped
    cancelledTotal += cancelled
  }
  return { byLine, ordered: orderedTotal, fulfilled: fulfilledTotal, cancelled: cancelledTotal }
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
