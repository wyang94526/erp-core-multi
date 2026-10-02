/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * CustomerList Component
 * Displays a list of customers in a table format with pagination
 */

import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { customerService } from '../api/services'
import type { Customer } from '../types'
import { useEffect, useState } from 'react'
import { csvFilename, downloadCsv } from '../utils/csvExport'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { PaginationControls } from './PaginationControls'
import { Plus } from 'lucide-react'
import { primaryButtonStyle } from '../utils/documentPageStyles'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { PageHeader } from './PageHeader'

const CUSTOMER_FILTERS: FilterField[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'ALL', label: 'All statuses' },
      { value: 'ACTIVE', label: 'Active' },
      { value: 'INACTIVE', label: 'Inactive' },
      { value: 'ON_HOLD', label: 'On hold' },
    ],
  },
]

export function CustomerList() {
  const navigate = useNavigate()
  const location = useLocation()
  const [skip, setSkip] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const limit = 10
  const { values } = useListFilterParams(CUSTOMER_FILTERS)
  const search = values.q.trim()
  const statusFilter = values.status || 'ALL'

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
    data,
    isLoading,
    isFetching,
    isError,
    error,
  } = useQuery({
    queryKey: ['customers', skip, limit, search, statusFilter],
    queryFn: () =>
      customerService.listCustomersPage(skip, limit, {
        q: search || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
      }),
    placeholderData: (previous) => previous,
  })

  const customers = data?.items ?? []
  const total = data?.pagination.total ?? 0

  const { items: sortedCustomers, requestSort, sortConfig } = useSortableData(customers)

  const handlePreviousPage = () => {
    if (skip >= limit) {
      setSkip(skip - limit)
    }
  }

  const handleNextPage = () => {
    if (skip + customers.length < total) {
      setSkip(skip + limit)
    }
  }

  useEffect(() => {
    setSkip(0)
  }, [search, statusFilter])

  return (
    <div style={containerStyle}>
      {toast && (
        <div style={toastStyle} role="status">
          {toast}
        </div>
      )}
      <PageHeader title="Customers" subtitle="View, create and manage your customer accounts">
        <button type="button" onClick={() => navigate('/customers/new')} style={primaryButtonStyle}>
          <Plus size={15} />
          Add Customer
        </button>
      </PageHeader>

      <ListFilterBar
        fields={CUSTOMER_FILTERS}
        searchPlaceholder="Search name, customer ID, or tax ID"
        exportCount={total}
        onExport={async () => {
          const page = await customerService.listCustomersPage(0, 2000, {
            q: search || undefined,
            status: statusFilter === 'ALL' ? undefined : statusFilter,
          })
          downloadCsv(
            csvFilename('customers'),
            ['Customer ID', 'Company Name', 'Customer Number Ext', 'Payment Terms', 'Status', 'Tax ID'],
            page.items.map((row) => [
              row.customer_id,
              row.company_name,
              row.customer_number_ext,
              row.payment_terms,
              row.status,
              row.tax_id,
            ]),
          )
        }}
      />

      <div style={dashboardSectionStyle}>
        {isError ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
            <p>Error loading customers:</p>
            <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        ) : isLoading && customers.length === 0 ? (
          <div style={emptyStateWrapperStyle}>
            <p>Loading customers...</p>
          </div>
        ) : customers.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No customers found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <SortableTh label="Customer ID" columnKey="customer_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Company Name" columnKey="company_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Customer Number Ext" columnKey="customer_number_ext" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Payment Terms" columnKey="payment_terms" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCustomers.map((customer: Customer) => (
                    <tr key={customer.customer_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>{customer.customer_id}</td>
                      <td style={directoryTdStyle}>{customer.company_name}</td>
                      <td style={directoryTdStyle}>{customer.customer_number_ext || '-'}</td>
                      <td style={directoryTdStyle}>{customer.payment_terms || '-'}</td>
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
        )}

        <PaginationControls
          skip={skip}
          pageCount={customers.length}
          total={total}
          onPrevious={handlePreviousPage}
          onNext={handleNextPage}
        />
        {isFetching && !isLoading ? (
          <p style={{ ...pageSubStyle, marginTop: 8 }}>Updating results…</p>
        ) : null}
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

const pageSubStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  fontSize: '14px',
  color: 'var(--text)',
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
  backgroundColor: 'var(--social-bg)',
}

const directoryThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const directoryTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--divider)',
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
