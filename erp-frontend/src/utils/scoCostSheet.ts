import type { SubcontractCharge } from '../types'

export const DEFAULT_COST_COMPONENTS: Omit<SubcontractCharge, 'line_no' | 'cost_per_unit' | 'is_margin'>[] = [
  {
    name: 'Receiving, IQC and storage',
    detail_explanation:
      'Includes receiving, IQC, stock-in, movement, and kitting, warehouse management',
  },
  {
    name: 'Assembly Service',
    detail_explanation: 'Jig Calibration, FAI, Assembly, Packing IPQC & OQC',
  },
  {
    name: 'Inventory Management & Shipment',
    detail_explanation:
      'ERP/MRP maintenance and reporting, work order issuing, stock control, cycle count & shipment',
  },
  {
    name: 'Admin & Documentation',
    detail_explanation:
      'Order processing-covering activities from PO receipt to final invoicing, production scheduling, managing BOM system',
  },
]

export function defaultCostSheet(): SubcontractCharge[] {
  const rows = DEFAULT_COST_COMPONENTS.map((row, index) => ({
    line_no: index + 1,
    name: row.name,
    detail_explanation: row.detail_explanation,
    labor_minutes: 0,
    sf_rate: 0,
    cost_per_unit: 0,
    margin_percent: null,
    is_margin: false,
  }))
  rows.push({
    line_no: rows.length + 1,
    name: 'Margin',
    detail_explanation: 'Margin (5-6%)',
    labor_minutes: null,
    sf_rate: null,
    cost_per_unit: 0,
    margin_percent: 0,
    is_margin: true,
  })
  return rows
}

export function computeCostPerUnit(minutes?: number | null, sfRate?: number | null): number {
  if (!minutes || !sfRate || minutes <= 0 || sfRate <= 0) return 0
  return Math.round(((minutes * sfRate) / 60) * 100) / 100
}

export function rollupCostSheet(charges: SubcontractCharge[], quantity: number) {
  let costSubtotal = 0
  let marginAmount = 0
  let marginPercent = 0
  const next = charges.map((row, index) => {
    const copy = { ...row, line_no: index + 1 }
    if (copy.is_margin) {
      marginPercent = Number(copy.margin_percent || 0)
      if (copy.cost_per_unit && !marginPercent) {
        marginAmount = Number(copy.cost_per_unit)
      } else if (marginPercent > 0) {
        marginAmount = Math.round(costSubtotal * (marginPercent / 100) * 100) / 100
        copy.cost_per_unit = marginAmount
      } else {
        marginAmount = Number(copy.cost_per_unit || 0)
      }
      return copy
    }
    const computed = computeCostPerUnit(copy.labor_minutes, copy.sf_rate)
    copy.cost_per_unit = computed > 0 ? computed : Number(copy.cost_per_unit || 0)
    costSubtotal += copy.cost_per_unit
    return copy
  })
  const unitPrice = Math.round((costSubtotal + marginAmount) * 10000) / 10000
  const lineTotal = Math.round(unitPrice * quantity * 100) / 100
  return { charges: next, costSubtotal, marginPercent, marginAmount, unitPrice, lineTotal }
}
