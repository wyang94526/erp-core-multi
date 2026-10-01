/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * PurchaseOrderList Component
 * Directory of purchase orders — drill into detail / create new
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { purchaseOrderService, vendorService } from '../api/services'
import type { PurchaseOrder, Supplier } from '../types'
import { useEffect, useMemo, useState } from 'react'
import {
  canDeletePurchaseOrder,
  isPurchaseOrderEditable,
  purchaseOrderDeleteReason,
  purchaseOrderLockReason,
} from '../utils/poWorkflow'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { formatPaginationLabel } from '../utils/pagination'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import {
  matchesDeliveryDate,
  matchesRelativeDate,
  type DeliveryDateFilter,
  type RelativeDateFilter,
} from '../utils/listDateFilters'
import ListFilterBar, {
  DashboardContextBanner,
  useListFilterParams,
  type FilterField,
} from './ListFilterBar'

const PO_FILTERS: FilterField[] = [
  {
    key: 'po_type',
    label: 'Type',
    options: [
      { value: 'ALL', label: 'All types' },
      { value: 'MATERIAL', label: 'Material' },
      { value: 'SUBCONTRACT', label: 'Subcontract' },
    ],
  },
  {
    key: 'order_date',
    label: 'Order date',
    allValue: 'all',
    options: [
      { value: 'all', label: 'All' },
      { value: 'this_month', label: 'This month' },
      { value: 'last_quarter', label: 'Last quarter' },
      { value: 'ytd', label: 'YTD' },
    ],
  },
  {
    key: 'delivery',
    label: 'Expected delivery',
    allValue: 'all',
    options: [
      { value: 'all', label: 'All' },
      { value: 'overdue', label: 'Overdue' },
      { value: 'this_week', label: 'This week' },
      { value: 'this_month', label: 'This month' },
      { value: 'next_30', label: 'Next 30 days' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'open', label: 'Open' },
      { value: 'Draft', label: 'Draft' },
      { value: 'Submitted', label: 'Submitted' },
      { value: 'Approved', label: 'Approved' },
      { value: 'Void', label: 'Void' },
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
]

export function PurchaseOrderList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [skip, setSkip] = useState(0)
  const limit = 10
  const listLimit = 100
  const { values, fromDashboard, metricTitle, hasActiveFilters, clearFilters } =
    useListFilterParams(PO_FILTERS)
  const approvalFilter = values.approval === 'ALL' ? null : values.approval
  const statusParam = values.status === 'ALL' ? null : values.status
  const typeFilter = values.po_type === 'ALL' ? null : values.po_type
  const orderDateFilter = (values.order_date || 'all') as RelativeDateFilter
  const deliveryFilter = (values.delivery || 'all') as DeliveryDateFilter

  const {
    data: purchaseOrders = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['purchaseOrders', 'list', listLimit],
    queryFn: () => purchaseOrderService.listPurchaseOrders(0, listLimit),
  })

  const { data: suppliers = [] } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => vendorService.listVendors(),
  })

  const supplierNameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of suppliers as Supplier[]) {
      map[s.supplier_id] = s.company_name
    }
    return map
  }, [suppliers])

  const filteredOrders = useMemo(() => {
    return purchaseOrders.filter((po) => {
      if (approvalFilter) {
        const approval = (po.approval_status || 'DRAFT').toUpperCase()
        if (approval !== approvalFilter.toUpperCase()) return false
      }
      if (statusParam === 'open') {
        if (po.status === 'Void' || po.status === 'Approved') return false
      } else if (statusParam && statusParam !== 'open') {
        if (po.status.toLowerCase() !== statusParam.toLowerCase()) return false
      }
      if (typeFilter && (po.po_type || 'MATERIAL') !== typeFilter) return false
      if (!matchesRelativeDate(po.order_date, orderDateFilter)) return false
      if (!matchesDeliveryDate(po.expected_delivery_date, deliveryFilter)) return false
      const supplierName = po.supplier_name || supplierNameById[po.supplier_id] || po.supplier_id
      return matchesSearch(
        values.q,
        po.po_number,
        supplierName,
        po.supplier_id,
        po.status,
        po.po_type,
        po.sco_number,
        po.approval_status,
      )
    })
  }, [
    purchaseOrders,
    supplierNameById,
    approvalFilter,
    statusParam,
    typeFilter,
    orderDateFilter,
    deliveryFilter,
    values.q,
  ])

  useEffect(() => {
    setSkip(0)
  }, [approvalFilter, statusParam, typeFilter, orderDateFilter, deliveryFilter, values.q])

  const pageRows = filteredOrders.slice(skip, skip + limit)

  const { items: sortedOrders, requestSort, sortConfig } = useSortableData(pageRows, {
    columnTypes: {
      order_date: 'date',
      expected_delivery_date: 'date',
      grand_total: 'number',
    },
    getValue: (po, key) => {
      if (key === 'supplier_name') {
        return po.supplier_name || supplierNameById[po.supplier_id] || po.supplier_id
      }
      return (po as unknown as Record<string, unknown>)[key]
    },
  })

  const handlePreviousPage = () => {
    if (skip >= limit) setSkip(skip - limit)
  }

  const handleNextPage = () => {
    if (skip + limit < filteredOrders.length) setSkip(skip + limit)
  }

  const handleDelete = async (po: PurchaseOrder) => {
    const blocked = purchaseOrderDeleteReason(po)
    if (blocked) {
      window.alert(blocked)
      return
    }
    if (!window.confirm(`Are you sure you want to delete purchase order ${po.po_number}?`)) {
      return
    }
    try {
      await purchaseOrderService.deletePurchaseOrder(po.po_number)
      await queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete purchase order')
    }
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading purchase orders...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
          <p>Error loading purchase orders:</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Purchase Orders</h2>
          <p style={pageSubStyle}>View, create and manage purchase orders with vendors</p>
        </div>
        <button
          onClick={() => navigate('/purchase-orders/new')}
          style={primaryButtonStyle}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          + Create Purchase Order
        </button>
      </header>

      {fromDashboard ? (
        <DashboardContextBanner
          title={metricTitle}
          subtitle={`${filteredOrders.length} purchase order(s) match current filters`}
          showClear={hasActiveFilters}
          onClear={clearFilters}
        />
      ) : null}

      <ListFilterBar
        fields={PO_FILTERS}
        searchPlaceholder="Search PO #, supplier, type, SCO #…"
        exportCount={filteredOrders.length}
        onExport={() =>
          downloadCsv(
            csvFilename('purchase-orders'),
            ['PO Number', 'Type', 'Supplier', 'Order Date', 'Expected Delivery', 'Total', 'Status', 'Approval'],
            filteredOrders.map((po) => [
              po.po_number,
              po.po_type,
              po.supplier_name || supplierNameById[po.supplier_id] || po.supplier_id,
              po.order_date,
              po.expected_delivery_date,
              po.grand_total,
              po.status,
              po.approval_status || 'DRAFT',
            ]),
          )
        }
      />

      <div style={dashboardSectionStyle}>

        {filteredOrders.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No purchase orders found.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <SortableTh label="PO Number" columnKey="po_number" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Type" columnKey="po_type" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Supplier / Vendor" columnKey="supplier_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Order Date" columnKey="order_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Expected Delivery" columnKey="expected_delivery_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Total Amount" columnKey="grand_total" sortConfig={sortConfig} onRequestSort={requestSort} align="right" />
                    <SortableTh label="Status" columnKey="status" sortConfig={sortConfig} onRequestSort={requestSort} align="center" />
                    <SortableTh label="Approval" columnKey="approval_status" sortConfig={sortConfig} onRequestSort={requestSort} align="center" />
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOrders.map((po: PurchaseOrder) => {
                    const statusColors = getStatusColors(po.status)
                    const supplierName =
                      po.supplier_name || supplierNameById[po.supplier_id] || po.supplier_id
                    const approval = (po.approval_status || 'DRAFT').replace(/_/g, ' ')
                    const canEditPo = isPurchaseOrderEditable(po)
                    const editLockReason = purchaseOrderLockReason(po)
                    const canDeletePo = canDeletePurchaseOrder(po)
                    const deleteLockReason = purchaseOrderDeleteReason(po)
                    return (
                      <tr key={po.po_number} style={directoryTbodyRowStyle}>
                        <td style={directoryTdStyle}>
                          <Link
                            to={`/purchase-orders/${encodeURIComponent(po.po_number)}`}
                            style={listLinkStyle}
                            title="View purchase order"
                          >
                            {po.po_number}
                          </Link>
                        </td>
                        <td style={directoryTdStyle}>
                          {po.po_type === 'SUBCONTRACT' ? 'Subcontract / 外發加工' : 'Material'}
                        </td>
                        <td style={directoryTdStyle}>
                          {po.supplier_id ? (
                            <Link
                              to={`/vendors/${encodeURIComponent(po.supplier_id)}/edit`}
                              style={listLinkStyle}
                              title="View vendor"
                            >
                              {supplierName}
                            </Link>
                          ) : (
                            supplierName || '—'
                          )}
                        </td>
                        <td style={directoryTdStyle}>
                          {po.order_date
                            ? new Date(po.order_date).toLocaleDateString()
                            : '—'}
                        </td>
                        <td style={directoryTdStyle}>
                          {po.expected_delivery_date
                            ? new Date(po.expected_delivery_date).toLocaleDateString()
                            : '—'}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                          {formatCurrency(Number(po.grand_total || 0))}
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
                            {po.status}
                          </span>
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>{approval}</td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          <button
                            onClick={() => navigate(`/purchase-orders/${po.po_number}`)}
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
                            onClick={() => {
                              if (!canEditPo) return
                              navigate(`/purchase-orders/${po.po_number}?edit=1`)
                            }}
                            disabled={!canEditPo}
                            title={
                              canEditPo
                                ? 'Edit this purchase order'
                                : editLockReason || 'This purchase order cannot be edited inline'
                            }
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: canEditPo ? '#fff3e0' : '#eceff1',
                              color: canEditPo ? '#e65100' : '#78909c',
                              border: canEditPo ? '1px solid #ffe0b2' : '1px solid #cfd8dc',
                              marginRight: '6px',
                              cursor: canEditPo ? 'pointer' : 'not-allowed',
                              opacity: canEditPo ? 1 : 0.75,
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(po)}
                            disabled={!canDeletePo}
                            title={
                              canDeletePo
                                ? 'Delete this draft purchase order'
                                : deleteLockReason || 'This purchase order cannot be deleted'
                            }
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: canDeletePo ? '#ffebee' : '#eceff1',
                              color: canDeletePo ? '#c62828' : '#78909c',
                              border: canDeletePo ? '1px solid #ffcdd2' : '1px solid #cfd8dc',
                              cursor: canDeletePo ? 'pointer' : 'not-allowed',
                              opacity: canDeletePo ? 1 : 0.75,
                            }}
                          >
                            Delete
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
                disabled={skip + limit >= filteredOrders.length}
                style={{
                  ...secondaryButtonStyle,
                  opacity: skip + limit >= filteredOrders.length ? 0.5 : 1,
                  cursor: skip + limit >= filteredOrders.length ? 'not-allowed' : 'pointer',
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
    Draft: { bg: '#f5f5f5', text: '#616161' },
    Submitted: { bg: '#e3f2fd', text: '#1565c0' },
    Approved: { bg: '#e8f5e9', text: '#2e7d32' },
    Void: { bg: '#ffebee', text: '#c62828' },
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
  padding: '8px 14px',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
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
  backgroundColor: '#f5f5f5',
}

const directoryThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const directoryTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid #eee',
}

const directoryTdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
}

const listLinkStyle: React.CSSProperties = {
  color: '#1565c0',
  textDecoration: 'none',
  fontWeight: 600,
}

const directoryEmptyTdWrapperStyle: React.CSSProperties = {
  padding: '40px 20px',
  textAlign: 'center',
  color: 'var(--text)',
  fontStyle: 'italic',
}

const directoryActionButtonStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 600,
  fontFamily: 'inherit',
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

export default PurchaseOrderList
