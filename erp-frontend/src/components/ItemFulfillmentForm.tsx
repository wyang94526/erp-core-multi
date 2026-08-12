/**
 * Create an item fulfillment against an approved sales order.
 * Routes: /sales-orders/:id/fulfill , /orders/:id/fulfill
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { fulfillmentService, salesOrderService } from '../api/services'

type LineDraft = {
  sales_order_line_id: number
  item_id: string
  quantity_ordered: number
  already_fulfilled: number
  quantity_fulfilled: number
}

export function ItemFulfillmentForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
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

  const drafts: LineDraft[] = useMemo(() => {
    if (!order?.items) return []
    const already: Record<number, number> = {}
    for (const ful of fulfillments) {
      if (ful.sales_order_id !== order.sales_order_id) continue
      if (ful.status === 'DRAFT') continue
      for (const line of ful.lines) {
        already[line.sales_order_line_id] =
          (already[line.sales_order_line_id] || 0) + line.quantity_fulfilled
      }
    }
    return order.items.map((item) => {
      const done = already[item.so_item_id] || 0
      const remaining = Math.max(0, item.quantity_ordered - done)
      return {
        sales_order_line_id: item.so_item_id,
        item_id: item.item_id,
        quantity_ordered: item.quantity_ordered,
        already_fulfilled: done,
        quantity_fulfilled: lineQty[item.so_item_id] ?? remaining,
      }
    })
  }, [order, fulfillments, lineQty])

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
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Fulfill Items</h2>
          <p style={pageSubStyle}>
            Sales order {order.sales_order_id} · {order.customer_id}
          </p>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={() => navigate(`/orders/${id}`)}>
          Back to Order
        </button>
      </header>

      {!canFulfill ? (
        <div style={{ ...cardStyle, color: '#c62828' }}>
          This sales order must be APPROVED before fulfillment.
        </div>
      ) : remainingTotal === 0 ? (
        <div style={cardStyle}>All ordered quantities are already fulfilled (non-draft).</div>
      ) : (
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Quantities to fulfill</h3>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>Item</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Ordered</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Already fulfilled</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>This shipment</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => {
                const max = Math.max(0, d.quantity_ordered - d.already_fulfilled)
                return (
                  <tr key={d.sales_order_line_id} style={tbodyRowStyle}>
                    <td style={tdStyle}>{d.item_id}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{d.quantity_ordered}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{d.already_fulfilled}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="number"
                        min={0}
                        max={max}
                        value={d.quantity_fulfilled}
                        disabled={max === 0}
                        onChange={(e) => {
                          const n = Math.min(max, Math.max(0, Number(e.target.value) || 0))
                          setLineQty((prev) => ({ ...prev, [d.sales_order_line_id]: n }))
                        }}
                        style={inputStyle}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
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
            Ship immediately (deduct inventory and write stock movements)
          </label>

          {mutation.isError ? (
            <p style={{ color: '#c62828', marginTop: 12 }}>
              {mutation.error instanceof Error ? mutation.error.message : 'Create failed'}
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={mutation.isPending || drafts.every((d) => d.quantity_fulfilled <= 0)}
              onClick={() => mutation.mutate()}
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
const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 24,
  boxShadow: 'var(--shadow)',
}
const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 18,
  fontWeight: 'bold',
  color: 'var(--text-h)',
}
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRowStyle: React.CSSProperties = { borderBottom: '2px solid var(--border)', backgroundColor: 'var(--social-bg)' }
const thStyle: React.CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const tbodyRowStyle: React.CSSProperties = { borderBottom: '1px solid var(--border)' }
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

export default ItemFulfillmentForm
