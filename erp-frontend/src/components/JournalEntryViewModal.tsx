/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, type CSSProperties } from 'react'
import type { JournalEntry, LedgerPosting } from '../types'
import { shortJournalId } from '../utils/journalEntries'

type JournalEntryViewModalProps = {
  entry: JournalEntry | null
  onClose: () => void
}

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

function formatAmount(value: number | string | null | undefined) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return money(n)
}

export function JournalEntryViewModal({ entry, onClose }: JournalEntryViewModalProps) {
  useEffect(() => {
    if (!entry) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entry, onClose])

  if (!entry) return null

  const postings: LedgerPosting[] = entry.postings || []
  const debitTotal = postings.reduce((sum, row) => sum + (Number(row.debit) || 0), 0)
  const creditTotal = postings.reduce((sum, row) => sum + (Number(row.credit) || 0), 0)

  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="journal-view-title"
      onClick={onClose}
    >
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <h2 id="journal-view-title" style={titleStyle}>
              Journal {shortJournalId(entry.id)}
            </h2>
            <p style={hintStyle}>Read-only view. Posted and approved journals cannot be modified.</p>
          </div>
          <button type="button" style={closeBtn} onClick={onClose}>
            Close
          </button>
        </div>

        <dl style={metaGrid}>
          <div>
            <dt style={dtStyle}>Journal ID</dt>
            <dd style={ddStyle}>{shortJournalId(entry.id)}</dd>
          </div>
          <div>
            <dt style={dtStyle}>Posting Date</dt>
            <dd style={ddStyle}>{formatDate(entry.posting_date || entry.created_at)}</dd>
          </div>
          <div>
            <dt style={dtStyle}>Financial Period</dt>
            <dd style={ddStyle}>{entry.period || '—'}</dd>
          </div>
          <div>
            <dt style={dtStyle}>Reference</dt>
            <dd style={ddStyle}>{entry.reference || '—'}</dd>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <dt style={dtStyle}>Description</dt>
            <dd style={ddStyle}>{entry.description || '—'}</dd>
          </div>
          <div>
            <dt style={dtStyle}>Posting Status</dt>
            <dd style={ddStyle}>{entry.posting_status || '—'}</dd>
          </div>
          <div>
            <dt style={dtStyle}>Approval Status</dt>
            <dd style={ddStyle}>{entry.approval_status || 'DRAFT'}</dd>
          </div>
        </dl>

        <h3 style={sectionTitle}>Posting Detail</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRow}>
                <th style={thStyle}>Account Code</th>
                <th style={thStyle}>Account Name</th>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Debit</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {postings.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, fontStyle: 'italic', color: '#666' }}>
                    No posting lines.
                  </td>
                </tr>
              ) : (
                postings.map((row, index) => (
                  <tr key={row.id || `${row.account_id}-${index}`}>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>
                      {row.account_code || '—'}
                    </td>
                    <td style={tdStyle}>{row.account_name || '—'}</td>
                    <td style={tdStyle}>{row.description || entry.description}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                      {formatAmount(row.debit)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                      {formatAmount(row.credit)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr style={tfootRow}>
                <td colSpan={3} style={{ ...tdStyle, fontWeight: 700 }}>
                  Totals
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                  {money(debitTotal)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                  {money(creditTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '16px',
}

const modalStyle: CSSProperties = {
  background: '#fff',
  borderRadius: '10px',
  padding: '20px 24px',
  width: 'min(860px, 100%)',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  border: '1px solid #ddd',
  textAlign: 'left',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  marginBottom: '16px',
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: '20px',
  fontWeight: 700,
  color: '#212121',
}

const hintStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: '13px',
  color: '#616161',
}

const closeBtn: CSSProperties = {
  padding: '8px 14px',
  backgroundColor: '#fff',
  color: '#1565c0',
  border: '1px solid #90caf9',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontFamily: 'inherit',
}

const metaGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '12px 16px',
  margin: '0 0 20px',
}

const dtStyle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#757575',
  marginBottom: '4px',
}

const ddStyle: CSSProperties = {
  margin: 0,
  fontSize: '14px',
  color: '#212121',
}

const sectionTitle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: '14px',
  fontWeight: 700,
  color: '#212121',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const theadRow: CSSProperties = {
  borderBottom: '2px solid #ddd',
  backgroundColor: '#f5f5f5',
}

const tfootRow: CSSProperties = {
  borderTop: '2px solid #ddd',
  backgroundColor: '#fafafa',
}

const thStyle: CSSProperties = {
  padding: '10px',
  textAlign: 'left',
  fontWeight: 700,
  color: '#212121',
}

const tdStyle: CSSProperties = {
  padding: '10px',
  color: '#424242',
  borderBottom: '1px solid #eee',
  verticalAlign: 'middle',
}
