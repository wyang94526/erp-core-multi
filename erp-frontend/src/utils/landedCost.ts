/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { isNonStockItem } from './itemTypes'

const round2 = (num: number) => Math.round((Number(num) + Number.EPSILON) * 100) / 100
const round4 = (num: number) => Math.round((Number(num) + Number.EPSILON) * 10000) / 10000

type LandedLine = {
  quantity?: number | null
  quantity_received?: number | null
  unit_price?: number | null
  line_subtotal?: number | null
  line_tax?: number | null
  sku?: string | null
  item_type?: string | null
  estimated_landed_unit_cost?: number
  allocated_landed_expense?: number
  actual_allocated_landed_expense?: number
  actual_unit_cost?: number
}

/** Landed add-on that explains Unit Cost = vendor price + this amount. */
export function displayedLandedUnitCost(item: LandedLine): {
  amount: number
  source: 'actual' | 'estimate'
} {
  const price = Math.max(0, Number(item.unit_price) || 0)
  const actualExtra = Math.max(0, Number(item.actual_allocated_landed_expense) || 0)
  const actualUnit = Number(item.actual_unit_cost)
  if (actualExtra > 0 && Number.isFinite(actualUnit)) {
    return { amount: round4(Math.max(0, actualUnit - price)), source: 'actual' }
  }
  const receivedQty = Math.max(0, Number(item.quantity_received) || 0)
  const orderedQty = Math.max(0, Number(item.quantity) || 0)
  if (actualExtra > 0) {
    const qty = receivedQty > 0 ? receivedQty : orderedQty
    return {
      amount: qty > 0 ? round4(actualExtra / qty) : round4(actualExtra),
      source: 'actual',
    }
  }
  return {
    amount: round4(Number(item.estimated_landed_unit_cost) || 0),
    source: 'estimate',
  }
}

export function isAllocatedExpenseLine(item: LandedLine): boolean {
  if (Number(item.quantity || 0) <= 0) return true
  return isNonStockItem(item.item_type, item.sku)
}

/** Spread freight/duty/tax extras onto merchandise. Estimated landed excludes unit price. */
export function applyEstimatedLandedUnitCosts<T extends LandedLine>(
  items: T[],
  shippingFee: number,
): T[] {
  const shipping = Math.max(0, Number(shippingFee) || 0)
  const expenseTotal = round2(
    shipping +
      items.reduce((sum, item) => {
        if (!isAllocatedExpenseLine(item)) return sum
        const charge = Math.max(0, Number(item.line_subtotal) || 0)
        const tax = Math.max(0, Number(item.line_tax) || 0)
        return sum + charge + tax
      }, 0),
  )
  const merchandise = items.filter((item) => !isAllocatedExpenseLine(item))
  const merchValue = round2(
    merchandise.reduce((sum, item) => sum + Math.max(0, Number(item.line_subtotal) || 0), 0),
  )

  let remaining = expenseTotal
  return items.map((item) => {
    const qty = Math.max(0, Number(item.quantity) || 0)
    const price = Math.max(0, Number(item.unit_price) || 0)
    const actualExtra = Math.max(0, Number(item.actual_allocated_landed_expense) || 0)
    const receivedQty = Math.max(0, Number(item.quantity_received) || 0)
    if (isAllocatedExpenseLine(item) || qty <= 0) {
      return {
        ...item,
        allocated_landed_expense: 0,
        estimated_landed_unit_cost: 0,
        actual_unit_cost: price > 0 ? round4(price) : 0,
      }
    }
    const merchIndex = merchandise.indexOf(item)
    let allocated = 0
    if (merchValue > 0) {
      if (merchIndex === merchandise.length - 1) {
        allocated = remaining
      } else {
        allocated = round2((expenseTotal * Math.max(0, Number(item.line_subtotal) || 0)) / merchValue)
        remaining = round2(remaining - allocated)
      }
    }
    const estimatedPerUnit = allocated / qty
    const actualQty = actualExtra > 0 && receivedQty > 0 ? receivedQty : qty
    return {
      ...item,
      allocated_landed_expense: round2(allocated + actualExtra),
      estimated_landed_unit_cost: round4(estimatedPerUnit),
      actual_unit_cost:
        actualExtra > 0 ? round4(price + actualExtra / actualQty) : round4(price + estimatedPerUnit),
    }
  })
}
