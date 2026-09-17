export interface PaymentTerm {
  id: string
  code: string
  description: string
  due_days: number
  discount_days?: number | null
  discount_percentage?: number | string | null
  is_active: boolean
  created_at?: string | null
  updated_at?: string | null
}

export type PaymentTermWrite = {
  code: string
  description: string
  due_days: number
  discount_days?: number | null
  discount_percentage?: number | string | null
  is_active?: boolean
}

export function paymentTermLabel(term: PaymentTerm): string {
  return `${term.code} — ${term.description}`
}

export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return isoDate
  date.setDate(date.getDate() + Number(days || 0))
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function findPaymentTerm(
  terms: PaymentTerm[],
  paymentTermId?: string | null,
  paymentTerms?: string | null,
): PaymentTerm | undefined {
  if (paymentTermId) {
    const byId = terms.find((term) => term.id === paymentTermId)
    if (byId) return byId
  }
  const raw = (paymentTerms || '').trim()
  if (!raw) return undefined
  const normalized = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return terms.find((term) => {
    const code = term.code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    const desc = term.description.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    return term.code.toUpperCase() === raw.toUpperCase() || code === normalized || desc === normalized
  })
}
