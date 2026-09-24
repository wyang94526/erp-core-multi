/**
 * @author: Wendy Yang
 * @date: 2026-09-24
 *
 * New Bank Transfer form — React Hook Form + Zod validation.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, type Resolver } from 'react-hook-form'
import { z } from 'zod'
import { bankAccountService, bankTransferService } from '../api/services'
import { bankTransferPath, isBankTransferEditable } from '../utils/bankTransfers'

function formatCurrency(amount: number, currency = 'USD') {
  return Number(amount || 0).toLocaleString('en-US', {
    style: 'currency',
    currency,
  })
}

function buildTransferSchema(availableBalance: number | null) {
  return z
    .object({
      from_account_id: z.string().min(1, 'From bank account is required'),
      to_account_id: z.string().min(1, 'To bank account is required'),
      amount: z
        .number({ error: 'Amount must be greater than zero' })
        .positive('Amount must be greater than zero'),
      transfer_date: z.string().min(1, 'Transfer date is required'),
      reference_number: z.string().optional(),
    })
    .refine((data) => data.from_account_id !== data.to_account_id, {
      message: 'Source and destination accounts must be different',
      path: ['to_account_id'],
    })
    .refine(
      (data) => availableBalance == null || !Number.isFinite(availableBalance) || data.amount <= availableBalance,
      {
        message:
          availableBalance != null && Number.isFinite(availableBalance)
            ? `Amount exceeds available book balance (${formatCurrency(availableBalance)})`
            : 'Amount exceeds available book balance',
        path: ['amount'],
      },
    )
}

type BankTransferFormValues = z.infer<typeof bankTransferSchema>

function zodResolver<T extends z.ZodType>(schema: T): Resolver<z.infer<T>> {
  return async (values) => {
    const parsed = schema.safeParse(values)
    if (parsed.success) {
      return { values: parsed.data, errors: {} }
    }
    const errors: Record<string, { type: string; message: string }> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'root')
      if (!errors[key]) {
        errors[key] = { type: issue.code, message: issue.message }
      }
    }
    return { values: {}, errors }
  }
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function accountLabel(account: {
  display_name?: string | null
  bank_name: string
  account_name: string
  is_default?: boolean
}) {
  const name = account.display_name || `${account.bank_name} - ${account.account_name}`
  return account.is_default ? `${name} (default)` : name
}

export function BankTransferForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formError, setFormError] = useState<string | null>(null)
  const transferId = id ? Number(id) : NaN
  const isEditMode = Number.isFinite(transferId)

  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ['bankAccounts', 'active'],
    queryFn: () => bankAccountService.getBankAccounts(true),
  })

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ['bankTransfers', transferId],
    queryFn: () => bankTransferService.get(transferId),
    enabled: isEditMode,
  })

  const availableRef = useRef<number | null>(null)
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<BankTransferFormValues>({
    resolver: (values, context, options) =>
      zodResolver(buildTransferSchema(availableRef.current))(values, context, options),
    defaultValues: {
      from_account_id: '',
      to_account_id: '',
      amount: Number.NaN,
      transfer_date: todayIsoDate(),
      reference_number: '',
    },
  })

  const seededAccounts = useRef(false)
  useEffect(() => {
    if (isEditMode) return
    if (seededAccounts.current || accounts.length === 0) return
    const defaultFrom = accounts.find((row) => row.is_default)?.bank_account_id || accounts[0]?.bank_account_id || ''
    const defaultTo = accounts.find((row) => row.bank_account_id !== defaultFrom)?.bank_account_id || ''
    reset({
      from_account_id: defaultFrom,
      to_account_id: defaultTo,
      amount: Number.NaN,
      transfer_date: todayIsoDate(),
      reference_number: '',
    })
    seededAccounts.current = true
  }, [accounts, isEditMode, reset])

  useEffect(() => {
    if (!existing) return
    reset({
      from_account_id: existing.from_account_id,
      to_account_id: existing.to_account_id,
      amount: Number(existing.amount),
      transfer_date: existing.transfer_date?.slice(0, 10) || todayIsoDate(),
      reference_number: existing.reference_number || '',
    })
  }, [existing, reset])

  const fromAccountId = watch('from_account_id')
  const toAccountId = watch('to_account_id')
  const fromAccount = accounts.find((row) => row.bank_account_id === fromAccountId)
  const availableBalance = fromAccount?.book_balance == null ? null : Number(fromAccount.book_balance)
  availableRef.current = availableBalance != null && Number.isFinite(availableBalance) ? availableBalance : null
  const toOptions = useMemo(
    () => accounts.filter((row) => row.bank_account_id !== fromAccountId),
    [accounts, fromAccountId],
  )

  useEffect(() => {
    if (!fromAccountId || fromAccountId !== toAccountId) return
    const next = accounts.find((row) => row.bank_account_id !== fromAccountId)
    setValue('to_account_id', next?.bank_account_id || '', { shouldValidate: true })
  }, [accounts, fromAccountId, setValue, toAccountId])

  const saveMutation = useMutation({
    mutationFn: async (values: BankTransferFormValues) => {
      const payload = {
        from_account_id: values.from_account_id,
        to_account_id: values.to_account_id,
        amount: values.amount,
        transfer_date: values.transfer_date,
        reference_number: values.reference_number?.trim() || null,
      }
      if (isEditMode) {
        return bankTransferService.update(transferId, payload)
      }
      return bankTransferService.create(payload)
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['bankTransfers'] })
      await queryClient.invalidateQueries({ queryKey: ['journalEntries'] })
      navigate(bankTransferPath(saved.id))
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Failed to save bank transfer')
    },
  })

  const onSubmit = (values: BankTransferFormValues) => {
    setFormError(null)
    saveMutation.mutate(values)
  }

  const isSubmitting = saveMutation.isPending

  if (isEditMode && loadingExisting) {
    return (
      <div style={containerStyle}>
        <div style={{ padding: 30, textAlign: 'center' }}>Loading bank transfer…</div>
      </div>
    )
  }

  if (isEditMode && existing && !isBankTransferEditable(existing)) {
    return (
      <div style={containerStyle}>
        <p style={errorStyle}>This transfer can no longer be edited.</p>
        <button type="button" style={secondaryButtonStyle} onClick={() => navigate(bankTransferPath(existing.id))}>
          View Transfer
        </button>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>{isEditMode ? 'Edit Bank Transfer' : 'New Bank Transfer'}</h2>
          <p style={pageSubStyle}>
            Transfer funds between internal company bank accounts. Save a draft, then submit it for
            approval. The auto-generated journal stays Draft until the G/L entry is approved.
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Transfer Details</h3>
          <div style={gridStyle}>
            <label style={labelStyle}>
              From Bank Account *
              <select
                style={inputStyle}
                disabled={loadingAccounts}
                {...register('from_account_id')}
              >
                <option value="">Select source account…</option>
                {accounts.map((account) => (
                  <option key={account.bank_account_id} value={account.bank_account_id}>
                    {accountLabel(account)}
                  </option>
                ))}
              </select>
              {fromAccount ? (
                <span style={hintStyle}>
                  Available book balance:{' '}
                  {formatCurrency(Number(fromAccount.book_balance || 0), fromAccount.currency || 'USD')}
                </span>
              ) : null}
              {errors.from_account_id ? <span style={fieldErrorStyle}>{errors.from_account_id.message}</span> : null}
            </label>
            <label style={labelStyle}>
              To Bank Account *
              <select
                style={inputStyle}
                disabled={loadingAccounts}
                {...register('to_account_id')}
              >
                <option value="">Select destination account…</option>
                {toOptions.map((account) => (
                  <option key={account.bank_account_id} value={account.bank_account_id}>
                    {accountLabel(account)}
                  </option>
                ))}
              </select>
              {errors.to_account_id ? <span style={fieldErrorStyle}>{errors.to_account_id.message}</span> : null}
            </label>
            <label style={labelStyle}>
              Amount *
              <input
                style={inputStyle}
                type="number"
                min="0.01"
                step="0.01"
                max={availableRef.current != null ? String(availableRef.current) : undefined}
                placeholder="0.00"
                {...register('amount', { valueAsNumber: true })}
              />
              {errors.amount ? <span style={fieldErrorStyle}>{errors.amount.message}</span> : null}
            </label>
            <label style={labelStyle}>
              Transfer Date *
              <input style={inputStyle} type="date" {...register('transfer_date')} />
              {errors.transfer_date ? <span style={fieldErrorStyle}>{errors.transfer_date.message}</span> : null}
            </label>
            <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
              Reference / Description
              <input
                style={inputStyle}
                placeholder="Optional memo or wire reference"
                {...register('reference_number')}
              />
            </label>
          </div>
        </div>

        {formError ? <p style={errorStyle}>{formError}</p> : null}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...primaryButtonStyle,
              backgroundColor: isSubmitting ? '#90caf9' : '#1976d2',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Saving…' : isEditMode ? 'Save Changes' : 'Save Draft'}
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => navigate(isEditMode && existing ? bankTransferPath(existing.id) : '/bank-transfers')}
          >
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
const fieldErrorStyle: CSSProperties = { color: '#c62828', fontWeight: 500, fontSize: 12 }
const hintStyle: CSSProperties = { color: 'var(--text)', fontWeight: 500, fontSize: 12 }
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

export default BankTransferForm
