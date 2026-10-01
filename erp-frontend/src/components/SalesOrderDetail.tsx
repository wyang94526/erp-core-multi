/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * SalesOrderDetail Component
 * Displays full details of a single sales order including customer info, status, and line items
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Ban, Factory, FileDown, Loader2, Mail, Package, Pencil, Receipt } from 'lucide-react'
import {
  customerService,
  fulfillmentService,
  itemService,
  locationService,
  salesInvoiceService,
  salesOrderService,
  subcontractOrderService,
} from '../api/services'
import { generateSalesOrderPdf } from '../utils/generateSalesOrderPdf'
import {
  invoiceStatusColors,
  invoiceStatusLabel,
  isFullyInvoiced,
  salesOrderInvoiceStatus,
} from '../utils/soBilling'
import {
  isSalesOrderEditable,
  isSalesOrderRevisable,
  salesOrderEditPath,
  PARENT_SO_MUST_BE_APPROVED_FOR_SCO_MESSAGE,
  SALES_ORDER_LOCKED_EDIT_MESSAGE,
} from '../utils/salesOrders'
import { isSalesOrderFullyFulfilled, salesOrderQtyProgress } from '../utils/fulfillmentQty'
import { scoReceivedQty } from '../utils/scoReceive'
import { invoiceDetailHref } from '../utils/cashReference'
import {
  HoverTip,
  actionRowStyle,
  badgeStyle,
  dangerButtonStyle,
  disabledActionStyle,
  documentPageHeaderStyle,
  documentPageSubStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../utils/documentPageStyles'
import { useAuth } from '../context/AuthContext'

const money = (n: number | null | undefined, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n) || 0)
import { ApprovalPanel } from './ApprovalPanel'
import { DocumentAttachmentsPanel } from './DocumentAttachmentsPanel'
import { DocumentRevisionPanel } from './DocumentRevisionPanel'

export function SalesOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { hasPermission } = useAuth()
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [lockWarning, setLockWarning] = useState<string | null>(null)
  const [reviseError, setReviseError] = useState<string | null>(null)

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

  const { data: relatedScos = [] } = useQuery({
    queryKey: ['subcontractOrders', 'bySalesOrder', id],
    queryFn: () => subcontractOrderService.listSubcontractOrders(0, 200, id),
    enabled: Boolean(id),
  })

  const { data: salesInvoices = [] } = useQuery({
    queryKey: ['salesInvoices'],
    queryFn: () => salesInvoiceService.list(0, 200),
  })

  const { data: scoAvailability } = useQuery({
    queryKey: ['scoSalesOrderLines', id],
    queryFn: () => subcontractOrderService.listSalesOrderLines(id!),
    enabled: Boolean(id),
  })

  const { data: customer } = useQuery({
    queryKey: ['customers', order?.customer_id],
    queryFn: () => customerService.getCustomer(order!.customer_id),
    enabled: Boolean(order?.customer_id),
  })

  const closeRemainingMutation = useMutation({
    mutationFn: () => salesOrderService.closeRemaining(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['salesOrders'] })
      queryClient.invalidateQueries({ queryKey: ['fulfillments'] })
    },
    onError: (err: Error) => {
      setReviseError(err.message || 'Failed to cancel remaining quantity')
    },
  })

  const reviseMutation = useMutation({
    mutationFn: () => salesOrderService.reviseSalesOrder(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesOrders', id] })
      queryClient.invalidateQueries({ queryKey: ['salesOrders'] })
      queryClient.invalidateQueries({ queryKey: ['sales-orders', id, 'revisions'] })
      queryClient.invalidateQueries({ queryKey: ['sales-orders', id, 'change-logs'] })
      setReviseError(null)
      navigate(salesOrderEditPath(id!))
    },
    onError: (err: Error) => {
      setReviseError(err.message || 'Failed to create revision')
    },
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
  const orderStatus = (order.status || '').toUpperCase()
  const orderCancelled = orderStatus === 'CANCELLED'
  const orderFulfillments = fulfillments.filter((f) => f.sales_order_id === order.sales_order_id)
  const hasShippedFulfillment = orderFulfillments.some((f) => f.status === 'SHIPPED')
  const fullyInvoiced = isFullyInvoiced(order)
  const fullyFulfilled = isSalesOrderFullyFulfilled(order, fulfillments)
  const billingStatus = salesOrderInvoiceStatus(order)
  const billingColors = invoiceStatusColors(billingStatus)
  const qtyProgress = salesOrderQtyProgress(order, fulfillments)
  const billedInvoice = salesInvoices.find(
    (inv) =>
      inv.sales_order_id === order.sales_order_id &&
      (inv.status || '').toUpperCase() !== 'VOID',
  )
  const billedAmount = Number(order.billed_amount || 0)
  const billedLabel = `Billed ${order.currency} ${billedAmount.toFixed(2)}`
  const canCreateInvoice = isApproved && hasShippedFulfillment && !fullyInvoiced
  const canEditOrder = isSalesOrderEditable(order)

  const fulfillBlockedReason = !isApproved
    ? 'Order must be approved before fulfillment'
    : orderCancelled
      ? 'Cancelled orders cannot be fulfilled'
      : order.remaining_closed
        ? 'Remaining quantity was cancelled'
        : fullyFulfilled
        ? 'All items have been fulfilled'
        : fullyInvoiced
          ? 'This Sales Order has already been fully billed.'
          : null
  const canFulfillItems = !fulfillBlockedReason

  const scoBlockedReason = !isApproved
    ? PARENT_SO_MUST_BE_APPROVED_FOR_SCO_MESSAGE
    : scoAvailability && !scoAvailability.can_create
    ? scoAvailability.message ||
      'All subcontract quantities are already covered by existing subcontract orders.'
    : !scoAvailability && (fullyFulfilled || fullyInvoiced || orderCancelled)
      ? fullyFulfilled
        ? 'All items have been fulfilled'
        : fullyInvoiced
          ? 'This Sales Order has already been fully billed.'
          : 'Cancelled orders cannot be subcontracted'
      : null
  const canCreateSubcontract = !scoBlockedReason

  const requestEdit = () => {
    if (canEditOrder) {
      navigate(salesOrderEditPath(id!))
      return
    }
    setLockWarning(SALES_ORDER_LOCKED_EDIT_MESSAGE)
  }

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

  const handleEmailCustomer = async () => {
    const email = (order.buyer_contact_email || customer?.primary_email || '').trim()
    if (!email) {
      setExportError(
        'No customer email on file. Add a buyer contact email on the sales order or a primary email on the customer.',
      )
      return
    }
    await handlePrintPdf()
    const subject = encodeURIComponent(`Sales order ${order.sales_order_id} from Grand-Tek Technology USA`)
    const body = encodeURIComponent(
      [
        `Please find sales order ${order.sales_order_id} for ${money(order.total_amount, order.currency || 'USD')}.`,
        order.customer_po_number ? `Customer PO: ${order.customer_po_number}` : '',
        '',
        'The sales order PDF was downloaded so you can attach it to this email.',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank')
  }

  const requestRevision = () => {
    if (reviseMutation.isPending) return
    if (
      !window.confirm(
        `Create a revision of ${order.sales_order_id}? The order number stays the same. The current approved state is frozen, then you can edit and re-submit for approval.`,
      )
    ) {
      return
    }
    reviseMutation.mutate()
  }

  const approvalColors = getStatusColors((order.approval_status || 'DRAFT').toUpperCase())
  const canReviseOrder = isSalesOrderRevisable(order) && hasPermission('sales_order:submit')

  return (
    <div style={containerStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>{order.sales_order_id}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ ...badgeStyle, backgroundColor: statusColors.bg, color: statusColors.text }}>
              {order.status}
            </span>
            <span style={{ ...badgeStyle, backgroundColor: approvalColors.bg, color: approvalColors.text }}>
              {(order.approval_status || 'DRAFT').replace(/_/g, ' ')}
            </span>
            <span style={{ ...badgeStyle, backgroundColor: billingColors.bg, color: billingColors.text }}>
              {invoiceStatusLabel(billingStatus)}
            </span>
            {Number(order.revision_number || 0) > 0 ? (
              <span style={{ ...badgeStyle, backgroundColor: '#fff3e0', color: '#e65100' }}>
                Rev {order.revision_number}
              </span>
            ) : null}
            {order.remaining_closed ? (
              <span style={{ ...badgeStyle, backgroundColor: '#eceff1', color: '#455a64' }}>
                Remaining cancelled
              </span>
            ) : null}
          </div>
          <p style={documentPageSubStyle}>
            {order.customer_id}
            {customer?.company_name ? ` · ${customer.company_name}` : ''}
            {order.customer_po_number ? ` · PO ${order.customer_po_number}` : ''}
          </p>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            <HoverTip label="Download or print this sales order as a PDF">
              <button type="button" style={primaryButtonStyle} onClick={() => void handlePrintPdf()} disabled={exportingPdf}>
                {exportingPdf ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <FileDown size={15} />}
                PDF
              </button>
            </HoverTip>
            <HoverTip label="Email this sales order to the customer. The PDF downloads first so you can attach it.">
              <button type="button" style={secondaryButtonStyle} onClick={() => void handleEmailCustomer()}>
                <Mail size={15} />
                Email customer
              </button>
            </HoverTip>
            <HoverTip label={canEditOrder ? 'Edit this sales order' : SALES_ORDER_LOCKED_EDIT_MESSAGE}>
              <button
                type="button"
                style={{ ...secondaryButtonStyle, ...disabledActionStyle(canEditOrder) }}
                disabled={!canEditOrder}
                onClick={requestEdit}
              >
                <Pencil size={15} />
                Edit
              </button>
            </HoverTip>
            {canReviseOrder ? (
              <HoverTip label="Freeze the approved snapshot, then edit and re-submit for approval">
                <button type="button" style={secondaryButtonStyle} disabled={reviseMutation.isPending} onClick={requestRevision}>
                  {reviseMutation.isPending ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Pencil size={15} />}
                  {reviseMutation.isPending ? 'Opening…' : 'Create Revision'}
                </button>
              </HoverTip>
            ) : null}
            <HoverTip
              label={
                canFulfillItems
                  ? relatedScos.some((sco) => (sco.status || '').toUpperCase() === 'PARTIALLY_RECEIVED')
                    ? 'Create a partial fulfillment for received subcontract quantity'
                    : 'Create an item fulfillment for this order'
                  : fulfillBlockedReason || 'Fulfillment is not available'
              }
            >
              <button
                type="button"
                style={{ ...secondaryButtonStyle, ...disabledActionStyle(canFulfillItems) }}
                disabled={!canFulfillItems}
                onClick={() => navigate(`/sales-orders/${id}/fulfill`)}
              >
                <Package size={15} />
                Fulfill
              </button>
            </HoverTip>
            {order.can_close_remaining ? (
              <HoverTip label="Cancel leftover quantity after this partial shipment. Remaining quantity will not be fulfilled.">
                <button
                  type="button"
                  style={dangerButtonStyle}
                  disabled={closeRemainingMutation.isPending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Cancel the remaining unshipped quantity on ${order.sales_order_id}? Further fulfillment will be closed.`,
                      )
                    ) {
                      return
                    }
                    closeRemainingMutation.mutate()
                  }}
                >
                  <Ban size={15} />
                  {closeRemainingMutation.isPending ? 'Closing…' : 'Cancel remaining'}
                </button>
              </HoverTip>
            ) : null}
            <HoverTip
              label={
                fullyInvoiced
                  ? 'This sales order has already been fully billed.'
                  : canCreateInvoice
                    ? 'Create a sales invoice from shipped fulfillments'
                    : 'Ship a fulfillment before invoicing'
              }
            >
              <button
                type="button"
                style={{ ...secondaryButtonStyle, ...disabledActionStyle(canCreateInvoice) }}
                disabled={!canCreateInvoice}
                onClick={() => navigate(`/sales-orders/${id}/invoice`)}
              >
                <Receipt size={15} />
                Create Invoice
              </button>
            </HoverTip>
            <HoverTip
              label={
                canCreateSubcontract
                  ? 'Create a subcontract order from this sales order'
                  : scoBlockedReason || 'Subcontract is not available'
              }
            >
              <button
                type="button"
                style={{ ...secondaryButtonStyle, ...disabledActionStyle(canCreateSubcontract) }}
                disabled={!canCreateSubcontract}
                onClick={() =>
                  navigate(`/subcontract-orders/new?sales_order_id=${encodeURIComponent(order.sales_order_id)}`)
                }
              >
                <Factory size={15} />
                Create Subcontract
              </button>
            </HoverTip>
          </div>
          <div style={actionRowStyle}>
            <HoverTip label="Back to the sales order list">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/sales-orders')}>
                <ArrowLeft size={15} />
                Sales Orders
              </button>
            </HoverTip>
          </div>
        </div>
      </header>

      <ApprovalPanel
        module="sales-orders"
        documentId={order.sales_order_id}
        approvalStatus={order.approval_status}
        currentApprovalStep={order.current_approval_step}
        onStatusChange={() => {
          queryClient.invalidateQueries({ queryKey: ['salesOrders', id] })
          queryClient.invalidateQueries({ queryKey: ['salesOrders'] })
          queryClient.invalidateQueries({ queryKey: ['sales-orders', id, 'revisions'] })
          queryClient.invalidateQueries({ queryKey: ['sales-orders', id, 'change-logs'] })
        }}
      />

      {lockWarning && (
        <div style={lockWarningStyle} role="alert">
          {lockWarning}
        </div>
      )}
      {reviseError && (
        <div style={lockWarningStyle} role="alert">
          {reviseError}
        </div>
      )}
      {exportError && (
        <div style={lockWarningStyle} role="alert">
          {exportError}
        </div>
      )}

      <DocumentRevisionPanel
        kind="sales-orders"
        documentId={order.sales_order_id}
        revisionNumber={order.revision_number}
        listRevisions={salesOrderService.listRevisions}
        listChangeLogs={salesOrderService.listChangeLogs}
      />

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
            <label style={labelStyle}>Customer Revision Date</label>
            <p style={valueStyle}>
              {order.customer_revision_date
                ? new Date(order.customer_revision_date).toLocaleDateString()
                : '-'}
            </p>
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
          {order.remaining_closed ? (
            <>
              <div>
                <label style={labelStyle}>Shipped / Fulfilled Qty</label>
                <p style={valueStyle}>{qtyProgress.fulfilled}</p>
              </div>
              <div>
                <label style={labelStyle}>Cancelled Qty</label>
                <p style={valueStyle}>{qtyProgress.cancelled}</p>
              </div>
            </>
          ) : null}
          <div>
            <label style={labelStyle}>Billing</label>
            <p style={valueStyle}>
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  backgroundColor: billingColors.bg,
                  color: billingColors.text,
                }}
              >
                {invoiceStatusLabel(billingStatus)}
              </span>
              <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text)' }}>
                {billedInvoice && billedAmount > 0 ? (
                  <Link
                    to={invoiceDetailHref(billedInvoice.invoice_number)}
                    style={documentLinkStyle}
                    title={`Open invoice ${billedInvoice.invoice_number}`}
                  >
                    {billedLabel}
                  </Link>
                ) : (
                  billedLabel
                )}
                {' · remaining '}
                {Number(order.remaining_billable_amount ?? order.total_amount ?? 0).toFixed(2)}
              </span>
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
            <label style={labelStyle}>Freight Terms / Incoterms</label>
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
                  <th style={thStyle}>Customer P/N</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                  {order.remaining_closed ? (
                    <>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Shipped / Fulfilled</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cancelled</th>
                    </>
                  ) : null}
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
                    <td style={tdStyle}>{item.customer_part_number || '-'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{item.quantity_ordered}</td>
                    {order.remaining_closed ? (
                      <>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {qtyProgress.byLine[item.so_item_id]?.fulfilled ?? 0}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {qtyProgress.byLine[item.so_item_id]?.cancelled ?? 0}
                        </td>
                      </>
                    ) : null}
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

      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Subcontract Orders</h3>
        {relatedScos.length === 0 ? (
          <p style={{ color: 'var(--text)', fontStyle: 'italic', margin: 0 }}>
            No subcontract orders are linked to this sales order.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>SCO #</th>
                  <th style={thStyle}>Supplier</th>
                  <th style={thStyle}>Item</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Qty Ordered</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Qty Received</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Approval</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {relatedScos.map((sco) => {
                  const scoColors = getScoStatusColors(sco.status)
                  return (
                    <tr key={sco.sco_number} style={tbodyRowStyle}>
                      <td style={tdStyle}>
                        <Link
                          to={`/subcontract-orders/${encodeURIComponent(sco.sco_number)}`}
                          style={documentLinkStyle}
                        >
                          {sco.sco_number}
                        </Link>
                      </td>
                      <td style={tdStyle}>{sco.supplier_id}</td>
                      <td style={tdStyle}>
                        {sco.item_id}
                        {(sco.line_count || sco.lines?.length || 0) > 1
                          ? ` +${(sco.line_count || sco.lines?.length || 1) - 1}`
                          : ''}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{sco.quantity_ordered}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{scoReceivedQty(sco)}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 'bold',
                            backgroundColor: scoColors.bg,
                            color: scoColors.text,
                          }}
                        >
                          {sco.status}
                        </span>
                      </td>
                      <td style={tdStyle}>{(sco.approval_status || 'DRAFT').replace(/_/g, ' ')}</td>
                      <td style={tdStyle}>
                        <Link
                          to={`/subcontract-orders/${encodeURIComponent(sco.sco_number)}`}
                          style={documentLinkStyle}
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DocumentAttachmentsPanel documentType="SALES_ORDER" documentId={order.sales_order_id} />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {orderFulfillments.length > 0 ? (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text)' }}>
          {orderFulfillments.length} fulfillment(s)
          {fullyInvoiced
            ? ' · fully billed'
            : hasShippedFulfillment
              ? ' · ready to invoice'
              : ' · awaiting shipment'}{' '}
          —{' '}
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
    PENDING_APPROVAL: { bg: '#fff3e0', text: '#e65100' },
    REJECTED: { bg: '#ffebee', text: '#c62828' },
    RECEIVED: { bg: '#e8f5e9', text: '#2e7d32' },
    PENDING: { bg: '#fffde7', text: '#f9a825' },
    PROCESSING: { bg: '#e3f2fd', text: '#1565c0' },
    APPROVED: { bg: '#e8f5e9', text: '#2e7d32' },
    FULFILLED: { bg: '#fff3e0', text: '#e65100' },
    PARTIALLY_FULFILLED: { bg: '#ede7f6', text: '#5e35b1' },
    INVOICED: { bg: '#e3f2fd', text: '#1565c0' },
    SHIPPED: { bg: '#fff3e0', text: '#e65100' },
    DELIVERED: { bg: '#e8f5e9', text: '#1b5e20' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  }
  return statusColors[status] || { bg: '#f5f5f5', text: '#616161' }
}

function getScoStatusColors(status: string): { bg: string; text: string } {
  const statusColors: Record<string, { bg: string; text: string }> = {
    PLANNED: { bg: '#fffde7', text: '#f9a825' },
    PARTIALLY_ISSUED: { bg: '#fff3e0', text: '#e65100' },
    MATERIALS_ISSUED: { bg: '#e3f2fd', text: '#1565c0' },
    PARTIALLY_RECEIVED: { bg: '#ede7f6', text: '#5e35b1' },
    COMPLETED: { bg: '#e8f5e9', text: '#2e7d32' },
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

const documentLinkStyle: React.CSSProperties = {
  color: '#1565c0',
  textDecoration: 'none',
  fontWeight: 600,
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

const lockWarningStyle: React.CSSProperties = {
  marginBottom: 16,
  backgroundColor: '#fff8e1',
  color: '#e65100',
  border: '1px solid #ffe082',
  borderRadius: 6,
  padding: '12px 16px',
  fontSize: 14,
  fontWeight: 600,
}

export default SalesOrderDetail
