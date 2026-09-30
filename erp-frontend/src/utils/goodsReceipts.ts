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
  color: 'var(--accent, #1565c0)',
  fontWeight: 700,
  textDecoration: 'underline',
}
