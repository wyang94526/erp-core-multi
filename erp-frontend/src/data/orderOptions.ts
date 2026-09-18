/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 *  Shared commercial terms for sales orders, customer master, and POs.
 */

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

export type FreightPaymentTerms = 'PREPAID_ON_PO' | 'THIRD_PARTY_COLLECT' | 'ROUTING_ACCOUNT'

export const FREIGHT_PAYMENT_TERMS_OPTIONS = [
  {
    value: 'PREPAID_ON_PO',
    label: 'Prepaid by Vendor & Added to PO',
    hint: 'Vendor pays the carrier and bills freight on their invoice.',
  },
  {
    value: 'THIRD_PARTY_COLLECT',
    label: '3rd-Party / Collect (Landed Cost)',
    hint: 'Billed directly by 3PL / carrier — not the goods vendor.',
  },
  {
    value: 'ROUTING_ACCOUNT',
    label: 'Customer / Vendor Routing Account',
    hint: 'Shipped on a routing account; freight is not on this vendor PO.',
  },
] as const

export function includesVendorFreight(freightTerms?: string | null): boolean {
  return (freightTerms || 'PREPAID_ON_PO') === 'PREPAID_ON_PO'
}

export function requiresCarrierAccount(freightTerms?: string | null): boolean {
  return freightTerms === 'THIRD_PARTY_COLLECT' || freightTerms === 'ROUTING_ACCOUNT'
}

export function withCurrentOption(options: readonly string[], current?: string | null): string[] {
  const value = (current || '').trim()
  if (value && !options.includes(value)) return [...options, value]
  return [...options]
}
