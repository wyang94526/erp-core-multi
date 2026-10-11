/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { productionOrderService } from '../api/services'
import {
  documentPageHeaderStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
} from '../utils/documentPageStyles'

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={metaRowStyle}>
      <dt style={labelStyle}>{label}</dt>
      <dd style={valueStyle}>{children}</dd>
    </div>
  )
}

export default function ProductionReceiptDetail() {
  const { orderId = '', receiptId = '' } = useParams()
  const navigate = useNavigate()
  const orderKey = decodeURIComponent(orderId)
  const receiptKey = decodeURIComponent(receiptId)

  const { data: order = null, isLoading, error } = useQuery({
    queryKey: ['productionOrders', orderKey],
    queryFn: () => productionOrderService.get(orderKey),
    enabled: Boolean(orderKey),
  })

  const receipt = (order?.receipts || []).find((row) => row.receipt_id === receiptKey) || null
  const orderHref = `/production-orders/${encodeURIComponent(orderKey)}`

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <p style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          Loading receipt…
        </p>
      </div>
    )
  }

  if (!order || !receipt) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>{error instanceof Error ? error.message : 'Production receipt not found'}</p>
          <button type="button" style={headerButtonStyle} onClick={() => navigate(order ? orderHref : '/production-orders')}>
            <ArrowLeft size={15} />
            {order ? orderKey : 'Production Orders'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>{receipt.receipt_id}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ ...badgeStyle, backgroundColor: receipt.posted_to_stock ? '#e8f5e9' : '#fff3e0', color: receipt.posted_to_stock ? '#2e7d32' : '#e65100' }}>
              {receipt.posted_to_stock ? 'Posted' : 'Pending stock'}
            </span>
          </div>
        </div>
        <div style={headerActionsStyle}>
          <button type="button" style={headerButtonStyle} onClick={() => navigate(orderHref)}>
            <ArrowLeft size={15} />
            {order.production_order_id}
          </button>
        </div>
      </header>

      <section style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Receipt</h2>
        <dl style={metaColumnStyle}>
          <MetaRow label="Production order">
            <Link to={orderHref} style={docLinkStyle}>{order.production_order_id}</Link>
          </MetaRow>
          <MetaRow label="Item">{order.item_id}</MetaRow>
          <MetaRow label="Quantity">{receipt.quantity_received}</MetaRow>
          <MetaRow label="Receipt date">{receipt.receipt_date ? new Date(receipt.receipt_date).toLocaleDateString() : '—'}</MetaRow>
          <MetaRow label="Warehouse">{order.warehouse_id || '—'}</MetaRow>
          <MetaRow label="Posted to stock">{receipt.posted_to_stock ? 'Yes' : 'No'}</MetaRow>
          <MetaRow label="Notes">{receipt.notes || '—'}</MetaRow>
        </dl>
      </section>
    </div>
  )
}

const containerStyle: CSSProperties = { padding: 24, maxWidth: 1200, margin: '0 auto', textAlign: 'left' }
const cardStyle: CSSProperties = {
  backgroundColor: 'var(--bg, #fff)',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
}
const sectionHeadingStyle: CSSProperties = { margin: '0 0 16px', fontSize: 18, fontWeight: 'bold', color: 'var(--text-h, #212121)' }
const metaColumnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }
const metaRowStyle: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 12, margin: 0 }
const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#757575',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  minWidth: 150,
  flexShrink: 0,
}
const valueStyle: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text, #424242)' }
const docLinkStyle: CSSProperties = { color: '#1565c0', fontWeight: 700, textDecoration: 'underline' }
const badgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 700,
}
