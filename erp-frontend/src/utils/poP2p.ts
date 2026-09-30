/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { PurchaseOrder, PurchaseOrderItem } from '../types'
import { isAmountOnlyLine } from './itemTypes'

export const ALL_PO_ITEMS_RECEIVED_MESSAGE =
  'All items on this purchase order have been fully received'

export const PO_FULLY_INVOICED_MESSAGE = 'This purchase order is fully invoiced'

export const ALL_RECEIVED_QTY_BILLED_MESSAGE =
  'All received quantities have already been billed'

export const RECEIVE_GOODS_BEFORE_BILL_MESSAGE =
  'Receive goods before creating a supplier invoice'

export const BILL_RECEIVED_BEFORE_CANCEL_REMAINING =
  'Create a supplier invoice for the received quantity before cancelling remaining.'

export function remainingReceiveQty(item: PurchaseOrderItem): number {
  if (item.quantity_remaining_to_receive != null) {
    return Math.max(0, Number(item.quantity_remaining_to_receive) || 0)
  }
  const ordered = Number(item.quantity || 0)
  const received = Number(item.quantity_received || 0)
  if (isAmountOnlyLine(item.item_type, ordered, item.sku)) {
    return received > 0 ? 0 : 1
  }
  return Math.max(0, ordered - received)
}

export function canReceivePoGoods(
  po: Pick<PurchaseOrder, 'can_receive_goods' | 'items' | 'remaining_closed'>,
): boolean {
  if (po.remaining_closed) return false
  if (po.can_receive_goods === true) return true
  if (po.can_receive_goods === false) return false
  return (po.items || []).some((item) => remainingReceiveQty(item) > 0)
}

export function receiveGoodsBlockedReason(po: PurchaseOrder): string | null {
  if (canReceivePoGoods(po)) return null
  return po.receive_blocked_reason || ALL_PO_ITEMS_RECEIVED_MESSAGE
}

export function canCreatePoBill(
  po: Pick<PurchaseOrder, 'can_create_bill' | 'billing_status' | 'bill_blocked_reason'>,
): boolean {
  if (po.can_create_bill === true) return true
  if (po.can_create_bill === false) return false
  return (po.billing_status || '').toUpperCase() !== 'FULLY_BILLED'
}

export function createBillBlockedReason(po: PurchaseOrder): string | null {
  if (canCreatePoBill(po)) return null
  return po.bill_blocked_reason || PO_FULLY_INVOICED_MESSAGE
}

export function canShowPoCloseRemaining(
  po: Pick<
    PurchaseOrder,
    'can_close_remaining' | 'can_receive_goods' | 'can_create_bill' | 'remaining_closed' | 'items' | 'billing_status' | 'bill_blocked_reason'
  >,
): boolean {
  if (po.remaining_closed) return false
  if (po.can_close_remaining) return true
  return canReceivePoGoods(po) && canCreatePoBill(po)
}

export function closeRemainingBlockedReason(
  po: Pick<
    PurchaseOrder,
    'can_close_remaining' | 'can_receive_goods' | 'can_create_bill' | 'remaining_closed' | 'items' | 'billing_status' | 'bill_blocked_reason'
  >,
): string | null {
  if (po.can_close_remaining) return null
  if (canShowPoCloseRemaining(po)) return BILL_RECEIVED_BEFORE_CANCEL_REMAINING
  return null
}
