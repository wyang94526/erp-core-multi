/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileDown, Loader2, Mail, Receipt, CheckCircle2, Ban } from 'lucide-react'
import {
  arInvoiceService,
  customerService,
  locationService,
  salesInvoiceService,
  salesOrderService,
} from '../api/services'
import type { ARInvoiceDetail } from '../types'
import { generateSalesInvoicePdf } from '../utils/generateSalesInvoicePdf'
import { loadCompanyPdfBranding } from '../utils/pdfLetterhead'
import { cashReferenceLinkStyle } from '../utils/cashReference'
import {
  HoverTip,
  actionRowStyle,
  badgeStyle,
  dangerButtonStyle,
  documentPageHeaderStyle,
  documentPageSubStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../utils/documentPageStyles'

const money = (n: number | null | undefined, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n) || 0)

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

function statusColors(status: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    Paid: { bg: '#e8f5e9', text: '#2e7d32' },
    Open: { bg: '#e3f2fd', text: '#1565c0' },
    Unpaid: { bg: '#ffebee', text: '#c62828' },
    Overdue: { bg: '#ffebee', text: '#c62828' },
    Partial: { bg: '#fff3e0', text: '#e65100' },
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    APPROVED: { bg: '#e3f2fd', text: '#1565c0' },
    VOID: { bg: '#ffebee', text: '#c62828' },
  }
  return map[status] || { bg: '#f5f5f5', text: '#616161' }
}

function creditMemoTooltip(detail: ARInvoiceDetail): string {
  if (detail.can_create_credit_memo) {
    return 'Create a credit memo to reverse remaining AR on this invoice'
  }
  const paid = (detail.display_status || detail.status) === 'Paid' || detail.status === 'Paid'
  if (paid) {
    return 'Credit memo is unavailable because this invoice is already paid'
  }
  return detail.credit_memo_reason || 'Credit memo is not available for this invoice'
}

export function InvoiceDetail() {
  const { invoiceId: rawId } = useParams<{ invoiceId: string }>()
  const invoiceId = decodeURIComponent(rawId || '').trim()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<ARInvoiceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [crediting, setCrediting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const load = async () => {
    if (!invoiceId) return
    setLoading(true)
    setError(null)
    try {
      setDetail(await arInvoiceService.getInvoiceDetail(invoiceId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoice')
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [invoiceId])

  const currency = detail?.currency || 'USD'
  const collectionBadge = statusColors(detail?.display_status || detail?.status || '')
  const approvalBadge = statusColors(detail?.approval_status || '')
  const siStatus = (detail?.sales_invoice_status || '').toUpperCase()

  const exportInvoicePdf = async (invoice: ARInvoiceDetail) => {
    const order = invoice.sales_order_id
      ? await salesOrderService.getSalesOrder(invoice.sales_order_id).catch(() => null)
      : null
    const [customer, billTo, shipTo, branding] = await Promise.all([
      invoice.customer_id
        ? customerService.getCustomer(invoice.customer_id).catch(() => null)
        : Promise.resolve(null),
      order?.bill_to_location_id
        ? locationService.getLocation(order.bill_to_location_id).catch(() => null)
        : Promise.resolve(null),
      order?.ship_to_location_id
        ? locationService.getLocation(order.ship_to_location_id).catch(() => null)
        : Promise.resolve(null),
      loadCompanyPdfBranding().catch(() => null),
    ])
    generateSalesInvoicePdf({
      detail: invoice,
      branding,
      customerName: customer?.company_name ?? invoice.customer_name,
      customerEmail: customer?.primary_email ?? invoice.customer_email,
      customerPhone: customer?.primary_phone ?? null,
      customerContact: customer?.primary_contact_name ?? null,
      billTo,
      shipTo,
    })
  }

  const handlePrint = async () => {
    if (!detail) return
    setPrinting(true)
    setError(null)
    try {
      await exportInvoicePdf(detail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to print invoice PDF')
    } finally {
      setPrinting(false)
    }
  }

  const handleResend = async () => {
    if (!detail) return
    const email = (detail.customer_email || '').trim()
    if (!email) {
      setError('No customer email on file. Add a primary email on the customer or buyer contact on the sales order.')
      return
    }
    await exportInvoicePdf(detail)
    const subject = encodeURIComponent(`Invoice ${detail.invoice_id} from Grand-Tek Technology USA`)
    const body = encodeURIComponent(
      [
        `Please find invoice ${detail.invoice_id} for ${money(detail.total_amount ?? detail.amount, currency)}.`,
        `Sales order: ${detail.sales_order_id}`,
        `Due: ${formatDate(detail.due_date)}`,
        '',
        'The invoice PDF was downloaded so you can attach it to this email.',
      ].join('\n'),
    )
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank')
  }

  const handleCreditMemo = async () => {
    if (!detail?.can_create_credit_memo) return
    if (
      !confirm(
        `Create a credit memo for ${detail.invoice_id}? This reverses remaining AR/revenue because another invoice exists for ${detail.sales_order_id}.`,
      )
    ) {
      return
    }
    setCrediting(true)
    setError(null)
    try {
      setDetail(await arInvoiceService.createCreditMemo(detail.invoice_id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credit memo failed')
    } finally {
      setCrediting(false)
    }
  }

  const handleApprove = async () => {
    if (!detail?.sales_invoice_id) return
    setApproving(true)
    setError(null)
    try {
      await salesInvoiceService.approve(detail.sales_invoice_id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setApproving(false)
    }
  }

  const handleVoid = async () => {
    if (!detail?.sales_invoice_id) return
    if (!confirm(`Void sales invoice ${detail.invoice_id}?`)) return
    setVoiding(true)
    setError(null)
    try {
      await salesInvoiceService.void(detail.sales_invoice_id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Void failed')
    } finally {
      setVoiding(false)
    }
  }

  if (!invoiceId) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>No invoice ID provided.</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStyle}>Loading invoice…</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>{error || 'Invoice not found'}</p>
          <button type="button" style={headerButtonStyle} onClick={() => navigate('/sales-invoices')}>
            Back to Sales Invoices
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>{detail.invoice_id}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ ...badgeStyle, backgroundColor: collectionBadge.bg, color: collectionBadge.text }}>
              {detail.display_status || detail.status}
            </span>
            <span style={{ ...badgeStyle, backgroundColor: approvalBadge.bg, color: approvalBadge.text }}>
              {(detail.approval_status || 'DRAFT').replace(/_/g, ' ')}
            </span>
            {siStatus ? (
              <span style={{ ...badgeStyle, backgroundColor: '#f5f5f5', color: '#616161' }}>
                Sales invoice {siStatus}
              </span>
            ) : null}
          </div>
          <p style={documentPageSubStyle}>
            {detail.customer_id}
            {detail.customer_name ? ` · ${detail.customer_name}` : ''}
            {detail.sales_order_id ? (
              <>
                {' · '}
                <Link to={`/orders/${detail.sales_order_id}`} style={cashReferenceLinkStyle}>
                  {detail.sales_order_id}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            <HoverTip label="Download or print this invoice as a PDF">
              <button type="button" style={primaryButtonStyle} onClick={handlePrint} disabled={printing}>
                {printing ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <FileDown size={15} />}
                PDF
              </button>
            </HoverTip>
            <HoverTip label="Email this invoice to the customer. The PDF downloads first so you can attach it.">
              <button type="button" style={secondaryButtonStyle} onClick={handleResend}>
                <Mail size={15} />
                Resend
              </button>
            </HoverTip>
            <HoverTip label={creditMemoTooltip(detail)}>
              <button
                type="button"
                style={{
                  ...secondaryButtonStyle,
                  opacity: detail.can_create_credit_memo ? 1 : 0.55,
                  cursor: detail.can_create_credit_memo ? 'pointer' : 'not-allowed',
                  pointerEvents: detail.can_create_credit_memo ? 'auto' : 'none',
                }}
                disabled={!detail.can_create_credit_memo || crediting}
                onClick={() => void handleCreditMemo()}
              >
                <Receipt size={15} />
                {crediting ? 'Creating…' : 'Credit memo'}
              </button>
            </HoverTip>
            {siStatus === 'DRAFT' && detail.sales_invoice_id ? (
              <HoverTip label="Approve this sales invoice and post AR / revenue to the general ledger">
                <button type="button" style={primaryButtonStyle} disabled={approving} onClick={() => void handleApprove()}>
                  {approving ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={15} />}
                  Approve
                </button>
              </HoverTip>
            ) : null}
            {(siStatus === 'DRAFT' || siStatus === 'APPROVED') && detail.sales_invoice_id ? (
              <HoverTip label="Void this sales invoice and release billed amount on the sales order">
                <button
                  type="button"
                  style={dangerButtonStyle}
                  disabled={voiding}
                  onClick={() => void handleVoid()}
                >
                  {voiding ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Ban size={15} />}
                  Void
                </button>
              </HoverTip>
            ) : null}
          </div>
          <div style={actionRowStyle}>
            <HoverTip label="Back to the sales invoice list">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/sales-invoices')}>
                <ArrowLeft size={15} />
                Sales Invoices
              </button>
            </HoverTip>
            <HoverTip label="Back to AR Aging & Collections">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/accounts-receivable')}>
                AR Aging
              </button>
            </HoverTip>
          </div>
        </div>
      </header>

      {error ? (
        <div style={errorBannerStyle} role="alert">
          {error}
        </div>
      ) : null}

      <section style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Header</h2>
        <div style={metaGridStyle}>
          <div style={metaColumnStyle}>
            <div style={metaRowStyle}>
              <div style={labelStyle}>Customer</div>
              <div>
                {detail.customer_id}
                {detail.customer_name ? ` · ${detail.customer_name}` : ''}
              </div>
            </div>
            <div style={metaRowStyle}>
              <div style={labelStyle}>Sales Order</div>
              <Link to={`/orders/${detail.sales_order_id}`} style={cashReferenceLinkStyle}>
                {detail.sales_order_id}
              </Link>
            </div>
            <div style={metaRowStyle}>
              <div style={labelStyle}>Issue Date</div>
              <div>{formatDate(detail.issue_date)}</div>
            </div>
          </div>
          <div style={metaColumnStyle}>
            <div style={metaRowStyle}>
              <div style={labelStyle}>Due Date</div>
              <div>{formatDate(detail.due_date)}</div>
            </div>
            <div style={metaRowStyle}>
              <div style={labelStyle}>Payment Date</div>
              <div>{formatDate(detail.payment_date)}</div>
            </div>
            <div style={metaRowStyle}>
              <div style={labelStyle}>Terms</div>
              <div>{detail.payment_terms || '—'}</div>
            </div>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Line items</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>Line</th>
                <th style={thStyle}>Part # / Description</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Unit Price ($)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Subtotal ($)</th>
              </tr>
            </thead>
            <tbody>
              {(detail.lines || []).length === 0 ? (
                <tr>
                  <td colSpan={5} style={tdStyle}>
                    No line items on this invoice.
                  </td>
                </tr>
              ) : (
                detail.lines.map((line, idx) => (
                  <tr key={`${line.item_id}-${idx}`}>
                    <td style={tdStyle}>{idx + 1}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{line.item_id}</div>
                      <div style={{ color: 'var(--text)', fontSize: 12 }}>{line.description || '—'}</div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{line.quantity}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{money(line.unit_price, currency)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{money(line.line_subtotal, currency)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div style={totalsStyle}>
          <div style={totalRowStyle}>
            <span>Subtotal</span>
            <strong>{money(detail.subtotal, currency)}</strong>
          </div>
          <div style={totalRowStyle}>
            <span>Shipping / Freight</span>
            <strong>{money(detail.freight_amount, currency)}</strong>
          </div>
          <div style={totalRowStyle}>
            <span>Taxes</span>
            <strong>{money(detail.tax_amount, currency)}</strong>
          </div>
          <div style={{ ...totalRowStyle, fontSize: 15 }}>
            <span>Grand Total</span>
            <strong>{money(detail.total_amount ?? detail.amount, currency)}</strong>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Payment & transaction history</h2>
        {(detail.payments || []).length === 0 ? (
          <p style={{ color: 'var(--text)', fontStyle: 'italic', margin: 0 }}>No payments applied yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Payment Date</th>
                  <th style={thStyle}>Method / Ref #</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Amount Applied ($)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Unapplied Balance ($)</th>
                </tr>
              </thead>
              <tbody>
                {detail.payments.map((p) => (
                  <tr key={`${p.reference}-${p.payment_date}`}>
                    <td style={tdStyle}>{formatDate(p.payment_date)}</td>
                    <td style={tdStyle}>
                      <Link to="/cash-management" style={cashReferenceLinkStyle} title="Open Cash Management">
                        {p.method}
                      </Link>
                      <div style={{ fontSize: 12, color: 'var(--text)' }}>{p.reference}</div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{money(p.amount_applied, currency)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{money(p.unapplied_balance, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const containerStyle: CSSProperties = {
  padding: 24,
  maxWidth: 1200,
  margin: '0 auto',
  textAlign: 'left',
}
const cardStyle: CSSProperties = {
  backgroundColor: 'var(--bg, #fff)',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
}
const sectionHeadingStyle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 18,
  fontWeight: 'bold',
  color: 'var(--text-h, #212121)',

}
const metaGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 32,
  fontSize: 14,
  color: 'var(--text, #424242)',
}
const metaColumnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}
const metaRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 12,
}
const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#757575',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  minWidth: 110,
  flexShrink: 0,
}
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRowStyle: CSSProperties = { backgroundColor: 'var(--social-bg, #f5f5f5)' }
const thStyle: CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h, #212121)' }
const tdStyle: CSSProperties = { padding: '12px 10px', color: 'var(--text, #424242)', verticalAlign: 'top' }
const totalsStyle: CSSProperties = {
  marginTop: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'flex-end',
  fontSize: 13,
}
const totalRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 24,
  minWidth: 240,
}
const errorBannerStyle: CSSProperties = {
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ef9a9a',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 16,
  fontSize: 13,
  fontWeight: 600,
}
const emptyStyle: CSSProperties = { padding: 30, textAlign: 'center', color: 'var(--text, #666)' }

export default InvoiceDetail
