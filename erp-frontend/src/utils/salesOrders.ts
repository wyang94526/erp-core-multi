/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { SalesOrder } from '../types'

export const SALES_ORDER_LOCKED_EDIT_MESSAGE =
  'Approved or invoiced orders cannot be modified directly. Use Create Revision to reopen this sales order.'

export const PARENT_SO_MUST_BE_APPROVED_FOR_SCO_MESSAGE =
  'The parent Sales Order must be approved before a subcontract order can be created or updated.'

const EDITABLE_APPROVAL = new Set(['DRAFT', 'REJECTED'])
const LOCKED_STATUS = new Set(['SHIPPED', 'INVOICED', 'FULFILLED', 'PARTIALLY_FULFILLED'])

function normalizeFlag(value: string | null | undefined): string {
  return (value || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
}

export function isSalesOrderEditable(
  order: Pick<SalesOrder, 'status' | 'approval_status'> & {
    invoice_status?: SalesOrder['invoice_status']
  },
): boolean {
  const approval = normalizeFlag(order.approval_status || 'DRAFT')
  const status = normalizeFlag(order.status)
  const invoiceStatus = normalizeFlag(order.invoice_status)
  if (LOCKED_STATUS.has(status) || invoiceStatus === 'FULLY_BILLED') return false
  return EDITABLE_APPROVAL.has(approval)
}

export function salesOrderDetailPath(orderId: string): string {
  return `/orders/${orderId}`
}

export function salesOrderEditPath(orderId: string): string {
  return `/orders/${orderId}/edit`
}

export function isSalesOrderRevisable(
  order: Pick<SalesOrder, 'status' | 'approval_status'> & {
    invoice_status?: SalesOrder['invoice_status']
    can_revise?: boolean
  },
): boolean {
  if (typeof order.can_revise === 'boolean') return order.can_revise
  const approval = normalizeFlag(order.approval_status || 'DRAFT')
  const status = normalizeFlag(order.status)
  const invoiceStatus = normalizeFlag(order.invoice_status)
  if (approval !== 'APPROVED') return false
  if (LOCKED_STATUS.has(status) || invoiceStatus === 'FULLY_BILLED') return false
  return true
}
