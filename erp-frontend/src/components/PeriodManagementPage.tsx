/**
 * @author: Wendy Yang
 * @date: 2026-10-02
 *
 * Period Management — Open, Soft Close, and Hard Close.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarCheck, Loader2, Lock, Unlock } from 'lucide-react'
import { financeSettingsService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import {
  FINANCE_PERIOD_SETTINGS_KEY,
  useFinancePeriodSettings,
} from '../hooks/useFinancePeriodSettings'
import { formatPeriodDate, periodStatusFor, periodStatusLabel } from '../utils/periodClose'
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

function todayISO() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function isHardReopen(current: string | null, next: string | null) {
  if (!current) return false
  if (!next) return true
  return next < current
}

export function PeriodManagementPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { hasPermission, hasAnyRole } = useAuth()
  const canManage = hasPermission('period:manage')
  const isAdmin = hasAnyRole(['ROLE-ADMIN'])
  const [softDraft, setSoftDraft] = useState('')
  const [hardDraft, setHardDraft] = useState('')
  const [justification, setJustification] = useState('')
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const settingsQuery = useFinancePeriodSettings()

  useEffect(() => {
    setSoftDraft(settingsQuery.data?.soft_close_date || '')
    setHardDraft(settingsQuery.data?.hard_close_date || settingsQuery.data?.current_closing_date || '')
  }, [settingsQuery.data?.soft_close_date, settingsQuery.data?.hard_close_date, settingsQuery.data?.current_closing_date])

  useEffect(() => {
    if (!success && !error) return
    const timer = window.setTimeout(() => {
      setSuccess(null)
      setError(null)
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [success, error])

  const updateMutation = useMutation({
    mutationFn: financeSettingsService.update,
    onSuccess: (data) => {
      setError(null)
      setJustification('')
      setSuccess(
        `Period state updated. Soft close ${formatPeriodDate(data.soft_close_date)}; hard close ${formatPeriodDate(data.hard_close_date)}.`,
      )
      void queryClient.invalidateQueries({ queryKey: FINANCE_PERIOD_SETTINGS_KEY })
    },
    onError: (err) => {
      setSuccess(null)
      setError(err instanceof Error ? err.message : 'Failed to update period state')
    },
  })

  const currentSoft = settingsQuery.data?.soft_close_date || null
  const currentHard = settingsQuery.data?.hard_close_date || settingsQuery.data?.current_closing_date || null
  const nextSoft = softDraft.trim() || null
  const nextHard = hardDraft.trim() || null
  const todayStatus = periodStatusFor(todayISO(), settingsQuery.data)
  const hardReopen = isHardReopen(currentHard, nextHard)
  const softUnchanged = currentSoft === nextSoft
  const hardUnchanged = currentHard === nextHard
  const canReopenHard = !hardReopen || isAdmin

  const submitSoft = () => {
    if (!canManage || updateMutation.isPending || softUnchanged) return
    updateMutation.mutate({ soft_close_date: nextSoft })
  }

  const submitHard = () => {
    if (!canManage || updateMutation.isPending || hardUnchanged) return
    if (hardReopen && justification.trim().length < 10) {
      setError('A justification of at least 10 characters is required to reopen a hard close.')
      return
    }
    updateMutation.mutate({
      hard_close_date: nextHard,
      justification: hardReopen ? justification.trim() : undefined,
    })
  }

  return (
    <div style={pageStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>Period Management</h1>
          <p style={documentPageSubStyle}>
            Soft Close locks operational subledgers so finance can post adjusting journals. Hard
            Close locks the books. Only an Admin can reopen a hard close, with a written
            justification.
          </p>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            <HoverTip label="Back to the general ledger">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/general-ledger')}>
                <ArrowLeft size={15} />
                General Ledger
              </button>
            </HoverTip>
            <HoverTip label="Open Month-End Close">
              <button
                type="button"
                style={headerButtonStyle}
                onClick={() => navigate('/general-ledger/month-end-close')}
              >
                <CalendarCheck size={15} />
                Month-End Close
              </button>
            </HoverTip>
          </div>
        </div>
      </header>

      {error && (
        <div style={errorBox} role="alert">
          {error}
        </div>
      )}
      {success && (
        <div style={successBox} role="status">
          {success}
        </div>
      )}
      {settingsQuery.isError && (
        <div style={errorBox} role="alert">
          {settingsQuery.error instanceof Error
            ? settingsQuery.error.message
            : 'Failed to load period settings'}
        </div>
      )}

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Period states</h2>
        <p style={hintStyle}>
          <strong>Open</strong> allows normal operations.{' '}
          <strong>Soft Close</strong> blocks sales, purchasing, receipts, invoices, cash, and bank
          transfers on or before that date; adjusting journals and month/year-end close stay
          allowed.{' '}
          <strong>Hard Close</strong> blocks every posting, including finance adjustments, until an
          Admin reopens the period.
        </p>
        <div style={summaryGrid}>
          <div>
            <div style={summaryLabel}>Status today</div>
            <div style={summaryValue}>{settingsQuery.isLoading ? 'Loading…' : periodStatusLabel(todayStatus)}</div>
          </div>
          <div>
            <div style={summaryLabel}>Soft close through</div>
            <div style={summaryValue}>
              {settingsQuery.isLoading ? 'Loading…' : formatPeriodDate(currentSoft)}
            </div>
          </div>
          <div>
            <div style={summaryLabel}>Hard close through</div>
            <div style={summaryValue}>
              {settingsQuery.isLoading ? 'Loading…' : formatPeriodDate(currentHard)}
            </div>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Soft Close</h2>
        <p style={hintStyle}>
          Use this after AP, AR, and operational documents for the period are complete. Finance can
          still enter accruals and run Month-End / Year-End Close.
        </p>
        <label style={fieldLabel}>
          Soft close date
          <input
            type="date"
            value={softDraft}
            onChange={(event) => {
              setSuccess(null)
              setError(null)
              setSoftDraft(event.target.value)
            }}
            disabled={!canManage || updateMutation.isPending}
            style={dateInputStyle}
          />
        </label>
        {canManage ? (
          <button
            type="button"
            style={{
              ...primaryButtonStyle,
              ...disabledActionStyle(!softUnchanged && !updateMutation.isPending),
            }}
            disabled={softUnchanged || updateMutation.isPending}
            onClick={submitSoft}
          >
            {updateMutation.isPending ? (
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Lock size={15} />
            )}
            {updateMutation.isPending ? 'Updating…' : 'Update Soft Close'}
          </button>
        ) : (
          <p style={hintStyle}>View only. Updating requires period:manage.</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Hard Close</h2>
        <p style={hintStyle}>
          Fully locks the period. Moving this date earlier, or clearing it, is a formal reopen and
          is written to the audit log.
        </p>
        <label style={fieldLabel}>
          Hard close date
          <input
            type="date"
            value={hardDraft}
            onChange={(event) => {
              setSuccess(null)
              setError(null)
              setHardDraft(event.target.value)
            }}
            disabled={!canManage || updateMutation.isPending}
            style={dateInputStyle}
          />
        </label>
        {hardReopen && (
          <label style={fieldLabel}>
            Reopen justification
            <textarea
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              placeholder="Why this hard-closed period must be reopened"
              disabled={!isAdmin || updateMutation.isPending}
              rows={3}
              style={textareaStyle}
            />
          </label>
        )}
        {!canReopenHard && (
          <div style={warnBox}>Only an Admin can reopen a hard-closed period.</div>
        )}
        {canManage ? (
          <button
            type="button"
            style={{
              ...primaryButtonStyle,
              ...disabledActionStyle(!hardUnchanged && !updateMutation.isPending && canReopenHard),
            }}
            disabled={hardUnchanged || updateMutation.isPending || !canReopenHard}
            onClick={submitHard}
          >
            {updateMutation.isPending ? (
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            ) : hardReopen ? (
              <Unlock size={15} />
            ) : (
              <Lock size={15} />
            )}
            {updateMutation.isPending ? 'Updating…' : hardReopen ? 'Reopen Hard Close' : 'Update Hard Close'}
          </button>
        ) : (
          <p style={hintStyle}>View only. Updating requires period:manage.</p>
        )}
      </section>
    </div>
  )
}

const pageStyle: CSSProperties = { padding: '8px 0 32px' }
const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  maxWidth: 720,
  marginBottom: 16,
}
const sectionTitle: CSSProperties = { margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }
const hintStyle: CSSProperties = { margin: '0 0 16px', fontSize: '13px', color: '#616161', lineHeight: 1.5 }
const summaryGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 16,
}
const summaryLabel: CSSProperties = { fontSize: 12, color: '#616161', fontWeight: 700 }
const summaryValue: CSSProperties = { marginTop: 4, fontSize: 15, color: '#212121', fontWeight: 700 }
const fieldLabel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  fontWeight: 700,
  color: '#424242',
  marginBottom: 12,
}
const dateInputStyle: CSSProperties = {
  maxWidth: 220,
  padding: '8px 10px',
  border: '1px solid #cfd8dc',
  borderRadius: 6,
  fontSize: 14,
  fontFamily: 'inherit',
}
const textareaStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #cfd8dc',
  borderRadius: 6,
  fontSize: 14,
  fontFamily: 'inherit',
  resize: 'vertical',
}
const errorBox: CSSProperties = {
  marginBottom: 12,
  padding: '10px 12px',
  background: '#ffebee',
  color: '#c62828',
  borderRadius: 6,
}
const successBox: CSSProperties = {
  marginBottom: 12,
  padding: '10px 12px',
  background: '#e8f5e9',
  color: '#2e7d32',
  borderRadius: 6,
}
const warnBox: CSSProperties = {
  marginBottom: 12,
  padding: '10px 12px',
  background: '#fff8e1',
  color: '#f57f17',
  borderRadius: 6,
  fontSize: 13,
}

export default PeriodManagementPage
