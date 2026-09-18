/**
 * Bank Account Form — create and edit company bank master data.
 */

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bankAccountService, chartOfAccountsService } from '../api/services'
import type { BankAccountType, BankAccountWrite } from '../types'
import {
  BANK_ACCOUNT_TYPES,
  BANK_CURRENCIES,
  bankAccountPath,
} from '../utils/bankAccounts'

const EMPTY_FORM = {
  bank_name: '',
  account_name: '',
  account_number: '',
  routing_number: '',
  account_type: 'CHECKING' as BankAccountType,
  currency: 'USD',
  gl_account_id: '',
  is_active: true,
}

export function BankAccountForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = Boolean(id)
  const bankAccountId = decodeURIComponent(id || '').trim()

  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  const { data: existing, isLoading, isError, error } = useQuery({
    queryKey: ['bankAccounts', bankAccountId],
    queryFn: () => bankAccountService.getBankAccount(bankAccountId),
    enabled: isEditMode && Boolean(bankAccountId),
  })

  const { data: glAccounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => chartOfAccountsService.listAccounts(0, 2000),
  })

  useEffect(() => {
    if (!existing) return
    setForm({
      bank_name: existing.bank_name,
      account_name: existing.account_name,
      account_number: existing.account_number,
      routing_number: existing.routing_number || '',
      account_type: (existing.account_type as BankAccountType) || 'CHECKING',
      currency: existing.currency || 'USD',
      gl_account_id: existing.gl_account_id || '',
      is_active: existing.is_active !== false,
    })
  }, [existing])

  const glOptions = useMemo(() => {
    const sorted = [...glAccounts].sort((a, b) => a.account_code.localeCompare(b.account_code))
    const assets = sorted.filter((acct) => acct.account_type === 'Asset')
    const source = assets.length > 0 ? assets : sorted
    if (form.gl_account_id && !source.some((acct) => acct.id === form.gl_account_id)) {
      const selected = sorted.find((acct) => acct.id === form.gl_account_id)
      return selected ? [selected, ...source] : source
    }
    return source
  }, [glAccounts, form.gl_account_id])

  const currencyOptions = useMemo(() => {
    if (form.currency && !BANK_CURRENCIES.includes(form.currency)) {
      return [form.currency, ...BANK_CURRENCIES]
    }
    return BANK_CURRENCIES
  }, [form.currency])

  const saveMutation = useMutation({
    mutationFn: async (payload: BankAccountWrite) => {
      if (isEditMode) {
        return bankAccountService.updateBankAccount(bankAccountId, payload)
      }
      return bankAccountService.createBankAccount(payload)
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['bankAccounts'] })
      navigate(bankAccountPath(saved.bank_account_id))
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Failed to save bank account')
    },
  })

  const handleSave = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!form.bank_name.trim() || !form.account_name.trim() || !form.account_number.trim()) {
      setFormError('Bank name, account name, and account number are required.')
      return
    }
    if (!form.gl_account_id) {
      setFormError('Mapped G/L Account is required for bank reconciliation.')
      return
    }
    saveMutation.mutate({
      bank_name: form.bank_name.trim(),
      account_name: form.account_name.trim(),
      account_number: form.account_number.trim(),
      routing_number: form.routing_number.trim() || null,
      account_type: form.account_type,
      currency: form.currency,
      gl_account_id: form.gl_account_id,
      is_active: form.is_active,
    })
  }

  const handleCancel = () => {
    if (isEditMode && bankAccountId) {
      navigate(bankAccountPath(bankAccountId))
      return
    }
    navigate('/bank-accounts')
  }

  if (isEditMode && isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateStyle}>Loading bank account…</div>
      </div>
    )
  }

  if (isEditMode && (isError || !existing)) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>{error instanceof Error ? error.message : 'Bank account not found'}</p>
          <button type="button" style={secondaryButtonStyle} onClick={() => navigate('/bank-accounts')}>
            Back to Bank Accounts
          </button>
        </div>
      </div>
    )
  }

  const isSubmitting = saveMutation.isPending

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>{isEditMode ? 'Edit Bank Account' : 'Create New Bank Account'}</h2>
          <p style={pageSubStyle}>
            {isEditMode
              ? `Editing ${bankAccountId}`
              : 'Company bank master data used by Cash Management and reconciliation'}
          </p>
        </div>
      </header>

      <form onSubmit={handleSave}>
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Account Information</h3>
          <div style={gridStyle}>
            {isEditMode ? (
              <label style={labelStyle}>
                Bank Account ID
                <input style={{ ...inputStyle, backgroundColor: 'var(--social-bg)' }} value={bankAccountId} disabled />
              </label>
            ) : null}
            <label style={labelStyle}>
              Bank Name *
              <input
                style={inputStyle}
                value={form.bank_name}
                onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
                placeholder="e.g. Amerant Bank"
              />
            </label>
            <label style={labelStyle}>
              Account Name *
              <input
                style={inputStyle}
                value={form.account_name}
                onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
                placeholder="Operating, Payroll, Reserve…"
              />
            </label>
            <label style={labelStyle}>
              Account Number *
              <input
                style={inputStyle}
                value={form.account_number}
                onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
              />
            </label>
            <label style={labelStyle}>
              Routing / SWIFT
              <input
                style={inputStyle}
                value={form.routing_number}
                onChange={(e) => setForm((f) => ({ ...f, routing_number: e.target.value }))}
                placeholder="9-digit ABA or SWIFT/BIC"
              />
            </label>
            <label style={labelStyle}>
              Account Type
              <select
                style={inputStyle}
                value={form.account_type}
                onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value as BankAccountType }))}
              >
                {BANK_ACCOUNT_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Currency
              <select
                style={inputStyle}
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              >
                {currencyOptions.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Mapped G/L Account *
              <select
                style={inputStyle}
                value={form.gl_account_id}
                onChange={(e) => setForm((f) => ({ ...f, gl_account_id: e.target.value }))}
                required
              >
                <option value="">Select cash / bank G/L…</option>
                {glOptions.map((acct) => (
                  <option key={acct.id} value={acct.id}>
                    {acct.account_code} — {acct.account_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22 }}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              Active
            </label>
          </div>
        </div>

        {formError && <p style={errorStyle}>{formError}</p>}

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...primaryButtonStyle,
              backgroundColor: isSubmitting ? '#90caf9' : '#1976d2',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Saving…' : isEditMode ? 'Update Bank Account' : 'Create Bank Account'}
          </button>
          <button type="button" style={secondaryButtonStyle} onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

const containerStyle: CSSProperties = {
  padding: '24px',
  maxWidth: '800px',
  margin: '0 auto',
  textAlign: 'left',
}
const pageHeaderStyle: CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
}
const pageTitleStyle: CSSProperties = { margin: 0, fontSize: '28px', fontWeight: 'bold', color: 'var(--text-h)' }
const pageSubStyle: CSSProperties = { margin: '4px 0 0 0', fontSize: '14px', color: 'var(--text)' }
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
  gap: '12px 16px',
}
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }
const inputStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontFamily: 'inherit',
}
const errorStyle: CSSProperties = { color: '#c62828', fontSize: 13, marginBottom: 12 }
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
}
const secondaryButtonStyle: CSSProperties = {
  padding: '10px 18px',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 700,
  fontFamily: 'inherit',
}
const emptyStateStyle: CSSProperties = { padding: 30, textAlign: 'center' }

export default BankAccountForm
