export const SCO_KIT_MUST_BE_ISSUED_MESSAGE =
  'Cannot approve Subcontract Order: All required kit components must be fully issued to the subcontractor first.'

type KitQtyLine = {
  quantity_required?: number | string | null
  quantity_issued?: number | string | null
  quantity_remaining?: number | string | null
}

export function kitLineRemaining(line: KitQtyLine): number {
  if (line.quantity_remaining != null && line.quantity_remaining !== '') {
    const remaining = Number(line.quantity_remaining)
    return remaining > 0 ? remaining : 0
  }
  const leftover = Number(line.quantity_required || 0) - Number(line.quantity_issued || 0)
  return leftover > 0 ? leftover : 0
}

export function scoHasUnissuedKitComponents(lines: KitQtyLine[] | null | undefined): boolean {
  return (lines || []).some((line) => kitLineRemaining(line) > 1e-9)
}
