/**
 * ChartOfAccounts — master list of GL accounts
 */

import { useEffect, useState } from 'react'
import { chartOfAccountsService } from '../api/services'
import type { AccountType, ChartOfAccount } from '../types'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'

const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']

function ChartOfAccounts() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    account_code: '',
    account_name: '',
    account_type: 'Asset' as AccountType,
  })

  const loadAccounts = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await chartOfAccountsService.listAccounts(0, 2000)
      setAccounts(
        [...data].sort((a, b) => a.account_code.localeCompare(b.account_code)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chart of accounts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  const { items: sortedAccounts, requestSort, sortConfig } = useSortableData(accounts, {
    columnTypes: {
      created_at: 'date',
    },
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!form.account_code.trim() || !form.account_name.trim()) {
      setFormError('Account code and name are required.')
      return
    }
    setSaving(true)
    try {
      await chartOfAccountsService.createAccount({
        account_code: form.account_code.trim(),
        account_name: form.account_name.trim(),
        account_type: form.account_type,
      })
      setForm({ account_code: '', account_name: '', account_type: 'Asset' })
      setShowForm(false)
      await loadAccounts()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create account')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (account: ChartOfAccount) => {
    if (!window.confirm(`Delete account ${account.account_code} — ${account.account_name}?`)) {
      return
    }
    try {
      await chartOfAccountsService.deleteAccount(account.id)
      await loadAccounts()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete account')
    }
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Chart of Accounts</h2>
          <p style={pageSubStyle}>
            Master list of GL accounts used by AR, AP, Cash, and General Ledger postings
          </p>
        </div>
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={() => {
            setShowForm((open) => !open)
            setFormError(null)
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          {showForm ? 'Cancel' : '+ Add Account'}
        </button>
      </header>

      {showForm && (
        <form style={formCardStyle} onSubmit={handleCreate}>
          <h3 style={formTitleStyle}>New Account</h3>
          <div style={formGridStyle}>
            <label style={labelStyle}>
              Account Code
              <input
                style={inputStyle}
                value={form.account_code}
                onChange={(e) => setForm((f) => ({ ...f, account_code: e.target.value }))}
                placeholder="e.g. 1000"
                maxLength={50}
                required
              />
            </label>
            <label style={labelStyle}>
              Account Name
              <input
                style={inputStyle}
                value={form.account_name}
                onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
                placeholder="e.g. Cash"
                maxLength={255}
                required
              />
            </label>
            <label style={labelStyle}>
              Account Type
              <select
                style={inputStyle}
                value={form.account_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, account_type: e.target.value as AccountType }))
                }
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {formError && <p style={formErrorStyle}>{formError}</p>}
          <div style={{ marginTop: '16px' }}>
            <button type="submit" style={primaryButtonStyle} disabled={saving}>
              {saving ? 'Saving...' : 'Create Account'}
            </button>
          </div>
        </form>
      )}

      <div style={dashboardSectionStyle}>
        {loading ? (
          <div style={emptyStateWrapperStyle}>Loading chart of accounts...</div>
        ) : error ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>{error}</div>
        ) : accounts.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No accounts found. Add one to get started.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <SortableTh label="Code" columnKey="account_code" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Name" columnKey="account_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Type" columnKey="account_type" sortConfig={sortConfig} onRequestSort={requestSort} align="center" />
                  <SortableTh label="Created" columnKey="created_at" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedAccounts.map((account) => {
                  const colors = getTypeColors(account.account_type)
                  return (
                    <tr key={account.id} style={directoryTbodyRowStyle}>
                      <td
                        style={{
                          ...directoryTdStyle,
                          fontWeight: 700,
                          color: 'var(--text-h)',
                          fontFamily: 'monospace',
                        }}
                      >
                        {account.account_code}
                      </td>
                      <td style={directoryTdStyle}>{account.account_name}</td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <span
                          style={{
                            ...statusBadgeStyle,
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {account.account_type}
                        </span>
                      </td>
                      <td style={directoryTdStyle}>{formatDate(account.created_at)}</td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <button
                          type="button"
                          style={{
                            ...directoryActionButtonStyle,
                            backgroundColor: '#ffebee',
                            color: '#c62828',
                            border: '1px solid #ffcdd2',
                          }}
                          onClick={() => handleDelete(account)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function getTypeColors(type: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    Asset: { bg: '#e3f2fd', text: '#1565c0' },
    Liability: { bg: '#fff3e0', text: '#e65100' },
    Equity: { bg: '#f3e5f5', text: '#7b1fa2' },
    Revenue: { bg: '#e8f5e9', text: '#2e7d32' },
    Expense: { bg: '#ffebee', text: '#c62828' },
  }
  return map[type] || { bg: '#f5f5f5', text: '#616161' }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString()
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
  color: 'var(--text-h)',
}

const pageSubStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  fontSize: '14px',
  color: 'var(--text)',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
  fontFamily: 'inherit',
}

const formCardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '20px 24px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
}

const formTitleStyle: React.CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--text-h)',
}

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '16px',
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text)',
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '14px',
  fontFamily: 'inherit',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
}

const formErrorStyle: React.CSSProperties = {
  margin: '12px 0 0 0',
  color: '#c62828',
  fontSize: '13px',
}

const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: 'var(--shadow)',
}

const directoryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const directoryTheadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
}

const directoryThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const directoryTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
  transition: 'background-color 0.2s',
}

const directoryTdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
}

const directoryActionButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '11px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

const statusBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: '12px',
  fontSize: '11px',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
}

export default ChartOfAccounts
