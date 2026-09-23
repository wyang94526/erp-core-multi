/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { JournalEntry } from '../types'

export const JOURNAL_CREATE_PATH = '/general-ledger/journals/new'
export const MONTH_END_CLOSE_PATH = '/general-ledger/month-end-close'

export function journalEditPath(id: string) {
  return `/general-ledger/journals/${id}/edit`
}

export function shortJournalId(id: string) {
  return id.split('-')[0].toUpperCase()
}

export function isJournalDraft(entry: Pick<JournalEntry, 'approval_status' | 'posting_status'>) {
  const approval = (entry.approval_status || 'DRAFT').toUpperCase()
  const posting = (entry.posting_status || '').toLowerCase()
  return posting !== 'posted' && approval === 'DRAFT'
}

export function isJournalEditable(entry: Pick<JournalEntry, 'approval_status' | 'posting_status'>) {
  const approval = (entry.approval_status || 'DRAFT').toUpperCase()
  const posting = (entry.posting_status || '').toLowerCase()
  return posting !== 'posted' && (approval === 'DRAFT' || approval === 'REJECTED')
}

export function isJournalDeletable(entry: Pick<JournalEntry, 'approval_status' | 'posting_status'>) {
  const approval = (entry.approval_status || '').toLowerCase()
  const posting = (entry.posting_status || '').toLowerCase()
  return posting === 'draft' && approval === 'draft'
}
