/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, CalendarCheck, CalendarRange, Lock, Upload } from 'lucide-react'
import { headerButtonStyle, primaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'
import { chartOfAccountsService, journalEntryService, postingRulesService } from '../api/services'
import type { JournalEntry, PostingRule } from '../types'
import { parseJournalBulkCsvFile } from '../utils/journalCsvImport'
import { downloadTextFile } from '../utils/financialReports'
import { ApprovalPanel } from './ApprovalPanel'
import { JournalLedgerFiltersBar, useJournalLedgerFilters } from './JournalLedgerFilters'
import { useAuth } from '../context/AuthContext'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import {
  filterJournalEntries,
  inferredJournalSource,
  inferredPostingRule,
  isInferredSystemJournal,
  postingRuleDisplay,
  isJournalDeletable,
  isJournalEditable,
  JOURNAL_CREATE_PATH,
  journalEditPath,
  journalEntriesToCsv,
  journalExportFilename,
  MONTH_END_CLOSE_PATH,
  YEAR_END_CLOSE_PATH,
  journalDisplayId,
  sourceDocumentLabel,
} from '../utils/journalEntries'

interface FlatPostingRow {
  entryId: string
  date: string
  journalId: string
  description: string
  accountCode: string
  accountName: string
  accountLabel: string
  debit: number
  credit: number
  period: string | null
  approvalStatus: string
}

function GeneralLedger() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const csvInputRef = useRef<HTMLInputElement | null>(null)
  const approvalPanelRef = useRef<HTMLDivElement | null>(null)
  const canCreate = hasPermission('journal:create')
  const { filters, clearFilters, hasActiveFilters } = useJournalLedgerFilters()
  const [rules, setRules] = useState<PostingRule[]>([])
  const selectedEntry = entries.find((entry) => entry.id === selectedId) || null

  const loadEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await journalEntryService.listJournalEntries(0, 500, filters)
      setEntries(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load journal entries')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void postingRulesService.list().then(setRules).catch(() => setRules([]))
  }, [])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  useEffect(() => {
    if (!selectedId) return
    approvalPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedId])

  const handleImportJournals = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    setError(null)
    setImportMessage(null)
    try {
      const accounts = await chartOfAccountsService.listAccounts(0, 2000)
      const parsed = await parseJournalBulkCsvFile(file, accounts)
      if (parsed.journals.length === 0) {
        const details = parsed.errors.map((row) => `${row.group_id}: ${row.message}`).join(' ')
        setError(details || 'No balanced journals were found in the CSV.')
        return
      }
      const skipNote = parsed.errors.length
        ? `\n${parsed.errors.length} journal(s) have errors and will be skipped:\n${parsed.errors
            .map((row) => `• ${row.group_id}: ${row.message}`)
            .join('\n')}`
        : ''
      const confirmed = window.confirm(
        `Import ${parsed.journals.length} balanced journal${parsed.journals.length === 1 ? '' : 's'} as drafts?${skipNote}`,
      )
      if (!confirmed) return
      const result = await journalEntryService.bulkImport({ journals: parsed.journals })
      const parts = [`Successfully imported ${result.created} journal${result.created === 1 ? '' : 's'}.`]
      const failed = [...parsed.errors, ...result.errors]
      if (failed.length) {
        parts.push(`Failed: ${failed.map((row) => `${row.group_id} (${row.message})`).join('; ')}`)
      }
      setImportMessage(parts.join(' '))
      if (failed.length && result.created === 0) {
        setError(parts.join(' '))
        setImportMessage(null)
      }
      await loadEntries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import journals')
    } finally {
      setImporting(false)
    }
  }

  const handleDeleteJournal = async (entry: JournalEntry) => {
    if (!isJournalDeletable(entry)) return
    if (!window.confirm('Are you sure you want to delete this draft journal entry?')) return
    setDeletingId(entry.id)
    setError(null)
    setImportMessage(null)
    try {
      await journalEntryService.deleteJournalEntry(entry.id)
      if (selectedId === entry.id) setSelectedId(null)
      setImportMessage('Draft journal entry deleted.')
      await loadEntries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete journal entry')
    } finally {
      setDeletingId(null)
    }
  }

  const formatCurrency = (amount: number) =>
    amount === 0
      ? ''
      : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString()
  }

  const visibleEntries = useMemo(
    () => filterJournalEntries(entries, filters, rules),
    [entries, filters, rules],
  )

  const rows: FlatPostingRow[] = useMemo(
    () =>
      visibleEntries.flatMap((entry) =>
        entry.postings.map((posting) => {
          const accountCode = posting.account_code || '—'
          const accountName = posting.account_name || '—'
          return {
            entryId: entry.id,
            date: entry.posting_date || entry.created_at,
            journalId: journalDisplayId(entry),
            description: posting.description || entry.description,
            accountCode,
            accountName,
            accountLabel: `${accountCode} ${accountName}`.trim(),
            debit: Number(posting.debit) || 0,
            credit: Number(posting.credit) || 0,
            period: entry.period,
            approvalStatus: entry.approval_status || 'DRAFT',
          }
        }),
      ),
    [visibleEntries],
  )

  const {
    items: sortedEntries,
    requestSort: requestEntrySort,
    sortConfig: entrySortConfig,
  } = useSortableData(visibleEntries, {
    columnTypes: {
      created_at: 'date',
      id: 'string',
      description: 'string',
      reference: 'string',
      source_document_type: 'string',
      posting_rule_id: 'string',
      period: 'string',
      posting_status: 'string',
      approval_status: 'string',
    },
    getValue: (entry, key) => {
      if (key === 'id') return journalDisplayId(entry)
      if (key === 'approval_status') return entry.approval_status || 'DRAFT'
      if (key === 'created_at') return entry.posting_date || entry.created_at
      if (key === 'source_document_type') {
        return `${sourceDocumentLabel(inferredJournalSource(entry))} ${entry.source_record_id || ''}`
      }
      if (key === 'posting_rule_id') return postingRuleDisplay(entry, rules)
      return (entry as unknown as Record<string, unknown>)[key]
    },
  })

  const handleExportJournals = () => {
    if (sortedEntries.length === 0) return
    const csv = journalEntriesToCsv(sortedEntries, rules)
    downloadTextFile(journalExportFilename(), `\uFEFF${csv}`, 'text/csv;charset=utf-8')
  }

  const {
    items: sortedRows,
    requestSort: requestPostingSort,
    sortConfig: postingSortConfig,
  } = useSortableData(rows, {
    columnTypes: {
      date: 'date',
      journalId: 'string',
      description: 'string',
      accountCode: 'string',
      accountName: 'string',
      accountLabel: 'string',
      debit: 'number',
      credit: 'number',
      period: 'string',
      approvalStatus: 'string',
    },
  })

  return (
    <div style={containerStyle}>
      <PageHeader title="General Ledger" subtitle="Double-entry journal postings and period close">
        {canCreate && (
          <>
            <button type="button" style={primaryButtonStyle} onClick={() => navigate(JOURNAL_CREATE_PATH)}>
              <BookOpen size={15} />
              Manual Journal Entry
            </button>
            <button
              type="button"
              style={headerButtonStyle}
              disabled={importing}
              onClick={() => csvInputRef.current?.click()}
            >
              <Upload size={15} />
              {importing ? 'Importing…' : 'Import Journals (CSV)'}
            </button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                void handleImportJournals(file)
              }}
            />
          </>
        )}
        <button type="button" style={headerButtonStyle} onClick={() => navigate(MONTH_END_CLOSE_PATH)}>
          <CalendarCheck size={15} />
          Run Month-End Close
        </button>
        <button type="button" style={headerButtonStyle} onClick={() => navigate(YEAR_END_CLOSE_PATH)}>
          <CalendarRange size={15} />
          Year-End Close
        </button>
      </PageHeader>

      {importMessage && <div style={successBannerStyle}>{importMessage}</div>}
      {error && <div style={errorBannerStyle}>{error}</div>}

      <JournalLedgerFiltersBar
        rules={rules}
        exportCount={sortedEntries.length}
        exportDisabled={loading}
        onExport={handleExportJournals}
      />
      <p style={filterCountStyle}>
        {loading
          ? 'Searching journals…'
          : `${sortedEntries.length} journal${sortedEntries.length === 1 ? '' : 's'} match current filters`}
      </p>

      {selectedId && (
        <div ref={approvalPanelRef} style={approvalAnchorStyle}>
          <div style={approvalContextStyle}>
            <div>
              <strong>Journal {journalDisplayId(selectedEntry || { id: selectedId })}</strong>
              {selectedEntry?.description ? ` — ${selectedEntry.description}` : ''}
            </div>
            <button type="button" style={closeButtonStyle} onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          <ApprovalPanel
            module="journal-entries"
            documentId={selectedId}
            approvalStatus={selectedEntry?.approval_status}
            currentApprovalStep={selectedEntry?.current_approval_step}
            onStatusChange={loadEntries}
          />
        </div>
      )}

      <div style={dashboardSectionStyle}>
        <div style={sectionHeaderRowStyle}>
          <h3 style={{ ...sectionTitleStyle, margin: 0 }}>Journal Entries</h3>
        </div>
        {loading ? (
          <div style={emptyStateWrapperStyle}>Loading journal entries...</div>
        ) : sortedEntries.length === 0 ? (
          <div style={emptyStateWrapperStyle}>
            {hasActiveFilters ? 'No journal entries match the current filters.' : 'No journal entries found.'}
            {hasActiveFilters ? (
              <div style={{ marginTop: 12 }}>
                <button type="button" style={headerButtonStyle} onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <SortableTh
                    label="Date"
                    columnKey="created_at"
                    sortConfig={entrySortConfig}
                    onRequestSort={requestEntrySort}
                  />
                  <SortableTh
                    label="Journal ID"
                    columnKey="id"
                    sortConfig={entrySortConfig}
                    onRequestSort={requestEntrySort}
                  />
                  <SortableTh
                    label="Description"
                    columnKey="description"
                    sortConfig={entrySortConfig}
                    onRequestSort={requestEntrySort}
                  />
                  <SortableTh
                    label="Reference"
                    columnKey="reference"
                    sortConfig={entrySortConfig}
                    onRequestSort={requestEntrySort}
                  />
                  <SortableTh
                    label="Source"
                    columnKey="source_document_type"
                    sortConfig={entrySortConfig}
                    onRequestSort={requestEntrySort}
                  />
                  <SortableTh
                    label="Period"
                    columnKey="period"
                    sortConfig={entrySortConfig}
                    onRequestSort={requestEntrySort}
                  />
                  <SortableTh
                    label="Posting"
                    columnKey="posting_status"
                    sortConfig={entrySortConfig}
                    onRequestSort={requestEntrySort}
                  />
                  <SortableTh
                    label="Approval"
                    columnKey="approval_status"
                    sortConfig={entrySortConfig}
                    onRequestSort={requestEntrySort}
                  />
                  <th style={directoryThStyle}>Actions</th>
                  <SortableTh
                    label="Posting Rule"
                    columnKey="posting_rule_id"
                    sortConfig={entrySortConfig}
                    onRequestSort={requestEntrySort}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    style={
                      entry.id === selectedId
                        ? { ...directoryTbodyRowStyle, backgroundColor: '#e3f2fd' }
                        : directoryTbodyRowStyle
                    }
                  >
                    <td style={directoryTdStyle}>
                      {formatDate(entry.posting_date || entry.created_at)}
                    </td>
                    <td style={directoryTdStyle}>{journalDisplayId(entry)}</td>
                    <td style={directoryTdStyle}>
                      <div style={descriptionCellStyle}>
                        {isInferredSystemJournal(entry) && (
                          <span style={systemChipStyle} title="System-generated from a source document">
                            <Lock size={11} />
                            System
                          </span>
                        )}
                        <span>{entry.description}</span>
                      </div>
                    </td>
                    <td style={directoryTdStyle}>{entry.reference || '—'}</td>
                    <td style={directoryTdStyle}>
                      {inferredJournalSource(entry) === 'MANUAL'
                        ? 'Manual'
                        : `${sourceDocumentLabel(inferredJournalSource(entry))}${
                            entry.source_record_id ? ` · ${entry.source_record_id}` : ''
                          }`}
                    </td>
                    <td style={directoryTdStyle}>{entry.period || '—'}</td>
                    <td style={directoryTdStyle}>{entry.posting_status || '—'}</td>
                    <td style={directoryTdStyle}>{entry.approval_status || 'DRAFT'}</td>
                    <td style={directoryTdStyle}>
                      <div style={actionRowStyle}>
                        {canCreate && isJournalEditable(entry) ? (
                          <button
                            style={editButtonStyle}
                            onClick={() => navigate(journalEditPath(entry.id, { from: '/general-ledger' }))}
                          >
                            Edit
                          </button>
                        ) : (
                          <button
                            type="button"
                            style={viewButtonStyle}
                            onClick={() => navigate(journalEditPath(entry.id, { from: '/general-ledger' }))}
                          >
                            View
                          </button>
                        )}
                        <button
                          style={approvalButtonStyle}
                          onClick={() => {
                            setSelectedId(entry.id)
                            requestAnimationFrame(() => {
                              approvalPanelRef.current?.scrollIntoView({
                                behavior: 'smooth',
                                block: 'start',
                              })
                            })
                          }}
                        >
                          Approval
                        </button>
                        {canCreate && isJournalDeletable(entry) && (
                          <button
                            type="button"
                            style={deleteButtonStyle}
                            disabled={deletingId === entry.id}
                            onClick={() => void handleDeleteJournal(entry)}
                          >
                            {deletingId === entry.id ? 'Deleting…' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ ...directoryTdStyle, fontFamily: 'monospace' }} title={inferredPostingRule(entry, rules)?.name || entry.posting_rule_name || ''}>
                      {postingRuleDisplay(entry, rules) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 style={sectionTitleStyle}>Posting Detail</h3>
        {loading ? null : sortedRows.length === 0 ? (
          <div style={emptyStateWrapperStyle}>
            {hasActiveFilters ? 'No posting lines match the current filters.' : 'No postings found.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <SortableTh
                    label="Date"
                    columnKey="date"
                    sortConfig={postingSortConfig}
                    onRequestSort={requestPostingSort}
                  />
                  <SortableTh
                    label="Journal ID"
                    columnKey="journalId"
                    sortConfig={postingSortConfig}
                    onRequestSort={requestPostingSort}
                  />
                  <SortableTh
                    label="Description"
                    columnKey="description"
                    sortConfig={postingSortConfig}
                    onRequestSort={requestPostingSort}
                  />
                  <SortableTh
                    label="Account Code"
                    columnKey="accountCode"
                    sortConfig={postingSortConfig}
                    onRequestSort={requestPostingSort}
                  />
                  <SortableTh
                    label="Account"
                    columnKey="accountName"
                    sortConfig={postingSortConfig}
                    onRequestSort={requestPostingSort}
                  />
                  <SortableTh
                    label="Debit"
                    columnKey="debit"
                    sortConfig={postingSortConfig}
                    onRequestSort={requestPostingSort}
                    align="right"
                  />
                  <SortableTh
                    label="Credit"
                    columnKey="credit"
                    sortConfig={postingSortConfig}
                    onRequestSort={requestPostingSort}
                    align="right"
                  />
                  <SortableTh
                    label="Period"
                    columnKey="period"
                    sortConfig={postingSortConfig}
                    onRequestSort={requestPostingSort}
                  />
                  <SortableTh
                    label="Approval"
                    columnKey="approvalStatus"
                    sortConfig={postingSortConfig}
                    onRequestSort={requestPostingSort}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => (
                  <tr key={`${row.entryId}-${row.accountCode}-${idx}`} style={directoryTbodyRowStyle}>
                    <td style={directoryTdStyle}>{formatDate(row.date)}</td>
                    <td style={directoryTdStyle}>{row.journalId}</td>
                    <td style={directoryTdStyle}>{row.description}</td>
                    <td style={{ ...directoryTdStyle, fontFamily: 'monospace', fontWeight: 600 }}>
                      {row.accountCode}
                    </td>
                    <td style={directoryTdStyle}>{row.accountName}</td>
                    <td style={{ ...directoryTdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                      {formatCurrency(row.debit)}
                    </td>
                    <td style={{ ...directoryTdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                      {formatCurrency(row.credit)}
                    </td>
                    <td style={directoryTdStyle}>{row.period || '—'}</td>
                    <td style={directoryTdStyle}>{row.approvalStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// STYLES
// ==========================================

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}

const filterCountStyle: React.CSSProperties = {
  margin: '-8px 0 16px',
  fontSize: '13px',
  color: '#616161',
}

const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: '#fff',
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
}

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: '16px',
  fontWeight: 700,
  color: '#212121',
}

const sectionHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  marginBottom: '12px',
}

const approvalButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  backgroundColor: '#e3f2fd',
  color: '#1565c0',
  border: '1px solid #bbdefb',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  fontFamily: 'inherit',
}

const editButtonStyle: React.CSSProperties = {
  ...approvalButtonStyle,
  backgroundColor: '#fff8e1',
  color: '#ef6c00',
  border: '1px solid #ffe082',
}

const viewButtonStyle: React.CSSProperties = {
  ...approvalButtonStyle,
  backgroundColor: '#e8f5e9',
  color: '#2e7d32',
  border: '1px solid #c8e6c9',
}

const deleteButtonStyle: React.CSSProperties = {
  ...approvalButtonStyle,
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ef9a9a',
}

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  flexWrap: 'wrap',
}

const directoryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const directoryTheadRowStyle: React.CSSProperties = {
  backgroundColor: '#f5f5f5',
}

const directoryThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: '#212121',
}

const directoryTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid #eee',
  transition: 'background-color 0.2s',
}

const directoryTdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: '#424242',
  verticalAlign: 'middle',
}

const descriptionCellStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
}

const systemChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 7px',
  borderRadius: 999,
  background: '#eceff1',
  color: '#455a64',
  border: '1px solid #cfd8dc',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

const successBannerStyle: React.CSSProperties = {
  marginBottom: '16px',
  padding: '10px 14px',
  borderRadius: '8px',
  background: '#e8f5e9',
  border: '1px solid #a5d6a7',
  color: '#1b5e20',
  fontSize: '13px',
}

const errorBannerStyle: React.CSSProperties = {
  ...successBannerStyle,
  background: '#ffebee',
  border: '1px solid #ef9a9a',
  color: '#c62828',
}

const approvalAnchorStyle: React.CSSProperties = {
  marginBottom: 16,
  scrollMarginTop: 16,
}

const approvalContextStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  marginBottom: 8,
  fontSize: 13,
  color: '#424242',
}

const closeButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  backgroundColor: '#fff',
  color: '#424242',
  border: '1px solid #ddd',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
}

export default GeneralLedger
