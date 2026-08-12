import React, { useEffect, useMemo, useState } from 'react'
import { journalEntryService } from '../api/services'
import type { JournalEntry } from '../types'
import { ApprovalPanel } from './ApprovalPanel'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'

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

function shortId(id: string) {
  return id.split('-')[0].toUpperCase()
}

function GeneralLedger() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loadEntries = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await journalEntryService.listJournalEntries()
      setEntries(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load journal entries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEntries()
  }, [])

  const handleRunMonthEndClose = () => {
    alert('Month-End Close process initiated.')
  }

  const formatCurrency = (amount: number) =>
    amount === 0
      ? ''
      : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString()
  }

  const rows: FlatPostingRow[] = useMemo(
    () =>
      entries.flatMap((entry) =>
        entry.postings.map((posting) => {
          const accountCode = posting.account_code || '—'
          const accountName = posting.account_name || '—'
          return {
            entryId: entry.id,
            date: entry.created_at,
            journalId: shortId(entry.id),
            description: entry.description,
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
    [entries],
  )

  const {
    items: sortedEntries,
    requestSort: requestEntrySort,
    sortConfig: entrySortConfig,
  } = useSortableData(entries, {
    columnTypes: {
      created_at: 'date',
      id: 'string',
      description: 'string',
      period: 'string',
      posting_status: 'string',
      approval_status: 'string',
    },
    getValue: (entry, key) => {
      if (key === 'id') return shortId(entry.id)
      if (key === 'approval_status') return entry.approval_status || 'DRAFT'
      return (entry as unknown as Record<string, unknown>)[key]
    },
  })

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
      <div style={pageHeaderStyle}>
        <div>
          <h1 style={pageTitleStyle}>General Ledger</h1>
          <p style={pageSubStyle}>Double-entry journal postings and period close</p>
        </div>
        <button style={primaryButtonStyle} onClick={handleRunMonthEndClose}>
          Run Month-End Close
        </button>
      </div>

      <div style={dashboardSectionStyle}>
        <h3 style={sectionTitleStyle}>Journal Entries</h3>
        {loading ? (
          <div style={emptyStateWrapperStyle}>Loading journal entries...</div>
        ) : error ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>{error}</div>
        ) : sortedEntries.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No journal entries found.</div>
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
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => (
                  <tr key={entry.id} style={directoryTbodyRowStyle}>
                    <td style={directoryTdStyle}>{formatDate(entry.created_at)}</td>
                    <td style={directoryTdStyle}>{shortId(entry.id)}</td>
                    <td style={directoryTdStyle}>{entry.description}</td>
                    <td style={directoryTdStyle}>{entry.period || '—'}</td>
                    <td style={directoryTdStyle}>{entry.posting_status || '—'}</td>
                    <td style={directoryTdStyle}>{entry.approval_status || 'DRAFT'}</td>
                    <td style={directoryTdStyle}>
                      <button
                        style={approvalButtonStyle}
                        onClick={() => setSelectedId(entry.id)}
                      >
                        Approval
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedId && (
          <ApprovalPanel
            module="journal-entries"
            documentId={selectedId}
            approvalStatus={
              entries.find((e) => e.id === selectedId)?.approval_status
            }
            onStatusChange={loadEntries}
          />
        )}

        <h3 style={sectionTitleStyle}>Posting Detail</h3>
        {loading ? null : sortedRows.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No postings found.</div>
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

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid #ddd',
  paddingBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
}

const pageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 'bold',
  color: '#212121',
}

const pageSubStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  fontSize: '14px',
  color: '#616161',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#2196F3',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
  fontFamily: 'inherit',
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

const directoryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const directoryTheadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid #ddd',
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

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

export default GeneralLedger
