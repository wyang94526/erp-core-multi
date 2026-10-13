/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Item Fulfillments list — Order-to-Cash shipping documents.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { fulfillmentService, salesOrderService, subcontractOrderService } from '../api/services'
import { isFullyInvoiced } from '../utils/soBilling'
import type { ItemFulfillment } from '../types'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import { formatPaginationLabel } from '../utils/pagination'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { PageHeader } from './PageHeader'
import {
  overScoReceiptMessage,
  subcontractReceivedBySoLine,
  validateFulfillmentAgainstOrder,
} from '../utils/fulfillmentQty'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'

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
  const [lineQtyDraft, setLineQtyDraft] = useState<Record<number, number>>({})
  const [lineLotDraft, setLineLotDraft] = useState<Record<number, string>>({})
  const [shippingDateDraft, setShippingDateDraft] = useState('')
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
  const { data: selectedScos = [] } = useQuery({
    queryKey: ['subcontractOrders', 'bySalesOrder', selected?.sales_order_id],
    queryFn: () => subcontractOrderService.listSubcontractOrders(0, 200, selected!.sales_order_id),
    enabled: Boolean(selected?.sales_order_id),
  })
  const selectedFullyInvoiced = Boolean(selectedOrder && isFullyInvoiced(selectedOrder))
  const invoiceActionBlocked = selectedOrderLoading || selectedFullyInvoiced
  const selectedLines = useMemo(() => {
    if (!selected) return []
    return selected.lines.map((line) => ({
      ...line,
      quantity_fulfilled: lineQtyDraft[line.sales_order_line_id] ?? line.quantity_fulfilled,
      lot_number: lineLotDraft[line.sales_order_line_id] ?? line.lot_number ?? '',
    }))
  }, [selected, lineQtyDraft, lineLotDraft])
  const overFulfillErrors = useMemo(() => {
    if (!selected || !selectedOrder || selected.status === 'SHIPPED') return []
    return validateFulfillmentAgainstOrder(selectedOrder, rows, selectedLines, {
      excludeFulfillmentId: selected.id,
    })
  }, [selected, selectedOrder, rows, selectedLines])
  const scoCaps = useMemo(
    () => (selectedOrder ? subcontractReceivedBySoLine(selectedOrder, selectedScos) : {}),
    [selectedOrder, selectedScos],
  )
  const overScoErrors = useMemo(() => {
    if (!selected || selected.status === 'SHIPPED') return []
    return selectedLines.flatMap((line) => {
      const cap = scoCaps[line.sales_order_line_id]
      if (!cap) return []
      if (Number(line.quantity_fulfilled) <= cap.received) return []
      return [
        {
          sales_order_line_id: line.sales_order_line_id,
          message: overScoReceiptMessage(cap.received, line.item_id, cap.scoNumbers),
        },
      ]
    })
  }, [selected, selectedLines, scoCaps])
  const overFulfillBanner = overFulfillErrors[0]?.message || overScoErrors[0]?.message
  const hasUnsavedQty = Object.keys(lineQtyDraft).length > 0
  const shipBlocked =
    Boolean(selected) &&
    (selectedOrderLoading ||
      !selectedOrder ||
      overFulfillErrors.length > 0 ||
      overScoErrors.length > 0 ||
      hasUnsavedQty)

  useEffect(() => {
    setLineQtyDraft({})
    setShippingDateDraft(localIsoDate(selected?.shipped_date))
  }, [selected?.id, selected?.shipped_date])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (values.status !== 'ALL' && r.status !== values.status) return false
      return matchesSearch(
        values.q,
        r.fulfillment_number,
        r.sales_order_id,
        r.customer_name,
        r.customer_id,
        r.carrier,
        r.status,
      )
    })
  }, [rows, values.status, values.q])

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

  const handleSaveQty = async (ful: ItemFulfillment) => {
    setBusy(true)
    try {
      const updated = await fulfillmentService.updateLines(
        ful.id,
        selectedLines.map((line) => ({
          sales_order_line_id: line.sales_order_line_id,
          quantity_fulfilled: Number(line.quantity_fulfilled),
          lot_number: String(line.lot_number || '').trim() || null,
        })),
      )
      setSelected(updated)
      setLineQtyDraft({})
      await queryClient.invalidateQueries({ queryKey: ['fulfillments'] })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update fulfillment quantity')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (ful: ItemFulfillment) => {
    if (ful.status !== 'DRAFT') return
    if (!window.confirm(`Delete draft fulfillment ${ful.fulfillment_number}? This cannot be undone.`)) {
      return
    }
    setBusy(true)
    try {
      await fulfillmentService.remove(ful.id)
      setSelected(null)
      await queryClient.invalidateQueries({ queryKey: ['fulfillments'] })
      await queryClient.invalidateQueries({ queryKey: ['salesOrders'] })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete fulfillment')
    } finally {
      setBusy(false)
    }
  }

  const advanceStatus = async (ful: ItemFulfillment, status: string) => {
    if (shipBlocked && status !== 'DRAFT') {
      window.alert(overFulfillBanner || 'Total fulfillment quantity cannot exceed the ordered quantity.')
      return
    }
    setBusy(true)
    try {
      const updated = await fulfillmentService.updateStatus(ful.id, {
        status,
        shipped_date: shippingDateDraft || null,
      })
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
      <PageHeader
        title="Item Fulfillments"
        subtitle="Ship approved sales order lines. Inventory and AR post on the shipping date."
      />

      <ListFilterBar
        fields={FILTERS}
        searchPlaceholder="Search fulfillment, sales order, customer…"
        exportCount={filtered.length}
        onExport={() =>
          downloadCsv(
            csvFilename('fulfillments'),
            ['Fulfillment #', 'Sales Order', 'Customer', 'Status', 'Shipped', 'Carrier'],
            filtered.map((row) => [
              row.fulfillment_number,
              row.sales_order_id,
              row.customer_name || row.customer_id,
              row.status,
              row.shipped_date,
              row.carrier,
            ]),
          )
        }
      />

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
            {selected.status === 'SHIPPED' ? (
              <p style={{ fontSize: 13, color: 'var(--text)' }}>
                Shipping Date:{' '}
                <strong>{selected.shipped_date ? selected.shipped_date.slice(0, 10) : '—'}</strong>
              </p>
            ) : (
              <label style={{ display: 'block', marginTop: 8, fontSize: 13, fontWeight: 700, color: 'var(--text-h)' }}>
                Shipping Date
                <input
                  type="date"
                  value={shippingDateDraft}
                  onChange={(event) => setShippingDateDraft(event.target.value)}
                  style={dateInputStyle}
                />
                <span style={{ display: 'block', marginTop: 4, fontWeight: 400, fontSize: 12, color: 'var(--text)' }}>
                  Inventory deduction and AR post on this date.
                </span>
              </label>
            )}

            <table style={{ ...tableStyle, marginTop: 16 }}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Item</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Ordered</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Received</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>This shipment</th>
                  <th style={thStyle}>Lot</th>
                </tr>
              </thead>
              <tbody>
                {selectedLines.map((line) => {
                  const ordered = selectedOrder?.items?.find(
                    (item) => item.so_item_id === line.sales_order_line_id,
                  )?.quantity_ordered
                  const received = scoCaps[line.sales_order_line_id]?.received
                  const lineError =
                    overFulfillErrors.find((err) => err.sales_order_line_id === line.sales_order_line_id) ||
                    overScoErrors.find((err) => err.sales_order_line_id === line.sales_order_line_id)
                  const canEditQty = selected.status === 'DRAFT'
                  return (
                    <tr key={line.id} style={tbodyRowStyle}>
                      <td style={tdStyle}>{line.item_id}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {ordered == null ? '—' : ordered}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {received == null ? '—' : received}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: 'right',
                          color: lineError ? '#c62828' : 'var(--text)',
                          fontWeight: lineError ? 700 : 400,
                        }}
                      >
                        {canEditQty ? (
                          <input
                            type="number"
                            min={1}
                            max={received != null && ordered != null ? Math.min(received, ordered) : ordered}
                            value={line.quantity_fulfilled}
                            disabled={busy}
                            onChange={(event) => {
                              const n = Math.max(0, Number(event.target.value) || 0)
                              setLineQtyDraft((prev) => ({
                                ...prev,
                                [line.sales_order_line_id]: n,
                              }))
                            }}
                            style={qtyInputStyle}
                          />
                        ) : (
                          line.quantity_fulfilled
                        )}
                      </td>
                      <td style={tdStyle}>
                        {selected.status === 'SHIPPED' ? (
                          line.lot_number || '—'
                        ) : (
                          <input
                            aria-label={`Lot for ${line.item_id}`}
                            value={line.lot_number || ''}
                            disabled={busy}
                            onChange={(event) =>
                              setLineLotDraft((prev) => ({
                                ...prev,
                                [line.sales_order_line_id]: event.target.value,
                              }))
                            }
                            style={qtyInputStyle}
                          />
                        )}
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
              {selected.status === 'DRAFT' && Object.keys(lineQtyDraft).length > 0 ? (
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,
                    ...(busy || overFulfillErrors.length > 0 || overScoErrors.length > 0
                      ? disabledPrimaryButtonStyle
                      : {}),
                  }}
                  disabled={busy || overFulfillErrors.length > 0 || overScoErrors.length > 0}
                  title={overFulfillBanner || 'Save this shipment quantity'}
                  onClick={() => void handleSaveQty(selected)}
                >
                  Save quantity
                </button>
              ) : null}
              {selected.status === 'DRAFT' ? (
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,
                    ...(busy || shipBlocked ? disabledPrimaryButtonStyle : {}),
                  }}
                  disabled={busy || shipBlocked}
                  title={
                    hasUnsavedQty
                      ? 'Save the shipment quantity first'
                      : overFulfillBanner || 'Mark this fulfillment as picked'
                  }
                  onClick={() => advanceStatus(selected, 'PICKED')}
                >
                  Mark Picked
                </button>
              ) : null}
              {selected.status === 'DRAFT' ? (
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,
                    backgroundColor: '#c62828',
                    ...(busy ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
                  }}
                  disabled={busy}
                  title="Delete this draft fulfillment"
                  onClick={() => void handleDelete(selected)}
                >
                  Delete
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
const qtyInputStyle: React.CSSProperties = {
  width: 88,
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 13,
  textAlign: 'right',
}
const dateInputStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 6,
  width: 180,
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 14,
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

function localIsoDate(value?: string | null): string {
  if (value && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

export default ItemFulfillmentList
