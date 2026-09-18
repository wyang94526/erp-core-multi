/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useMemo, useState } from 'react'

export type SortDirection = 'asc' | 'desc' | null

export type SortConfig = {
  key: string | null
  direction: SortDirection
}

export type SortableColumnType = 'auto' | 'string' | 'number' | 'date'

export type UseSortableDataOptions<T> = {
  /** Custom value extractor (e.g. nested fields / computed columns). */
  getValue?: (item: T, key: string) => unknown
  /** Optional per-column type hints for comparison. */
  columnTypes?: Record<string, SortableColumnType>
}

function looksLikeDateString(value: string): boolean {
  const v = value.trim()
  return (
    /^\d{4}-\d{2}-\d{2}/.test(v) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v) ||
    /^\d{4}\/\d{2}\/\d{2}/.test(v)
  )
}

function toComparable(
  value: unknown,
  type: SortableColumnType,
): string | number | null {
  if (value == null || value === '') return null

  const resolved: SortableColumnType =
    type === 'auto'
      ? typeof value === 'number'
        ? 'number'
        : value instanceof Date
          ? 'date'
          : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())
            ? 'number'
            : typeof value === 'string' &&
                looksLikeDateString(value) &&
                !Number.isNaN(Date.parse(value))
              ? 'date'
              : 'string'
      : type

  if (resolved === 'number') {
    const n =
      typeof value === 'number'
        ? value
        : Number(String(value).replace(/[$,]/g, ''))
    return Number.isFinite(n) ? n : null
  }

  if (resolved === 'date') {
    const t = value instanceof Date ? value.getTime() : Date.parse(String(value))
    return Number.isFinite(t) ? t : null
  }

  return String(value).toLocaleLowerCase()
}

function compareValues(
  a: unknown,
  b: unknown,
  type: SortableColumnType,
  direction: 'asc' | 'desc',
): number {
  const av = toComparable(a, type)
  const bv = toComparable(b, type)

  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1

  let result = 0
  if (typeof av === 'number' && typeof bv === 'number') {
    result = av - bv
  } else {
    result = String(av).localeCompare(String(bv), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  }
  return direction === 'asc' ? result : -result
}

/**
 * Client-side table sorting: click cycles asc → desc → unsorted (original order).
 */
export function useSortableData<T>(
  items: T[],
  options: UseSortableDataOptions<T> = {},
) {
  const { getValue, columnTypes } = options
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: null,
    direction: null,
  })

  const requestSort = (key: string) => {
    setSortConfig((prev) => {
      if (prev.key !== key) {
        return { key, direction: 'asc' }
      }
      if (prev.direction === 'asc') {
        return { key, direction: 'desc' }
      }
      if (prev.direction === 'desc') {
        return { key: null, direction: null }
      }
      return { key, direction: 'asc' }
    })
  }

  const sortedItems = useMemo(() => {
    if (!sortConfig.key || !sortConfig.direction) {
      return items
    }
    const key = sortConfig.key
    const direction = sortConfig.direction
    const type = columnTypes?.[key] ?? 'auto'
    const resolve = (item: T) => {
      if (getValue) return getValue(item, key)
      return (item as unknown as Record<string, unknown>)[key]
    }

    return [...items].sort((a, b) =>
      compareValues(resolve(a), resolve(b), type, direction),
    )
  }, [items, sortConfig, getValue, columnTypes])

  return {
    items: sortedItems,
    requestSort,
    sortConfig,
  }
}

export default useSortableData
