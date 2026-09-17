export type ItemType = 'INVENTORY' | 'NON_INVENTORY' | 'SERVICE'

export const ITEM_TYPE_OPTIONS: { value: ItemType; label: string }[] = [
  { value: 'INVENTORY', label: 'Inventory' },
  { value: 'NON_INVENTORY', label: 'Non-Inventory' },
  { value: 'SERVICE', label: 'Service' },
]

export function normalizeItemType(value?: string | null): ItemType {
  const raw = String(value || 'INVENTORY').trim().toUpperCase().replace(/[-\s]/g, '_')
  if (raw === 'NONINVENTORY' || raw === 'NON_STOCK' || raw === 'NONSTOCK') return 'NON_INVENTORY'
  if (raw === 'SERVICE') return 'SERVICE'
  if (raw === 'NON_INVENTORY') return 'NON_INVENTORY'
  return 'INVENTORY'
}

export function isStockItemType(value?: string | null): boolean {
  return normalizeItemType(value) === 'INVENTORY'
}

const SERVICE_SKU_ALIASES = new Set([
  'MISC',
  'MISCELLANEOUS',
  'FREIGHT',
  'FRT',
  'FREIGHT-IN',
  'FREIGHTIN',
  'SVC-FREIGHT',
])

export function isServiceSku(sku?: string | null): boolean {
  const raw = String(sku || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
  return SERVICE_SKU_ALIASES.has(raw)
}

export function isNonStockItem(itemType?: string | null, sku?: string | null): boolean {
  return !isStockItemType(itemType) || isServiceSku(sku)
}

export function isAmountOnlyLine(
  itemType?: string | null,
  quantity?: number | null,
  sku?: string | null,
): boolean {
  return isNonStockItem(itemType, sku) && Number(quantity || 0) === 0
}

export function itemTypeLabel(value?: string | null): string {
  const kind = normalizeItemType(value)
  return ITEM_TYPE_OPTIONS.find((opt) => opt.value === kind)?.label || kind
}
