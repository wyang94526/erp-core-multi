/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { CSSProperties } from 'react'
import type { CashTransaction } from '../types'

export function invoiceDetailHref(invoiceId: string): string {
  return `/sales-invoices/${encodeURIComponent((invoiceId || '').trim())}`
}

export function billDetailHref(billId: string): string {
  return `/supplier-invoices/${encodeURIComponent((billId || '').trim())}`
}

export function sourceOrderHref(
  sourceType: string | null | undefined,
  sourceOrderId: string | null | undefined,
): string | null {
  const id = (sourceOrderId || '').trim()
  if (!id) return null
  const type = (sourceType || '').toUpperCase()
  if (
    type === 'SUBCONTRACT_ORDER' ||
    id.toUpperCase().startsWith('SCO-') ||
    id.toUpperCase().startsWith('UP23-')
  ) {
    return `/subcontract-orders/${encodeURIComponent(id)}`
  }
  return `/purchase-orders/${encodeURIComponent(id)}`
}

export function purchaseOrderHref(poNumber: string | null | undefined): string | null {
  const id = (poNumber || '').trim()
  if (!id) return null
  return `/purchase-orders/${encodeURIComponent(id)}`
}

export function cashReferenceHref(
  tx: Pick<CashTransaction, 'type' | 'reference_id'>,
): string | null {
  const id = (tx.reference_id || '').trim()
  if (!id) return null
  const upper = id.toUpperCase()
  const type = (tx.type || '').toLowerCase()
  if (upper.startsWith('INV-') || upper.startsWith('PU65-')) {
    return invoiceDetailHref(id)
  }
  if (upper.startsWith('ARINV-')) {
    return `/accounts-receivable?invoice=${encodeURIComponent(id)}`
  }
  if (upper.startsWith('VBILL-') || upper.startsWith('APBILL-')) {
    return billDetailHref(id)
  }
  if (type.includes('deposit')) {
    return `/accounts-receivable?invoice=${encodeURIComponent(id)}`
  }
  if (type.includes('issue')) {
    return billDetailHref(id)
  }
  return null
}

export function cashReferenceLabel(tx: Pick<CashTransaction, 'type' | 'reference_id'>): string {
  const href = cashReferenceHref(tx) || ''
  if (href.startsWith('/sales-invoices') || href.startsWith('/accounts-receivable')) {
    return 'Open invoice'
  }
  if (href.startsWith('/supplier-invoices') || href.startsWith('/accounts-payable')) {
    return 'Open bill'
  }
  return 'Open reference'
}

export const cashReferenceLinkStyle: CSSProperties = {
  color: '#1565c0',
  fontWeight: 700,
  textDecoration: 'none',
}
