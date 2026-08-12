/**
 * Create a sales invoice from a fulfilled sales order / fulfillment.
 * Routes: /sales-orders/:id/invoice , /orders/:id/invoice
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { fulfillmentService, salesInvoiceService, salesOrderService } from '../api/services'

export function SalesInvoiceForm() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const fulfillmentParam = searchParams.get('fulfillment_id')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [fulfillmentId, setFulfillmentId] = useState<string>(fulfillmentParam || '')
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [approveAfter, setApproveAfter] = useState(true)

  const { data: order, isLoading, isError, error } = useQuery({
    queryKey: ['salesOrders', id],
    queryFn: () => salesOrderService.getSalesOrder(id!),
    enabled: Boolean(id),
  })

  const { data: fulfillments = [] } = useQuery({
    queryKey: ['fulfillments'],
    queryFn: () => fulfillmentService.list(0, 200),
  })

  const shippedForOrder = useMemo(
    () =>
      fulfillments.filter(
        (f) => f.sales_order_id === id && f.status === 'SHIPPED',
      ),
    [fulfillments, id],
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await salesInvoiceService.create({
        sales_order_id: id!,
        fulfillment_id: fulfillmentId ? Number(fulfillmentId) : null,
        issue_date: issueDate || null,
        payment_terms: order?.payment_terms || null,
      })
      if (approveAfter) {
        return salesInvoiceService.approve(created.id)
      }
      return created
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['salesInvoices'] })
      await queryClient.invalidateQueries({ queryKey: ['salesOrders', id] })
      navigate('/sales-invoices')
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

  const canInvoice = shippedForOrder.length > 0

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Create Sales Invoice</h2>
          <p style={pageSubStyle}>
            Sales order {order.sales_order_id} · {order.customer_id}
          </p>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={() => navigate(`/orders/${id}`)}>
          Back to Order
        </button>
      </header>

      {!canInvoice ? (
        <div style={{ ...cardStyle, color: '#c62828' }}>
          Ship at least one item fulfillment before creating an invoice.
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={() => navigate(`/sales-orders/${id}/fulfill`)}
            >
              Fulfill Items
            </button>
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Invoice source</h3>
          <label style={labelStyle}>
            Fulfillment (optional — defaults to full order lines if blank)
            <select
              value={fulfillmentId}
              onChange={(e) => setFulfillmentId(e.target.value)}
              style={{ ...inputStyle, width: '100%', textAlign: 'left' }}
            >
              <option value="">All order lines</option>
              {shippedForOrder.map((f) => (
                <option key={f.id} value={String(f.id)}>
                  {f.fulfillment_number}
                  {f.shipped_date ? ` · shipped ${f.shipped_date}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label style={{ ...labelStyle, marginTop: 16 }}>
            Issue date
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              style={{ ...inputStyle, width: '100%', textAlign: 'left' }}
            />
          </label>

          <p style={{ fontSize: 13, color: 'var(--text)', marginTop: 12 }}>
            Payment terms: {order.payment_terms || 'Net 30'} · Currency: {order.currency}
          </p>

          <label style={{ ...labelStyle, marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={approveAfter}
              onChange={(e) => setApproveAfter(e.target.checked)}
            />
            Approve immediately (post Debit AR / Credit Revenue &amp; Tax to GL)
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
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? 'Saving…'
                : approveAfter
                  ? 'Create & Approve Invoice'
                  : 'Create Draft Invoice'}
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
  maxWidth: 720,
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

export default SalesInvoiceForm
