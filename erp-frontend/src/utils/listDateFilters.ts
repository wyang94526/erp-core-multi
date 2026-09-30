/**
 * @author: Wendy Yang
 * @date: 2026-09-30
 */

export type RelativeDateFilter = 'all' | 'this_month' | 'last_quarter' | 'ytd'
export type DeliveryDateFilter = 'all' | 'overdue' | 'this_week' | 'this_month' | 'next_30'

export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null
  const match = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeekMonday(now: Date) {
  const start = startOfDay(now)
  const day = start.getDay()
  const offset = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + offset)
  return start
}

export function matchesRelativeDate(
  value: string | null | undefined,
  filter: RelativeDateFilter,
  now = new Date(),
) {
  if (filter === 'all') return true
  const date = parseDateOnly(value)
  if (!date) return false
  const year = now.getFullYear()
  const month = now.getMonth()
  if (filter === 'this_month') {
    return date.getFullYear() === year && date.getMonth() === month
  }
  if (filter === 'ytd') {
    return date.getFullYear() === year && date <= now
  }
  const currentQuarter = Math.floor(month / 3)
  const lastQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1
  const lastQuarterYear = currentQuarter === 0 ? year - 1 : year
  const start = new Date(lastQuarterYear, lastQuarter * 3, 1)
  const end = new Date(lastQuarterYear, lastQuarter * 3 + 3, 0, 23, 59, 59)
  return date >= start && date <= end
}

export function matchesDeliveryDate(
  value: string | null | undefined,
  filter: DeliveryDateFilter,
  now = new Date(),
) {
  if (filter === 'all') return true
  const date = parseDateOnly(value)
  if (!date) return false
  const today = startOfDay(now)
  if (filter === 'overdue') {
    return date < today
  }
  if (filter === 'this_month') {
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  }
  if (filter === 'this_week') {
    const start = startOfWeekMonday(now)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return date >= start && date <= end
  }
  const horizon = new Date(today)
  horizon.setDate(today.getDate() + 30)
  return date >= today && date <= horizon
}
