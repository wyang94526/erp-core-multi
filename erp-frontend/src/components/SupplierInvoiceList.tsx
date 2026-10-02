/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Supplier Invoices / Vendor Bills list — Procure-to-Pay billing documents.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { vendorInvoiceService } from '../api/services'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { formatPaginationLabel } from '../utils/pagination'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { billDetailHref, billEditHref, sourceOrderHref } from '../utils/cashReference'
import { Plus } from 'lucide-react'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import { primaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'
import {
  matchesDeliveryDate,
  matchesRelativeDate,
  type DeliveryDateFilter,
  type RelativeDateFilter,
} from '../utils/listDateFilters'

function isNonPoInvoice(inv: { invoice_type?: string | null; source_type?: string | null }): boolean {
  const kind = (inv.invoice_type || '').toUpperCase()
  return kind === 'EXPENSE' || kind === 'LANDED_COST' || (inv.source_type || '').toUpperCase() === 'NON_PO'
}

const PAGE_SIZE = 10

const FILTERS: FilterField[] = [
  {
    key: 'invoice_date',
    label: 'Bill date',
    allValue: 'all',
    options: [
      { value: 'all', label: 'All' },
      { value: 'this_month', label: 'This month' },
      { value: 'last_quarter', label: 'Last quarter' },
      { value: 'ytd', label: 'YTD' },
    ],
  },
  {
    key: 'due',
    label: 'Due date',
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
      { value: 'DRAFT', label: 'Draft' },
      { value: 'PENDING_APPROVAL', label: 'Pending' },
      { value: 'REJECTED', label: 'Returned' },
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
    REJECTED: { bg: '#ffebee', text: '#c62828' },
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
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const sourceOrderId = searchParams.get('source_order_id') || undefined
  const focusInvoice = (searchParams.get('invoice') || '').trim()
  const [skip, setSkip] = useState(0)
  const [returningId, setReturningId] = useState<number | null>(null)
  const { values, hasActiveFilters } = useListFilterParams(FILTERS)
  const invoiceDateFilter = (values.invoice_date || 'all') as RelativeDateFilter
  const dueFilter = (values.due || 'all') as DeliveryDateFilter

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
      if (!matchesRelativeDate(r.invoice_date, invoiceDateFilter)) return false
      if (dueFilter === 'overdue') {
        if (r.status === 'PAID' || r.status === 'CANCELLED') return false
        if (!matchesDeliveryDate(r.due_date, 'overdue')) return false
      } else if (!matchesDeliveryDate(r.due_date, dueFilter)) {
        return false
      }
      return matchesSearch(
        values.q,
        r.invoice_number,
        r.source_order_id,
        r.reference_po_number,
        r.vendor_name,
        r.vendor_id,
        r.status,
        r.source_type,
        r.invoice_type,
        r.vendor_invoice_number,
      )
    })
  }, [rows, values.status, values.source_type, values.q, invoiceDateFilter, dueFilter])

  useEffect(() => {
    setSkip(0)
  }, [values.status, values.source_type, values.q, invoiceDateFilter, dueFilter])

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
      <PageHeader
        title="Supplier Invoices / Bills"
        subtitle="Vendor bills for purchase orders, subcontract orders, and Non-PO expenses"
      >
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={() => navigate('/supplier-invoices/new?category=non-po')}
        >
          <Plus size={15} />
          Create Non-PO Invoice
        </button>
      </PageHeader>

      <ListFilterBar
        fields={FILTERS}
        searchPlaceholder="Search bill, order, vendor…"
        exportCount={filtered.length}
        onExport={() =>
          downloadCsv(
            csvFilename('supplier-invoices'),
            ['Bill #', 'Source', 'Order', 'Vendor', 'Bill Date', 'Due', 'Total', 'Outstanding', 'Status'],
            filtered.map((inv) => [
              inv.invoice_number,
              inv.source_type,
              inv.source_order_id,
              inv.vendor_name || inv.vendor_id,
              inv.invoice_date,
              inv.due_date,
              inv.total_amount,
              inv.outstanding_balance,
              inv.status,
            ]),
          )
        }
      />

      {isLoading ? (
        <div style={emptyStyle}>Loading supplier invoices...</div>
      ) : isError ? (
        <div style={{ ...emptyStyle, color: '#c62828' }}>
          {error instanceof Error ? error.message : 'Failed to load'}
        </div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>
          {hasActiveFilters
            ? 'No supplier invoices match the current filters.'
            : 'No supplier invoices yet. Receive goods on an approved PO/SCO to create a matched bill, or create a Non-PO invoice for freight, duty, rent, or utilities.'}
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
                  const orderId = inv.reference_po_number || inv.source_order_id
                  const orderPath = sourceOrderHref(inv.source_type, orderId)
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
                        {orderPath && orderId ? (
                          <Link to={orderPath} style={linkStyle} title="Open referenced purchase order">
                            {orderId}
                          </Link>
                        ) : (
                          orderId || '—'
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
                        <div style={actionCellStyle}>
                          <Link to={billDetailHref(inv.invoice_number)} style={linkStyle} title="View bill details">
                            View
                          </Link>
                          {isNonPoInvoice(inv) &&
                          (inv.status === 'DRAFT' ||
                            inv.status === 'REJECTED' ||
                            inv.status === 'PENDING_APPROVAL') ? (
                            <Link
                              to={billEditHref(inv.invoice_number)}
                              style={linkStyle}
                              title="Edit this Non-PO invoice"
                            >
                              Edit
                            </Link>
                          ) : null}
                          {isNonPoInvoice(inv) && inv.status === 'APPROVED' ? (
                            <button
                              type="button"
                              style={returnLinkStyle}
                              disabled={returningId === inv.id}
                              onClick={async () => {
                                if (
                                  !window.confirm(
                                    `Rescind approval for ${inv.invoice_number}? The AP posting will be reversed so it can be edited.`,
                                  )
                                ) {
                                  return
                                }
                                setReturningId(inv.id)
                                try {
                                  await vendorInvoiceService.rescind(inv.id)
                                  await queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] })
                                } catch (err) {
                                  window.alert(err instanceof Error ? err.message : 'Rescind failed')
                                } finally {
                                  setReturningId(null)
                                }
                              }}
                            >
                              {returningId === inv.id ? 'Rescinding…' : 'Rescind'}
                            </button>
                          ) : null}
                          {isNonPoInvoice(inv) && inv.status === 'PENDING_APPROVAL' ? (
                            <button
                              type="button"
                              style={returnLinkStyle}
                              disabled={returningId === inv.id}
                              onClick={async () => {
                                if (
                                  !window.confirm(
                                    `Return ${inv.invoice_number} to the requester so they can edit and resubmit?`,
                                  )
                                ) {
                                  return
                                }
                                setReturningId(inv.id)
                                try {
                                  await vendorInvoiceService.reject(inv.id)
                                  await queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] })
                                } catch (err) {
                                  window.alert(err instanceof Error ? err.message : 'Return failed')
                                } finally {
                                  setReturningId(null)
                                }
                              }}
                            >
                              {returningId === inv.id ? 'Returning…' : 'Return'}
                            </button>
                          ) : null}
                        </div>
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
const emptyStyle: React.CSSProperties = { padding: 30, textAlign: 'center', color: 'var(--text)' }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRowStyle: React.CSSProperties = { backgroundColor: 'var(--social-bg)' }
const thStyle: React.CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const tbodyRowStyle: React.CSSProperties = { borderBottom: '1px solid var(--divider)' }
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
const linkStyle: React.CSSProperties = { color: '#1565c0', textDecoration: 'underline', fontWeight: 600 }
const actionCellStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }
const returnLinkStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#c62828',
  textDecoration: 'underline',
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
  fontSize: 13,
}
const pagerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }
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
