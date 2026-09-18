/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { BankAccount, BankAccountType } from '../types'

export const BANK_ACCOUNT_TYPES: { value: BankAccountType; label: string }[] = [
  { value: 'CHECKING', label: 'Checking' },
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'MONEY_MARKET', label: 'Money Market' },
  { value: 'OTHER', label: 'Other' },
]

export const BANK_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'CNY', 'JPY', 'TWD']

export function bankAccountTypeLabel(value?: string | null) {
  const match = BANK_ACCOUNT_TYPES.find((item) => item.value === (value || '').toUpperCase())
  return match?.label || value || '—'
}

export function bankGlDisplay(account: Pick<BankAccount, 'gl_account_display' | 'gl_account_code' | 'gl_account_name'>) {
  if (account.gl_account_display) return account.gl_account_display
  if (account.gl_account_code) {
    return `${account.gl_account_code} — ${account.gl_account_name || ''}`.trim()
  }
  return '—'
}

export function bankAccountPath(bankAccountId: string, suffix: '' | '/edit' = '') {
  return `/bank-accounts/${encodeURIComponent(bankAccountId)}${suffix}`
}
