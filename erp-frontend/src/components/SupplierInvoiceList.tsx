/**
 * Supplier Invoices / Vendor Bills list — Procure-to-Pay billing documents.
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { vendorInvoiceService } from '../api/services'
import type { SupplierInvoice } from '../types'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'

const PAGE_SIZE = 10

const FILTERS: FilterField[] = [
  {
    key: 'status',
    label: 'Status',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'DRAFT', label: 'Draft' },
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
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const sourceOrderId = searchParams.get('source_order_id') || undefined
  const [skip, setSkip] = useState(0)
  const [selected, setSelected] = useState<SupplierInvoice | null>(null)
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

  const approveMutation = useMutation({
    mutationFn: (id: number) => vendorInvoiceService.approve(id),
    onSuccess: async (inv) => {
      await queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] })
      setSelected(inv)
    },
    onError: (err) => alert(err instanceof Error ? err.message : 'Approve failed'),
  })

  const payMutation = useMutation({
    mutationFn: (id: number) => vendorInvoiceService.pay(id),
    onSuccess: async (inv) => {
      await queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] })
      setSelected(inv)
    },
    onError: (err) => alert(err instanceof Error ? err.message : 'Payment failed'),
  })

  const sourceTag = (t: string) => (t === 'SUBCONTRACT_ORDER' ? 'SCO' : 'PO')

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Supplier Invoices / Bills</h2>
          <p style={pageSubStyle}>
            Vendor bills for purchase and subcontract orders — approval posts GRNI → AP
          </p>
        </div>
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
          No supplier invoices yet. Receive goods on an approved PO/SCO, then Create Bill.
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
                  const orderPath =
                    inv.source_type === 'SUBCONTRACT_ORDER'
                      ? `/subcontract-orders/${inv.source_order_id}`
                      : `/purchase-orders/${inv.source_order_id}`
                  return (
                    <tr key={inv.id} style={tbodyRowStyle}>
                      <td style={tdStyle}>{inv.invoice_number}</td>
                      <td style={tdStyle}>
                        <span style={tagStyle}>{sourceTag(inv.source_type)}</span>
                      </td>
                      <td style={tdStyle}>
                        <Link to={orderPath} style={linkStyle}>
                          {inv.source_order_id}
                        </Link>
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
                        <button type="button" style={linkButtonStyle} onClick={() => setSelected(inv)}>
                          View
                        </button>
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
              {skip + 1}–{Math.min(skip + PAGE_SIZE, filtered.length)} of {filtered.length}
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

      {selected ? (
        <div style={drawerOverlayStyle} onClick={() => setSelected(null)}>
          <aside style={drawerStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: 'var(--text-h)' }}>{selected.invoice_number}</h3>
              <button type="button" style={secondaryButtonStyle} onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <p style={{ color: 'var(--text)', fontSize: 14 }}>
              {sourceTag(selected.source_type)} {selected.source_order_id} · {selected.vendor_name || selected.vendor_id}
            </p>
            {selected.match_warnings && selected.match_warnings.length > 0 ? (
              <div style={{ background: '#fff8e1', border: '1px solid #ffe082', padding: 10, borderRadius: 6, fontSize: 13 }}>
                <strong>3-way match warnings</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {selected.match_warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <table style={{ ...tableStyle, marginTop: 16 }}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Item</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {selected.lines.map((line) => (
                  <tr key={line.id} style={tbodyRowStyle}>
                    <td style={tdStyle}>{line.description || line.item_id}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{line.quantity_billed}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{money(line.unit_price)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{money(line.line_subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
              {selected.status === 'DRAFT' ? (
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={approveMutation.isPending}
                  onClick={() => approveMutation.mutate(selected.id)}
                >
                  Approve (post AP)
                </button>
              ) : null}
              {selected.status === 'APPROVED' ? (
                <button
                  type="button"
                  style={{ ...primaryButtonStyle, backgroundColor: '#2e7d32' }}
                  disabled={payMutation.isPending}
                  onClick={() => payMutation.mutate(selected.id)}
                >
                  Record Payment
                </button>
              ) : null}
              {selected.ap_bill_id ? (
                <button type="button" style={secondaryButtonStyle} onClick={() => navigate('/accounts-payable')}>
                  Open AP Bills
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

const containerStyle: React.CSSProperties = { padding: 24, maxWidth: 1200, margin: '0 auto', textAlign: 'left' }
const pageHeaderStyle: React.CSSProperties = { marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 16 }
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
const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#1565c0',
  cursor: 'pointer',
  fontWeight: 600,
  fontFamily: 'inherit',
  padding: 0,
}
const pagerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }
const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 16px',
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
const drawerOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  zIndex: 40,
  display: 'flex',
  justifyContent: 'flex-end',
}
const drawerStyle: React.CSSProperties = {
  width: 'min(480px, 100%)',
  background: 'var(--bg)',
  height: '100%',
  padding: 24,
  overflowY: 'auto',
  boxShadow: 'var(--shadow)',
}

export default SupplierInvoiceList
