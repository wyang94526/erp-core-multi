/**
 * VendorList Component
 * Displays a list of vendors/suppliers in a table format with pagination
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { vendorService } from '../api/services'
import type { Supplier } from '../types'
import { useState } from 'react'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'

export function VendorList() {
  const navigate = useNavigate()
  const [skip, setSkip] = useState(0)
  const limit = 10

  // Fetch vendors using React Query
  const {
    data: vendors = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['vendors', skip, limit],
    queryFn: () => vendorService.listVendors(skip, limit),
  })

  const { items: sortedVendors, requestSort, sortConfig } = useSortableData(vendors)

  const handlePreviousPage = () => {
    if (skip >= limit) {
      setSkip(skip - limit)
    }
  }

  const handleNextPage = () => {
    if (vendors.length === limit) {
      setSkip(skip + limit)
    }
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading vendors...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
          <p>Error loading vendors:</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  const getStatusColors = (status?: string | null) => {
    const isActive = status !== 'Inactive'
    return isActive ? { bg: '#e8f5e9', text: '#2e7d32' } : { bg: '#ffebee', text: '#c62828' }
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Vendors</h2>
          <p style={pageSubStyle}>View, create and manage your vendor / supplier accounts</p>
        </div>
        <button
          onClick={() => navigate('/vendors/new')}
          style={primaryButtonStyle}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          + Add Vendor
        </button>
      </header>

      <div style={dashboardSectionStyle}>
        {vendors.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No vendors found.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <SortableTh label="Vendor ID" columnKey="supplier_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Company Name" columnKey="company_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Vendor Number Ext" columnKey="vendor_number_ext" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Payment Terms" columnKey="payment_terms" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Status" columnKey="status" sortConfig={sortConfig} onRequestSort={requestSort} align="center" />
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVendors.map((vendor: Supplier) => {
                    const statusColors = getStatusColors(vendor.status)
                    return (
                      <tr key={vendor.supplier_id} style={directoryTbodyRowStyle}>
                        <td style={directoryTdStyle}>{vendor.supplier_id}</td>
                        <td style={directoryTdStyle}>{vendor.company_name}</td>
                        <td style={directoryTdStyle}>{vendor.vendor_number_ext || '-'}</td>
                        <td style={directoryTdStyle}>{vendor.payment_terms || '-'}</td>
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
                            {vendor.status || 'Active'}
                          </span>
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                          <button
                            onClick={() => navigate(`/vendors/${vendor.supplier_id}/edit`)}
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
                Showing {skip + 1} to {skip + vendors.length} of results
              </span>

              <button
                onClick={handleNextPage}
                disabled={vendors.length < limit}
                style={{ ...secondaryButtonStyle, opacity: vendors.length < limit ? 0.5 : 1, cursor: vendors.length < limit ? 'not-allowed' : 'pointer' }}
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
// STYLES
// ==========================================

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

export default VendorList
