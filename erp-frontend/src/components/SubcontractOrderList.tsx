/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * SubcontractOrderList Component
 * Displays a list of subcontract orders (SCOs) in a table format with pagination
 */

import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { subcontractOrderService } from '../api/services'
import type { SubcontractOrder } from '../types'
import { useEffect, useMemo, useState } from 'react'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { formatPaginationLabel } from '../utils/pagination'
import ListFilterBar, {
  DashboardContextBanner,
  useListFilterParams,
  type FilterField,
} from './ListFilterBar'
import { salesOrderDetailPath } from '../utils/salesOrders'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'

const SCO_FILTERS: FilterField[] = [
  {
    key: 'view',
    label: 'View',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'active', label: 'Active' },
      { value: 'completed', label: 'Completed' },
    ],
  },
  {
    key: 'approval',
    label: 'Approval',
    allValue: 'ALL',
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
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'PLANNED', label: 'Planned' },
      { value: 'PARTIALLY_ISSUED', label: 'Partially Issued' },
      { value: 'MATERIALS_ISSUED', label: 'Materials Issued' },
      { value: 'PARTIALLY_RECEIVED', label: 'Partially Received' },
      { value: 'COMPLETED', label: 'Completed' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ],
  },
]

export function SubcontractOrderList() {
  const navigate = useNavigate()
  const [skip, setSkip] = useState(0)
  const limit = 10
  const listLimit = 100

  // Optional itemId query param (e.g. /subcontract-orders?itemId=PROD-1001G)
  // set when navigating here from the "View Related Subcontract Orders" link
  // on the Edit Product page for outside-processed products.
  const [searchParams, setSearchParams] = useSearchParams()
  const itemIdFilter = searchParams.get('itemId') || ''
  const salesOrderIdFilter = searchParams.get('sales_order_id') || ''
  const { values, fromDashboard, metricTitle, hasActiveFilters, clearFilters } =
    useListFilterParams(SCO_FILTERS)

  const {
    data: allScos = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['subcontractOrders', 'list', listLimit],
    queryFn: () => subcontractOrderService.listSubcontractOrders(0, listLimit),
  })

  const scos = useMemo(() => {
    return allScos.filter((sco) => {
      if (itemIdFilter && sco.item_id !== itemIdFilter) return false
      if (salesOrderIdFilter && sco.sales_order_id !== salesOrderIdFilter) return false
      if (values.view === 'active') {
        const s = (sco.status || '').toUpperCase()
        if (['COMPLETED', 'CANCELLED'].includes(s)) return false
      }
      if (values.view === 'completed') {
        if ((sco.status || '').toUpperCase() !== 'COMPLETED') return false
      }
      if (values.status !== 'ALL' && (sco.status || '').toUpperCase() !== values.status) {
        return false
      }
      if (values.approval !== 'ALL') {
        const approval = (sco.approval_status || 'DRAFT').toUpperCase()
        if (approval !== values.approval.toUpperCase()) return false
      }
      return matchesSearch(
        values.q,
        sco.sco_number,
        sco.supplier_id,
        sco.sales_order_id,
        sco.item_id,
        sco.status,
        sco.approval_status,
      )
    })
  }, [allScos, itemIdFilter, salesOrderIdFilter, values.view, values.status, values.approval, values.q])

  useEffect(() => {
    setSkip(0)
  }, [itemIdFilter, salesOrderIdFilter, values.view, values.status, values.approval, values.q])

  const pageRows = scos.slice(skip, skip + limit)

  const { items: sortedScos, requestSort, sortConfig } = useSortableData(pageRows, {
    columnTypes: {
      quantity_ordered: 'number',
      order_date: 'date',
    },
  })

  const handleClearFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('itemId')
    next.delete('sales_order_id')
    setSearchParams(next)
  }

  const handlePreviousPage = () => {
    if (skip >= limit) {
      setSkip(skip - limit)
    }
  }

  const handleNextPage = () => {
    if (skip + limit < scos.length) {
      setSkip(skip + limit)
    }
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading subcontract orders...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
          <p>Error loading subcontract orders:</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Subcontract Orders</h2>
          <p style={pageSubStyle}>Manage outside processing orders sent to subcontractors</p>
          {itemIdFilter && (
            <div style={filterBadgeRowStyle}>
              <span style={filterBadgeStyle}>Filtered by Product: {itemIdFilter}</span>
              <button onClick={handleClearFilter} style={clearFilterLinkStyle}>
                Clear filter
              </button>
            </div>
          )}
          {salesOrderIdFilter && (
            <div style={filterBadgeRowStyle}>
              <span style={filterBadgeStyle}>Filtered by Sales Order: {salesOrderIdFilter}</span>
              <button onClick={handleClearFilter} style={clearFilterLinkStyle}>
                Clear filter
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => navigate('/subcontract-orders/new')}
          style={primaryButtonStyle}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          + Create Subcontract Order
        </button>
      </header>

      {fromDashboard ? (
        <DashboardContextBanner
          title={metricTitle}
          subtitle={`${scos.length} subcontract order(s) match current filters`}
          showClear={hasActiveFilters}
          onClear={clearFilters}
        />
      ) : null}

      <ListFilterBar
        fields={SCO_FILTERS}
        searchPlaceholder="Search SCO, supplier, sales order, item…"
        exportCount={scos.length}
        onExport={() =>
          downloadCsv(
            csvFilename('subcontract-orders'),
            ['SCO Number', 'Supplier', 'Sales Order', 'Product', 'Qty Ordered', 'Order Date', 'Status', 'Approval'],
            scos.map((sco) => [
              sco.sco_number,
              sco.supplier_id,
              sco.sales_order_id,
              sco.item_id,
              sco.quantity_ordered,
              sco.order_date,
              sco.status,
              sco.approval_status || 'DRAFT',
            ]),
          )
        }
      />

      <div style={dashboardSectionStyle}>
        {scos.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No subcontract orders found.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <SortableTh label="SCO Number" columnKey="sco_number" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Supplier" columnKey="supplier_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Sales Order" columnKey="sales_order_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Product" columnKey="item_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Qty Ordered" columnKey="quantity_ordered" sortConfig={sortConfig} onRequestSort={requestSort} align="right" />
                    <SortableTh label="Order Date" columnKey="order_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Status" columnKey="status" sortConfig={sortConfig} onRequestSort={requestSort} align="center" />
                    <SortableTh label="Approval" columnKey="approval_status" sortConfig={sortConfig} onRequestSort={requestSort} align="center" />
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedScos.map((sco: SubcontractOrder) => {
                    const statusColors = getStatusColors(sco.status)
                    return (
                      <tr key={sco.sco_number} style={directoryTbodyRowStyle}>
                        <td style={directoryTdStyle}>
                          <Link
                            to={`/subcontract-orders/${encodeURIComponent(sco.sco_number)}`}
                            style={soLinkStyle}
                            title="View subcontract order details"
                          >
                            {sco.sco_number}
                          </Link>
                        </td>
                        <td style={directoryTdStyle}>
                          {sco.supplier_id ? (
                            <Link
                              to={`/vendors/${encodeURIComponent(sco.supplier_id)}/edit`}
                              style={soLinkStyle}
                              title="View supplier details"
                            >
                              {sco.supplier_id}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={directoryTdStyle}>
                          {sco.sales_order_id ? (
                            <Link to={salesOrderDetailPath(sco.sales_order_id)} style={soLinkStyle} title="View sales order details">
                              {sco.sales_order_id}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={directoryTdStyle}>
                          {sco.item_id}
                          {(sco.line_count || sco.lines?.length || 0) > 1
                            ? ` +${(sco.line_count || sco.lines?.length || 1) - 1}`
                            : ''}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'right' }}>{sco.quantity_ordered}</td>
                        <td style={directoryTdStyle}>
                          {sco.order_date ? new Date(sco.order_date).toLocaleDateString() : '-'}
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
                            {sco.status}
                          </span>
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          {(sco.approval_status || 'DRAFT').replace(/_/g, ' ')}
                          {Number(sco.amendment_number || 0) > 0
                            ? ` · Amd ${sco.amendment_number}`
                            : ''}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          <button
                            onClick={() => navigate(`/subcontract-orders/${sco.sco_number}`)}
                            style={{ ...directoryActionButtonStyle, backgroundColor: '#e3f2fd', color: '#1565c0', border: '1px solid #bbdefb' }}
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

            {/* Pagination Controls */}
            <div style={paginationRowStyle}>
              <button
                onClick={handlePreviousPage}
                disabled={skip === 0}
                style={{ ...secondaryButtonStyle, opacity: skip === 0 ? 0.5 : 1, cursor: skip === 0 ? 'not-allowed' : 'pointer' }}
              >
                ← Previous
              </button>

              <span style={{ fontSize: '13px', color: 'var(--text)' }}>
                {formatPaginationLabel({
                  skip,
                  pageCount: pageRows.length,
                  total: scos.length,
                })}
              </span>

              <button
                onClick={handleNextPage}
                disabled={skip + limit >= scos.length}
                style={{
                  ...secondaryButtonStyle,
                  opacity: skip + limit >= scos.length ? 0.5 : 1,
                  cursor: skip + limit >= scos.length ? 'not-allowed' : 'pointer',
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

// ==========================================
// HELPER FUNCTIONS & STYLES
// ==========================================

function getStatusColors(status: string): { bg: string; text: string } {
  const statusColors: Record<string, { bg: string; text: string }> = {
    PLANNED: { bg: '#fffde7', text: '#f9a825' },
    PARTIALLY_ISSUED: { bg: '#fff3e0', text: '#e65100' },
    MATERIALS_ISSUED: { bg: '#e3f2fd', text: '#1565c0' },
    PARTIALLY_RECEIVED: { bg: '#ede7f6', text: '#5e35b1' },
    COMPLETED: { bg: '#e8f5e9', text: '#2e7d32' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  }
  return statusColors[status] || { bg: '#f5f5f5', text: '#616161' }
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '24px',
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

const soLinkStyle: React.CSSProperties = {
  color: '#1565c0',
  textDecoration: 'none',
  fontWeight: 600,
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

const filterBadgeRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  marginTop: '8px',
}

const filterBadgeStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '12px',
  fontSize: '11px',
  fontWeight: 'bold',
  backgroundColor: '#e3f2fd',
  color: '#1565c0',
}

const clearFilterLinkStyle: React.CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  color: '#1976d2',
  fontSize: '12px',
  fontWeight: 'bold',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

export default SubcontractOrderList

