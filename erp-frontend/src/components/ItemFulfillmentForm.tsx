/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Create an item fulfillment against an approved sales order.
 * Routes: /sales-orders/:id/fulfill , /orders/:id/fulfill
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { fulfillmentService, itemService, salesOrderService, subcontractOrderService } from '../api/services'
import { ArrowLeft } from 'lucide-react'
import { isStockItemType } from '../utils/itemTypes'
import { headerButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'
import {
  fulfilledQtyByLine,
  overFulfillmentMessage,
  overScoReceiptMessage,
  subcontractReceivedBySoLine,
} from '../utils/fulfillmentQty'

type LineDraft = {
  sales_order_line_id: number
  item_id: string
  quantity_ordered: number
  already_fulfilled: number
  quantity_received: number | null
  sco_numbers: string[]
  quantity_fulfilled: number
}

export function ItemFulfillmentForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [shippingDate, setShippingDate] = useState(localIsoDate())
  const [shipNow, setShipNow] = useState(false)
  const [lineQty, setLineQty] = useState<Record<number, number>>({})

  const { data: order, isLoading, isError, error } = useQuery({
    queryKey: ['salesOrders', id],
    queryFn: () => salesOrderService.getSalesOrder(id!),
    enabled: Boolean(id),
  })

  const { data: fulfillments = [] } = useQuery({
    queryKey: ['fulfillments'],
    queryFn: () => fulfillmentService.list(0, 200),
  })

  const { data: catalogItems = [] } = useQuery({
    queryKey: ['items', 'fulfillment-catalog'],
    queryFn: () => itemService.listItems(0, 1000),
  })

  const { data: subcontractOrders = [] } = useQuery({
    queryKey: ['subcontractOrders', 'bySalesOrder', id],
    queryFn: () => subcontractOrderService.listSubcontractOrders(0, 200, id),
    enabled: Boolean(id),
  })

  const drafts: LineDraft[] = useMemo(() => {
    if (!order?.items) return []
    const already = fulfilledQtyByLine(fulfillments, order.sales_order_id)
    const scoCaps = subcontractReceivedBySoLine(order, subcontractOrders)
    return order.items
      .filter((item) => {
        const catalog = catalogItems.find((row) => row.item_id === item.item_id)
        return isStockItemType(catalog?.item_type)
      })
      .map((item) => {
      const done = already[item.so_item_id] || 0
      const cap = scoCaps[item.so_item_id]
      const remainingOrdered = Math.max(0, item.quantity_ordered - done)
      const remainingReceived =
        cap != null ? Math.max(0, cap.received - done) : remainingOrdered
      const remaining = Math.min(remainingOrdered, remainingReceived)
      return {
        sales_order_line_id: item.so_item_id,
        item_id: item.item_id,
        quantity_ordered: item.quantity_ordered,
        already_fulfilled: done,
        quantity_received: cap != null ? cap.received : null,
        sco_numbers: cap?.scoNumbers || [],
        quantity_fulfilled: lineQty[item.so_item_id] ?? remaining,
      }
    })
  }, [order, fulfillments, lineQty, catalogItems, subcontractOrders])

  const lineErrors = useMemo(() => {
    const errors: Record<number, string> = {}
    for (const d of drafts) {
      const remainingOrdered = d.quantity_ordered - d.already_fulfilled
      if (d.quantity_fulfilled > remainingOrdered) {
        errors[d.sales_order_line_id] = overFulfillmentMessage(d.quantity_ordered, d.item_id)
      } else if (
        d.quantity_received != null &&
        d.quantity_fulfilled > Math.max(0, d.quantity_received - d.already_fulfilled)
      ) {
        errors[d.sales_order_line_id] = overScoReceiptMessage(
          d.quantity_received,
          d.item_id,
          d.sco_numbers,
        )
      }
    }
    return errors
  }, [drafts])
  const hasOverFulfill = Object.keys(lineErrors).length > 0
  const firstOverFulfillError = drafts.find((d) => lineErrors[d.sales_order_line_id])
  const overFulfillBanner = firstOverFulfillError
    ? lineErrors[firstOverFulfillError.sales_order_line_id]
    : null

  const mutation = useMutation({
    mutationFn: () => {
      const lines = drafts
        .filter((d) => d.quantity_fulfilled > 0)
        .map((d) => ({
          sales_order_line_id: d.sales_order_line_id,
          quantity_fulfilled: d.quantity_fulfilled,
        }))
      return fulfillmentService.create({
        sales_order_id: id!,
        carrier: carrier || null,
        tracking_number: tracking || null,
        status: shipNow ? 'SHIPPED' : 'DRAFT',
        shipped_date: shippingDate || null,
        lines,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fulfillments'] })
      await queryClient.invalidateQueries({ queryKey: ['salesOrders', id] })
      navigate('/fulfillments')
    },
  })

  if (!id) {
    return <div style={containerStyle}>Missing sales order id</div>
  }

  if (isLoading) {
    return <div style={containerStyle}>Loading sales order...</div>
  }

  if (isError || !order) {
    return (
      <div style={containerStyle}>
        <p style={{ color: '#c62828' }}>
          {error instanceof Error ? error.message : 'Sales order not found'}
        </p>
        <button type="button" style={secondaryButtonStyle} onClick={() => navigate(`/orders/${id}`)}>
          Back
        </button>
      </div>
    )
  }

  const canFulfill = (order.approval_status || '').toUpperCase() === 'APPROVED'
  const remainingTotal = drafts.reduce(
    (sum, d) => sum + Math.max(0, d.quantity_ordered - d.already_fulfilled),
    0,
  )

  return (
    <div style={containerStyle}>
      <PageHeader
        title="Fulfill Items"
        subtitle={`Sales order ${order.sales_order_id} · ${order.customer_id}. Partial shipments are allowed — subcontracted items default to finished-goods received so far.`}
      >
        <button type="button" style={headerButtonStyle} onClick={() => navigate(`/orders/${id}`)}>
          <ArrowLeft size={15} />
          Back to Order
        </button>
      </PageHeader>

      {!canFulfill ? (
        <div style={{ ...cardStyle, color: '#c62828' }}>
          This sales order must be APPROVED before fulfillment.
        </div>
      ) : remainingTotal === 0 ? (
        <div style={cardStyle}>
          {drafts.length === 0
            ? 'No inventory lines to fulfill. Service and non-inventory charges skip stock movement and can be invoiced from the sales order.'
            : 'All ordered quantities are already fulfilled.'}
        </div>
      ) : (
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Quantities to fulfill</h3>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>Item</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Ordered</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Received</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Already fulfilled</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>This shipment</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => {
                const remainingOrdered = Math.max(0, d.quantity_ordered - d.already_fulfilled)
                const remainingReceived =
                  d.quantity_received != null
                    ? Math.max(0, d.quantity_received - d.already_fulfilled)
                    : remainingOrdered
                const max = Math.min(remainingOrdered, remainingReceived)
                const error = lineErrors[d.sales_order_line_id]
                return (
                  <tr key={d.sales_order_line_id} style={tbodyRowStyle}>
                    <td style={tdStyle}>{d.item_id}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{d.quantity_ordered}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {d.quantity_received == null ? '—' : d.quantity_received}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{d.already_fulfilled}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="number"
                        min={0}
                        max={max}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `fulfill-qty-error-${d.sales_order_line_id}` : undefined}
                        value={d.quantity_fulfilled}
                        disabled={max === 0}
                        onChange={(e) => {
                          const n = Math.max(0, Number(e.target.value) || 0)
                          setLineQty((prev) => ({ ...prev, [d.sales_order_line_id]: n }))
                        }}
                        style={{
                          ...inputStyle,
                          borderColor: error ? '#c62828' : 'var(--border)',
                        }}
                      />
                      {error ? (
                        <div
                          id={`fulfill-qty-error-${d.sales_order_line_id}`}
                          style={inlineErrorStyle}
                        >
                          {error}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
            <label style={labelStyle}>
              Shipping Date
              <input
                type="date"
                value={shippingDate}
                onChange={(e) => setShippingDate(e.target.value)}
                style={{ ...inputStyle, width: '100%', textAlign: 'left' }}
              />
              <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text)' }}>
                Inventory deduction and AR post on this date.
              </span>
            </label>
            <label style={labelStyle}>
              Carrier
              <input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                style={{ ...inputStyle, width: '100%', textAlign: 'left' }}
                placeholder="Optional"
              />
            </label>
            <label style={labelStyle}>
              Tracking number
              <input
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                style={{ ...inputStyle, width: '100%', textAlign: 'left' }}
                placeholder="Optional"
              />
            </label>
          </div>

          <label style={{ ...labelStyle, marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={shipNow} onChange={(e) => setShipNow(e.target.checked)} />
            Ship immediately (deduct inventory on the shipping date)
          </label>

          {overFulfillBanner ? (
            <div role="alert" style={warningBannerStyle}>
              {overFulfillBanner}
            </div>
          ) : null}

          {mutation.isError ? (
            <p style={{ color: '#c62828', marginTop: 12 }}>
              {mutation.error instanceof Error ? mutation.error.message : 'Create failed'}
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button
              type="button"
              style={{
                ...primaryButtonStyle,
                ...(hasOverFulfill || mutation.isPending || drafts.every((d) => d.quantity_fulfilled <= 0)
                  ? disabledPrimaryButtonStyle
                  : {}),
              }}
              disabled={
                mutation.isPending ||
                hasOverFulfill ||
                drafts.every((d) => d.quantity_fulfilled <= 0)
              }
              title={
                hasOverFulfill
                  ? overFulfillBanner || undefined
                  : shipNow
                    ? 'Ship (deduct inventory)'
                    : 'Create fulfillment'
              }
              onClick={() => {
                if (hasOverFulfill) return
                mutation.mutate()
              }}
            >
              {mutation.isPending ? 'Saving…' : shipNow ? 'Create & Ship' : 'Create Fulfillment'}
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={() => navigate(`/orders/${id}`)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: 24,
  maxWidth: 960,
  margin: '0 auto',
  textAlign: 'left',
}
const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 24,
  boxShadow: 'var(--shadow)',
}
const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 18,
  fontWeight: 'bold',
  color: 'var(--text-h)',
}
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRowStyle: React.CSSProperties = { backgroundColor: 'var(--social-bg)' }
const thStyle: React.CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const tbodyRowStyle: React.CSSProperties = { borderBottom: '1px solid var(--divider)' }
const tdStyle: React.CSSProperties = { padding: '12px 10px', color: 'var(--text)' }
const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 'bold',
  color: 'var(--text-h)',
  display: 'block',
}
const inputStyle: React.CSSProperties = {
  marginTop: 6,
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 14,
  width: 100,
  textAlign: 'right',
  boxSizing: 'border-box',
}
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
  padding: '10px 18px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 14,
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
const inlineErrorStyle: React.CSSProperties = {
  marginTop: 6,
  color: '#c62828',
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'left',
  maxWidth: 260,
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

export default ItemFulfillmentForm
