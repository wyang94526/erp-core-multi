/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { CSSProperties } from 'react'
import type { GoodsReceipt, GoodsReceiptJournal, JournalEntry, LedgerPosting } from '../types'

export function goodsReceiptHref(receiptId: string | null | undefined): string {
  return `/goods-receipts/${encodeURIComponent((receiptId || '').trim())}`
}

export function goodsReceiptStatusLabel(status: string | null | undefined): string {
  const key = (status || 'POSTED').toUpperCase()
  if (key === 'POSTED') return 'Posted'
  if (key === 'DRAFT') return 'Draft'
  if (key === 'CANCELLED') return 'Voided'
  return status || 'Posted'
}

export function goodsReceiptStatusColors(status: string | null | undefined): { bg: string; text: string } {
  const key = (status || '').toUpperCase()
  if (key === 'POSTED') return { bg: '#e8f5e9', text: '#2e7d32' }
  if (key === 'DRAFT') return { bg: '#f5f5f5', text: '#616161' }
  if (key === 'CANCELLED') return { bg: '#ffebee', text: '#c62828' }
  return { bg: '#f5f5f5', text: '#616161' }
}

export function formatReceiptQty(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(4)).toString()
}

type ReceiptQtyLine = {
  item_id?: string | null
  uom?: string | null
  quantity_received?: number | string | null
  quantity_ordered?: number | string | null
}

/** True when every receipt line is the same SKU and (if present) the same UOM. */
export function receiptQtyIsHomogeneous(lines: ReceiptQtyLine[] | null | undefined): boolean {
  const rows = lines || []
  if (rows.length <= 1) return true
  const items = new Set(rows.map((line) => (line.item_id || '').trim()).filter(Boolean))
  const uoms = new Set(rows.map((line) => (line.uom || '').trim().toUpperCase()).filter(Boolean))
  return items.size <= 1 && uoms.size <= 1
}

export function receiptQtyTotals(
  lines: ReceiptQtyLine[] | null | undefined,
  orderQtyTotal?: number | null,
): { received: number; ordered: number } {
  const rows = lines || []
  const received = rows.reduce((total, line) => total + Number(line.quantity_received || 0), 0)
  const fromOrder = Number(orderQtyTotal)
  const ordered = Number.isFinite(fromOrder) && fromOrder > 0
    ? fromOrder
    : rows.reduce((total, line) => total + Number(line.quantity_ordered || 0), 0)
  return { received, ordered }
}

export function formatReceiptPercent(received: number, ordered: number): string {
  if (!(ordered > 0) || !Number.isFinite(received)) return '—'
  const pct = (received / ordered) * 100
  const rounded = Math.round(pct * 10) / 10
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}%`
}

export function receiptReceivedHint(
  lines: ReceiptQtyLine[] | null | undefined,
  orderQtyTotal?: number | null,
): string | undefined {
  const mixed = !receiptQtyIsHomogeneous(lines)
  const { received, ordered } = receiptQtyTotals(lines, orderQtyTotal)
  if (mixed && ordered > 0) {
    return `${formatReceiptQty(received)} received of ${formatReceiptQty(ordered)} ordered (${formatReceiptPercent(received, ordered)} of the order quantity). Open the receipt for each line.`
  }
  if (mixed) {
    return 'Component quantities are not totaled because they are different items. Open the receipt to see each line.'
  }
  return undefined
}

/** Header qty for a goods receipt. Mixed kit/BOM lines show % of ordered quantity. */
export function formatReceiptHeaderQty(
  lines: ReceiptQtyLine[] | null | undefined,
  orderQtyTotal?: number | null,
): string {
  const rows = lines || []
  if (!rows.length) return '—'
  const { received, ordered } = receiptQtyTotals(rows, orderQtyTotal)
  if (!receiptQtyIsHomogeneous(rows)) {
    return ordered > 0 ? formatReceiptPercent(received, ordered) : 'Mixed items'
  }
  const uom = (rows.find((line) => (line.uom || '').trim())?.uom || '').trim()
  const qty = formatReceiptQty(received)
  return uom ? `${qty} ${uom}` : qty
}

export function formatReceiptMoney(value: number | string | null | undefined, currency = 'USD'): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
}

export function receiptWarehouseLabel(receipt: Pick<
  GoodsReceipt,
  'warehouse_name' | 'warehouse_code' | 'warehouse_id' | 'bin_code' | 'bin_id'
>): string {
  const warehouse = receipt.warehouse_name || receipt.warehouse_code || receipt.warehouse_id
  const bin = receipt.bin_code || receipt.bin_id
  if (warehouse && bin) return `${warehouse} / ${bin}`
  return warehouse || bin || '—'
}

export function journalPurposeLabel(purpose: string | null | undefined): string {
  const key = (purpose || '').toUpperCase()
  if (key === 'GRNI_ACCRUAL') return 'GRNI accrual'
  if (key === 'GRNI_CLEAR') return 'GRNI cleared to AP'
  return 'Journal'
}

export function toJournalEntry(row: GoodsReceiptJournal): JournalEntry {
  const postings: LedgerPosting[] = (row.postings || []).map((posting, index) => ({
    id: posting.id || `${row.id}-${index}`,
    entry_id: row.id,
    account_id: posting.account_id || '',
    debit: Number(posting.debit) || 0,
    credit: Number(posting.credit) || 0,
    currency: posting.currency || 'USD',
    description: posting.description || null,
    account_code: posting.account_code || null,
    account_name: posting.account_name || null,
  }))
  return {
    id: row.id,
    journal_number: row.journal_number || null,
    created_at: row.created_at || new Date().toISOString(),
    description: row.description,
    posted_by_user_id: row.posted_by_user_id || null,
    period: row.period || null,
    posting_date: row.posting_date || null,
    reference: row.reference || null,
    posting_status: (row.posting_status as JournalEntry['posting_status']) || 'Draft',
    approval_status: (row.approval_status as JournalEntry['approval_status']) || 'DRAFT',
    is_system_generated: Boolean(row.is_system_generated),
    source_document_type: row.source_document_type || null,
    source_record_id: row.source_record_id || null,
    posting_rule_id: row.posting_rule_id || null,
    postings,
  }
}

export const receiptLinkStyle: CSSProperties = {
  color: 'var(--link, #1565c0)',
  fontWeight: 700,
  textDecoration: 'underline',
}
