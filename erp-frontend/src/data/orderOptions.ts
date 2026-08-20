/** Shared commercial terms for sales orders, customer master, and POs. */

export const INCOTERM_OPTIONS = [
  'EXW',
  'FCA',
  'FOB',
  'CFR',
  'CIF',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
] as const

export type Incoterm = (typeof INCOTERM_OPTIONS)[number]

export const SHIPPING_METHOD_OPTIONS = [
  'Local Trucking',
  'LTL',
  'FTL',
  'Ground',
  'Express Ground',
  'Air Freight',
  'Ocean Freight',
  'Courier',
  'Customer Pickup',
] as const

export type ShippingMethod = (typeof SHIPPING_METHOD_OPTIONS)[number]

export const PO_TYPE_OPTIONS = [
  { value: 'MATERIAL', label: 'Material PO' },
  { value: 'SUBCONTRACT', label: 'Subcontract / outside processing (外發加工單)' },
] as const

export type PoType = 'MATERIAL' | 'SUBCONTRACT'

export function withCurrentOption(options: readonly string[], current?: string | null): string[] {
  const value = (current || '').trim()
  if (value && !options.includes(value)) return [...options, value]
  return [...options]
}
