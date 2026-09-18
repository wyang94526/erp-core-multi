/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { PurchaseOrder, PurchaseOrderItem } from '../types'

export const ALL_PO_ITEMS_RECEIVED_MESSAGE =
  'All items on this purchase order have been fully received'

export const PO_FULLY_INVOICED_MESSAGE = 'This purchase order is fully invoiced'

export const ALL_RECEIVED_QTY_BILLED_MESSAGE =
  'All received quantities have already been billed'

export const RECEIVE_GOODS_BEFORE_BILL_MESSAGE =
  'Receive goods before creating a supplier invoice'

export function remainingReceiveQty(item: PurchaseOrderItem): number {
  if (item.quantity_remaining_to_receive != null) {
    return Number(item.quantity_remaining_to_receive)
  }
  return Number(item.quantity || 0)
}

export function canReceivePoGoods(po: Pick<PurchaseOrder, 'can_receive_goods' | 'items'>): boolean {
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
