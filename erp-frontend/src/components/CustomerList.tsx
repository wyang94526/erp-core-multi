/**
 * CustomerList Component
 * Displays a list of customers in a table format with pagination
 */

import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { customerService } from '../api/services'
import type { Customer } from '../types'
import { useEffect, useState } from 'react'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'

export function CustomerList() {
  const navigate = useNavigate()
  const location = useLocation()
  const [skip, setSkip] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [toast, setToast] = useState<string | null>(null)
  const limit = 10

  useEffect(() => {
    const message = (location.state as { toast?: string } | null)?.toast
    if (message) {
      setToast(message)
      navigate('.', { replace: true, state: {} })
    }
  }, [location.state, navigate])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const {
    data: customers = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['customers', skip, limit, search, statusFilter],
    queryFn: () =>
      customerService.listCustomers(skip, limit, {
        q: search || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
      }),
  })

  const { items: sortedCustomers, requestSort, sortConfig } = useSortableData(customers)

  const handlePreviousPage = () => {
    if (skip >= limit) {
      setSkip(skip - limit)
    }
  }

  const handleNextPage = () => {
    if (customers.length === limit) {
      setSkip(skip + limit)
    }
  }

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault()
    setSkip(0)
    setSearch(searchInput.trim())
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading customers...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
          <p>Error loading customers:</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      {toast && (
        <div style={toastStyle} role="status">
          {toast}
        </div>
      )}
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Customers</h2>
          <p style={pageSubStyle}>View, create and manage your customer accounts</p>
        </div>
        <button
          onClick={() => navigate('/customers/new')}
          style={primaryButtonStyle}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          + Add Customer
        </button>
      </header>

      <form onSubmit={applySearch} style={filterRowStyle}>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name, customer ID, or tax ID"
          style={searchInputStyle}
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setSkip(0)
          }}
          style={selectStyle}
        >
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ON_HOLD">On hold</option>
        </select>
        <button type="submit" style={secondaryButtonStyle}>
          Search
        </button>
      </form>

      <div style={dashboardSectionStyle}>
        {customers.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No customers found.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <SortableTh label="Customer ID" columnKey="customer_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Company Name" columnKey="company_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Customer Number Ext" columnKey="customer_number_ext" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCustomers.map((customer: Customer) => (
                    <tr key={customer.customer_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>{customer.customer_id}</td>
                      <td style={directoryTdStyle}>{customer.company_name}</td>
                      <td style={directoryTdStyle}>{customer.customer_number_ext || '-'}</td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <button
                          onClick={() => navigate(`/customers/${customer.customer_id}/edit`)}
                          style={{ ...directoryActionButtonStyle, backgroundColor: '#fff3e0', color: '#e65100', border: '1px solid #ffe0b2' }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={paginationRowStyle}>
              <button
                onClick={handlePreviousPage}
                disabled={skip === 0}
                style={{ ...secondaryButtonStyle, opacity: skip === 0 ? 0.5 : 1, cursor: skip === 0 ? 'not-allowed' : 'pointer' }}
              >
                ← Previous
              </button>

              <span style={{ fontSize: '13px', color: 'var(--text)' }}>
                Showing {skip + 1} to {skip + customers.length} of results
              </span>

              <button
                onClick={handleNextPage}
                disabled={customers.length < limit}
                style={{ ...secondaryButtonStyle, opacity: customers.length < limit ? 0.5 : 1, cursor: customers.length < limit ? 'not-allowed' : 'pointer' }}
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

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '16px',
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

const filterRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  marginBottom: '16px',
  flexWrap: 'wrap',
  alignItems: 'center',
}

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: '220px',
  padding: '9px 12px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '14px',
  fontFamily: 'inherit',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
}

const selectStyle: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '14px',
  fontFamily: 'inherit',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
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

const toastStyle: React.CSSProperties = {
  position: 'sticky',
  top: 12,
  zIndex: 20,
  marginBottom: '16px',
  backgroundColor: '#e8f5e9',
  color: '#1b5e20',
  border: '1px solid #c8e6c9',
  borderRadius: '6px',
  padding: '12px 16px',
  fontSize: '14px',
  fontWeight: 600,
}

export default CustomerList
