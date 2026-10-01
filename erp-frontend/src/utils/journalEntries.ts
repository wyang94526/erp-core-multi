/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { JournalEntry, PostingRule } from '../types'

export const JOURNAL_CREATE_PATH = '/general-ledger/journals/new'
export const MONTH_END_CLOSE_PATH = '/general-ledger/month-end-close'
export const YEAR_END_CLOSE_PATH = '/general-ledger/year-end-close'

export function journalEditPath(id: string, options?: { from?: string | null }) {
  const path = `/general-ledger/journals/${encodeURIComponent(id)}/edit`
  const from = (options?.from || '').trim()
  if (!from) return path
  return `${path}?from=${encodeURIComponent(from)}`
}

export function journalReturnPath(
  from?: string | null,
  sourceType?: string | null,
  sourceRecordId?: string | null,
) {
  const explicit = (from || '').trim()
  if (explicit) return explicit
  return sourceDocumentPath(sourceType, sourceRecordId) || '/general-ledger'
}

export function journalReturnLabel(path?: string | null) {
  const route = (path || '').split('?')[0]
  if (route.startsWith('/goods-receipts')) return 'Back to Goods Receipt'
  if (route.startsWith('/supplier-invoices')) return 'Back to Supplier Invoice'
  if (route.startsWith('/sales-invoices')) return 'Back to Sales Invoice'
  if (route.startsWith('/bank-transfers')) return 'Back to Bank Transfer'
  if (route.startsWith('/purchase-orders')) return 'Back to Purchase Order'
  if (route.startsWith('/subcontract-orders')) return 'Back to Subcontract Order'
  if (route.includes('month-end-close')) return 'Back to Month-End Close'
  if (route.includes('year-end-close')) return 'Back to Year-End Close'
  if (route.startsWith('/general-ledger')) return 'Back to General Ledger'
  return 'Back'
}

export function shortJournalId(id: string) {
  return id.split('-')[0].toUpperCase()
}

export function journalDisplayId(entry?: { id?: string; journal_number?: string | null } | null) {
  const number = (entry?.journal_number || '').trim()
  if (number) return number
  return entry?.id ? shortJournalId(entry.id) : '—'
}

export function isSystemJournal(entry: Pick<JournalEntry, 'is_system_generated'>) {
  return Boolean(entry.is_system_generated)
}

export function isJournalDraft(entry: Pick<JournalEntry, 'approval_status' | 'posting_status'>) {
  const approval = (entry.approval_status || 'DRAFT').toUpperCase()
  const posting = (entry.posting_status || '').toLowerCase()
  return posting !== 'posted' && approval === 'DRAFT'
}

export function isJournalEditable(
  entry: Pick<JournalEntry, 'approval_status' | 'posting_status' | 'is_system_generated'>,
) {
  if (isSystemJournal(entry)) return false
  const approval = (entry.approval_status || 'DRAFT').toUpperCase()
  const posting = (entry.posting_status || '').toLowerCase()
  return posting !== 'posted' && (approval === 'DRAFT' || approval === 'REJECTED')
}

export function isJournalDeletable(
  entry: Pick<JournalEntry, 'approval_status' | 'posting_status' | 'is_system_generated'>,
) {
  if (isSystemJournal(entry)) return false
  const approval = (entry.approval_status || '').toLowerCase()
  const posting = (entry.posting_status || '').toLowerCase()
  return posting === 'draft' && approval === 'draft'
}

const SOURCE_TEXT_MARKERS: Array<{ type: string; markers: string[] }> = [
  { type: 'MONTH_END_CLOSE', markers: ['month-end close', 'mec-'] },
  { type: 'YEAR_END_CLOSE', markers: ['year-end close', 'yec-'] },
  { type: 'BANK_TRANSFER', markers: ['bank transfer', 'btr-'] },
  { type: 'GOODS_RECEIPT', markers: ['goods receipt'] },
  { type: 'SUPPLIER_INVOICE', markers: ['supplier invoice', 'grni clear'] },
  { type: 'SALES_INVOICE', markers: ['sales invoice'] },
  { type: 'SALES_CREDIT', markers: ['credit memo'] },
  { type: 'AR_PAYMENT', markers: ['ar payment'] },
  { type: 'AP_PAYMENT', markers: ['ap payment'] },
]

export function inferredJournalSource(
  entry: Pick<JournalEntry, 'source_document_type' | 'description' | 'reference' | 'is_system_generated'>,
) {
  const stored = (entry.source_document_type || '').trim().toUpperCase()
  if (stored) return stored
  const blob = `${entry.description || ''} ${entry.reference || ''}`.toLowerCase()
  const match = SOURCE_TEXT_MARKERS.find(({ markers }) => markers.some((marker) => blob.includes(marker)))
  return match?.type || 'MANUAL'
}

export function isInferredSystemJournal(
  entry: Pick<JournalEntry, 'source_document_type' | 'description' | 'reference' | 'is_system_generated'>,
) {
  return isSystemJournal(entry) || inferredJournalSource(entry) !== 'MANUAL'
}

export function sourceDocumentLabel(sourceType?: string | null) {
  const kind = (sourceType || '').toUpperCase()
  if (kind === 'GOODS_RECEIPT') return 'Goods Receipt'
  if (kind === 'SUPPLIER_INVOICE') return 'Supplier Invoice'
  if (kind === 'SALES_INVOICE') return 'Sales Invoice'
  if (kind === 'SALES_CREDIT') return 'Credit Memo'
  if (kind === 'AR_PAYMENT') return 'Customer Payment'
  if (kind === 'AP_PAYMENT') return 'Vendor Payment'
  if (kind === 'BANK_TRANSFER') return 'Bank Transfer'
  if (kind === 'MONTH_END_CLOSE') return 'Month-End Close'
  if (kind === 'YEAR_END_CLOSE') return 'Year-End Close'
  return kind || 'Source Document'
}

export function sourceDocumentPath(
  sourceType?: string | null,
  sourceRecordId?: string | null,
): string | null {
  const kind = (sourceType || '').toUpperCase()
  const id = (sourceRecordId || '').trim()
  if (kind === 'MONTH_END_CLOSE') return MONTH_END_CLOSE_PATH
  if (kind === 'YEAR_END_CLOSE') return YEAR_END_CLOSE_PATH
  if (!kind || !id) return null
  if (kind === 'GOODS_RECEIPT') return `/goods-receipts/${encodeURIComponent(id)}`
  if (kind === 'SUPPLIER_INVOICE' || kind === 'AP_PAYMENT') {
    return `/supplier-invoices/${encodeURIComponent(id)}`
  }
  if (kind === 'SALES_INVOICE' || kind === 'SALES_CREDIT' || kind === 'AR_PAYMENT') {
    return `/sales-invoices/${encodeURIComponent(id)}`
  }
  if (kind === 'BANK_TRANSFER') return `/bank-transfers/${encodeURIComponent(id)}`
  return null
}

export function postingRulePath(ruleId?: string | null): string | null {
  const id = (ruleId || '').trim()
  return id ? `/posting-rules#rule-${id}` : null
}

export const JOURNAL_SOURCE_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All sources' },
  { value: 'GOODS_RECEIPT', label: 'Goods Receipt' },
  { value: 'SUPPLIER_INVOICE', label: 'Supplier Invoice' },
  { value: 'SALES_INVOICE', label: 'Sales Invoice' },
  { value: 'SALES_CREDIT', label: 'Credit Memo' },
  { value: 'AR_PAYMENT', label: 'Customer Payment' },
  { value: 'AP_PAYMENT', label: 'Vendor Payment' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'MONTH_END_CLOSE', label: 'Month-End Close' },
  { value: 'YEAR_END_CLOSE', label: 'Year-End Close' },
  { value: 'MANUAL', label: 'Manual / imported' },
] as const

export type JournalLedgerFilters = {
  q: string
  source: string
  origin: string
  date_from: string
  date_to: string
  period: string
  rule: string
  posting: string
  approval: string
}

export const EMPTY_JOURNAL_LEDGER_FILTERS: JournalLedgerFilters = {
  q: '',
  source: 'ALL',
  origin: 'ALL',
  date_from: '',
  date_to: '',
  period: '',
  rule: 'ALL',
  posting: 'ALL',
  approval: 'ALL',
}

export function journalPostedDate(entry: Pick<JournalEntry, 'posting_date' | 'created_at'>) {
  return (entry.posting_date || entry.created_at || '').slice(0, 10)
}

export function journalSearchText(entry: JournalEntry) {
  const lines = (entry.postings || []).flatMap((row) => [
    row.description,
    row.account_code,
    row.account_name,
  ])
  return [
    entry.id,
    entry.journal_number,
    journalDisplayId(entry),
    entry.description,
    entry.reference,
    entry.period,
    entry.source_document_type,
    sourceDocumentLabel(entry.source_document_type),
    entry.source_record_id,
    entry.posting_rule_id,
    entry.posting_rule_code,
    entry.posting_rule_name,
    ...lines,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function journalAccountPair(entry: Pick<JournalEntry, 'postings'>) {
  const lines = entry.postings || []
  const debit = lines.find((row) => Number(row.debit) > 0)
  const credit = lines.find((row) => Number(row.credit) > 0)
  return { debit, credit }
}

export function inferredPostingRule(
  entry: Pick<JournalEntry, 'posting_rule_id' | 'postings' | 'source_document_type' | 'is_system_generated'>,
  rules: PostingRule[],
) {
  if (entry.posting_rule_id) {
    return rules.find((rule) => rule.id === entry.posting_rule_id) || null
  }
  if (!entry.is_system_generated && !entry.source_document_type) {
    return null
  }
  const source = (entry.source_document_type || '').toUpperCase()
  if (source === 'BANK_TRANSFER') {
    return (
      rules.find((rule) => rule.rule_code === 'BANK_TRANSFER') ||
      rules.find((rule) => rule.event_code === 'BANK_TRANSFER') ||
      null
    )
  }
  const { debit, credit } = journalAccountPair(entry)
  if (!debit || !credit) return null
  const matches = rules.filter((rule) => {
    const debitOk =
      (rule.debit_account_id && rule.debit_account_id === debit.account_id) ||
      Boolean(rule.debit_account_code && debit.account_code && rule.debit_account_code === debit.account_code)
    const creditOk =
      (rule.credit_account_id && rule.credit_account_id === credit.account_id) ||
      Boolean(rule.credit_account_code && credit.account_code && rule.credit_account_code === credit.account_code)
    return debitOk && creditOk
  })
  return matches.length === 1 ? matches[0] : null
}

export function postingRuleDisplay(
  entry: Pick<JournalEntry, 'posting_rule_id' | 'posting_rule_code' | 'posting_rule_name' | 'postings'>,
  rules: PostingRule[] = [],
) {
  const rule = inferredPostingRule(entry, rules)
  return rule?.rule_code || entry.posting_rule_code || ''
}

export function filterJournalEntries(
  entries: JournalEntry[],
  filters: JournalLedgerFilters,
  rules: PostingRule[] = [],
) {
  const q = filters.q.trim().toLowerCase()
  const source = (filters.source || 'ALL').toUpperCase()
  const origin = (filters.origin || 'ALL').toUpperCase()
  const rule = (filters.rule || 'ALL').trim()
  const posting = (filters.posting || 'ALL').toLowerCase()
  const approval = (filters.approval || 'ALL').toUpperCase()
  const period = filters.period.trim()
  const dateFrom = filters.date_from.trim()
  const dateTo = filters.date_to.trim()

  return entries.filter((entry) => {
    if (q && !journalSearchText(entry).includes(q)) return false
    const inferredSource = inferredJournalSource(entry)
    if (origin === 'SYSTEM' && !isInferredSystemJournal(entry)) return false
    if (origin === 'MANUAL' && isInferredSystemJournal(entry)) return false
    if (source === 'MANUAL' && inferredSource !== 'MANUAL') return false
    if (source !== 'ALL' && source !== 'MANUAL' && inferredSource !== source) return false
    if (rule && rule !== 'ALL') {
      const inferredRule = inferredPostingRule(entry, rules)
      if ((inferredRule?.id || entry.posting_rule_id || '') !== rule) return false
    }
    if (period && (entry.period || '') !== period) return false
    if (posting !== 'all' && (entry.posting_status || '').toLowerCase() !== posting) return false
    if (approval !== 'ALL' && (entry.approval_status || 'DRAFT').toUpperCase() !== approval) {
      return false
    }
    const posted = journalPostedDate(entry)
    if (dateFrom && posted && posted < dateFrom) return false
    if (dateTo && posted && posted > dateTo) return false
    return true
  })
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export const JOURNAL_EXPORT_HEADERS = [
  'Date',
  'Journal ID',
  'Journal UUID',
  'Description',
  'Reference',
  'Source',
  'Source Record',
  'Origin',
  'Period',
  'Posting',
  'Approval',
  'Account Code',
  'Account Name',
  'Line Memo',
  'Debit',
  'Credit',
  'Posting Rule',
] as const

export function journalEntriesToCsv(entries: JournalEntry[], rules: PostingRule[] = []) {
  const rows = entries.flatMap((entry) => {
    const source = inferredJournalSource(entry)
    const header = {
      date: journalPostedDate(entry),
      journalId: journalDisplayId(entry),
      uuid: entry.id,
      description: entry.description || '',
      reference: entry.reference || '',
      source: source === 'MANUAL' ? 'Manual' : sourceDocumentLabel(source),
      sourceRecord: entry.source_record_id || '',
      origin: isInferredSystemJournal(entry) ? 'System' : 'Manual',
      period: entry.period || '',
      posting: entry.posting_status || '',
      approval: entry.approval_status || 'DRAFT',
      rule: postingRuleDisplay(entry, rules),
    }
    const lines = entry.postings?.length ? entry.postings : [null]
    return lines.map((line) => [
      header.date,
      header.journalId,
      header.uuid,
      header.description,
      header.reference,
      header.source,
      header.sourceRecord,
      header.origin,
      header.period,
      header.posting,
      header.approval,
      line?.account_code || '',
      line?.account_name || '',
      line?.description || '',
      line && Number(line.debit) ? Number(line.debit) : '',
      line && Number(line.credit) ? Number(line.credit) : '',
      header.rule,
    ])
  })
  return [JOURNAL_EXPORT_HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

export function journalExportFilename(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `journal-entries-${now.getFullYear()}-${month}-${day}.csv`
}

export function journalLedgerFiltersActive(filters: JournalLedgerFilters) {
  return (
    Boolean(filters.q.trim()) ||
    (filters.source || 'ALL') !== 'ALL' ||
    (filters.origin || 'ALL') !== 'ALL' ||
    Boolean(filters.date_from.trim()) ||
    Boolean(filters.date_to.trim()) ||
    Boolean(filters.period.trim()) ||
    (filters.rule || 'ALL') !== 'ALL' ||
    (filters.posting || 'ALL') !== 'ALL' ||
    (filters.approval || 'ALL') !== 'ALL'
  )
}
