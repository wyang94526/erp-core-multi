/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { approvalService, chartOfAccountsService, journalEntryService, postingRulesService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type { JournalEntry, JournalLineDraft } from '../types'
import { newJournalLine } from '../utils/journalCsvImport'
import {
  inferredPostingRule,
  isJournalEditable,
  isSystemJournal,
  postingRuleDisplay,
  postingRulePath,
  sourceDocumentLabel,
  sourceDocumentPath,
} from '../utils/journalEntries'

function todayISO() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function periodFromDate(value: string) {
  return value.slice(0, 7)
}

function dateOnly(value: string | null | undefined) {
  if (!value) return todayISO()
  return value.slice(0, 10)
}

function amountStr(value: number | string | null | undefined) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

function linesFromEntry(entry: JournalEntry): JournalLineDraft[] {
  const rows = (entry.postings || []).map((posting, index) =>
    newJournalLine({
      key: posting.id || `line-${index}`,
      account_id: posting.account_id,
      description: posting.description || '',
      debit: amountStr(posting.debit),
      credit: amountStr(posting.credit),
    }),
  )
  while (rows.length < 2) rows.push(newJournalLine())
  return rows
}

function parseAmount(value: string) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export function ManualJournalEntryPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { hasPermission } = useAuth()
  const isEdit = Boolean(id)
  const canCreate = hasPermission('journal:create')
  const canSubmit = hasPermission('journal:submit')

  const [postingDate, setPostingDate] = useState(todayISO)
  const [period, setPeriod] = useState(periodFromDate(todayISO()))
  const [periodDirty, setPeriodDirty] = useState(false)
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<JournalLineDraft[]>([newJournalLine(), newJournalLine()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedId, setLoadedId] = useState<string | null>(null)

  const accountsQuery = useQuery({
    queryKey: ['chartOfAccounts', 'journal-form'],
    queryFn: () => chartOfAccountsService.listAccounts(0, 2000),
  })

  const entryQuery = useQuery({
    queryKey: ['journalEntry', id],
    queryFn: () => journalEntryService.getJournalEntry(id as string),
    enabled: isEdit && Boolean(id),
  })

  const rulesQuery = useQuery({
    queryKey: ['postingRules'],
    queryFn: () => postingRulesService.list(),
    enabled: isEdit,
  })

  const accounts = useMemo(() => {
    const rows = accountsQuery.data || []
    return [...rows].sort((a, b) => a.account_code.localeCompare(b.account_code))
  }, [accountsQuery.data])

  useEffect(() => {
    if (!isEdit) {
      setPostingDate(todayISO())
      setPeriod(periodFromDate(todayISO()))
      setPeriodDirty(false)
      setReference('')
      setDescription('')
      setLines([newJournalLine(), newJournalLine()])
      setError(null)
      setLoadedId(null)
      return
    }
    const entry = entryQuery.data
    if (!entry || loadedId === `${entry.id}:${entryQuery.dataUpdatedAt}`) return
    if (!isJournalEditable(entry) && !isSystemJournal(entry)) {
      setError('Only draft or rejected journals can be edited.')
      return
    }
    setPostingDate(dateOnly(entry.posting_date || entry.created_at))
    setPeriod(entry.period || periodFromDate(dateOnly(entry.posting_date || entry.created_at)))
    setPeriodDirty(Boolean(entry.period))
    setReference(entry.reference || '')
    setDescription(entry.description || '')
    setLines(linesFromEntry(entry))
    setError(null)
    setLoadedId(`${entry.id}:${entryQuery.dataUpdatedAt}`)
  }, [isEdit, entryQuery.data, entryQuery.dataUpdatedAt, loadedId])

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        acc.debit += parseAmount(line.debit)
        acc.credit += parseAmount(line.credit)
        return acc
      },
      { debit: 0, credit: 0 },
    )
  }, [lines])

  const difference = Math.round((totals.debit - totals.credit) * 100) / 100
  const balanced = totals.debit > 0 && totals.credit > 0 && difference === 0
  const hasDebit = lines.some((line) => parseAmount(line.debit) > 0)
  const hasCredit = lines.some((line) => parseAmount(line.credit) > 0)

  const updateLine = (key: string, patch: Partial<JournalLineDraft>) => {
    setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const setDebit = (key: string, value: string) => {
    updateLine(key, parseAmount(value) > 0 ? { debit: value, credit: '' } : { debit: value })
  }

  const setCredit = (key: string, value: string) => {
    updateLine(key, parseAmount(value) > 0 ? { credit: value, debit: '' } : { credit: value })
  }

  const buildPayload = () => {
    const postings = lines
      .map((line) => ({
        account_id: line.account_id,
        debit: parseAmount(line.debit),
        credit: parseAmount(line.credit),
        description: line.description.trim() || null,
      }))
      .filter((line) => line.account_id && (line.debit > 0 || line.credit > 0))
    return {
      description: description.trim(),
      posting_date: postingDate,
      period,
      reference: reference.trim() || null,
      postings,
    }
  }

  const validate = () => {
    if (!description.trim()) return 'Enter a journal description.'
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return 'Financial period must be YYYY-MM.'
    const payload = buildPayload()
    if (payload.postings.length < 2) return 'Add at least two posting lines.'
    if (!hasDebit || !hasCredit) return 'Include at least one debit line and one credit line.'
    if (!balanced) return 'Total debits must equal total credits before saving.'
    if (payload.postings.some((line) => line.debit > 0 && line.credit > 0)) {
      return 'Each line can have a debit or a credit, not both.'
    }
    return null
  }

  const goBack = () => navigate('/general-ledger')

  const handleSave = async (submitAfter: boolean) => {
    const message = validate()
    if (message) {
      setError(message)
      return
    }
    if (entryQuery.data && isSystemJournal(entryQuery.data)) return
    setBusy(true)
    setError(null)
    try {
      const payload = buildPayload()
      const saved = isEdit && id
        ? await journalEntryService.updateJournalEntry(id, payload)
        : await journalEntryService.createJournalEntry(payload)
      if (submitAfter) {
        await approvalService.submit('journal-entries', saved.id)
      }
      await queryClient.invalidateQueries({ queryKey: ['journalEntry', saved.id] })
      await queryClient.invalidateQueries({ queryKey: ['journalEntries'] })
      await queryClient.invalidateQueries({ queryKey: ['monthEndClosePreview'] })
      goBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save journal entry')
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void handleSave(canSubmit)
  }

  const loadedEntry = entryQuery.data
  const readOnly = Boolean(loadedEntry && isSystemJournal(loadedEntry))

  if (isEdit && entryQuery.isLoading) {
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>Journal Entry</h1>
        <p style={hintStyle}>Loading journal…</p>
      </div>
    )
  }

  if (!canCreate && !readOnly) {
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>Manual Journal Entry</h1>
        <p style={hintStyle}>You need journal:create permission to add or edit journals.</p>
      </div>
    )
  }

  if (isEdit && (entryQuery.isError || (loadedEntry && !isJournalEditable(loadedEntry) && !readOnly))) {
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>Edit Journal Entry</h1>
        <p style={errorStyle}>
          {error || (entryQuery.error instanceof Error ? entryQuery.error.message : 'This journal cannot be edited.')}
        </p>
        <button type="button" style={cancelBtn} onClick={goBack}>
          Back to General Ledger
        </button>
      </div>
    )
  }

  const sourceHref = loadedEntry
    ? sourceDocumentPath(loadedEntry.source_document_type, loadedEntry.source_record_id)
    : null
  const postingRule = loadedEntry ? inferredPostingRule(loadedEntry, rulesQuery.data || []) : null
  const ruleLabel = loadedEntry ? postingRuleDisplay(loadedEntry, rulesQuery.data || []) : ''
  const ruleHref = postingRulePath(postingRule?.id || loadedEntry?.posting_rule_id)

  return (
    <div style={pageStyle}>
      <form style={formStyle} onSubmit={onSubmit}>
        <div style={headerStyle}>
          <div>
            <h1 style={titleStyle}>
              {readOnly ? 'System Journal Entry' : isEdit ? 'Edit Journal Entry' : 'Manual Journal Entry'}
            </h1>
            <p style={hintStyle}>
              {readOnly
                ? 'This journal was generated automatically. Reverse it from the source document instead of editing the lines.'
                : 'Manual double-entry journal mapped to the chart of accounts. Debits must equal credits.'}
            </p>
          </div>
        </div>

        <div style={headerGridStyle}>
          <label style={labelStyle}>
            Posting Date
            <input
              type="date"
              required
              disabled={readOnly}
              value={postingDate}
              onChange={(e) => {
                const next = e.target.value
                setPostingDate(next)
                if (!periodDirty && next) setPeriod(periodFromDate(next))
              }}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Financial Period
            <input
              type="month"
              required
              disabled={readOnly}
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value)
                setPeriodDirty(true)
              }}
              style={inputStyle}
            />
          </label>
          <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
            Reference / Source Document
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional source document or voucher #"
              disabled={readOnly}
              style={inputStyle}
            />
          </label>
          <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
            Description
            <input
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Accrue September rent"
              disabled={readOnly}
              style={inputStyle}
            />
          </label>
        </div>

        {readOnly && loadedEntry && (
          <div style={sourceActionsStyle}>
            {sourceHref ? (
              <Link to={sourceHref} style={sourceLinkStyle}>
                View Source Document — {sourceDocumentLabel(loadedEntry.source_document_type)}
                {loadedEntry.source_record_id ? ` ${loadedEntry.source_record_id}` : ''}
              </Link>
            ) : (
              <span style={hintStyle}>No source document link is available.</span>
            )}
            {ruleHref && ruleLabel && (
              <Link to={ruleHref} style={sourceLinkStyle} title={postingRule?.name || loadedEntry.posting_rule_name || ruleLabel}>
                View Posting Rule {ruleLabel}
              </Link>
            )}
          </div>
        )}

        {accountsQuery.isLoading && <p style={hintStyle}>Loading chart of accounts…</p>}
        <div style={gridWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Account Code</th>
                <th style={thStyle}>Account Name</th>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Debit</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Credit</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const account = accounts.find((row) => row.id === line.account_id)
                return (
                  <tr key={line.key}>
                    <td style={tdStyle}>
                      <select
                        value={line.account_id}
                        onChange={(e) => updateLine(line.key, { account_id: e.target.value })}
                        disabled={readOnly}
                        style={inputStyle}
                      >
                        <option value="">Select account…</option>
                        {accounts.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.account_code} · {row.account_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <input value={account?.account_name || ''} readOnly style={readOnlyStyle} />
                    </td>
                    <td style={tdStyle}>
                      <input
                        value={line.description}
                        onChange={(e) => updateLine(line.key, { description: e.target.value })}
                        placeholder="Line memo (optional)"
                        disabled={readOnly}
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.debit}
                        onChange={(e) => setDebit(line.key, e.target.value)}
                        disabled={readOnly}
                        style={{ ...inputStyle, textAlign: 'right' }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.credit}
                        onChange={(e) => setCredit(line.key, e.target.value)}
                        disabled={readOnly}
                        style={{ ...inputStyle, textAlign: 'right' }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        style={removeBtn}
                        disabled={readOnly || lines.length <= 2 || busy}
                        onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <button
            type="button"
            style={addLineBtn}
            disabled={busy}
            onClick={() => setLines((rows) => [...rows, newJournalLine()])}
          >
            + Add line
          </button>
        )}

        <div style={totalsStyle}>
          <span>Debits {money(totals.debit)}</span>
          <span>Credits {money(totals.credit)}</span>
          <span style={{ color: balanced ? '#2e7d32' : '#c62828', fontWeight: 700 }}>
            {balanced ? 'Balanced' : `Out of balance ${money(Math.abs(difference))}`}
          </span>
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        <div style={actionsStyle}>
          <button type="button" style={cancelBtn} onClick={goBack} disabled={busy}>
            {readOnly ? 'Back to General Ledger' : 'Cancel'}
          </button>
          {!readOnly && (
            <button type="button" style={secondaryBtn} disabled={busy} onClick={() => void handleSave(false)}>
              {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Draft'}
            </button>
          )}
          {!readOnly && canSubmit && (
            <button type="submit" style={primaryBtn} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit for Approval'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

const pageStyle: CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}

const formStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
}

const headerStyle: CSSProperties = {
  marginBottom: '16px',
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 'bold',
  color: '#212121',
}

const hintStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: '13px',
  color: '#616161',
}

const sourceActionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '12px',
  margin: '0 0 16px',
}

const sourceLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid #90caf9',
  background: '#e3f2fd',
  color: '#1565c0',
  fontWeight: 600,
  fontSize: '13px',
  textDecoration: 'none',
}

const headerGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px',
  marginBottom: '16px',
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '12px',
  fontWeight: 700,
  color: '#424242',
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid #ccc',
  fontFamily: 'inherit',
  fontSize: '13px',
}

const readOnlyStyle: CSSProperties = {
  ...inputStyle,
  background: '#f5f5f5',
  color: '#424242',
}

const gridWrapStyle: CSSProperties = {
  overflowX: 'auto',
  border: '1px solid #eee',
  borderRadius: '8px',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const thStyle: CSSProperties = {
  padding: '8px',
  textAlign: 'left',
  background: '#f5f5f5',
  borderBottom: '1px solid #ddd',
  fontSize: '12px',
}

const tdStyle: CSSProperties = {
  padding: '8px',
  verticalAlign: 'middle',
  borderBottom: '1px solid #f0f0f0',
}

const addLineBtn: CSSProperties = {
  marginTop: '10px',
  padding: '6px 12px',
  border: '1px dashed #90caf9',
  background: '#e3f2fd',
  color: '#1565c0',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 600,
}

const totalsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '16px',
  marginTop: '14px',
  fontSize: '13px',
  color: '#424242',
}

const errorStyle: CSSProperties = {
  marginTop: '12px',
  color: '#c62828',
  fontSize: '13px',
}

const actionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  marginTop: '18px',
  flexWrap: 'wrap',
}

const cancelBtn: CSSProperties = {
  padding: '8px 14px',
  border: '1px solid #ccc',
  background: '#fff',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const secondaryBtn: CSSProperties = {
  padding: '8px 14px',
  border: '1px solid #90caf9',
  background: '#e3f2fd',
  color: '#1565c0',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 700,
}

const primaryBtn: CSSProperties = {
  padding: '8px 14px',
  border: 'none',
  background: '#2196F3',
  color: '#fff',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 700,
}

const removeBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#c62828',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '12px',
}
