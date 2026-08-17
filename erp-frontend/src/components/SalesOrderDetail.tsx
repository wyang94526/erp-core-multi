/**
 * SalesOrderDetail Component
 * Displays full details of a single sales order including customer info, status, and line items
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { FileDown, Loader2 } from 'lucide-react'
import {
  customerService,
  fulfillmentService,
  itemService,
  locationService,
  salesOrderService,
} from '../api/services'
import { generateSalesOrderPdf } from '../utils/generateSalesOrderPdf'
import { ApprovalPanel } from './ApprovalPanel'
import { DocumentAttachmentsPanel } from './DocumentAttachmentsPanel'

export function SalesOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  if (!id) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error: No order ID provided</p>
        </div>
      </div>
    )
  }

  // Fetch the sales order
  const {
    data: order,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['salesOrders', id],
    queryFn: () => salesOrderService.getSalesOrder(id),
  })

  const { data: fulfillments = [] } = useQuery({
    queryKey: ['fulfillments'],
    queryFn: () => fulfillmentService.list(0, 200),
  })

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading order details...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error loading order:</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
          <button onClick={() => navigate('/sales-orders')} style={secondaryButtonStyle}>
            Back to Orders
          </button>
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p>Order not found</p>
          <button onClick={() => navigate('/sales-orders')} style={secondaryButtonStyle}>
            Back to Orders
          </button>
        </div>
      </div>
    )
  }

  const statusColors = getStatusColors(order.status)
  const isApproved = (order.approval_status || '').toUpperCase() === 'APPROVED'
  const orderFulfillments = fulfillments.filter((f) => f.sales_order_id === order.sales_order_id)
  const hasShippedFulfillment = orderFulfillments.some((f) => f.status === 'SHIPPED')
  const canFulfillItems = isApproved && order.status !== 'CANCELLED'
  const canCreateInvoice = isApproved && hasShippedFulfillment

  const handlePrintPdf = async () => {
    setExportError(null)
    setExportingPdf(true)
    try {
      const uniqueItemIds = [...new Set((order.items || []).map((item) => item.item_id).filter(Boolean))]
      const [customer, billTo, shipTo, catalogItems] = await Promise.all([
        order.customer_id
          ? customerService.getCustomer(order.customer_id).catch(() => null)
          : Promise.resolve(null),
        order.bill_to_location_id
          ? locationService.getLocation(order.bill_to_location_id).catch(() => null)
          : Promise.resolve(null),
        order.ship_to_location_id
          ? locationService.getLocation(order.ship_to_location_id).catch(() => null)
          : Promise.resolve(null),
        Promise.all(uniqueItemIds.map((itemId) => itemService.getItem(itemId).catch(() => null))),
      ])

      const itemDescriptions = Object.fromEntries(
        catalogItems
          .filter((item) => item != null)
          .map((item) => [item.item_id, item.description || item.customer_part_number || '']),
      )

      generateSalesOrderPdf({
        order,
        customerName: customer?.company_name ?? null,
        billTo,
        shipTo,
        itemDescriptions,
      })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to print sales order PDF')
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Sales Order Details</h2>
          <p style={pageSubStyle}>Viewing order {order.sales_order_id}</p>
        </div>
        <button onClick={() => navigate('/sales-orders')} style={secondaryButtonStyle}>
          Back to Orders
        </button>
      </header>

      <ApprovalPanel
        module="sales-orders"
        documentId={order.sales_order_id}
        approvalStatus={order.approval_status}
        currentApprovalStep={order.current_approval_step}
        onStatusChange={() => {
          queryClient.invalidateQueries({ queryKey: ['salesOrders', id] })
          queryClient.invalidateQueries({ queryKey: ['salesOrders'] })
        }}
      />

      {isApproved && (
        <div style={exportBarStyle}>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-h)', marginBottom: 4 }}>
              Print sales order
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              Download a printable PDF for the approved sales order.
            </div>
            {exportError && (
              <div style={{ marginTop: 8, color: '#c62828', fontSize: 13 }} role="alert">
                {exportError}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handlePrintPdf}
            disabled={exportingPdf}
            style={{
              ...exportButtonStyle,
              opacity: exportingPdf ? 0.75 : 1,
              cursor: exportingPdf ? 'not-allowed' : 'pointer',
            }}
          >
            {exportingPdf ? (
              <>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                Preparing PDF…
              </>
            ) : (
              <>
                <FileDown size={16} />
                Print PDF
              </>
            )}
          </button>
        </div>
      )}

      {/* Order Header Information */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Order Data</h3>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Sales Order ID</label>
            <p style={valueStyle}>{order.sales_order_id}</p>
          </div>
          <div>
            <label style={labelStyle}>Customer ID</label>
            <p style={valueStyle}>{order.customer_id}</p>
          </div>
          <div>
            <label style={labelStyle}>Order Date</label>
            <p style={valueStyle}>{new Date(order.order_date).toLocaleDateString()}</p>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <p style={valueStyle}>
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  backgroundColor: statusColors.bg,
                  color: statusColors.text,
                }}
              >
                {order.status}
              </span>
            </p>
          </div>
          <div>
            <label style={labelStyle}>Approval Status</label>
            <p style={valueStyle}>
              {(order.approval_status || 'DRAFT').replace(/_/g, ' ')}
            </p>
          </div>
          <div>
            <label style={labelStyle}>Customer PO Number</label>
            <p style={valueStyle}>{order.customer_po_number}</p>
          </div>
          <div>
            <label style={labelStyle}>PO Revision Number</label>
            <p style={valueStyle}>{order.po_revision_number}</p>
          </div>
          <div>
            <label style={labelStyle}>Currency</label>
            <p style={valueStyle}>{order.currency}</p>
          </div>
          <div>
            <label style={labelStyle}>Total Amount</label>
            <p style={{ ...valueStyle, fontWeight: 'bold', color: 'var(--accent)' }}>
              {order.currency} {Number(order.total_amount || 0).toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Location Information */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Location Information</h3>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Bill To Location ID</label>
            <p style={valueStyle}>{order.bill_to_location_id}</p>
          </div>
          <div>
            <label style={labelStyle}>Ship To Location ID</label>
            <p style={valueStyle}>{order.ship_to_location_id}</p>
          </div>
        </div>
      </div>

      {/* Additional Details */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Additional Details</h3>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Payment Terms</label>
            <p style={valueStyle}>{order.payment_terms || '-'}</p>
          </div>
          <div>
            <label style={labelStyle}>Freight Terms</label>
            <p style={valueStyle}>{order.freight_terms || '-'}</p>
          </div>
          <div>
            <label style={labelStyle}>Shipping Method</label>
            <p style={valueStyle}>{order.shipping_method || '-'}</p>
          </div>
          <div>
            <label style={labelStyle}>Buyer Contact Name</label>
            <p style={valueStyle}>{order.buyer_contact_name || '-'}</p>
          </div>
          <div>
            <label style={labelStyle}>Buyer Contact Email</label>
            <p style={valueStyle}>{order.buyer_contact_email || '-'}</p>
          </div>
          <div>
            <label style={labelStyle}>Created At</label>
            <p style={valueStyle}>
              {order.created_at ? new Date(order.created_at).toLocaleString() : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* Line Items Table */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Line Items</h3>
        {order.items && order.items.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Line #</th>
                  <th style={thStyle}>Product ID</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Unit Price</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Tax Amount</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.so_item_id} style={tbodyRowStyle}>
                    <td style={tdStyle}>{item.line_number}</td>
                    <td style={tdStyle}>{item.item_id}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{item.quantity_ordered}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {order.currency} {Number(item.unit_price).toFixed(4)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {order.currency} {Number(item.tax_amount).toFixed(2)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', color: 'var(--text-h)' }}>
                      {order.currency} {Number(item.total_amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: 'var(--text)', fontStyle: 'italic' }}>No line items found.</p>
        )}
      </div>

      <DocumentAttachmentsPanel documentType="SALES_ORDER" documentId={order.sales_order_id} />

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => navigate(`/sales-orders/${id}/fulfill`)}
          style={{
            ...primaryButtonStyle,
            backgroundColor: canFulfillItems ? '#2e7d32' : '#9e9e9e',
            cursor: canFulfillItems ? 'pointer' : 'not-allowed',
          }}
          disabled={!canFulfillItems}
          title={
            canFulfillItems
              ? 'Create an item fulfillment for this order'
              : 'Order must be approved before fulfillment'
          }
        >
          Fulfill Items
        </button>
        <button
          type="button"
          onClick={() => navigate(`/sales-orders/${id}/invoice`)}
          style={{
            ...primaryButtonStyle,
            backgroundColor: canCreateInvoice ? '#6a1b9a' : '#9e9e9e',
            cursor: canCreateInvoice ? 'pointer' : 'not-allowed',
          }}
          disabled={!canCreateInvoice}
          title={
            canCreateInvoice
              ? 'Create a sales invoice from shipped fulfillments'
              : 'Ship a fulfillment before invoicing'
          }
        >
          Create Invoice
        </button>
        <button
          onClick={() => navigate(`/orders/${id}/edit`)}
          style={primaryButtonStyle}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          Edit Order
        </button>
        <button onClick={() => navigate('/sales-orders')} style={secondaryButtonStyle}>
          Back to Orders
        </button>
      </div>
      {orderFulfillments.length > 0 ? (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text)' }}>
          {orderFulfillments.length} fulfillment(s)
          {hasShippedFulfillment ? ' · ready to invoice' : ' · awaiting shipment'} —{' '}
          <button
            type="button"
            style={{
              background: 'none',
              border: 'none',
              color: '#1565c0',
              cursor: 'pointer',
              fontWeight: 600,
              fontFamily: 'inherit',
              padding: 0,
            }}
            onClick={() => navigate('/fulfillments')}
          >
            View fulfillments
          </button>
        </p>
      ) : null}
    </div>
  )
}

// ==========================================
// HELPER FUNCTIONS & STYLES
// ==========================================

function getStatusColors(status: string): { bg: string; text: string } {
  const statusColors: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    RECEIVED: { bg: '#e8f5e9', text: '#2e7d32' },
    PENDING: { bg: '#fffde7', text: '#f9a825' },
    PROCESSING: { bg: '#e3f2fd', text: '#1565c0' },
    APPROVED: { bg: '#e8f5e9', text: '#2e7d32' },
    FULFILLED: { bg: '#fff3e0', text: '#e65100' },
    INVOICED: { bg: '#e3f2fd', text: '#1565c0' },
    SHIPPED: { bg: '#fff3e0', text: '#e65100' },
    DELIVERED: { bg: '#e8f5e9', text: '#1b5e20' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  }
  return statusColors[status] || { bg: '#f5f5f5', text: '#616161' }
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
}

const pageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const pageSubStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  fontSize: '14px',
  color: 'var(--text)',
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
}

const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  borderBottom: '2px solid var(--border)',
  paddingBottom: '8px',
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '20px',
}

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  marginBottom: '4px',
  display: 'block',
}

const valueStyle: React.CSSProperties = {
  color: 'var(--text)',
  margin: 0,
  fontSize: '14px',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const theadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
}

const thStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const tbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
  fontFamily: 'inherit',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

const exportBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  padding: '16px 18px',
  marginBottom: 16,
  borderRadius: 10,
  border: '1px solid rgba(147, 51, 234, 0.28)',
  background:
    'linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(255,255,255,0.95) 55%)',
  boxShadow: 'var(--shadow)',
}

const exportButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '11px 18px',
  backgroundColor: '#9333ea',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

export default SalesOrderDetail
