/**
 * Format amounts in the active company's base currency.
 */

let activeCurrency = 'USD'

export function normalizeCurrency(code: string | null | undefined): string {
  const text = (code || '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(text) ? text : 'USD'
}

export function setActiveCurrency(code: string | null | undefined): void {
  activeCurrency = normalizeCurrency(code)
}

export function getActiveCurrency(): string {
  return activeCurrency
}

export function currencySymbol(code: string | null | undefined): string {
  const currency = normalizeCurrency(code)
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).formatToParts(0)
    return parts.find((part) => part.type === 'currency')?.value || currency
  } catch {
    return currency
  }
}

export function formatMoney(
  amount: number,
  currencyCode?: string | null,
  options?: { precise?: boolean; compact?: boolean },
): string {
  const currency = currencyCode ? normalizeCurrency(currencyCode) : activeCurrency
  const precise = options?.precise ?? false
  const compact = options?.compact ?? false
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      ...(compact ? { notation: 'compact' as const, maximumFractionDigits: 1 } : {}),
      ...(!precise && !compact ? { maximumFractionDigits: 0 } : {}),
    }).format(Number(amount) || 0)
  } catch {
    const value = Number(amount) || 0
    return `${currencySymbol(currency)}${precise ? value.toFixed(2) : Math.round(value)}`
  }
}
