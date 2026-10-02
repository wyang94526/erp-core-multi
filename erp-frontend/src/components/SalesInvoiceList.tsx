/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Sales Invoices list — Order-to-Cash billing documents.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { salesInvoiceService } from '../api/services'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { formatPaginationLabel } from '../utils/pagination'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { invoiceDetailHref } from '../utils/cashReference'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import { PageHeader } from './PageHeader'
import {
  matchesDeliveryDate,
  matchesRelativeDate,
  type DeliveryDateFilter,
  type RelativeDateFilter,
} from '../utils/listDateFilters'

const PAGE_SIZE = 10

const FILTERS: FilterField[] = [
  {
    key: 'issue_date',
    label: 'Issue date',
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
      { value: 'APPROVED', label: 'Approved' },
      { value: 'PAID', label: 'Paid' },
      { value: 'VOID', label: 'Void' },
    ],
  },
]

function statusColors(status: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    APPROVED: { bg: '#e3f2fd', text: '#1565c0' },
    PAID: { bg: '#e8f5e9', text: '#2e7d32' },
    VOID: { bg: '#ffebee', text: '#c62828' },
  }
  return map[status] || { bg: '#f5f5f5', text: '#616161' }
}

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)

export function SalesInvoiceList() {
  const [searchParams] = useSearchParams()
  const focusInvoice = (searchParams.get('invoice') || '').trim()
  const [skip, setSkip] = useState(0)
  const { values, hasActiveFilters } = useListFilterParams(FILTERS)
  const issueDateFilter = (values.issue_date || 'all') as RelativeDateFilter
  const dueFilter = (values.due || 'all') as DeliveryDateFilter

  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['salesInvoices'],
    queryFn: () => salesInvoiceService.list(0, 200),
  })

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (values.status !== 'ALL' && r.status !== values.status) return false
      if (!matchesRelativeDate(r.issue_date, issueDateFilter)) return false
      if (dueFilter === 'overdue') {
        if (r.status === 'PAID' || r.status === 'VOID') return false
        if (!matchesDeliveryDate(r.due_date, 'overdue')) return false
      } else if (!matchesDeliveryDate(r.due_date, dueFilter)) {
        return false
      }
      return matchesSearch(
        values.q,
        r.invoice_number,
        r.sales_order_id,
        r.customer_name,
        r.customer_id,
        r.ar_invoice_id,
        r.status,
      )
    })
  }, [rows, values.status, values.q, issueDateFilter, dueFilter])

  useEffect(() => {
    setSkip(0)
  }, [values.status, values.q, issueDateFilter, dueFilter])

  const pageRows = filtered.slice(skip, skip + PAGE_SIZE)
  const { items: sorted, requestSort, sortConfig } = useSortableData(pageRows, {
    columnTypes: {
      issue_date: 'date',
      due_date: 'date',
      total_amount: 'number',
      outstanding_balance: 'number',
    },
  })

  if (focusInvoice) {
    return <Navigate to={invoiceDetailHref(focusInvoice)} replace />
  }

  return (
    <div style={containerStyle}>
      <PageHeader
        title="Sales Invoices (Customer Invoicing)"
        subtitle="Bill fulfilled sales orders; approval posts AR / revenue to the general ledger"
      />

      <ListFilterBar
        fields={FILTERS}
        searchPlaceholder="Search invoice, sales order, customer…"
        exportCount={filtered.length}
        onExport={() =>
          downloadCsv(
            csvFilename('sales-invoices'),
            ['Invoice #', 'Sales Order', 'Customer', 'Issue', 'Due', 'Total', 'Outstanding', 'AR Invoice', 'Status'],
            filtered.map((inv) => [
              inv.invoice_number,
              inv.sales_order_id,
              inv.customer_name || inv.customer_id,
              inv.issue_date,
              inv.due_date,
              inv.total_amount,
              inv.outstanding_balance,
              inv.ar_invoice_id,
              inv.status,
            ]),
          )
        }
      />

      {isLoading ? (
        <div style={emptyStyle}>Loading sales invoices...</div>
      ) : isError ? (
        <div style={{ ...emptyStyle, color: '#c62828' }}>
          {error instanceof Error ? error.message : 'Failed to load'}
        </div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>
          {hasActiveFilters
            ? 'No sales invoices match the current filters.'
            : 'No sales invoices yet. After shipping a fulfillment, use Create Invoice on the sales order.'}
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <SortableTh label="Invoice #" columnKey="invoice_number" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Sales Order" columnKey="sales_order_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Customer" columnKey="customer_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Issue" columnKey="issue_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Due" columnKey="due_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Total" columnKey="total_amount" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Outstanding" columnKey="outstanding_balance" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="AR Invoice" columnKey="ar_invoice_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Status" columnKey="status" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((inv) => {
                  const colors = statusColors(inv.status)
                  return (
                    <tr key={inv.id} style={tbodyRowStyle}>
                      <td style={tdStyle}>
                        <Link to={invoiceDetailHref(inv.invoice_number)} style={linkStyle} title="Open invoice details">
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td style={tdStyle}>
                        <Link to={`/orders/${inv.sales_order_id}`} style={linkStyle}>
                          {inv.sales_order_id}
                        </Link>
                      </td>
                      <td style={tdStyle}>{inv.customer_name || inv.customer_id}</td>
                      <td style={tdStyle}>{new Date(inv.issue_date).toLocaleDateString()}</td>
                      <td style={tdStyle}>{new Date(inv.due_date).toLocaleDateString()}</td>
                      <td style={tdStyle}>{money(inv.total_amount)}</td>
                      <td style={tdStyle}>{money(inv.outstanding_balance)}</td>
                      <td style={tdStyle}>
                        {inv.ar_invoice_id ? (
                          <Link
                            to={`/accounts-receivable?invoice=${encodeURIComponent(inv.ar_invoice_id)}`}
                            style={linkStyle}
                            title="Open AR Aging & Collections"
                          >
                            {inv.ar_invoice_id}
                          </Link>
                        ) : (
                          <span style={{ color: 'var(--text)', fontStyle: 'italic' }}>
                            {inv.status === 'DRAFT' ? 'On approve' : '—'}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ ...badgeStyle, backgroundColor: colors.bg, color: colors.text }}>
                          {inv.status}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <Link to={invoiceDetailHref(inv.invoice_number)} style={linkButtonStyle}>
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
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={skip === 0}
              onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
            >
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

const containerStyle: React.CSSProperties = {
  padding: 24,
  maxWidth: 1200,
  margin: '0 auto',
  textAlign: 'left',
}
const emptyStyle: React.CSSProperties = { padding: 30, textAlign: 'center', color: 'var(--text)' }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRowStyle: React.CSSProperties = { backgroundColor: 'var(--social-bg)' }
const thStyle: React.CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const tbodyRowStyle: React.CSSProperties = { borderBottom: '1px solid var(--divider)' }
const tdStyle: React.CSSProperties = { padding: '12px 10px', color: 'var(--text)' }
const badgeStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 'bold',
}
const linkStyle: React.CSSProperties = { color: '#1565c0', textDecoration: 'none', fontWeight: 600 }
const linkButtonStyle: React.CSSProperties = {
  color: '#1565c0',
  textDecoration: 'none',
  fontWeight: 600,
}
const pagerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  marginTop: 16,
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

export default SalesInvoiceList
