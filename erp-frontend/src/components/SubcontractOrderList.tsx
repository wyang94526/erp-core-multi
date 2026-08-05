/**
 * SubcontractOrderList Component
 * Displays a list of subcontract orders (SCOs) in a table format with pagination
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { subcontractOrderService } from '../api/services'
import type { SubcontractOrder } from '../types'
import { useState } from 'react'

export function SubcontractOrderList() {
  const navigate = useNavigate()
  const [skip, setSkip] = useState(0)
  const limit = 10

  // Optional itemId query param (e.g. /subcontract-orders?itemId=PROD-1001G)
  // set when navigating here from the "View Related Subcontract Orders" link
  // on the Edit Product page for outside-processed products.
  const [searchParams, setSearchParams] = useSearchParams()
  const itemIdFilter = searchParams.get('itemId') || ''

  const {
    data: allScos = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['subcontractOrders', skip, limit],
    queryFn: () => subcontractOrderService.listSubcontractOrders(skip, limit),
  })

  // Client-side filter by itemId when the query param is present
  const scos = itemIdFilter
    ? allScos.filter((sco) => sco.item_id === itemIdFilter)
    : allScos

  const handleClearFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('itemId')
    setSearchParams(next)
  }


  const handlePreviousPage = () => {
    if (skip >= limit) {
      setSkip(skip - limit)
    }
  }

  const handleNextPage = () => {
    if (scos.length === limit) {
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
        </div>
        <button

          onClick={() => navigate('/subcontract-orders/new')}
          style={primaryButtonStyle}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          + New Subcontract Order
        </button>
      </header>

      <div style={dashboardSectionStyle}>
        {scos.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No subcontract orders found.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <th style={directoryThStyle}>SCO Number</th>
                    <th style={directoryThStyle}>Supplier</th>
                    <th style={directoryThStyle}>Product</th>
                    <th style={{ ...directoryThStyle, textAlign: 'right' }}>Qty Ordered</th>
                    <th style={directoryThStyle}>Order Date</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Approval</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scos.map((sco: SubcontractOrder) => {
                    const statusColors = getStatusColors(sco.status)
                    return (
                      <tr key={sco.sco_number} style={directoryTbodyRowStyle}>
                        <td style={directoryTdStyle}>{sco.sco_number}</td>
                        <td style={directoryTdStyle}>{sco.supplier_id}</td>
                        <td style={directoryTdStyle}>{sco.item_id}</td>
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
                Showing {skip + 1} to {skip + scos.length} of results
              </span>

              <button
                onClick={handleNextPage}
                disabled={scos.length < limit}
                style={{ ...secondaryButtonStyle, opacity: scos.length < limit ? 0.5 : 1, cursor: scos.length < limit ? 'not-allowed' : 'pointer' }}
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

