/**
 * @author: Wendy Yang
 * @date: 2026-09-24
 *
 * Year-End Close — generate a Draft P&L closing journal for approval.
 */

import { useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarRange, FilePlus, Loader2 } from 'lucide-react'
import { journalEntryService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type { JournalEntry } from '../types'
import {
  journalEditPath,
  isJournalDraft,
  MONTH_END_CLOSE_PATH,
  YEAR_END_CLOSE_PATH,
  journalDisplayId,
} from '../utils/journalEntries'
import {
  HoverTip,
  actionRowStyle,
  disabledActionStyle,
  documentPageHeaderStyle,
  documentPageSubStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
  primaryButtonStyle,
} from '../utils/documentPageStyles'

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

function formatMoney(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

function yearOptions(currentYear: number) {
  const years: number[] = []
  for (let year = currentYear + 1; year >= currentYear - 5; year -= 1) {
    years.push(year)
  }
  return years
}

export function YearEndClosePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { hasPermission } = useAuth()
  const canRun = hasPermission('journal:create')
  const currentYear = new Date().getFullYear()
  const [fiscalYear, setFiscalYear] = useState(currentYear)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewQuery = useQuery({
    queryKey: ['yearEndClosePreview', fiscalYear],
    queryFn: () => journalEntryService.previewYearEndClose(fiscalYear),
  })

  const closeMutation = useMutation({
    mutationFn: () => journalEntryService.runYearEndClose(fiscalYear),
    onSuccess: (data) => {
      setError(null)
      setResultMessage(data.message)
      void queryClient.invalidateQueries({ queryKey: ['yearEndClosePreview'] })
      void queryClient.invalidateQueries({ queryKey: ['journalEntries'] })
    },
    onError: (err) => {
      setResultMessage(null)
      setError(err instanceof Error ? err.message : 'Year-end close failed')
    },
  })

  const preview = previewQuery.data
  const ready = preview?.ready || []
  const held = preview?.held || []
  const lines = preview?.lines || []
  const existing = preview?.existing_journal
  const years = useMemo(() => yearOptions(currentYear), [currentYear])

  return (
    <div style={pageStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>Year-End Close</h1>
          <p style={documentPageSubStyle}>
            Close FY {fiscalYear} P&amp;L into retained earnings (3350), then reverse the monthly
            current-period NI park (Debit 3353 / Credit 3354). The generated journal stays Draft
            and must be submitted for approval before it posts.
          </p>
          <label style={periodControlStyle}>
            <span style={periodLabelTextStyle}>Fiscal year</span>
            <select
              value={fiscalYear}
              onChange={(event) => {
                setResultMessage(null)
                setError(null)
                setFiscalYear(Number(event.target.value))
              }}
              style={selectStyle}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={headerActionsStyle}>
          {canRun ? (
            <div style={actionRowStyle}>
              <HoverTip
                label={
                  preview?.can_run
                    ? 'Generate a Draft journal that closes P&L to 3350 and reverses 3353 / 3354'
                    : preview?.blockers?.[0] || 'Closing journal cannot be generated yet'
                }
              >
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,
                    ...disabledActionStyle(Boolean(preview?.can_run) && !closeMutation.isPending),
                  }}
                  disabled={closeMutation.isPending || !preview?.can_run}
                  onClick={() => closeMutation.mutate()}
                >
                  {closeMutation.isPending ? (
                    <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <FilePlus size={15} />
                  )}
                  {closeMutation.isPending ? 'Generating…' : 'Generate journal'}
                </button>
              </HoverTip>
            </div>
          ) : null}
          <div style={actionRowStyle}>
            <HoverTip label="Back to the general ledger">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/general-ledger')}>
                <ArrowLeft size={15} />
                General Ledger
              </button>
            </HoverTip>
            <HoverTip label="Park monthly NI on Month-End Close">
              <button type="button" style={headerButtonStyle} onClick={() => navigate(MONTH_END_CLOSE_PATH)}>
                <CalendarRange size={15} />
                Month-End Close
              </button>
            </HoverTip>
          </div>
        </div>
      </header>

      {error && <div style={errorBox}>{error}</div>}
      {resultMessage && (
        <div style={successBox}>
          {resultMessage}
          {closeMutation.data?.journal ? (
            <>
              {' '}
              <Link to={journalEditPath(closeMutation.data.journal.id, { from: YEAR_END_CLOSE_PATH })} style={inlineLink}>
                Open {journalDisplayId(closeMutation.data.journal)}
              </Link>
            </>
          ) : null}
        </div>
      )}

      {preview?.year_still_open ? (
        <div style={infoBox}>
          FY {fiscalYear} is still open. You can generate the closing journal now; it remains Draft
          until it is approved. Approve monthly park journals first. Revenue and expense stay open
          until this year-end journal is approved.
        </div>
      ) : null}

      {preview?.blockers?.length ? (
        <div style={warnBox}>
          <strong>Cannot generate yet</strong>
          <ul style={blockerList}>
            {preview.blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Close summary</h2>
        <div style={summaryGrid}>
          <Summary label="Revenue" value={formatMoney(preview?.revenue_total)} />
          <Summary label="Expense" value={formatMoney(preview?.expense_total)} />
          <Summary label="Net income" value={formatMoney(preview?.net_income)} />
          <Summary
            label="Retained earnings"
            value={
              preview?.retained_earnings
                ? `${preview.retained_earnings.account_code} · ${preview.retained_earnings.account_name}`
                : '—'
            }
          />
          <Summary label="Close date" value={preview?.close_date || '—'} />
          <Summary label="Period" value={preview?.period || '—'} />
        </div>
        {existing ? (
          <p style={hintStyle}>
            Existing close journal{' '}
            <Link to={journalEditPath(existing.id, { from: YEAR_END_CLOSE_PATH })} style={inlineLink}>
              {journalDisplayId(existing)}
            </Link>{' '}
            is {existing.approval_status || 'DRAFT'} / {existing.posting_status || 'Draft'}. Review
            and submit it for approval.
          </p>
        ) : (
          <p style={hintStyle}>
            Approving the closing journal zeros FY {fiscalYear} P&amp;L into 3350 and reverses
            parked current-period NI (3353 / 3354). Month-end only parks monthly NI; it does not
            close revenue or expense.
          </p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Proposed journal lines ({lines.length})</h2>
        <p style={hintStyle}>Created as Draft / DRAFT. Submit from the journal page after review.</p>
        {previewQuery.isLoading ? (
          <p style={hintStyle}>Loading…</p>
        ) : lines.length === 0 ? (
          <p style={emptyStyle}>No posted P&amp;L balances to close for this year.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRow}>
                  <th style={thStyle}>Account</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Type</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Debit</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={`${line.account_id}-${line.description}`} style={tbodyRow}>
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{line.account_code}</td>
                    <td style={tdStyle}>{line.account_name}</td>
                    <td style={tdStyle}>{line.account_type}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(line.debit) ? formatMoney(line.debit) : ''}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(line.credit) ? formatMoney(line.credit) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Approved drafts still unposted ({ready.length})</h2>
        <p style={hintStyle}>
          Approve and post these journals before generating the year-end journal. Monthly NI is
          parked from{' '}
          <Link to={MONTH_END_CLOSE_PATH} style={inlineLink}>
            Month-End Close
          </Link>
          .
        </p>
        {ready.length === 0 ? (
          <p style={emptyStyle}>No approved draft journals in FY {fiscalYear}.</p>
        ) : (
          <EntryTable rows={ready} from={YEAR_END_CLOSE_PATH} />
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Held for approval ({held.length})</h2>
        <p style={hintStyle}>These drafts are not included in the close until they are approved and posted.</p>
        {held.length === 0 ? (
          <p style={emptyStyle}>No unapproved draft journals in FY {fiscalYear}.</p>
        ) : (
          <EntryTable rows={held} allowEdit from={YEAR_END_CLOSE_PATH} />
        )}
      </section>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={summaryLabel}>{label}</div>
      <div style={summaryValue}>{value}</div>
    </div>
  )
}

function EntryTable({
  rows,
  allowEdit = false,
  from,
}: {
  rows: JournalEntry[]
  allowEdit?: boolean
  from: string
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
                <td style={tdStyle}>{journalDisplayId(entry)}</td>
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
                        onClick={() => navigate(journalEditPath(entry.id, { from }))}
                      >
                        Edit
                      </button>
                    ) : (
                      <button type="button" style={viewBtn} onClick={() => navigate(journalEditPath(entry.id, { from }))}>
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
const periodControlStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 10,
  whiteSpace: 'nowrap',
}
const periodLabelTextStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#757575',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
}
const selectStyle: CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border, #ddd)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--text-h, #212121)',
  backgroundColor: 'var(--bg, #fff)',
}
const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  marginBottom: '16px',
}
const sectionTitle: CSSProperties = { margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }
const hintStyle: CSSProperties = { margin: '0 0 12px', fontSize: '13px', color: '#616161' }
const emptyStyle: CSSProperties = { padding: '20px', textAlign: 'center', color: '#666', fontStyle: 'italic' }
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
const infoBox: CSSProperties = {
  marginBottom: '12px',
  padding: '10px 12px',
  background: '#e3f2fd',
  color: '#1565c0',
  borderRadius: '6px',
  fontSize: 13,
}
const warnBox: CSSProperties = {
  marginBottom: '12px',
  padding: '10px 12px',
  background: '#fff8e1',
  color: '#f57f17',
  borderRadius: '6px',
  fontSize: 13,
}
const blockerList: CSSProperties = { margin: '8px 0 0 18px' }
const summaryGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 16,
  margin: '12px 0',
}
const summaryLabel: CSSProperties = { fontSize: 12, color: '#616161', fontWeight: 700 }
const summaryValue: CSSProperties = { marginTop: 4, fontSize: 15, color: '#212121', fontWeight: 700 }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '13px' }
const theadRow: CSSProperties = { background: '#f5f5f5' }
const thStyle: CSSProperties = { padding: '10px', textAlign: 'left' }
const tbodyRow: CSSProperties = { borderBottom: '1px solid #eee' }
const tdStyle: CSSProperties = { padding: '10px', color: '#424242' }
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
const actionRow: CSSProperties = { display: 'flex', gap: '6px', flexWrap: 'wrap' }
const inlineLink: CSSProperties = { color: '#1565c0', fontWeight: 700 }

export default YearEndClosePage
