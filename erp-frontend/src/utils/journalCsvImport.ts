/**
 * @author: Wendy Yang
 * @date: 2026-09-23
 *
 * Parse a multi-journal CSV on the client and group lines by Group ID / Journal Ref.
 */

import Papa from 'papaparse'
import type { ChartOfAccount, JournalBulkImportEntry, JournalBulkImportLine, JournalCsvGroupError, JournalLineDraft } from '../types'

const GROUP_KEYS = ['group id', 'group', 'journal ref', 'journal_ref', 'journal id', 'batch id']
const REFERENCE_KEYS = ['reference', 'source document', 'voucher', 'voucher no']
const DATE_KEYS = ['posting date', 'date', 'journal date']
const PERIOD_KEYS = ['financial period', 'period', 'year month', 'yyyymm']
const HEADER_DESC_KEYS = ['header description', 'journal description', 'journal memo']
const ACCOUNT_KEYS = [
  'account code',
  'account_code',
  'accountcode',
  'account',
  'acct code',
  'acct',
  'code',
  '科目代號',
  '科目代号',
  '科目',
]
const LINE_MEMO_KEYS = ['line memo', 'memo', 'line description', 'narration', '摘要']
const GENERIC_DESC_KEYS = ['description']
const DEBIT_KEYS = ['debit', 'debit amount', 'dr', '借方']
const CREDIT_KEYS = ['credit', 'credit amount', 'cr', '貸方', '贷方']

export type JournalBulkCsvParseResult = {
  journals: JournalBulkImportEntry[]
  errors: JournalCsvGroupError[]
  skipped: number
}

function newLineKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function newJournalLine(partial?: Partial<JournalLineDraft>): JournalLineDraft {
  return {
    key: newLineKey(),
    account_id: '',
    description: '',
    debit: '',
    credit: '',
    ...partial,
  }
}

function normHeader(value: string) {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_\-]+/g, ' ')
}

function cell(row: Record<string, string>, keys: string[]) {
  const mapped = new Map<string, string>()
  for (const [raw, value] of Object.entries(row)) {
    mapped.set(normHeader(raw), (value ?? '').trim())
  }
  for (const key of keys) {
    const value = mapped.get(normHeader(key))
    if (value) return value
  }
  return ''
}

function hasAnyHeader(headers: string[], keys: string[]) {
  return keys.some((key) => headers.includes(normHeader(key)))
}

export function parseJournalAmount(value: string | null | undefined): number {
  const text = (value ?? '').trim()
  if (!text || text === '-' || text === '—' || text === '–') return 0
  let cleaned = text.replace(/[$,\s]/g, '')
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = cleaned.slice(1, -1)
  }
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.abs(n) * 100) / 100
}

export function formatJournalAmount(value: number): string {
  if (value <= 0) return '0.00'
  return value.toFixed(2)
}

export function parseJournalDate(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const ymd = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  return null
}

export function parseJournalPeriod(value: string, postingDate: string | null): string | null {
  const text = value.trim()
  if (text) {
    const digits = text.replace(/\D/g, '')
    if (digits.length === 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return text
    return null
  }
  if (postingDate && /^\d{4}-\d{2}-\d{2}$/.test(postingDate)) return postingDate.slice(0, 7)
  return null
}

function findAccount(accounts: ChartOfAccount[], code: string): ChartOfAccount | undefined {
  const exact = accounts.find((row) => row.account_code === code)
  if (exact) return exact
  const lowered = code.toLowerCase()
  return accounts.find((row) => row.account_code.toLowerCase() === lowered)
}

function groupKeyForRow(row: Record<string, string>, index: number, headers: string[]) {
  const group = cell(row, GROUP_KEYS)
  if (group) return group
  const reference = cell(row, REFERENCE_KEYS)
  if (reference) return reference
  const date = cell(row, DATE_KEYS)
  const header = cell(row, HEADER_DESC_KEYS) || cell(row, GENERIC_DESC_KEYS)
  if (date || header) return [date, header].filter(Boolean).join(' · ')
  if (!hasAnyHeader(headers, GROUP_KEYS) && !hasAnyHeader(headers, REFERENCE_KEYS)) {
    return '1'
  }
  return `row-${index + 2}`
}

export function groupJournalCsvRows(
  rows: Record<string, string>[],
  accounts: ChartOfAccount[],
  headers: string[] = [],
): JournalBulkCsvParseResult {
  const buckets = new Map<string, Record<string, string>[]>()
  const order: string[] = []
  let skipped = 0

  rows.forEach((row, index) => {
    const accountCode = cell(row, ACCOUNT_KEYS)
    const memo = cell(row, LINE_MEMO_KEYS) || cell(row, GENERIC_DESC_KEYS)
    const debit = parseJournalAmount(cell(row, DEBIT_KEYS))
    const credit = parseJournalAmount(cell(row, CREDIT_KEYS))
    if (!accountCode && !memo && debit <= 0 && credit <= 0 && !cell(row, DATE_KEYS) && !cell(row, HEADER_DESC_KEYS)) {
      skipped += 1
      return
    }
    const key = groupKeyForRow(row, index, headers)
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key)?.push(row)
  })

  const journals: JournalBulkImportEntry[] = []
  const errors: JournalCsvGroupError[] = []

  for (const groupId of order) {
    const groupRows = buckets.get(groupId) || []
    const first = groupRows[0]
    const postingDate = parseJournalDate(cell(first, DATE_KEYS))
    const period = parseJournalPeriod(cell(first, PERIOD_KEYS), postingDate)
    const description =
      cell(first, HEADER_DESC_KEYS) ||
      cell(first, GENERIC_DESC_KEYS) ||
      `Imported journal ${groupId}`
    const reference = cell(first, REFERENCE_KEYS) || (GROUP_KEYS.some((key) => cell(first, [key])) ? groupId : '')

    const postings: JournalBulkImportLine[] = []
    const groupErrors: string[] = []
    groupRows.forEach((row, index) => {
      const accountCode = cell(row, ACCOUNT_KEYS)
      const memo = cell(row, LINE_MEMO_KEYS) || cell(row, GENERIC_DESC_KEYS)
      const debit = parseJournalAmount(cell(row, DEBIT_KEYS))
      const credit = parseJournalAmount(cell(row, CREDIT_KEYS))
      if (!accountCode && debit <= 0 && credit <= 0) {
        skipped += 1
        return
      }
      const account = accountCode ? findAccount(accounts, accountCode) : undefined
      if (!accountCode) {
        groupErrors.push(`line ${index + 1}: account code is blank`)
        return
      }
      if (!account) {
        groupErrors.push(`line ${index + 1}: account ${accountCode} was not found`)
        return
      }
      if (debit > 0 && credit > 0) {
        groupErrors.push(`line ${index + 1}: ${accountCode} has both debit and credit`)
        return
      }
      if (debit <= 0 && credit <= 0) {
        groupErrors.push(`line ${index + 1}: ${accountCode} has no debit or credit`)
        return
      }
      postings.push({
        account_id: account.id,
        account_code: account.account_code,
        description: memo || null,
        debit,
        credit,
      })
    })

    const totalDebit = Math.round(postings.reduce((sum, line) => sum + line.debit, 0) * 100) / 100
    const totalCredit = Math.round(postings.reduce((sum, line) => sum + line.credit, 0) * 100) / 100
    if (!postingDate) groupErrors.push('posting date is missing or invalid (use YYYY-MM-DD)')
    if (cell(first, PERIOD_KEYS) && !period) groupErrors.push('financial period must be YYYY-MM')
    if (postings.length < 2) groupErrors.push('needs at least two posting lines')
    if (totalDebit <= 0 || totalCredit <= 0) groupErrors.push('needs at least one debit and one credit')
    if (totalDebit !== totalCredit) {
      groupErrors.push(`out of balance: debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}`)
    }

    if (groupErrors.length) {
      errors.push({ group_id: groupId, message: groupErrors.join('; ') })
      continue
    }

    journals.push({
      group_id: groupId,
      description,
      posting_date: postingDate as string,
      period: period || undefined,
      reference: reference || groupId,
      postings,
    })
  }

  return { journals, errors, skipped }
}

function assertJournalCsvHeaders(fields: string[] | undefined) {
  if (!fields?.length) {
    throw new Error(
      'CSV must include a header row with Group ID or Journal Ref, Posting Date, Account Code, Debit, and Credit.',
    )
  }
  const headers = fields.map((field) => normHeader(field))
  const hasAccount = hasAnyHeader(headers, ACCOUNT_KEYS)
  const hasAmount = hasAnyHeader(headers, DEBIT_KEYS) || hasAnyHeader(headers, CREDIT_KEYS)
  if (!hasAccount || !hasAmount) {
    throw new Error('CSV headers must include Account Code plus Debit and/or Credit.')
  }
  return headers
}

export function parseJournalBulkCsvText(
  text: string,
  accounts: ChartOfAccount[],
): JournalBulkCsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
  })
  const headers = assertJournalCsvHeaders(parsed.meta.fields)
  return groupJournalCsvRows(parsed.data, accounts, headers)
}

export function parseJournalBulkCsvFile(
  file: File,
  accounts: ChartOfAccount[],
): Promise<JournalBulkCsvParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
      complete: (parsed) => {
        try {
          const headers = assertJournalCsvHeaders(parsed.meta.fields)
          resolve(groupJournalCsvRows(parsed.data, accounts, headers))
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Could not parse journal CSV'))
        }
      },
      error: (err) => reject(new Error(err.message || 'Could not parse journal CSV')),
    })
  })
}
