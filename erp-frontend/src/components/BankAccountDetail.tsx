/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Bank Account Detail — read-only master-data view with Edit / Back actions.
 */

import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { ArrowLeft, Pencil } from 'lucide-react'
import { bankAccountService } from '../api/services'
import { bankAccountPath, bankAccountTypeLabel, bankGlDisplay } from '../utils/bankAccounts'
import {
  HoverTip,
  actionRowStyle,
  badgeStyle,
  documentPageHeaderStyle,
  documentPageSubStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
  secondaryButtonStyle,
} from '../utils/documentPageStyles'

export function BankAccountDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const bankAccountId = decodeURIComponent(id || '').trim()

  const {
    data: account,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['bankAccounts', bankAccountId],
    queryFn: () => bankAccountService.getBankAccount(bankAccountId),
    enabled: Boolean(bankAccountId),
  })

  if (!bankAccountId) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error: No bank account ID provided</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateStyle}>Loading bank account…</div>
      </div>
    )
  }

  if (isError || !account) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>{error instanceof Error ? error.message : 'Bank account not found'}</p>
          <button type="button" style={headerButtonStyle} onClick={() => navigate('/bank-accounts')}>
            Back to Bank Accounts
          </button>
        </div>
      </div>
    )
  }

  const active = account.is_active !== false

  return (
    <div style={containerStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>{account.bank_account_id}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span
              style={{
                ...badgeStyle,
                backgroundColor: active ? '#e8f5e9' : '#eceff1',
                color: active ? '#2e7d32' : '#546e7a',
              }}
            >
              {active ? 'Active' : 'Inactive'}
            </span>
            {account.is_default ? (
              <span style={{ ...badgeStyle, backgroundColor: '#e3f2fd', color: '#1565c0' }}>Default</span>
            ) : null}
            <span style={{ ...badgeStyle, backgroundColor: '#f5f5f5', color: '#616161' }}>
              {bankAccountTypeLabel(account.account_type)}
            </span>
          </div>
          <p style={documentPageSubStyle}>
            {account.bank_name}
            {account.account_name ? ` · ${account.account_name}` : ''}
          </p>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            <HoverTip label="Edit this bank account">
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => navigate(bankAccountPath(account.bank_account_id, '/edit'))}
              >
                <Pencil size={15} />
                Edit
              </button>
            </HoverTip>
          </div>
          <div style={actionRowStyle}>
            <HoverTip label="Back to the bank account list">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/bank-accounts')}>
                <ArrowLeft size={15} />
                Bank Accounts
              </button>
            </HoverTip>
          </div>
        </div>
      </header>

      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Account Information</h3>
        <div style={gridStyle}>
          <Field label="Bank Account ID" value={account.bank_account_id} />
          <Field label="Bank Name" value={account.bank_name} />
          <Field label="Account Name" value={account.account_name} />
          <Field label="Account Number" value={account.account_number} mono />
          <Field label="Masked Number" value={account.account_number_masked || '—'} mono />
          <Field label="Routing / SWIFT" value={account.routing_number || '—'} mono />
          <Field label="Account Type" value={bankAccountTypeLabel(account.account_type)} />
          <Field label="Currency" value={account.currency || 'USD'} />
          <Field label="Mapped G/L Account" value={bankGlDisplay(account)} />
          <div>
            <label style={labelStyle}>Status</label>
            <p style={valueStyle}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '4px 10px',
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 'bold',
                  backgroundColor: active ? '#e8f5e9' : '#eceff1',
                  color: active ? '#2e7d32' : '#546e7a',
                }}
              >
                {active ? 'Active' : 'Inactive'}
              </span>
              {account.is_default ? (
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text)' }}>Default payment account</span>
              ) : null}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <p style={{ ...valueStyle, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</p>
    </div>
  )
}

const containerStyle: CSSProperties = {
  padding: '24px',
  maxWidth: '1000px',
  margin: '0 auto',
  textAlign: 'left',
}
const cardStyle: CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
}
const sectionHeadingStyle: CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  borderBottom: '2px solid var(--border)',
  paddingBottom: '8px',
}
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '16px 24px',
}
const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text)',
  marginBottom: 4,
}
const valueStyle: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text-h)' }
const emptyStateStyle: CSSProperties = { padding: 30, textAlign: 'center' }

export default BankAccountDetail
