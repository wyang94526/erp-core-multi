import type { SalesOrder } from '../types'

export type SalesOrderInvoiceStatus = 'UNBILLED' | 'PARTIALLY_BILLED' | 'FULLY_BILLED'

export function salesOrderInvoiceStatus(order: Pick<SalesOrder, 'invoice_status'>): SalesOrderInvoiceStatus {
  const status = (order.invoice_status || 'UNBILLED').toUpperCase()
  if (status === 'FULLY_BILLED' || status === 'PARTIALLY_BILLED') return status
  return 'UNBILLED'
}

export function isFullyInvoiced(order: Pick<SalesOrder, 'invoice_status'>): boolean {
  return salesOrderInvoiceStatus(order) === 'FULLY_BILLED'
}

export function invoiceStatusLabel(status: SalesOrderInvoiceStatus): string {
  if (status === 'FULLY_BILLED') return 'Fully Billed'
  if (status === 'PARTIALLY_BILLED') return 'Partially Billed'
  return 'Unbilled'
}

export function invoiceStatusColors(status: SalesOrderInvoiceStatus): { bg: string; text: string } {
  if (status === 'FULLY_BILLED') return { bg: '#e3f2fd', text: '#1565c0' }
  if (status === 'PARTIALLY_BILLED') return { bg: '#fff3e0', text: '#e65100' }
  return { bg: '#f5f5f5', text: '#616161' }
}
