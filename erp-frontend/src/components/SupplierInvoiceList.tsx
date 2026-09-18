/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Supplier Invoices / Vendor Bills list — Procure-to-Pay billing documents.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { vendorInvoiceService } from '../api/services'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { formatPaginationLabel } from '../utils/pagination'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { billDetailHref } from '../utils/cashReference'

const PAGE_SIZE = 10

const FILTERS: FilterField[] = [
  {
    key: 'status',
    label: 'Status',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'DRAFT', label: 'Draft' },
      { value: 'PENDING_APPROVAL', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'PAID', label: 'Paid' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ],
  },
  {
    key: 'source_type',
    label: 'Source',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'PURCHASE_ORDER', label: 'Purchase Order' },
      { value: 'SUBCONTRACT_ORDER', label: 'Subcontract' },
      { value: 'NON_PO', label: 'Non-PO' },
    ],
  },
]

function statusColors(status: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    PENDING_APPROVAL: { bg: '#fff3e0', text: '#e65100' },
    APPROVED: { bg: '#e3f2fd', text: '#1565c0' },
    PAID: { bg: '#e8f5e9', text: '#2e7d32' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  }
  return map[status] || { bg: '#f5f5f5', text: '#616161' }
}

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)

export function SupplierInvoiceList() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sourceOrderId = searchParams.get('source_order_id') || undefined
  const focusInvoice = (searchParams.get('invoice') || '').trim()
  const [skip, setSkip] = useState(0)
  const { values } = useListFilterParams(FILTERS)

  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['vendorInvoices', sourceOrderId],
    queryFn: () =>
      vendorInvoiceService.list({
        skip: 0,
        limit: 200,
        source_order_id: sourceOrderId,
      }),
  })

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (values.status !== 'ALL' && r.status !== values.status) return false
      if (values.source_type !== 'ALL' && r.source_type !== values.source_type) return false
      return true
    })
  }, [rows, values.status, values.source_type])

  useEffect(() => {
    setSkip(0)
  }, [values.status, values.source_type])

  const pageRows = filtered.slice(skip, skip + PAGE_SIZE)
  const { items: sorted, requestSort, sortConfig } = useSortableData(pageRows, {
    columnTypes: {
      invoice_date: 'date',
      due_date: 'date',
      total_amount: 'number',
      outstanding_balance: 'number',
    },
  })

  const sourceTag = (inv: { invoice_type?: string; source_type: string }) => {
    if (inv.invoice_type === 'EXPENSE') return 'EXPENSE'
    if (inv.invoice_type === 'LANDED_COST') return 'LANDED'
    if (inv.source_type === 'NON_PO') return 'NON-PO'
    if (inv.source_type === 'SUBCONTRACT_ORDER') return 'SCO'
    return 'PO'
  }

  if (focusInvoice) {
    return <Navigate to={billDetailHref(focusInvoice)} replace />
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Supplier Invoices / Bills</h2>
          <p style={pageSubStyle}>
            Vendor bills for purchase orders, subcontract orders, and Non-PO expenses
          </p>
        </div>
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={() => navigate('/supplier-invoices/new?category=non-po')}
        >
          Create Non-PO Invoice
        </button>
      </header>

      <ListFilterBar fields={FILTERS} />

      {isLoading ? (
        <div style={emptyStyle}>Loading supplier invoices...</div>
      ) : isError ? (
        <div style={{ ...emptyStyle, color: '#c62828' }}>
          {error instanceof Error ? error.message : 'Failed to load'}
        </div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>
          No supplier invoices yet. Receive goods on an approved PO/SCO to create a matched bill, or
          create a Non-PO invoice for freight, duty, rent, or utilities.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <SortableTh label="Bill #" columnKey="invoice_number" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Source" columnKey="source_type" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Order" columnKey="source_order_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Vendor" columnKey="vendor_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Due" columnKey="due_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Total" columnKey="total_amount" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Outstanding" columnKey="outstanding_balance" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Status" columnKey="status" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((inv) => {
                  const colors = statusColors(inv.status)
                  const focused = Boolean(focusInvoice) && inv.invoice_number === focusInvoice
                  const orderPath =
                    inv.source_type === 'SUBCONTRACT_ORDER'
                      ? `/subcontract-orders/${inv.source_order_id}`
                      : inv.source_type === 'PURCHASE_ORDER' && inv.source_order_id
                        ? `/purchase-orders/${inv.source_order_id}`
                        : null
                  return (
                    <tr
                      key={inv.id}
                      style={{
                        ...tbodyRowStyle,
                        backgroundColor: focused ? '#e3f2fd' : undefined,
                      }}
                    >
                      <td style={tdStyle}>
                        <Link to={billDetailHref(inv.invoice_number)} style={linkStyle} title="View bill details">
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td style={tdStyle}>
                        <span style={tagStyle}>{sourceTag(inv)}</span>
                      </td>
                      <td style={tdStyle}>
                        {orderPath && inv.source_order_id ? (
                          <Link to={orderPath} style={linkStyle}>
                            {inv.source_order_id}
                          </Link>
                        ) : (
                          inv.source_order_id || '—'
                        )}
                      </td>
                      <td style={tdStyle}>{inv.vendor_name || inv.vendor_id}</td>
                      <td style={tdStyle}>{new Date(inv.due_date).toLocaleDateString()}</td>
                      <td style={tdStyle}>{money(inv.total_amount)}</td>
                      <td style={tdStyle}>{money(inv.outstanding_balance)}</td>
                      <td style={tdStyle}>
                        <span style={{ ...badgeStyle, backgroundColor: colors.bg, color: colors.text }}>
                          {inv.status}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <Link to={billDetailHref(inv.invoice_number)} style={linkStyle} title="View bill details">
                          View
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={pagerStyle}>
            <button type="button" style={secondaryButtonStyle} disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}>
              Previous
            </button>
            <span style={{ color: 'var(--text)', fontSize: 13 }}>
              {formatPaginationLabel({
                skip,
                pageCount: pageRows.length,
                total: filtered.length,
              })}
            </span>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={skip + PAGE_SIZE >= filtered.length}
              onClick={() => setSkip(skip + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </>
      )}

    </div>
  )
}

const containerStyle: React.CSSProperties = { padding: 24, maxWidth: 1200, margin: '0 auto', textAlign: 'left' }
const pageHeaderStyle: React.CSSProperties = {
  marginBottom: 20,
  borderBottom: '1px solid var(--border)',
  paddingBottom: 16,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
}
const pageTitleStyle: React.CSSProperties = { margin: 0, fontSize: 28, fontWeight: 'bold', color: 'var(--text-h)' }
const pageSubStyle: React.CSSProperties = { margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }
const emptyStyle: React.CSSProperties = { padding: 30, textAlign: 'center', color: 'var(--text)' }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRowStyle: React.CSSProperties = { borderBottom: '2px solid var(--border)', backgroundColor: 'var(--social-bg)' }
const thStyle: React.CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const tbodyRowStyle: React.CSSProperties = { borderBottom: '1px solid var(--border)' }
const tdStyle: React.CSSProperties = { padding: '12px 10px', color: 'var(--text)' }
const badgeStyle: React.CSSProperties = { padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 'bold' }
const tagStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  background: '#eceff1',
  fontSize: 11,
  fontWeight: 700,
}
const linkStyle: React.CSSProperties = { color: '#1565c0', textDecoration: 'none', fontWeight: 600 }
const pagerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }
const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 'bold',
  fontFamily: 'inherit',
}
const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

export default SupplierInvoiceList
