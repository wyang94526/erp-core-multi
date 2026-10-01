/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * PostingRules — debit/credit account mapping used when documents post to GL.
 */

import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { chartOfAccountsService, postingRulesService } from '../api/services'
import type { ChartOfAccount, PostingRule } from '../types'
import { useAuth } from '../context/AuthContext'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'

const RULE_FILTERS: FilterField[] = []

function accountLabel(code?: string | null, name?: string | null) {
  if (!code) return '—'
  return name ? `${code} — ${name}` : code
}

function debitLabel(rule: PostingRule) {
  if (rule.debit_display_label) return rule.debit_display_label
  return accountLabel(rule.debit_account_code, rule.debit_account_name)
}

const EVENT_GROUP_ORDER = [
  'Month-end close',
  'Year-end close',
]

function PostingRules() {
  const { hash } = useLocation()
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('journal:create')
  const [rules, setRules] = useState<PostingRule[]>([])
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PostingRule | null>(null)
  const [debitId, setDebitId] = useState('')
  const [creditId, setCreditId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const load = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const [ruleRows, accountRows] = await Promise.all([
        postingRulesService.list(),
        chartOfAccountsService.listAccounts(0, 2000),
      ])
      setRules(ruleRows)
      setAccounts([...accountRows].sort((a, b) => a.account_code.localeCompare(b.account_code)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posting rules')
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const ruleId = hash.startsWith('#rule-') ? hash.slice('#rule-'.length) : ''
    if (!ruleId || rules.length === 0) return
    const match = rules.find((rule) => rule.id === ruleId)
    if (match) openEdit(match)
    document.getElementById(`rule-${ruleId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [hash, rules])

  const { values } = useListFilterParams(RULE_FILTERS)
  const filteredRules = useMemo(
    () =>
      rules.filter(
        (rule) =>
          rule.is_active &&
          matchesSearch(
            values.q,
            rule.rule_code,
            rule.name,
            rule.event_label,
            rule.event_code,
            rule.variant_label,
            rule.party_label,
            rule.debit_account_code,
            rule.credit_account_code,
          ),
      ),
    [rules, values.q],
  )
  const grouped = useMemo(() => {
    const byEvent = new Map<string, PostingRule[]>()
    for (const rule of filteredRules) {
      const key = rule.event_label || rule.event_code
      const list = byEvent.get(key) || []
      list.push(rule)
      byEvent.set(key, list)
    }
    return [...byEvent.entries()].sort(([left], [right]) => {
      const leftRank = EVENT_GROUP_ORDER.indexOf(left)
      const rightRank = EVENT_GROUP_ORDER.indexOf(right)
      if (leftRank === -1 && rightRank === -1) return 0
      if (leftRank === -1) return 1
      if (rightRank === -1) return -1
      return leftRank - rightRank
    })
  }, [filteredRules])

  const openEdit = (rule: PostingRule) => {
    setEditing(rule)
    setDebitId(rule.debit_account_id)
    setCreditId(rule.credit_account_id)
    setFormError(null)
    setSaveMessage(null)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      debit_account_id: debitId,
      credit_account_id: creditId,
    }
    console.log('[PostingRules] Save Rule clicked', {
      ruleId: editing?.id,
      ruleName: editing?.name,
      canEdit,
      payload,
    })
    if (!editing) {
      setFormError('No posting rule is open for edit.')
      return
    }
    if (!canEdit) {
      setFormError('You need journal:create permission to save posting rules.')
      return
    }
    if (!debitId || !creditId) {
      setFormError('Debit and credit accounts are required.')
      return
    }
    if (debitId === creditId) {
      setFormError('Debit and credit accounts must be different.')
      return
    }
    setSaving(true)
    setFormError(null)
    setSaveMessage(null)
    try {
      const saved = await postingRulesService.update(editing.id, payload)
      console.log('[PostingRules] Save Rule succeeded', saved)
      setRules((current) => current.map((row) => (row.id === saved.id ? saved : row)))
      setEditing(null)
      setSaveMessage(
        `Saved ${saved.name}: debit ${saved.debit_account_code} / credit ${saved.credit_account_code}.`,
      )
      await load({ silent: true })
    } catch (err) {
      const status = err && typeof err === 'object' && 'status' in err ? (err as { status?: number }).status : undefined
      const message = err instanceof Error ? err.message : 'Failed to save posting rule'
      console.error('[PostingRules] Save Rule failed', { status, message, err })
      setFormError(status ? `Save failed (${status}): ${message}` : message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async (rule: PostingRule) => {
    if (
      !window.confirm(
        `Reset ${rule.name} to the standard debit ${rule.default_debit_account_code} / credit ${rule.default_credit_account_code}?`,
      )
    ) {
      return
    }
    try {
      await postingRulesService.reset(rule.id)
      if (editing?.id === rule.id) setEditing(null)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reset posting rule')
    }
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Posting Rules</h2>
          <p style={pageSubStyle}>
            Auto-generated journals read these debit and credit accounts. Change them here to
            maintain your chart — the next posting uses the new setup. Vendor AP mapping and
            bank-account G/L still override AP and cash. Month-end close parks current-period NI
            (3354 / 3353). Year-end close zeros all P&amp;L into retained earnings (3350) and
            reverses the monthly NI park (3353 / 3354).
          </p>
        </div>
      </header>

      <ListFilterBar
        fields={RULE_FILTERS}
        searchPlaceholder="Search rule code, event, account…"
        exportCount={filteredRules.length}
        onExport={() =>
          downloadCsv(
            csvFilename('posting-rules'),
            ['Rule Code', 'Name', 'Event', 'Variant', 'Party', 'Debit', 'Credit'],
            filteredRules.map((rule) => [
              rule.rule_code,
              rule.name,
              rule.event_label || rule.event_code,
              rule.variant_label || rule.variant,
              rule.party_label || rule.party_scope,
              rule.debit_display_label || rule.debit_account_code,
              rule.credit_account_code,
            ]),
          )
        }
      />

      {saveMessage && !editing && <p style={successStyle}>{saveMessage}</p>}

      {editing && (
        <form style={formCardStyle} onSubmit={handleSave}>
          <h3 style={formTitleStyle}>{editing.name}</h3>
          <p style={pageSubStyle}>
            {editing.event_label} · {editing.variant_label} · {editing.party_label}
          </p>
          {editing.debit_display_label ? (
            <p style={pageSubStyle}>
              Year-end close iterates every Income and Expense account. Only the retained
              earnings destination (3350) is stored on this rule.
            </p>
          ) : null}
          {!canEdit && (
            <p style={errorStyle}>You can view this rule, but journal:create is required to save changes.</p>
          )}
          <div style={formGridStyle}>
            <label style={labelStyle}>
              Debit account
              {editing.debit_display_label ? (
                <input style={{ ...inputStyle, opacity: 0.75 }} value={editing.debit_display_label} readOnly disabled />
              ) : (
                <select style={inputStyle} value={debitId} onChange={(e) => setDebitId(e.target.value)}>
                  {accounts.map((acct) => (
                    <option key={acct.id} value={acct.id}>
                      {acct.account_code} — {acct.account_name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label style={labelStyle}>
              Credit account
              <select
                style={inputStyle}
                value={creditId}
                onChange={(e) => setCreditId(e.target.value)}
              >
                {accounts.map((acct) => (
                  <option key={acct.id} value={acct.id}>
                    {acct.account_code} — {acct.account_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {formError && <p style={errorStyle}>{formError}</p>}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              type="submit"
              style={{
                ...primaryButtonStyle,
                ...(saving || !canEdit ? { opacity: 0.65, cursor: 'not-allowed' } : {}),
              }}
              disabled={saving || !canEdit}
              title={!canEdit ? 'Requires journal:create permission' : 'Save debit and credit accounts'}
            >
              {saving ? 'Saving…' : 'Save Rule'}
            </button>
            <button
              type="button"
              style={ghostButtonStyle}
              onClick={() => {
                setEditing(null)
                setFormError(null)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div style={dashboardSectionStyle}>
        {loading ? (
          <div style={emptyStateWrapperStyle}>Loading posting rules…</div>
        ) : error ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>{error}</div>
        ) : rules.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No posting rules found.</div>
        ) : (
          grouped.map(([eventLabel, eventRules]) => (
            <div key={eventLabel} style={{ marginBottom: 8 }}>
              <h3 style={groupTitleStyle}>{eventLabel}</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={directoryTableStyle}>
                  <thead>
                    <tr style={directoryTheadRowStyle}>
                      <th style={directoryThStyle}>When</th>
                      <th style={directoryThStyle}>Party</th>
                      <th style={directoryThStyle}>Debit</th>
                      <th style={directoryThStyle}>Credit</th>
                      <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventRules.map((rule) => (
                      <tr
                        id={`rule-${rule.id}`}
                        key={rule.id}
                        style={
                          hash === `#rule-${rule.id}`
                            ? { ...directoryTbodyRowStyle, backgroundColor: '#e3f2fd' }
                            : directoryTbodyRowStyle
                        }
                      >
                        <td style={directoryTdStyle}>{rule.variant_label}</td>
                        <td style={directoryTdStyle}>{rule.party_label}</td>
                        <td style={{ ...directoryTdStyle, fontFamily: rule.debit_display_label ? 'inherit' : 'monospace' }}>
                          {debitLabel(rule)}
                        </td>
                        <td style={{ ...directoryTdStyle, fontFamily: 'monospace' }}>
                          {accountLabel(rule.credit_account_code, rule.credit_account_name)}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                style={ghostButtonStyle}
                                onClick={() => openEdit(rule)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                style={ghostButtonStyle}
                                onClick={() => handleReset(rule)}
                              >
                                Reset
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}
const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
}
const pageTitleStyle: React.CSSProperties = { margin: 0, fontSize: '28px', fontWeight: 'bold', color: 'var(--text-h)' }
const pageSubStyle: React.CSSProperties = { margin: '4px 0 0 0', fontSize: '14px', color: 'var(--text)' }
const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
}
const formCardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '20px 24px',
  marginBottom: '20px',
}
const formTitleStyle: React.CSSProperties = { margin: '0 0 8px 0', fontSize: '16px' }
const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '12px',
  marginTop: 16,
}
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }
const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontFamily: 'inherit',
}
const errorStyle: React.CSSProperties = { color: '#c62828', fontSize: 13 }
const successStyle: React.CSSProperties = {
  color: '#1b5e20',
  background: '#e8f5e9',
  border: '1px solid #a5d6a7',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 13,
  marginBottom: 16,
}
const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '8px 0 16px',
}
const groupTitleStyle: React.CSSProperties = {
  margin: '16px 16px 8px',
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-h)',
}
const directoryTableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const directoryTheadRowStyle: React.CSSProperties = { backgroundColor: 'var(--social-bg)' }
const directoryThStyle: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--text)',
}
const directoryTbodyRowStyle: React.CSSProperties = { borderTop: '1px solid var(--border)' }
const directoryTdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13 }
const emptyStateWrapperStyle: React.CSSProperties = { padding: '30px', textAlign: 'center' }
const ghostButtonStyle: React.CSSProperties = {
  margin: '0 4px',
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 'bold',
  fontFamily: 'inherit',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
}

export default PostingRules
