/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import RowActionMenu, { type MenuAction } from './RowActionMenu'
import {
  directoryTableStyle,
  directoryTbodyRowStyle,
  directoryTdStyle,
  directoryThStyle,
  directoryTheadRowStyle,
  emptyStateStyle,
} from './dashboardStyles'

export type TxColumn<T> = {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  width?: string | number
  render: (row: T) => ReactNode
}

export type TxPrimaryAction = {
  id: string
  label: string
  onClick: () => void
  variant?: 'success' | 'danger' | 'primary' | 'neutral'
  disabled?: boolean
  loading?: boolean
}

type InteractiveTransactionTableProps<T> = {
  rows: T[]
  getRowId: (row: T) => string
  columns: TxColumn<T>[]
  selectedIds: Set<string>
  onSelectionChange: (next: Set<string>) => void
  expandedId: string | null
  onExpandedChange: (id: string | null) => void
  renderExpanded?: (row: T) => ReactNode
  getPrimaryActions?: (row: T) => TxPrimaryAction[]
  getMenuActions?: (row: T) => MenuAction[]
  busyIds?: Set<string>
  emptyMessage?: string
  selectable?: boolean
}

export default function InteractiveTransactionTable<T>({
  rows,
  getRowId,
  columns,
  selectedIds,
  onSelectionChange,
  expandedId,
  onExpandedChange,
  renderExpanded,
  getPrimaryActions,
  getMenuActions,
  busyIds,
  emptyMessage = 'No records to display.',
  selectable = true,
}: InteractiveTransactionTableProps<T>) {
  const allIds = rows.map(getRowId)
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id))
  const someSelected = allIds.some((id) => selectedIds.has(id))

  const toggleAll = () => {
    if (allSelected) onSelectionChange(new Set())
    else onSelectionChange(new Set(allIds))
  }

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(next)
  }

  if (rows.length === 0) {
    return <div style={emptyStateStyle}>{emptyMessage}</div>
  }

  const colSpan =
    columns.length + 1 + (selectable ? 1 : 0) + (getPrimaryActions || getMenuActions ? 1 : 0)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={directoryTableStyle}>
        <thead>
          <tr style={directoryTheadRowStyle}>
            {selectable ? (
              <th style={{ ...directoryThStyle, width: 36 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected
                  }}
                  onChange={toggleAll}
                  aria-label="Select all rows"
                />
              </th>
            ) : null}
            <th style={{ ...directoryThStyle, width: 36 }} aria-label="Expand" />
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  ...directoryThStyle,
                  textAlign: col.align || 'left',
                  width: col.width,
                }}
              >
                {col.header}
              </th>
            ))}
            {getPrimaryActions || getMenuActions ? (
              <th style={{ ...directoryThStyle, textAlign: 'right' }}>Actions</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = getRowId(row)
            const expanded = expandedId === id
            const busy = busyIds?.has(id)
            const primary = getPrimaryActions?.(row) || []
            const menu = getMenuActions?.(row) || []

            return (
              <Fragment key={id}>
                <tr
                  style={{
                    ...directoryTbodyRowStyle,
                    background: selectedIds.has(id)
                      ? '#e3f2fd'
                      : expanded
                        ? '#f8fafc'
                        : 'var(--bg)',
                    cursor: renderExpanded ? 'pointer' : 'default',
                  }}
                  onClick={() => {
                    if (!renderExpanded) return
                    onExpandedChange(expanded ? null : id)
                  }}
                >
                  {selectable ? (
                    <td
                      style={directoryTdStyle}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(id)}
                        onChange={() => toggleOne(id)}
                        aria-label={`Select ${id}`}
                      />
                    </td>
                  ) : null}
                  <td style={directoryTdStyle}>
                    {renderExpanded ? (
                      expanded ? (
                        <ChevronDown size={16} color="#1565c0" />
                      ) : (
                        <ChevronRight size={16} color="var(--text)" />
                      )
                    ) : null}
                  </td>
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{ ...directoryTdStyle, textAlign: col.align || 'left' }}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                  {getPrimaryActions || getMenuActions ? (
                    <td
                      style={{ ...directoryTdStyle, textAlign: 'right' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: 6,
                          flexWrap: 'wrap',
                        }}
                      >
                        {busy ? <Loader2 size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> : null}
                        {primary.map((action) => (
                          <button
                            key={action.id}
                            type="button"
                            disabled={action.disabled || busy || action.loading}
                            onClick={action.onClick}
                            style={actionBtnStyle(action.variant, action.disabled || busy)}
                          >
                            {action.loading ? '…' : action.label}
                          </button>
                        ))}
                        <RowActionMenu actions={menu} disabled={busy} />
                      </div>
                    </td>
                  ) : null}
                </tr>
                {expanded && renderExpanded ? (
                  <tr>
                    <td
                      colSpan={colSpan}
                      style={{
                        padding: '12px 16px 16px',
                        background: '#f5f9fc',
                        borderBottom: '1px solid var(--divider)',
                      }}
                    >
                      {renderExpanded(row)}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function actionBtnStyle(
  variant: TxPrimaryAction['variant'] = 'neutral',
  disabled?: boolean,
): CSSProperties {
  const colors: Record<NonNullable<TxPrimaryAction['variant']>, { bg: string; color: string }> = {
    success: { bg: '#e8f5e9', color: '#2e7d32' },
    danger: { bg: '#ffebee', color: '#c62828' },
    primary: { bg: '#e3f2fd', color: '#1565c0' },
    neutral: { bg: '#f5f5f5', color: '#424242' },
  }
  const c = colors[variant]
  return {
    border: 'none',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: '0.75rem',
    fontWeight: 700,
    background: c.bg,
    color: c.color,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    whiteSpace: 'nowrap',
  }
}
