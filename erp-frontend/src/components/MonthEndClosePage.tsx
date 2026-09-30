/**
 * @author: Wendy Yang
 * @date: 2026-09-24
 *
 * Month-End Close — post period adjustments; P&L stays open until year-end.
 */

import { useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarRange, FilePlus } from 'lucide-react'
import { journalEntryService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type { JournalEntry } from '../types'
import {
  JOURNAL_CREATE_PATH,
  journalEditPath,
  isJournalDraft,
  shortJournalId,
  YEAR_END_CLOSE_PATH,
} from '../utils/journalEntries'
import { JournalEntryViewModal } from './JournalEntryViewModal'
import {
  HoverTip,
  actionRowStyle,
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

function currentPeriod() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function MonthEndClosePage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canCreate = hasPermission('journal:create')
  const [period, setPeriod] = useState(currentPeriod)
  const [viewingEntry, setViewingEntry] = useState<JournalEntry | null>(null)

  const previewQuery = useQuery({
    queryKey: ['monthEndClosePreview', period],
    queryFn: () => journalEntryService.previewMonthEndClose(period),
  })

  const preview = previewQuery.data
  const ready = preview?.ready || []
  const held = preview?.held || []
  const adjustmentRules = preview?.adjustment_rules || []
  const existing = preview?.existing_journal

  return (
    <div style={pageStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>Month-End Close</h1>
          <p style={documentPageSubStyle}>
            Post {period} adjustments — GRNI cutoff, prepayments, accruals, depreciation, or
            currency revaluation. Revenue and expense stay open and keep accumulating until
            Year-End Close.
          </p>
          <label style={periodControlStyle}>
            <span style={periodLabelTextStyle}>Period</span>
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              style={selectStyle}
            />
          </label>
        </div>
        <div style={headerActionsStyle}>
          {canCreate ? (
            <div style={actionRowStyle}>
              <HoverTip label="Create a Draft month-end adjustment journal">
                <button type="button" style={primaryButtonStyle} onClick={() => navigate(JOURNAL_CREATE_PATH)}>
                  <FilePlus size={15} />
                  New adjustment
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
            <HoverTip label="Close full-year P&L on Year-End Close">
              <button type="button" style={headerButtonStyle} onClick={() => navigate(YEAR_END_CLOSE_PATH)}>
                <CalendarRange size={15} />
                Year-End Close
              </button>
            </HoverTip>
          </div>
        </div>
      </header>

      {preview?.period_still_open ? (
        <div style={infoBox}>
          {period} is still open. Post adjustment journals now; they stay Draft until approved.
          Operational journals still post through their own approval workflow. P&amp;L is not closed
          this month.
        </div>
      ) : null}

      {preview?.blockers?.length ? (
        <div style={warnBox}>
          <strong>Before you finish month-end</strong>
          <ul style={blockerList}>
            {preview.blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Period activity (still accumulating)</h2>
        <div style={summaryGrid}>
          <Summary label="Revenue" value={formatMoney(preview?.revenue_total)} />
          <Summary label="Expense" value={formatMoney(preview?.expense_total)} />
          <Summary label="Net income" value={formatMoney(preview?.net_income)} />
          <Summary
            label="Current-period NI plug"
            value={
              preview?.current_period_ni
                ? `${preview.current_period_ni.account_code} · ${preview.current_period_ni.account_name}`
                : '—'
            }
          />
          <Summary label="Period end" value={preview?.close_date || '—'} />
          <Summary label="Period" value={preview?.period || '—'} />
        </div>
        <p style={hintStyle}>
          These totals are informational. Revenue and expense are not zeroed at month-end.{' '}
          <Link to={YEAR_END_CLOSE_PATH} style={inlineLink}>
            Year-End Close
          </Link>{' '}
          closes full-year P&amp;L into retained earnings (3350).
        </p>
        {existing ? (
          <p style={hintStyle}>
            A legacy monthly close journal{' '}
            <Link to={journalEditPath(existing.id)} style={inlineLink}>
              {shortJournalId(existing.id)}
            </Link>{' '}
            is {existing.approval_status || 'DRAFT'} / {existing.posting_status || 'Draft'}. Review
            it if it still needs approval or deletion.
          </p>
        ) : null}
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Adjustment posting rules ({adjustmentRules.length})</h2>
        <p style={hintStyle}>
          Use these catalog pairs when you post a month-end adjustment journal. Edit the accounts on
          Posting Rules if the default codes do not match your chart.
        </p>
        {previewQuery.isLoading ? (
          <p style={hintStyle}>Loading…</p>
        ) : adjustmentRules.length === 0 ? (
          <p style={emptyStyle}>No month-end adjustment rules are configured.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRow}>
                  <th style={thStyle}>When</th>
                  <th style={thStyle}>Debit</th>
                  <th style={thStyle}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {adjustmentRules.map((rule) => (
                  <tr key={rule.id} style={tbodyRow}>
                    <td style={tdStyle}>{rule.variant_label || rule.name}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>
                      {rule.debit_account_code}
                      {rule.debit_account_name ? ` — ${rule.debit_account_name}` : ''}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace' }}>
                      {rule.credit_account_code}
                      {rule.credit_account_name ? ` — ${rule.credit_account_name}` : ''}
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
        <p style={hintStyle}>These must post through journal approval before you finish month-end.</p>
        {ready.length === 0 ? (
          <p style={emptyStyle}>No approved draft journals in {period}.</p>
        ) : (
          <EntryTable rows={ready} onView={setViewingEntry} />
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Held for approval ({held.length})</h2>
        <p style={hintStyle}>These drafts are not included in the close until they are approved and posted.</p>
        {held.length === 0 ? (
          <p style={emptyStyle}>No unapproved draft journals in {period}.</p>
        ) : (
          <EntryTable rows={held} allowEdit onView={setViewingEntry} />
        )}
      </section>

      <JournalEntryViewModal entry={viewingEntry} onClose={() => setViewingEntry(null)} />
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
const theadRow: CSSProperties = { borderBottom: '2px solid #ddd', background: '#f5f5f5' }
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

export default MonthEndClosePage
