/**
 * @author: Wendy Yang
 * @date: 2026-10-02
 *
 * Open / Soft Close / Hard Close helpers for finance period settings.
 */

import type { FinancePeriodSettings, PeriodCloseStatus } from '../types'

export function dateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${value.getFullYear()}-${month}-${day}`
  }
  return String(value).slice(0, 10) || null
}

export function periodStatusFor(
  txnDate: string | Date | null | undefined,
  settings: FinancePeriodSettings | null | undefined,
): PeriodCloseStatus {
  const resolved = dateOnly(txnDate)
  if (!resolved || !settings) return 'OPEN'
  const hard = dateOnly(settings.hard_close_date || settings.current_closing_date)
  if (hard && resolved <= hard) return 'HARD_CLOSE'
  const soft = dateOnly(settings.soft_close_date)
  if (soft && resolved <= soft) return 'SOFT_CLOSE'
  return 'OPEN'
}

export function periodStatusLabel(status: PeriodCloseStatus): string {
  if (status === 'HARD_CLOSE') return 'Hard Close'
  if (status === 'SOFT_CLOSE') return 'Soft Close'
  return 'Open'
}

export function periodStatusMessage(
  status: PeriodCloseStatus,
  options: { kind?: 'operational' | 'adjustment' } = {},
): string | null {
  const kind = options.kind || 'operational'
  if (status === 'HARD_CLOSE') {
    return 'This date is hard-closed. An Admin must reopen the period with a justification before anything can be posted.'
  }
  if (status === 'SOFT_CLOSE' && kind === 'operational') {
    return 'This date is soft-closed. Operational documents are locked; finance can still post adjusting journals.'
  }
  if (status === 'SOFT_CLOSE' && kind === 'adjustment') {
    return 'This date is soft-closed. Adjusting journals are still allowed until Hard Close.'
  }
  return null
}

export function formatPeriodDate(value: string | null | undefined): string {
  if (!value) return 'Not set'
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}
