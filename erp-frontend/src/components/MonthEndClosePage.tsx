/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { journalEntryService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type { JournalEntry } from '../types'
import { journalEditPath, isJournalDraft, shortJournalId } from '../utils/journalEntries'
import { JournalEntryViewModal } from './JournalEntryViewModal'

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

export function MonthEndClosePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { hasPermission } = useAuth()
  const canRun = hasPermission('journal:approve')
  const [result, setResult] = useState<{ message: string; entries_posted: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewingEntry, setViewingEntry] = useState<JournalEntry | null>(null)

  const previewQuery = useQuery({
    queryKey: ['monthEndClosePreview'],
    queryFn: () => journalEntryService.previewMonthEndClose(),
  })

  const closeMutation = useMutation({
    mutationFn: () => journalEntryService.runMonthEndClose(),
    onSuccess: (data) => {
      setError(null)
      setResult({ message: data.message, entries_posted: data.entries_posted })
      void queryClient.invalidateQueries({ queryKey: ['monthEndClosePreview'] })
    },
    onError: (err) => {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Month-end close failed')
    },
  })

  const ready = previewQuery.data?.ready || []
  const held = previewQuery.data?.held || []
  const period = previewQuery.data?.period || ''

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Month-End Close</h1>
          <p style={subStyle}>
            Post approved draft journals for period {period || '—'}. Unapproved drafts stay in the
            approval workflow and are not posted.
          </p>
        </div>
        <div style={actionsStyle}>
          <button type="button" style={secondaryBtn} onClick={() => navigate('/general-ledger')}>
            Back to General Ledger
          </button>
          {canRun && (
            <button
              type="button"
              style={primaryBtn}
              disabled={closeMutation.isPending || ready.length === 0}
              onClick={() => closeMutation.mutate()}
            >
              {closeMutation.isPending ? 'Closing…' : 'Run Month-End Close'}
            </button>
          )}
        </div>
      </div>

      {error && <div style={errorBox}>{error}</div>}
      {result && (
        <div style={successBox}>
          {result.message} Posted {result.entries_posted} journal
          {result.entries_posted === 1 ? '' : 's'}.
        </div>
      )}

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Ready to post ({ready.length})</h2>
        <p style={hintStyle}>Approved journals still in Draft posting status.</p>
        {previewQuery.isLoading ? (
          <p style={hintStyle}>Loading…</p>
        ) : ready.length === 0 ? (
          <p style={emptyStyle}>No approved draft journals are waiting to post.</p>
        ) : (
          <EntryTable rows={ready} onView={setViewingEntry} />
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Held for approval ({held.length})</h2>
        <p style={hintStyle}>These drafts will not post until they are approved.</p>
        {previewQuery.isLoading ? null : held.length === 0 ? (
          <p style={emptyStyle}>No unapproved draft journals.</p>
        ) : (
          <EntryTable rows={held} allowEdit onView={setViewingEntry} />
        )}
      </section>

      <JournalEntryViewModal entry={viewingEntry} onClose={() => setViewingEntry(null)} />
    </div>
  )
}

function EntryTable({
  rows,
  allowEdit = false,
  onView,
}: {
  rows: JournalEntry[]
  allowEdit?: boolean
  onView: (entry: JournalEntry) => void
}) {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('journal:create')

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRow}>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Journal ID</th>
            <th style={thStyle}>Description</th>
            <th style={thStyle}>Reference</th>
            <th style={thStyle}>Period</th>
            <th style={thStyle}>Approval</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => {
            const showEdit = allowEdit && canEdit && isJournalDraft(entry)
            return (
              <tr key={entry.id} style={tbodyRow}>
                <td style={tdStyle}>{formatDate(entry.posting_date || entry.created_at)}</td>
                <td style={tdStyle}>{shortJournalId(entry.id)}</td>
                <td style={tdStyle}>{entry.description}</td>
                <td style={tdStyle}>{entry.reference || '—'}</td>
                <td style={tdStyle}>{entry.period || '—'}</td>
                <td style={tdStyle}>{entry.approval_status || 'DRAFT'}</td>
                <td style={tdStyle}>
                  <div style={actionRow}>
                    {showEdit ? (
                      <button
                        type="button"
                        style={editBtn}
                        onClick={() => navigate(journalEditPath(entry.id))}
                      >
                        Edit
                      </button>
                    ) : (
                      <button type="button" style={viewBtn} onClick={() => onView(entry)}>
                        View
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const pageStyle: CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
  marginBottom: '20px',
  paddingBottom: '16px',
  borderBottom: '1px solid #ddd',
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 'bold',
  color: '#212121',
}

const subStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: '14px',
  color: '#616161',
}

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
}

const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  marginBottom: '16px',
}

const sectionTitle: CSSProperties = {
  margin: '0 0 4px',
  fontSize: '16px',
  fontWeight: 700,
}

const hintStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: '13px',
  color: '#616161',
}

const emptyStyle: CSSProperties = {
  padding: '20px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

const errorBox: CSSProperties = {
  marginBottom: '12px',
  padding: '10px 12px',
  background: '#ffebee',
  color: '#c62828',
  borderRadius: '6px',
}

const successBox: CSSProperties = {
  marginBottom: '12px',
  padding: '10px 12px',
  background: '#e8f5e9',
  color: '#2e7d32',
  borderRadius: '6px',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const theadRow: CSSProperties = {
  borderBottom: '2px solid #ddd',
  background: '#f5f5f5',
}

const thStyle: CSSProperties = {
  padding: '10px',
  textAlign: 'left',
}

const tbodyRow: CSSProperties = {
  borderBottom: '1px solid #eee',
}

const tdStyle: CSSProperties = {
  padding: '10px',
  color: '#424242',
}

const primaryBtn: CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#2196F3',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

const secondaryBtn: CSSProperties = {
  ...primaryBtn,
  backgroundColor: '#fff',
  color: '#1565c0',
  border: '1px solid #90caf9',
}

const editBtn: CSSProperties = {
  padding: '4px 10px',
  backgroundColor: '#fff8e1',
  color: '#ef6c00',
  border: '1px solid #ffe082',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  fontFamily: 'inherit',
}

const viewBtn: CSSProperties = {
  ...editBtn,
  backgroundColor: '#e8f5e9',
  color: '#2e7d32',
  border: '1px solid #c8e6c9',
}

const actionRow: CSSProperties = {
  display: 'flex',
  gap: '6px',
  flexWrap: 'wrap',
}
