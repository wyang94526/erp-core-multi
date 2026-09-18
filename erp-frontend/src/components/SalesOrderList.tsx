/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * SalesOrderList — full-page sales orders with URL-driven filters
 * (used by dashboard KPI drill-through and direct navigation).
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { salesOrderService } from '../api/services'
import type { SalesOrder } from '../types'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { formatPaginationLabel } from '../utils/pagination'
import { METRIC_PAGE_TITLES } from '../config/metricRoutes'
import type { MetricDrillKey } from '../types/dashboard'
import {
  invoiceStatusColors,
  invoiceStatusLabel,
  salesOrderInvoiceStatus,
} from '../utils/soBilling'
import {
  isSalesOrderEditable,
  salesOrderEditPath,
  SALES_ORDER_LOCKED_EDIT_MESSAGE,
} from '../utils/salesOrders'

type DateFilter = 'all' | 'this_month' | 'last_quarter' | 'ytd'
type ViewFilter = 'all' | 'open'

const LIST_LIMIT = 100

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function matchesDateFilter(orderDate: string, filter: DateFilter, now = new Date()): boolean {
  if (filter === 'all') return true
  const d = parseDate(orderDate)
  if (!d) return false
  const y = now.getFullYear()
  const m = now.getMonth()
  if (filter === 'this_month') {
    return d.getFullYear() === y && d.getMonth() === m
  }
  if (filter === 'ytd') {
    return d.getFullYear() === y && d <= now
  }
  const currentQuarter = Math.floor(m / 3)
  const lastQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1
  const lastQuarterYear = currentQuarter === 0 ? y - 1 : y
  const start = new Date(lastQuarterYear, lastQuarter * 3, 1)
  const end = new Date(lastQuarterYear, lastQuarter * 3 + 3, 0, 23, 59, 59)
  return d >= start && d <= end
}

function isOpenOrder(order: SalesOrder): boolean {
  const status = (order.status || '').toUpperCase()
  return !['CANCELLED', 'DELIVERED', 'CLOSED'].includes(status)
}

export function SalesOrderList() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [skip, setSkip] = useState(0)
  const pageSize = 10

  const dateFilter = (searchParams.get('date') as DateFilter) || 'all'
  const approvalFilter = searchParams.get('approval') || 'ALL'
  const statusFilter = searchParams.get('status') || 'ALL'
  const viewFilter = (searchParams.get('view') as ViewFilter) || 'all'
  const fromDashboard = searchParams.get('from') === 'dashboard'
  const metric = (searchParams.get('metric') || '') as MetricDrillKey | ''
  const [lockWarning, setLockWarning] = useState<string | null>(null)

  const requestEdit = (order: SalesOrder) => {
    if (isSalesOrderEditable(order)) {
      navigate(salesOrderEditPath(order.sales_order_id))
      return
    }
    setLockWarning(SALES_ORDER_LOCKED_EDIT_MESSAGE)
  }

  useEffect(() => {
    if (!lockWarning) return
    const timer = window.setTimeout(() => setLockWarning(null), 8000)
    return () => window.clearTimeout(timer)
  }, [lockWarning])

  const {
    data: salesOrders = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['salesOrders', 'filtered', LIST_LIMIT],
    queryFn: () => salesOrderService.listSalesOrders(0, LIST_LIMIT),
  })

  const filteredOrders = useMemo(() => {
    return salesOrders.filter((order) => {
      if (!matchesDateFilter(order.order_date, dateFilter)) return false
      if (viewFilter === 'open' && !isOpenOrder(order)) return false
      if (approvalFilter !== 'ALL') {
        const approval = (order.approval_status || 'DRAFT').toUpperCase()
        if (approval !== approvalFilter.toUpperCase()) return false
      }
      if (statusFilter !== 'ALL') {
        if ((order.status || '').toUpperCase() !== statusFilter.toUpperCase()) return false
      }
      return true
    })
  }, [salesOrders, dateFilter, viewFilter, approvalFilter, statusFilter])

  useEffect(() => {
    setSkip(0)
  }, [dateFilter, viewFilter, approvalFilter, statusFilter])

  const pageRows = filteredOrders.slice(skip, skip + pageSize)

  const { items: sortedOrders, requestSort, sortConfig } = useSortableData(pageRows, {
    columnTypes: {
      sales_order_id: 'string',
      customer_id: 'string',
      order_date: 'date',
      status: 'string',
      approval_status: 'string',
      invoice_status: 'string',
      total_amount: 'number',
      items_count: 'number',
    },
    getValue: (order, key) => {
      if (key === 'items_count') return order.items?.length ?? 0
      return (order as unknown as Record<string, unknown>)[key]
    },
  })

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    const isDefault =
      (key === 'date' && value === 'all') ||
      (key === 'view' && value === 'all') ||
      ((key === 'approval' || key === 'status') && value === 'ALL')
    if (isDefault) next.delete(key)
    else next.set(key, value)
    if (fromDashboard) next.set('from', 'dashboard')
    if (metric) next.set('metric', metric)
    setSearchParams(next, { replace: true })
  }

  const clearFilters = () => {
    setSearchParams({}, { replace: true })
  }

  const hasActiveFilters =
    dateFilter !== 'all' ||
    approvalFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    viewFilter !== 'all'

  const filteredTotal = filteredOrders.reduce(
    (sum, o) => sum + (Number(o.total_amount) || 0),
    0,
  )

  const handlePreviousPage = () => {
    if (skip >= pageSize) setSkip(skip - pageSize)
  }

  const handleNextPage = () => {
    if (skip + pageSize < filteredOrders.length) setSkip(skip + pageSize)
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading sales orders...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
          <p>Error loading sales orders:</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  const metricTitle =
    metric && METRIC_PAGE_TITLES[metric]
      ? METRIC_PAGE_TITLES[metric]
      : 'Filtered sales orders'

  return (
    <div style={containerStyle}>
      {lockWarning && (
        <div style={lockWarningStyle} role="alert">
          {lockWarning}
        </div>
      )}
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Sales Orders</h2>
          <p style={pageSubStyle}>
            View, create and manage sales orders for your customers
          </p>
        </div>
        <button
          onClick={() => navigate('/orders/new')}
          style={primaryButtonStyle}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          + Create Order
        </button>
      </header>

      {fromDashboard ? (
        <div style={contextBannerStyle}>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1565c0', letterSpacing: '0.04em' }}>
              FROM DASHBOARD
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text-h)', marginTop: 2 }}>
              {metricTitle}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text)', marginTop: 4 }}>
              {filteredOrders.length} order(s) ·{' '}
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                filteredTotal,
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/" style={linkBtnStyle}>
              ← Back to Dashboard
            </Link>
            {hasActiveFilters ? (
              <button type="button" onClick={clearFilters} style={ghostBtnStyle}>
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div style={filtersBarStyle}>
        <FilterSelect
          label="Date"
          value={dateFilter}
          onChange={(value) => updateParam('date', value)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'this_month', label: 'This Month' },
            { value: 'last_quarter', label: 'Last Quarter' },
            { value: 'ytd', label: 'YTD' },
          ]}
        />
        <FilterSelect
          label="View"
          value={viewFilter}
          onChange={(value) => updateParam('view', value)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open only' },
          ]}
        />
        <FilterSelect
          label="Approval"
          value={approvalFilter}
          onChange={(value) => updateParam('approval', value)}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'PENDING_APPROVAL', label: 'Pending' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'DRAFT', label: 'Draft' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={(value) => updateParam('status', value)}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'DRAFT', label: 'Draft' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'RECEIVED', label: 'Received' },
            { value: 'SHIPPED', label: 'Shipped' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
        {hasActiveFilters ? (
          <div style={filterClearWrapStyle}>
            <button type="button" onClick={clearFilters} style={ghostBtnStyle}>
              Clear filters
            </button>
          </div>
        ) : null}
      </div>

      <div style={dashboardSectionStyle}>
        {filteredOrders.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>
            No sales orders match the current filters.
            {hasActiveFilters ? (
              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={clearFilters} style={secondaryButtonStyle}>
                  Clear filters
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <SortableTh
                      label="Sales Order ID"
                      columnKey="sales_order_id"
                      sortConfig={sortConfig}
                      onRequestSort={requestSort}
                    />
                    <SortableTh
                      label="Customer ID"
                      columnKey="customer_id"
                      sortConfig={sortConfig}
                      onRequestSort={requestSort}
                    />
                    <SortableTh
                      label="Order Date"
                      columnKey="order_date"
                      sortConfig={sortConfig}
                      onRequestSort={requestSort}
                    />
                    <SortableTh
                      label="Status"
                      columnKey="status"
                      sortConfig={sortConfig}
                      onRequestSort={requestSort}
                      align="center"
                    />
                    <SortableTh
                      label="Approval"
                      columnKey="approval_status"
                      sortConfig={sortConfig}
                      onRequestSort={requestSort}
                      align="center"
                    />
                    <SortableTh
                      label="Billing"
                      columnKey="invoice_status"
                      sortConfig={sortConfig}
                      onRequestSort={requestSort}
                      align="center"
                    />
                    <SortableTh
                      label="Total Amount"
                      columnKey="total_amount"
                      sortConfig={sortConfig}
                      onRequestSort={requestSort}
                      align="right"
                    />
                    <SortableTh
                      label="Items"
                      columnKey="items_count"
                      sortConfig={sortConfig}
                      onRequestSort={requestSort}
                      align="center"
                    />
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOrders.map((order: SalesOrder) => {
                    const statusColors = getStatusColors(order.status)
                    const approvalColors = getApprovalColors(order.approval_status || 'DRAFT')
                    const approval = (order.approval_status || 'DRAFT').replace(/_/g, ' ')
                    const billingStatus = salesOrderInvoiceStatus(order)
                    const billingColors = invoiceStatusColors(billingStatus)
                    return (
                      <tr key={order.sales_order_id} style={directoryTbodyRowStyle}>
                        <td style={directoryTdStyle}>
                          <button
                            type="button"
                            onClick={() => navigate(`/orders/${order.sales_order_id}`)}
                            style={idLinkStyle}
                          >
                            {order.sales_order_id}
                          </button>
                        </td>
                        <td style={directoryTdStyle}>{order.customer_id}</td>
                        <td style={directoryTdStyle}>
                          {new Date(order.order_date).toLocaleDateString()}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 'bold',
                              backgroundColor: statusColors.bg,
                              color: statusColors.text,
                            }}
                          >
                            {order.status}
                          </span>
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 'bold',
                              backgroundColor: approvalColors.bg,
                              color: approvalColors.text,
                            }}
                          >
                            {approval}
                          </span>
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 'bold',
                              backgroundColor: billingColors.bg,
                              color: billingColors.text,
                            }}
                          >
                            {invoiceStatusLabel(billingStatus)}
                          </span>
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                          {order.currency} {Number(order.total_amount || 0).toFixed(2)}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          {order.items?.length ?? 0}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          <button
                            onClick={() => navigate(`/orders/${order.sales_order_id}`)}
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: '#e3f2fd',
                              color: '#1565c0',
                              border: '1px solid #bbdefb',
                              marginRight: '6px',
                            }}
                          >
                            View / Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => requestEdit(order)}
                            aria-disabled={!isSalesOrderEditable(order)}
                            title={
                              isSalesOrderEditable(order)
                                ? 'Edit this sales order'
                                : SALES_ORDER_LOCKED_EDIT_MESSAGE
                            }
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: isSalesOrderEditable(order) ? '#fff3e0' : '#eceff1',
                              color: isSalesOrderEditable(order) ? '#e65100' : '#90a4ae',
                              border: isSalesOrderEditable(order)
                                ? '1px solid #ffe0b2'
                                : '1px solid #cfd8dc',
                              cursor: isSalesOrderEditable(order) ? 'pointer' : 'not-allowed',
                              opacity: isSalesOrderEditable(order) ? 1 : 0.7,
                            }}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={paginationRowStyle}>
              <button
                onClick={handlePreviousPage}
                disabled={skip === 0}
                style={{
                  ...secondaryButtonStyle,
                  opacity: skip === 0 ? 0.5 : 1,
                  cursor: skip === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                ← Previous
              </button>

              <span style={{ fontSize: '13px', color: 'var(--text)' }}>
                {formatPaginationLabel({
                  skip,
                  pageCount: pageRows.length,
                  total: filteredOrders.length,
                })}
              </span>

              <button
                onClick={handleNextPage}
                disabled={skip + pageSize >= filteredOrders.length}
                style={{
                  ...secondaryButtonStyle,
                  opacity: skip + pageSize >= filteredOrders.length ? 0.5 : 1,
                  cursor:
                    skip + pageSize >= filteredOrders.length ? 'not-allowed' : 'pointer',
                }}
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  const selectId = `so-filter-${label.toLowerCase()}`
  return (
    <label htmlFor={selectId} style={filterFieldStyle}>
      <span style={filterLabelStyle}>{label}</span>
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={filterSelectStyle}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function getStatusColors(status: string): { bg: string; text: string } {
  const statusColors: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    RECEIVED: { bg: '#e8f5e9', text: '#2e7d32' },
    PENDING: { bg: '#fffde7', text: '#f9a825' },
    PROCESSING: { bg: '#e3f2fd', text: '#1565c0' },
    APPROVED: { bg: '#e8f5e9', text: '#2e7d32' },
    FULFILLED: { bg: '#fff3e0', text: '#e65100' },
    INVOICED: { bg: '#e3f2fd', text: '#1565c0' },
    SHIPPED: { bg: '#fff3e0', text: '#e65100' },
    DELIVERED: { bg: '#e8f5e9', text: '#1b5e20' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  }
  return statusColors[status] || { bg: '#f5f5f5', text: '#616161' }
}

function getApprovalColors(status: string): { bg: string; text: string } {
  const key = status.toUpperCase()
  const map: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    PENDING_APPROVAL: { bg: '#fffde7', text: '#f9a825' },
    APPROVED: { bg: '#e8f5e9', text: '#2e7d32' },
    REJECTED: { bg: '#ffebee', text: '#c62828' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  }
  return map[key] || { bg: '#f5f5f5', text: '#616161' }
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '20px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
}

const pageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const pageSubStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  fontSize: '14px',
  color: 'var(--text)',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
  fontFamily: 'inherit',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const contextBannerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
  marginBottom: 16,
  padding: '14px 16px',
  borderRadius: 8,
  border: '1px solid #90caf9',
  background: 'linear-gradient(135deg, #e3f2fd 0%, #f5f9fc 60%, #fff 100%)',
}

const filtersBarStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-end',
  flexWrap: 'wrap',
  gap: 16,
  marginBottom: 16,
  padding: '16px 18px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  boxShadow: 'var(--shadow)',
}

const filterFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 150,
  flex: '1 1 150px',
  maxWidth: 220,
}

const filterLabelStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  color: 'var(--text)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const filterSelectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
  fontSize: '0.875rem',
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const filterClearWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  paddingBottom: 1,
  marginLeft: 'auto',
}

const linkBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '8px 12px',
  borderRadius: 6,
  background: '#1976d2',
  color: '#fff',
  textDecoration: 'none',
  fontSize: '0.8rem',
  fontWeight: 700,
}

const ghostBtnStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-h)',
  fontSize: '0.8rem',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const idLinkStyle: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  color: '#1565c0',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 'inherit',
}

const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: 'var(--shadow)',
}

const directoryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const directoryTheadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
}

const directoryThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const directoryTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
  transition: 'background-color 0.2s',
}

const directoryTdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
}

const directoryActionButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '11px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
}

const directoryEmptyTdWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

const lockWarningStyle: React.CSSProperties = {
  position: 'sticky',
  top: 12,
  zIndex: 20,
  marginBottom: 16,
  backgroundColor: '#fff8e1',
  color: '#e65100',
  border: '1px solid #ffe082',
  borderRadius: 6,
  padding: '12px 16px',
  fontSize: 14,
  fontWeight: 600,
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

const paginationRowStyle: React.CSSProperties = {
  marginTop: '20px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
}

export default SalesOrderList
