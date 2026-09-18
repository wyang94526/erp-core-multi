/**
 * Item Fulfillments list — Order-to-Cash shipping documents.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { fulfillmentService, salesOrderService } from '../api/services'
import { isFullyInvoiced } from '../utils/soBilling'
import type { ItemFulfillment } from '../types'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { formatPaginationLabel } from '../utils/pagination'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { validateFulfillmentAgainstOrder } from '../utils/fulfillmentQty'

const PAGE_SIZE = 10

const FILTERS: FilterField[] = [
  {
    key: 'status',
    label: 'Status',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'DRAFT', label: 'Draft' },
      { value: 'PICKED', label: 'Picked' },
      { value: 'PACKED', label: 'Packed' },
      { value: 'SHIPPED', label: 'Shipped' },
    ],
  },
]

function statusColors(status: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    PICKED: { bg: '#e3f2fd', text: '#1565c0' },
    PACKED: { bg: '#fff3e0', text: '#e65100' },
    SHIPPED: { bg: '#e8f5e9', text: '#2e7d32' },
  }
  return map[status] || { bg: '#f5f5f5', text: '#616161' }
}

export function ItemFulfillmentList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [skip, setSkip] = useState(0)
  const [selected, setSelected] = useState<ItemFulfillment | null>(null)
  const [busy, setBusy] = useState(false)
  const { values } = useListFilterParams(FILTERS)

  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['fulfillments'],
    queryFn: () => fulfillmentService.list(0, 200),
  })

  const { data: selectedOrder, isLoading: selectedOrderLoading } = useQuery({
    queryKey: ['salesOrders', selected?.sales_order_id],
    queryFn: () => salesOrderService.getSalesOrder(selected!.sales_order_id),
    enabled: Boolean(selected?.sales_order_id),
  })
  const selectedFullyInvoiced = Boolean(selectedOrder && isFullyInvoiced(selectedOrder))
  const invoiceActionBlocked = selectedOrderLoading || selectedFullyInvoiced
  const overFulfillErrors = useMemo(() => {
    if (!selected || !selectedOrder || selected.status === 'SHIPPED') return []
    return validateFulfillmentAgainstOrder(selectedOrder, rows, selected.lines, {
      excludeFulfillmentId: selected.id,
    })
  }, [selected, selectedOrder, rows])
  const overFulfillBanner = overFulfillErrors[0]?.message
  const shipBlocked =
    Boolean(selected) &&
    (selectedOrderLoading || !selectedOrder || overFulfillErrors.length > 0)

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (values.status !== 'ALL' && r.status !== values.status) return false
      return true
    })
  }, [rows, values.status])

  useEffect(() => {
    setSkip(0)
  }, [values.status])

  const pageRows = filtered.slice(skip, skip + PAGE_SIZE)
  const { items: sorted, requestSort, sortConfig } = useSortableData(pageRows, {
    columnTypes: {
      created_at: 'date',
      shipped_date: 'date',
    },
  })

  const advanceStatus = async (ful: ItemFulfillment, status: string) => {
    if (shipBlocked && status !== 'DRAFT') {
      window.alert(overFulfillBanner || 'Total fulfillment quantity cannot exceed the ordered quantity.')
      return
    }
    setBusy(true)
    try {
      const updated = await fulfillmentService.updateStatus(ful.id, { status })
      await queryClient.invalidateQueries({ queryKey: ['fulfillments'] })
      setSelected(updated)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Item Fulfillments</h2>
          <p style={pageSubStyle}>Ship approved sales order lines and update inventory on shipment</p>
        </div>
      </header>

      <ListFilterBar fields={FILTERS} />

      {isLoading ? (
        <div style={emptyStyle}>Loading fulfillments...</div>
      ) : isError ? (
        <div style={{ ...emptyStyle, color: '#c62828' }}>
          {error instanceof Error ? error.message : 'Failed to load'}
        </div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>No fulfillments found. Open an approved sales order and choose Fulfill Items.</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <SortableTh label="Fulfillment #" columnKey="fulfillment_number" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Sales Order" columnKey="sales_order_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Customer" columnKey="customer_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Status" columnKey="status" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Shipped" columnKey="shipped_date" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Carrier" columnKey="carrier" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((ful) => {
                  const colors = statusColors(ful.status)
                  return (
                    <tr key={ful.id} style={tbodyRowStyle}>
                      <td style={tdStyle}>{ful.fulfillment_number}</td>
                      <td style={tdStyle}>
                        <Link to={`/orders/${ful.sales_order_id}`} style={linkStyle}>
                          {ful.sales_order_id}
                        </Link>
                      </td>
                      <td style={tdStyle}>{ful.customer_name || ful.customer_id}</td>
                      <td style={tdStyle}>
                        <span style={{ ...badgeStyle, backgroundColor: colors.bg, color: colors.text }}>
                          {ful.status}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {ful.shipped_date ? new Date(ful.shipped_date).toLocaleDateString() : '—'}
                      </td>
                      <td style={tdStyle}>{ful.carrier || '—'}</td>
                      <td style={tdStyle}>
                        <button type="button" style={linkButtonStyle} onClick={() => setSelected(ful)}>
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

      {selected ? (
        <div style={drawerOverlayStyle} onClick={() => setSelected(null)}>
          <aside style={drawerStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: 'var(--text-h)' }}>{selected.fulfillment_number}</h3>
              <button type="button" style={secondaryButtonStyle} onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <p style={{ color: 'var(--text)', fontSize: 14 }}>
              SO{' '}
              <Link to={`/orders/${selected.sales_order_id}`} style={linkStyle}>
                {selected.sales_order_id}
              </Link>
              {' · '}
              {selected.customer_name || selected.customer_id}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text)' }}>
              Status: <strong>{selected.status}</strong>
              {selected.tracking_number ? ` · Tracking ${selected.tracking_number}` : ''}
            </p>

            <table style={{ ...tableStyle, marginTop: 16 }}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Item</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Ordered</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>This shipment</th>
                </tr>
              </thead>
              <tbody>
                {selected.lines.map((line) => {
                  const ordered = selectedOrder?.items?.find(
                    (item) => item.so_item_id === line.sales_order_line_id,
                  )?.quantity_ordered
                  const lineError = overFulfillErrors.find(
                    (err) => err.sales_order_line_id === line.sales_order_line_id,
                  )
                  return (
                    <tr key={line.id} style={tbodyRowStyle}>
                      <td style={tdStyle}>{line.item_id}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {ordered == null ? '—' : ordered}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: 'right',
                          color: lineError ? '#c62828' : 'var(--text)',
                          fontWeight: lineError ? 700 : 400,
                        }}
                      >
                        {line.quantity_fulfilled}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {overFulfillBanner ? (
              <div role="alert" style={warningBannerStyle}>
                {overFulfillBanner}
              </div>
            ) : null}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
              {selected.status === 'DRAFT' ? (
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,
                    ...(busy || shipBlocked ? disabledPrimaryButtonStyle : {}),
                  }}
                  disabled={busy || shipBlocked}
                  title={overFulfillBanner || 'Mark this fulfillment as picked'}
                  onClick={() => advanceStatus(selected, 'PICKED')}
                >
                  Mark Picked
                </button>
              ) : null}
              {selected.status === 'PICKED' ? (
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,
                    ...(busy || shipBlocked ? disabledPrimaryButtonStyle : {}),
                  }}
                  disabled={busy || shipBlocked}
                  title={overFulfillBanner || 'Mark this fulfillment as packed'}
                  onClick={() => advanceStatus(selected, 'PACKED')}
                >
                  Mark Packed
                </button>
              ) : null}
              {selected.status === 'PACKED' || selected.status === 'PICKED' || selected.status === 'DRAFT' ? (
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,
                    backgroundColor: '#2e7d32',
                    ...(busy || shipBlocked ? disabledPrimaryButtonStyle : {}),
                  }}
                  disabled={busy || shipBlocked}
                  title={
                    overFulfillBanner || 'Ship (deduct inventory)'
                  }
                  onClick={() => advanceStatus(selected, 'SHIPPED')}
                >
                  Ship (deduct inventory)
                </button>
              ) : null}
              {selected.status === 'SHIPPED' ? (
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,
                    backgroundColor: invoiceActionBlocked ? '#9e9e9e' : '#1976d2',
                    cursor: invoiceActionBlocked ? 'not-allowed' : 'pointer',
                  }}
                  disabled={invoiceActionBlocked}
                  title={
                    selectedFullyInvoiced
                      ? 'This Sales Order has already been fully billed.'
                      : 'Create a sales invoice from this fulfillment'
                  }
                  onClick={() => {
                    if (invoiceActionBlocked) return
                    navigate(
                      `/sales-orders/${selected.sales_order_id}/invoice?fulfillment_id=${selected.id}`,
                    )
                  }}
                >
                  Create Invoice
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: 24,
  maxWidth: 1200,
  margin: '0 auto',
  textAlign: 'left',
}
const pageHeaderStyle: React.CSSProperties = {
  marginBottom: 20,
  borderBottom: '1px solid var(--border)',
  paddingBottom: 16,
}
const pageTitleStyle: React.CSSProperties = { margin: 0, fontSize: 28, fontWeight: 'bold', color: 'var(--text-h)' }
const pageSubStyle: React.CSSProperties = { margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }
const emptyStyle: React.CSSProperties = { padding: 30, textAlign: 'center', color: 'var(--text)' }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRowStyle: React.CSSProperties = { borderBottom: '2px solid var(--border)', backgroundColor: 'var(--social-bg)' }
const thStyle: React.CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const tbodyRowStyle: React.CSSProperties = { borderBottom: '1px solid var(--border)' }
const tdStyle: React.CSSProperties = { padding: '12px 10px', color: 'var(--text)' }
const badgeStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 'bold',
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
const pagerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  marginTop: 16,
}
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
const disabledPrimaryButtonStyle: React.CSSProperties = {
  backgroundColor: '#9e9e9e',
  cursor: 'not-allowed',
}
const warningBannerStyle: React.CSSProperties = {
  marginTop: 16,
  padding: '10px 12px',
  borderRadius: 6,
  backgroundColor: '#fdecea',
  border: '1px solid #ef9a9a',
  color: '#b71c1c',
  fontSize: 13,
  fontWeight: 600,
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
  width: 'min(440px, 100%)',
  background: 'var(--bg)',
  height: '100%',
  padding: 24,
  overflowY: 'auto',
  boxShadow: 'var(--shadow)',
}

export default ItemFulfillmentList
