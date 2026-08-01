/**
 * SalesOrderList Component
 * Displays a list of sales orders in a table format with pagination
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { salesOrderService } from '../api/services'
import type { SalesOrder } from '../types'
import { useState } from 'react'

export function SalesOrderList() {
  const navigate = useNavigate()
  const [skip, setSkip] = useState(0)
  const limit = 10

  // Fetch sales orders using React Query
  const {
    data: salesOrders = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['salesOrders', skip, limit],
    queryFn: () => salesOrderService.listSalesOrders(skip, limit),
  })

  const handlePreviousPage = () => {
    if (skip >= limit) {
      setSkip(skip - limit)
    }
  }

  const handleNextPage = () => {
    if (salesOrders.length === limit) {
      setSkip(skip + limit)
    }
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
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Sales Orders</h2>
          <p style={pageSubStyle}>View, create and manage sales orders for your customers</p>
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

      <div style={dashboardSectionStyle}>
        {salesOrders.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No sales orders found.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <th style={directoryThStyle}>Sales Order ID</th>
                    <th style={directoryThStyle}>Customer ID</th>
                    <th style={directoryThStyle}>Order Date</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                    <th style={{ ...directoryThStyle, textAlign: 'right' }}>Total Amount</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Items</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {salesOrders.map((order: SalesOrder) => {
                    const statusColors = getStatusColors(order.status)
                    return (
                      <tr key={order.sales_order_id} style={directoryTbodyRowStyle}>
                        <td style={directoryTdStyle}>{order.sales_order_id}</td>
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
                        <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                          {order.currency} {Number(order.total_amount || 0).toFixed(2)}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>{order.items.length}</td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          <button
                            onClick={() => navigate(`/orders/${order.sales_order_id}`)}
                            style={{ ...directoryActionButtonStyle, backgroundColor: '#e3f2fd', color: '#1565c0', border: '1px solid #bbdefb', marginRight: '6px' }}
                          >
                            View
                          </button>
                          <button
                            onClick={() => navigate(`/orders/${order.sales_order_id}/edit`)}
                            style={{ ...directoryActionButtonStyle, backgroundColor: '#fff3e0', color: '#e65100', border: '1px solid #ffe0b2' }}
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
                Showing {skip + 1} to {skip + salesOrders.length} of results
              </span>

              <button
                onClick={handleNextPage}
                disabled={salesOrders.length < limit}
                style={{ ...secondaryButtonStyle, opacity: salesOrders.length < limit ? 0.5 : 1, cursor: salesOrders.length < limit ? 'not-allowed' : 'pointer' }}
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
    RECEIVED: { bg: '#e8f5e9', text: '#2e7d32' },
    PROCESSING: { bg: '#e3f2fd', text: '#1565c0' },
    SHIPPED: { bg: '#fff3e0', text: '#e65100' },
    DELIVERED: { bg: '#e8f5e9', text: '#1b5e20' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
    PENDING: { bg: '#fffde7', text: '#f9a825' },
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

export default SalesOrderList
