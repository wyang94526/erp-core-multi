import { isNonStockItem } from './itemTypes'

const round2 = (num: number) => Math.round((Number(num) + Number.EPSILON) * 100) / 100
const round4 = (num: number) => Math.round((Number(num) + Number.EPSILON) * 10000) / 10000

type LandedLine = {
  quantity?: number | null
  unit_price?: number | null
  line_subtotal?: number | null
  sku?: string | null
  item_type?: string | null
  estimated_landed_unit_cost?: number
  allocated_landed_expense?: number
}

export function isAllocatedExpenseLine(item: LandedLine): boolean {
  if (Number(item.quantity || 0) <= 0) return true
  return isNonStockItem(item.item_type, item.sku)
}

export function applyEstimatedLandedUnitCosts<T extends LandedLine>(
  items: T[],
  shippingFee: number,
): T[] {
  const shipping = Math.max(0, Number(shippingFee) || 0)
  const expenseTotal = round2(
    shipping +
      items.reduce((sum, item) => {
        if (!isAllocatedExpenseLine(item)) return sum
        return sum + Math.max(0, Number(item.line_subtotal) || 0)
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
    if (isAllocatedExpenseLine(item) || qty <= 0) {
      return {
        ...item,
        allocated_landed_expense: 0,
        estimated_landed_unit_cost: price > 0 ? round4(price) : 0,
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
    return {
      ...item,
      allocated_landed_expense: allocated,
      estimated_landed_unit_cost: round4(price + allocated / qty),
    }
  })
}
