/**
 * Create a supplier invoice (vendor bill) from a PO or Subcontract Order.
 * Routes: /supplier-invoices/new?source_type=&source_order_id=
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  purchaseOrderService,
  subcontractOrderService,
  vendorInvoiceService,
} from '../api/services'

export function SupplierInvoiceForm() {
  const [searchParams] = useSearchParams()
  const sourceType = (searchParams.get('source_type') || 'PURCHASE_ORDER') as
    | 'PURCHASE_ORDER'
    | 'SUBCONTRACT_ORDER'
  const sourceOrderId = searchParams.get('source_order_id') || ''
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [approveAfter, setApproveAfter] = useState(true)
  const [unitPriceOverride, setUnitPriceOverride] = useState('')

  const poQuery = useQuery({
    queryKey: ['purchaseOrders', sourceOrderId],
    queryFn: () => purchaseOrderService.getPurchaseOrder(sourceOrderId),
    enabled: sourceType === 'PURCHASE_ORDER' && Boolean(sourceOrderId),
  })

  const scoQuery = useQuery({
    queryKey: ['subcontractOrders', sourceOrderId],
    queryFn: () => subcontractOrderService.getSubcontractOrder(sourceOrderId),
    enabled: sourceType === 'SUBCONTRACT_ORDER' && Boolean(sourceOrderId),
  })

  const backPath =
    sourceType === 'SUBCONTRACT_ORDER'
      ? `/subcontract-orders/${sourceOrderId}`
      : `/purchase-orders/${sourceOrderId}`

  const mutation = useMutation({
    mutationFn: async () => {
      const lines =
        sourceType === 'SUBCONTRACT_ORDER' && unitPriceOverride
          ? [
              {
                item_id: scoQuery.data?.item_id,
                quantity_billed: Number(
                  (scoQuery.data?.finished_goods_receipts || []).reduce(
                    (s, r) => s + r.quantity_received,
                    0,
                  ),
                ),
                unit_price: Number(unitPriceOverride),
              },
            ]
          : null

      const created = await vendorInvoiceService.create({
        source_type: sourceType,
        source_order_id: sourceOrderId,
        vendor_invoice_number: vendorInvoiceNumber || null,
        invoice_date: invoiceDate || null,
        freight_amount:
          poQuery.data && (poQuery.data.freight_terms || 'PREPAID_ON_PO') !== 'PREPAID_ON_PO'
            ? 0
            : poQuery.data?.shipping_fee ?? null,
        tax_amount: poQuery.data?.total_tax ?? null,
        lines,
      })
      if (approveAfter) {
        return vendorInvoiceService.approve(created.id)
      }
      return created
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] })
      navigate('/supplier-invoices')
    },
  })

  if (!sourceOrderId) {
    return <div style={containerStyle}>Missing source_order_id</div>
  }

  const loading = poQuery.isLoading || scoQuery.isLoading
  const orderLabel = sourceType === 'SUBCONTRACT_ORDER' ? 'Subcontract Order' : 'Purchase Order'
  const vendorId =
    sourceType === 'SUBCONTRACT_ORDER' ? scoQuery.data?.supplier_id : poQuery.data?.supplier_id

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Create Supplier Invoice</h2>
          <p style={pageSubStyle}>
            {orderLabel} {sourceOrderId} · {vendorId || '…'}
          </p>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={() => navigate(backPath)}>
          Back to Order
        </button>
      </header>

      {loading ? (
        <div style={cardStyle}>Loading order…</div>
      ) : (
        <div style={cardStyle}>
          <p style={{ fontSize: 13, color: 'var(--text)' }}>
            Lines default to unbilled received quantities at order prices. Approval posts Debit GRNI /
            Credit Accounts Payable (with PPV for price variances).
          </p>

          <label style={labelStyle}>
            Vendor invoice number
            <input
              value={vendorInvoiceNumber}
              onChange={(e) => setVendorInvoiceNumber(e.target.value)}
              style={inputStyle}
              placeholder="Supplier's invoice #"
            />
          </label>

          <label style={{ ...labelStyle, marginTop: 16 }}>
            Invoice date
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              style={inputStyle}
            />
          </label>

          {sourceType === 'SUBCONTRACT_ORDER' ? (
            <label style={{ ...labelStyle, marginTop: 16 }}>
              Unit price override (required if SCO unit_price is 0)
              <input
                type="number"
                min={0}
                step="0.01"
                value={unitPriceOverride}
                onChange={(e) => setUnitPriceOverride(e.target.value)}
                style={inputStyle}
                placeholder={String(scoQuery.data?.unit_price ?? 0)}
              />
            </label>
          ) : null}

          <label style={{ ...labelStyle, marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={approveAfter}
              onChange={(e) => setApproveAfter(e.target.checked)}
            />
            Approve immediately (post GRNI → AP)
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
                  ? 'Create & Approve Bill'
                  : 'Create Draft Bill'}
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={() => navigate(backPath)}>
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
  width: '100%',
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

export default SupplierInvoiceForm
