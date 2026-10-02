/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * VendorList Component
 * Displays a list of vendors/suppliers in a table format with pagination
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { vendorService } from '../api/services'
import type { Supplier } from '../types'
import { useEffect, useMemo, useState } from 'react'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { PaginationControls } from './PaginationControls'
import { Plus } from 'lucide-react'
import { primaryButtonStyle } from '../utils/documentPageStyles'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { PageHeader } from './PageHeader'

const VENDOR_FILTERS: FilterField[] = [
  {
    key: 'vendor_type',
    label: 'Type',
    options: [
      { value: 'ALL', label: 'All types' },
      { value: 'material', label: 'Material' },
      { value: 'subcontractor', label: 'Subcontractor' },
      { value: 'both', label: 'Both' },
      { value: 'service', label: 'Service' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'Active', label: 'Active' },
      { value: 'Inactive', label: 'Inactive' },
    ],
  },
]

export function VendorList() {
  const navigate = useNavigate()
  const [skip, setSkip] = useState(0)
  const limit = 10
  const { values } = useListFilterParams(VENDOR_FILTERS)

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['vendors', 'directory'],
    queryFn: () => vendorService.listVendorsPage(0, 500),
  })

  const vendors = data?.items ?? []
  const filteredVendors = useMemo(() => {
    return vendors.filter((vendor) => {
      if (values.vendor_type !== 'ALL' && (vendor.vendor_type || 'material') !== values.vendor_type) {
        return false
      }
      if (values.status !== 'ALL') {
        const active = vendor.status !== 'Inactive'
        if (values.status === 'Active' && !active) return false
        if (values.status === 'Inactive' && active) return false
      }
      return matchesSearch(
        values.q,
        vendor.supplier_id,
        vendor.company_name,
        vendor.vendor_number_ext,
        vendor.vendor_type,
        vendor.payment_terms,
        vendor.status,
      )
    })
  }, [vendors, values.q, values.vendor_type, values.status])

  useEffect(() => {
    setSkip(0)
  }, [values.q, values.vendor_type, values.status])

  const pageRows = filteredVendors.slice(skip, skip + limit)
  const total = filteredVendors.length

  const { items: sortedVendors, requestSort, sortConfig } = useSortableData(pageRows)

  const handlePreviousPage = () => {
    if (skip >= limit) {
      setSkip(skip - limit)
    }
  }

  const handleNextPage = () => {
    if (skip + limit < total) {
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

  const formatVendorType = (vendorType?: string | null) => {
    const labels: Record<string, string> = {
      material: 'Material',
      subcontractor: 'Subcontractor',
      both: 'Both',
      service: 'Service',
    }
    return labels[vendorType || 'material'] || vendorType || 'Material'
  }

  return (
    <div style={containerStyle}>
      <PageHeader title="Vendors" subtitle="View, create and manage your vendor / supplier accounts">
        <button type="button" onClick={() => navigate('/vendors/new')} style={primaryButtonStyle}>
          <Plus size={15} />
          Add Vendor
        </button>
      </PageHeader>

      <ListFilterBar
        fields={VENDOR_FILTERS}
        searchPlaceholder="Search vendor ID, name, terms…"
        exportCount={filteredVendors.length}
        onExport={() =>
          downloadCsv(
            csvFilename('vendors'),
            ['Vendor ID', 'Company Name', 'Vendor Type', 'Vendor Number Ext', 'Payment Terms', 'Status'],
            filteredVendors.map((vendor) => [
              vendor.supplier_id,
              vendor.company_name,
              formatVendorType(vendor.vendor_type),
              vendor.vendor_number_ext,
              vendor.payment_terms,
              vendor.status !== 'Inactive' ? 'Active' : 'Inactive',
            ]),
          )
        }
      />

      <div style={dashboardSectionStyle}>
        {filteredVendors.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No vendors found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <SortableTh label="Vendor ID" columnKey="supplier_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Company Name" columnKey="company_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Vendor Type" columnKey="vendor_type" sortConfig={sortConfig} onRequestSort={requestSort} />
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
                        <td style={directoryTdStyle}>{formatVendorType(vendor.vendor_type)}</td>
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
        )}

        <PaginationControls
          skip={skip}
          pageCount={vendors.length}
          total={total}
          onPrevious={handlePreviousPage}
          onNext={handleNextPage}
        />
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

export default VendorList
