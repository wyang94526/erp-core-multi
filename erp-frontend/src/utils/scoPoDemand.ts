/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { UnfulfilledScoComponent } from '../types'

export const ALL_SCO_COMPONENTS_IMPORTED_MESSAGE =
  'All subcontract components have already been imported'

type PoImportLine = {
  sco_component_id?: number | null
  quantity?: number | null
}

export function extraQtyByScoComponent(
  poItems: PoImportLine[],
): Map<number, number> {
  const extra = new Map<number, number>()
  for (const item of poItems) {
    if (item.sco_component_id == null) continue
    extra.set(
      item.sco_component_id,
      (extra.get(item.sco_component_id) || 0) + Number(item.quantity || 0),
    )
  }
  return extra
}

export function remainingQtyForScoComponent(
  line: Pick<UnfulfilledScoComponent, 'sco_component_id' | 'quantity_remaining'>,
  extraByComponent: Map<number, number>,
): number {
  const leftover =
    Number(line.quantity_remaining || 0) - (extraByComponent.get(line.sco_component_id) || 0)
  return leftover > 0 ? leftover : 0
}

export function remainingScoImportQty(
  demand: UnfulfilledScoComponent[],
  poItems: PoImportLine[],
): number {
  const extra = extraQtyByScoComponent(poItems)
  return demand.reduce(
    (sum, line) => sum + remainingQtyForScoComponent(line, extra),
    0,
  )
}
