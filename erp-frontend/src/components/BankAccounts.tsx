/**
 * Bank Accounts directory — company bank master data.
 * View / Edit open a dedicated Bank Account Detail / form page.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { bankAccountService } from '../api/services'
import type { BankAccount } from '../types'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { bankAccountPath, bankAccountTypeLabel, bankGlDisplay } from '../utils/bankAccounts'

function BankAccounts() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void bankAccountService
      .getBankAccounts(false)
      .then((rows) => {
        if (!cancelled) setAccounts(rows)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load bank accounts')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { items: sortedAccounts, requestSort, sortConfig } = useSortableData(accounts, {
    columnTypes: {
      is_active: 'string',
    },
  })

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Bank Accounts</h2>
          <p style={pageSubStyle}>
            Company bank master data. Map each account to a G/L cash account for reconciliation.
          </p>
        </div>
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={() => navigate('/bank-accounts/new')}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          + Add Bank Account
        </button>
      </header>

      <div style={dashboardSectionStyle}>
        {loading ? (
          <div style={emptyStateWrapperStyle}>Loading bank accounts…</div>
        ) : error ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>{error}</div>
        ) : sortedAccounts.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No bank accounts yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <SortableTh label="Bank Name" columnKey="bank_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Account Number" columnKey="account_number_masked" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Account Type" columnKey="account_type" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Currency" columnKey="currency" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh
                    label="Mapped G/L Account"
                    columnKey="gl_account_display"
                    sortConfig={sortConfig}
                    onRequestSort={requestSort}
                  />
                  <SortableTh label="Status" columnKey="is_active" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedAccounts.map((account) => (
                  <tr key={account.bank_account_id} style={directoryTbodyRowStyle}>
                    <td style={directoryTdStyle}>
                      <button
                        type="button"
                        style={idButtonStyle}
                        onClick={() => navigate(bankAccountPath(account.bank_account_id))}
                      >
                        {account.bank_name}
                      </button>
                      <div style={{ fontSize: 12, color: 'var(--text)' }}>{account.account_name}</div>
                    </td>
                    <td style={{ ...directoryTdStyle, fontFamily: 'monospace' }}>
                      {account.account_number_masked || account.account_number}
                    </td>
                    <td style={directoryTdStyle}>{bankAccountTypeLabel(account.account_type)}</td>
                    <td style={directoryTdStyle}>{account.currency || 'USD'}</td>
                    <td style={directoryTdStyle}>{bankGlDisplay(account)}</td>
                    <td style={directoryTdStyle}>
                      <span
                        style={{
                          ...statusBadgeStyle,
                          backgroundColor: account.is_active === false ? '#eceff1' : '#e8f5e9',
                          color: account.is_active === false ? '#546e7a' : '#2e7d32',
                        }}
                      >
                        {account.is_active === false ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                    <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                      <button
                        type="button"
                        style={{
                          ...directoryActionButtonStyle,
                          backgroundColor: '#e3f2fd',
                          color: '#1565c0',
                          border: '1px solid #bbdefb',
                          marginRight: 6,
                        }}
                        onClick={() => navigate(bankAccountPath(account.bank_account_id))}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        style={{
                          ...directoryActionButtonStyle,
                          backgroundColor: '#fff3e0',
                          color: '#e65100',
                          border: '1px solid #ffe0b2',
                        }}
                        onClick={() => navigate(bankAccountPath(account.bank_account_id, '/edit'))}
                      >
                        Edit
                      </button>
                    </td>
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

const containerStyle: CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}
const pageHeaderStyle: CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
}
const pageTitleStyle: CSSProperties = { margin: 0, fontSize: '28px', fontWeight: 'bold', color: 'var(--text-h)' }
const pageSubStyle: CSSProperties = { margin: '4px 0 0 0', fontSize: '14px', color: 'var(--text)' }
const primaryButtonStyle: CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
  transition: 'background-color 0.2s',
}
const dashboardSectionStyle: CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
}
const directoryTableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const directoryTheadRowStyle: CSSProperties = { backgroundColor: 'var(--social-bg)' }
const directoryThStyle: CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--text)',
}
const directoryTbodyRowStyle: CSSProperties = { borderTop: '1px solid var(--border)' }
const directoryTdStyle: CSSProperties = { padding: '10px 12px', fontSize: 13 }
const emptyStateWrapperStyle: CSSProperties = { padding: '30px', textAlign: 'center' }
const statusBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 'bold',
}
const directoryActionButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 'bold',
  fontFamily: 'inherit',
}
const idButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: '#1565c0',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
}

export default BankAccounts
