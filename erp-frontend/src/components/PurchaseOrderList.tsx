/**
 * PurchaseOrderList Component
 * Directory of purchase orders — drill into detail / create new
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { purchaseOrderService, vendorService } from '../api/services'
import type { PurchaseOrder, Supplier } from '../types'
import { useMemo, useState } from 'react'

export function PurchaseOrderList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [skip, setSkip] = useState(0)
  const [searchFilter, setSearchFilter] = useState('')
  const limit = 10

  const {
    data: purchaseOrders = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['purchaseOrders', skip, limit],
    queryFn: () => purchaseOrderService.listPurchaseOrders(skip, limit),
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
    const q = searchFilter.trim().toLowerCase()
    if (!q) return purchaseOrders
    return purchaseOrders.filter((po) => {
      const supplierName =
        po.supplier_name || supplierNameById[po.supplier_id] || po.supplier_id
      return (
        po.po_number.toLowerCase().includes(q) ||
        supplierName.toLowerCase().includes(q) ||
        po.status.toLowerCase().includes(q) ||
        (po.approval_status || '').toLowerCase().includes(q)
      )
    })
  }, [purchaseOrders, searchFilter, supplierNameById])

  const handlePreviousPage = () => {
    if (skip >= limit) setSkip(skip - limit)
  }

  const handleNextPage = () => {
    if (purchaseOrders.length === limit) setSkip(skip + limit)
  }

  const handleDelete = async (poNumber: string) => {
    if (!window.confirm(`Are you sure you want to delete purchase order ${poNumber}?`)) {
      return
    }
    try {
      await purchaseOrderService.deletePurchaseOrder(poNumber)
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

      <div style={dashboardSectionStyle}>
        <div style={dashboardHeaderStyle}>
          <input
            type="text"
            placeholder="Search by PO#, Supplier, Status..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            style={searchInputStyle}
            aria-label="Filter purchase orders"
          />
        </div>

        {filteredOrders.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No purchase orders found.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <th style={directoryThStyle}>PO Number</th>
                    <th style={directoryThStyle}>Supplier / Vendor</th>
                    <th style={directoryThStyle}>Order Date</th>
                    <th style={directoryThStyle}>Expected Delivery</th>
                    <th style={{ ...directoryThStyle, textAlign: 'right' }}>Total Amount</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Approval</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((po: PurchaseOrder) => {
                    const statusColors = getStatusColors(po.status)
                    const supplierName =
                      po.supplier_name || supplierNameById[po.supplier_id] || po.supplier_id
                    const approval = (po.approval_status || 'DRAFT').replace(/_/g, ' ')
                    return (
                      <tr key={po.po_number} style={directoryTbodyRowStyle}>
                        <td style={directoryTdStyle}>{po.po_number}</td>
                        <td style={directoryTdStyle}>{supplierName}</td>
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
                            onClick={() => navigate(`/purchase-orders/${po.po_number}?edit=1`)}
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: '#fff3e0',
                              color: '#e65100',
                              border: '1px solid #ffe0b2',
                              marginRight: '6px',
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(po.po_number)}
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: '#ffebee',
                              color: '#c62828',
                              border: '1px solid #ffcdd2',
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
                Showing {skip + 1} to {skip + purchaseOrders.length} of results
              </span>

              <button
                onClick={handleNextPage}
                disabled={purchaseOrders.length < limit}
                style={{
                  ...secondaryButtonStyle,
                  opacity: purchaseOrders.length < limit ? 0.5 : 1,
                  cursor: purchaseOrders.length < limit ? 'not-allowed' : 'pointer',
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

const dashboardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: '16px',
}

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '320px',
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '13px',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
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
