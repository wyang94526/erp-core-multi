/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { bankAccountService, cashTransactionService } from '../api/services'
import type { BankAccount, CashPaymentMethod } from '../types'

export type CashPaymentChoice = {
  bank_account_id: string
  payment_method: CashPaymentMethod
  instrument_ref_no: string
  payment_date: string
}

type RecordCashPaymentDialogProps = {
  open: boolean
  title: string
  subtitle?: string
  amount?: number | null
  confirmLabel: string
  submitting?: boolean
  onCancel: () => void
  onConfirm: (choice: CashPaymentChoice) => void | Promise<void>
}

const PAYMENT_METHODS: { value: CashPaymentMethod; label: string }[] = [
  { value: 'ACH', label: 'ACH / Direct Deposit' },
  { value: 'WIRE', label: 'Wire Transfer' },
  { value: 'CHECK', label: 'Check' },
  { value: 'CARD', label: 'Credit Card' },
]

const money = (n: number | null | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)

function todayISO() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function stripInstrumentPrefix(value: string) {
  return value.replace(/^(CHK|WIRE|ACH|CC)-/i, '').trim()
}

function instrumentLabel(method: CashPaymentMethod) {
  if (method === 'CHECK') return 'Check Number'
  if (method === 'CARD') return 'Card / Authorization #'
  return 'Transaction / Wire Reference #'
}

export function RecordCashPaymentDialog({
  open,
  title,
  subtitle,
  amount,
  confirmLabel,
  submitting = false,
  onCancel,
  onConfirm,
}: RecordCashPaymentDialogProps) {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [bankAccountId, setBankAccountId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<CashPaymentMethod>('CHECK')
  const [instrumentRef, setInstrumentRef] = useState('')
  const [paymentDate, setPaymentDate] = useState(todayISO)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPaymentMethod('CHECK')
    setPaymentDate(todayISO())
    setInstrumentRef('')
    void bankAccountService
      .getBankAccounts(true)
      .then((rows) => {
        if (cancelled) return
        setAccounts(rows)
        const fallback = rows.find((row) => row.is_default)?.bank_account_id || rows[0]?.bank_account_id || ''
        setBankAccountId(fallback)
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
  }, [open])

  useEffect(() => {
    if (!open) return
    if (paymentMethod !== 'CHECK') {
      setInstrumentRef('')
      return
    }
    let cancelled = false
    void cashTransactionService
      .nextInstrument('CHECK')
      .then((next) => {
        if (!cancelled) setInstrumentRef(stripInstrumentPrefix(next.instrument_ref_no || ''))
      })
      .catch(() => {
        /* keep the field editable even if auto-numbering is unavailable */
      })
    return () => {
      cancelled = true
    }
  }, [open, paymentMethod])

  if (!open) return null

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!bankAccountId) {
      setError('Select a bank account')
      return
    }
    if (!paymentMethod) {
      setError('Select a payment method')
      return
    }
    const reference = instrumentRef.trim()
    if (!reference) {
      setError(`${instrumentLabel(paymentMethod)} is required`)
      return
    }
    if (!paymentDate) {
      setError('Select a payment date')
      return
    }
    await onConfirm({
      bank_account_id: bankAccountId,
      payment_method: paymentMethod,
      instrument_ref_no: reference,
      payment_date: paymentDate,
    })
  }

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <form style={dialogStyle} onClick={(event) => event.stopPropagation()} onSubmit={(event) => void handleSubmit(event)}>
        <h3 style={titleStyle}>{title}</h3>
        {subtitle ? <p style={subStyle}>{subtitle}</p> : null}
        {amount != null ? (
          <p style={amountStyle}>
            Amount <strong>{money(amount)}</strong>
          </p>
        ) : null}

        <label style={labelStyle}>
          Bank account
          <select
            style={selectStyle}
            value={bankAccountId}
            onChange={(event) => setBankAccountId(event.target.value)}
            disabled={loading || submitting}
            required
          >
            {accounts.length === 0 ? <option value="">Loading accounts…</option> : null}
            {accounts.map((account) => (
              <option key={account.bank_account_id} value={account.bank_account_id}>
                {account.display_name || `${account.bank_name} - ${account.account_name}`}
                {account.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Payment Method
          <select
            style={selectStyle}
            value={paymentMethod}
            onChange={(event) => {
              const next = event.target.value as CashPaymentMethod
              setPaymentMethod(next)
              if (next !== 'CHECK') setInstrumentRef('')
            }}
            disabled={loading || submitting}
            required
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          {instrumentLabel(paymentMethod)}
          <input
            style={selectStyle}
            value={instrumentRef}
            onChange={(event) => setInstrumentRef(event.target.value)}
            disabled={loading || submitting}
            required
            autoComplete="off"
            placeholder={paymentMethod === 'CHECK' ? 'Auto-assigned; edit if needed' : 'Required'}
          />
        </label>

        <label style={labelStyle}>
          Payment Date
          <input
            type="date"
            style={selectStyle}
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
            disabled={loading || submitting}
            required
          />
        </label>

        {error ? (
          <div style={errorStyle} role="alert">
            {error}
          </div>
        ) : null}

        <div style={actionsStyle}>
          <button type="button" style={secondaryStyle} onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" style={primaryStyle} disabled={submitting || loading || !bankAccountId}>
            {submitting ? 'Processing…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const dialogStyle: CSSProperties = {
  width: 'min(480px, 100%)',
  background: '#fff',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
}

const titleStyle: CSSProperties = { margin: 0, fontSize: 18, color: '#212121' }
const subStyle: CSSProperties = { margin: '8px 0 0', fontSize: 13, color: '#616161' }
const amountStyle: CSSProperties = { margin: '12px 0 0', fontSize: 14, color: '#424242' }
const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 16,
  fontSize: 12,
  fontWeight: 700,
  color: '#757575',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
}
const selectStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #ddd',
  fontSize: 14,
  fontWeight: 600,
  color: '#212121',
  fontFamily: 'inherit',
}
const actionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }
const primaryStyle: CSSProperties = {
  padding: '8px 14px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 700,
  fontFamily: 'inherit',
}
const secondaryStyle: CSSProperties = {
  padding: '8px 14px',
  backgroundColor: 'transparent',
  color: '#212121',
  border: '1px solid #ddd',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 700,
  fontFamily: 'inherit',
}
const errorStyle: CSSProperties = {
  marginTop: 12,
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ef9a9a',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
}

export default RecordCashPaymentDialog
