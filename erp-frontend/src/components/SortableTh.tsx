/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { CSSProperties, ReactNode } from 'react'
import type { SortConfig } from '../hooks/useSortableData'

type SortableThProps = {
  label: ReactNode
  columnKey: string
  sortConfig: SortConfig
  onRequestSort: (key: string) => void
  align?: 'left' | 'center' | 'right'
  style?: CSSProperties
}

const baseThStyle: CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  userSelect: 'none',
}

export default function SortableTh({
  label,
  columnKey,
  sortConfig,
  onRequestSort,
  align = 'left',
  style,
}: SortableThProps) {
  const active = sortConfig.key === columnKey && sortConfig.direction != null
  const indicator =
    !active || !sortConfig.direction
      ? ''
      : sortConfig.direction === 'asc'
        ? ' ▲'
        : ' ▼'

  return (
    <th
      className={`sortable-th${active ? ' sortable-th-active' : ''}`}
      style={{
        ...baseThStyle,
        textAlign: align,
        ...style,
        cursor: 'pointer',
        fontWeight: active ? 800 : 'bold',
        color: active ? 'var(--accent)' : 'var(--text-h)',
      }}
      onClick={() => onRequestSort(columnKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onRequestSort(columnKey)
        }
      }}
      tabIndex={0}
      aria-sort={
        !active
          ? 'none'
          : sortConfig.direction === 'asc'
            ? 'ascending'
            : 'descending'
      }
      title="Click to sort"
    >
      <span className="sortable-th-label">
        {label}
        <span className="sortable-th-indicator" aria-hidden>
          {indicator || ' ↕'}
        </span>
      </span>
    </th>
  )
}
