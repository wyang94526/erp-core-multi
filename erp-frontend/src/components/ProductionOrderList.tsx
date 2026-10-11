/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { productionOrderService } from '../api/services'
import type { ProductionOrder } from '../types'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { formatPaginationLabel } from '../utils/pagination'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import { primaryButtonStyle, secondaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'

const FILTERS: FilterField[] = [
  {
    key: 'status',
    label: 'Status',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'draft', label: 'Draft' },
      { value: 'released', label: 'Released' },
      { value: 'in_process', label: 'In process' },
      { value: 'completed', label: 'Completed' },
      { value: 'closed', label: 'Closed' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
]

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function statusColors(status: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    draft: { bg: '#fffde7', text: '#f9a825' },
    released: { bg: '#e3f2fd', text: '#1565c0' },
    in_process: { bg: '#fff3e0', text: '#e65100' },
    completed: { bg: '#e8f5e9', text: '#2e7d32' },
    closed: { bg: '#eceff1', text: '#546e7a' },
    cancelled: { bg: '#ffebee', text: '#c62828' },
  }
  return colors[status] || { bg: '#f5f5f5', text: '#616161' }
}

function formatMoney(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ProductionOrderList() {
  const navigate = useNavigate()
  const [skip, setSkip] = useState(0)
  const limit = 10
  const { values } = useListFilterParams(FILTERS)

  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['productionOrders'],
    queryFn: () => productionOrderService.list(),
  })

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (values.status !== 'ALL' && row.status !== values.status) return false
      return matchesSearch(
        values.q,
        row.production_order_id,
        row.item_id,
        row.sales_order_id,
        row.status,
        row.transaction_currency,
      )
    })
  }, [rows, values.status, values.q])

  useEffect(() => {
    setSkip(0)
  }, [values.status, values.q])

  const pageRows = filtered.slice(skip, skip + limit)
  const { items: sorted, requestSort, sortConfig } = useSortableData(pageRows, {
    columnTypes: { qty_ordered: 'number', order_date: 'date', due_date: 'date', base_amount: 'number' },
  })

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <p style={emptyStyle}>Loading production orders…</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStyle, color: '#c62828' }}>
          <p>Error loading production orders.</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <PageHeader
        title="Production Orders"
        subtitle="Create a draft, review the exploded BOM and routing, then release when components are on hand."
      >
        <button type="button" onClick={() => navigate('/production-orders/new')} style={primaryButtonStyle}>
          <Plus size={15} />
          Create Production Order
        </button>
      </PageHeader>

      <ListFilterBar
        fields={FILTERS}
        searchPlaceholder="Search order, item, status…"
        exportCount={filtered.length}
        onExport={() =>
          downloadCsv(
            csvFilename('production-orders'),
            ['Order', 'Item', 'Qty ordered', 'Qty completed', 'Scrapped', 'Status', 'Due date', 'Currency', 'Base amount', 'Order date'],
            filtered.map((row) => [
              row.production_order_id,
              row.item_id,
              row.qty_ordered,
              row.qty_completed,
              row.scrapped_qty ?? 0,
              row.status,
              row.due_date ?? '',
              row.transaction_currency,
              row.base_amount ?? '',
              row.order_date,
            ]),
          )
        }
      />

      <div style={cardStyle}>
        {filtered.length === 0 ? (
          <div style={emptyStyle}>No production orders found.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadStyle}>
                    <SortableTh label="Order" columnKey="production_order_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Item" columnKey="item_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Qty" columnKey="qty_ordered" sortConfig={sortConfig} onRequestSort={requestSort} align="right" />
                    <SortableTh label="Due date" columnKey="due_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Status" columnKey="status" sortConfig={sortConfig} onRequestSort={requestSort} align="center" />
                    <SortableTh label="Currency" columnKey="transaction_currency" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Base amount" columnKey="base_amount" sortConfig={sortConfig} onRequestSort={requestSort} align="right" />
                    <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row: ProductionOrder) => {
                    const colors = statusColors(row.status)
                    return (
                      <tr key={row.production_order_id} style={rowStyle}>
                        <td style={tdStyle}>
                          <Link to={`/production-orders/${encodeURIComponent(row.production_order_id)}`} style={linkStyle}>
                            {row.production_order_id}
                          </Link>
                        </td>
                        <td style={tdStyle}>{row.item_id}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {row.qty_completed}/{row.qty_ordered}
                        </td>
                        <td style={tdStyle}>{row.due_date ? new Date(row.due_date).toLocaleDateString() : '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span style={{ ...badgeStyle, backgroundColor: colors.bg, color: colors.text }}>{statusLabel(row.status)}</span>
                        </td>
                        <td style={tdStyle}>{row.transaction_currency}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatMoney(row.base_amount)}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <button
                            type="button"
                            style={viewButtonStyle}
                            onClick={() => navigate(`/production-orders/${encodeURIComponent(row.production_order_id)}`)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={paginationStyle}>
              <button type="button" onClick={() => setSkip(Math.max(0, skip - limit))} disabled={skip === 0} style={pageButton(skip === 0)}>
                ← Previous
              </button>
              <span style={{ fontSize: 13, color: 'var(--text)' }}>
                {formatPaginationLabel({ skip, pageCount: pageRows.length, total: filtered.length })}
              </span>
              <button
                type="button"
                onClick={() => setSkip(skip + limit)}
                disabled={skip + limit >= filtered.length}
                style={pageButton(skip + limit >= filtered.length)}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const containerStyle: CSSProperties = { padding: 24, maxWidth: 1200, margin: '0 auto', textAlign: 'left' }
const cardStyle: CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
  boxShadow: 'var(--shadow)',
}
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadStyle: CSSProperties = { backgroundColor: 'var(--social-bg)' }
const thStyle: CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const rowStyle: CSSProperties = { borderBottom: '1px solid var(--divider)' }
const tdStyle: CSSProperties = { padding: '12px 10px', color: 'var(--text)', verticalAlign: 'middle' }
const linkStyle: CSSProperties = { color: '#1565c0', textDecoration: 'none', fontWeight: 600 }
const badgeStyle: CSSProperties = { padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 'bold' }
const viewButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 'bold',
  backgroundColor: '#e3f2fd',
  color: '#1565c0',
  border: '1px solid #bbdefb',
  fontFamily: 'inherit',
}
const emptyStyle: CSSProperties = { padding: 30, textAlign: 'center', color: '#666', fontStyle: 'italic' }
const paginationStyle: CSSProperties = { marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }

function pageButton(disabled: boolean): CSSProperties {
  return { ...secondaryButtonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }
}
