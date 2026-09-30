/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * SalesOrderList — full-page sales orders with URL-driven filters
 * (used by dashboard KPI drill-through and direct navigation).
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { salesOrderService } from '../api/services'
import type { SalesOrder } from '../types'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { formatPaginationLabel } from '../utils/pagination'
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
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import { matchesRelativeDate, type RelativeDateFilter } from '../utils/listDateFilters'
import ListFilterBar, {
  DashboardContextBanner,
  useListFilterParams,
  type FilterField,
} from './ListFilterBar'

type ViewFilter = 'all' | 'open'

const LIST_LIMIT = 100

const SO_FILTERS: FilterField[] = [
  {
    key: 'date',
    label: 'Date',
    allValue: 'all',
    options: [
      { value: 'all', label: 'All' },
      { value: 'this_month', label: 'This Month' },
      { value: 'last_quarter', label: 'Last Quarter' },
      { value: 'ytd', label: 'YTD' },
    ],
  },
  {
    key: 'view',
    label: 'View',
    allValue: 'all',
    options: [
      { value: 'all', label: 'All' },
      { value: 'open', label: 'Open only' },
    ],
  },
  {
    key: 'approval',
    label: 'Approval',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'PENDING_APPROVAL', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'DRAFT', label: 'Draft' },
      { value: 'REJECTED', label: 'Rejected' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'DRAFT', label: 'Draft' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'RECEIVED', label: 'Received' },
      { value: 'SHIPPED', label: 'Shipped' },
      { value: 'PARTIALLY_FULFILLED', label: 'Partially fulfilled' },
      { value: 'FULFILLED', label: 'Fulfilled' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ],
  },
]

function isOpenOrder(order: SalesOrder): boolean {
  const status = (order.status || '').toUpperCase()
  return !['CANCELLED', 'DELIVERED', 'CLOSED'].includes(status)
}

export function SalesOrderList() {
  const navigate = useNavigate()
  const [skip, setSkip] = useState(0)
  const pageSize = 10
  const { values, fromDashboard, metricTitle, hasActiveFilters, clearFilters } =
    useListFilterParams(SO_FILTERS)
  const dateFilter = (values.date || 'all') as RelativeDateFilter
  const approvalFilter = values.approval || 'ALL'
  const statusFilter = values.status || 'ALL'
  const viewFilter = (values.view || 'all') as ViewFilter
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
      if (!matchesRelativeDate(order.order_date, dateFilter)) return false
      if (viewFilter === 'open' && !isOpenOrder(order)) return false
      if (approvalFilter !== 'ALL') {
        const approval = (order.approval_status || 'DRAFT').toUpperCase()
        if (approval !== approvalFilter.toUpperCase()) return false
      }
      if (statusFilter !== 'ALL') {
        if ((order.status || '').toUpperCase() !== statusFilter.toUpperCase()) return false
      }
      return matchesSearch(
        values.q,
        order.sales_order_id,
        order.customer_id,
        order.customer_po_number,
        order.status,
        order.approval_status,
        order.buyer_contact_name,
      )
    })
  }, [salesOrders, dateFilter, viewFilter, approvalFilter, statusFilter, values.q])

  useEffect(() => {
    setSkip(0)
  }, [dateFilter, viewFilter, approvalFilter, statusFilter, values.q])

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
        <DashboardContextBanner
          title={metricTitle}
          subtitle={`${filteredOrders.length} order(s) · ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(filteredTotal)}`}
          showClear={hasActiveFilters}
          onClear={clearFilters}
        />
      ) : null}

      <ListFilterBar
        fields={SO_FILTERS}
        searchPlaceholder="Search sales order, customer, PO #…"
        exportCount={filteredOrders.length}
        onExport={() =>
          downloadCsv(
            csvFilename('sales-orders'),
            ['Sales Order ID', 'Customer ID', 'Customer PO', 'Order Date', 'Status', 'Approval', 'Billing', 'Total Amount', 'Items'],
            filteredOrders.map((order) => [
              order.sales_order_id,
              order.customer_id,
              order.customer_po_number,
              order.order_date,
              order.status,
              order.approval_status || 'DRAFT',
              salesOrderInvoiceStatus(order),
              order.total_amount,
              order.items?.length ?? 0,
            ]),
          )
        }
      />

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

function getStatusColors(status: string): { bg: string; text: string } {
  const statusColors: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    RECEIVED: { bg: '#e8f5e9', text: '#2e7d32' },
    PENDING: { bg: '#fffde7', text: '#f9a825' },
    PROCESSING: { bg: '#e3f2fd', text: '#1565c0' },
    APPROVED: { bg: '#e8f5e9', text: '#2e7d32' },
    FULFILLED: { bg: '#fff3e0', text: '#e65100' },
    PARTIALLY_FULFILLED: { bg: '#ede7f6', text: '#5e35b1' },
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
