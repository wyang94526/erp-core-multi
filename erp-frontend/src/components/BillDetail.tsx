/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Banknote, CheckCircle2, FileDown, Loader2, Mail, Send } from 'lucide-react'
import { apBillService, vendorInvoiceService } from '../api/services'
import type { APBillDetail } from '../types'
import { generateSupplierBillPdf } from '../utils/generateSupplierBillPdf'
import { cashReferenceLinkStyle, sourceOrderHref } from '../utils/cashReference'
import { RecordCashPaymentDialog, type CashPaymentChoice } from './RecordCashPaymentDialog'

const money = (n: number | null | undefined, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n) || 0)

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

function formatQty(value: number | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(4)))
}

function statusColors(status: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    Paid: { bg: '#e8f5e9', text: '#2e7d32' },
    PAID: { bg: '#e8f5e9', text: '#2e7d32' },
    Open: { bg: '#e3f2fd', text: '#1565c0' },
    Unpaid: { bg: '#ffebee', text: '#c62828' },
    Overdue: { bg: '#ffebee', text: '#c62828' },
    Partial: { bg: '#fff3e0', text: '#e65100' },
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    PENDING_APPROVAL: { bg: '#fff3e0', text: '#e65100' },
    APPROVED: { bg: '#e3f2fd', text: '#1565c0' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  }
  return map[status] || { bg: '#f5f5f5', text: '#616161' }
}

function HoverTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span title={label} style={{ display: 'inline-flex' }}>
      {children}
    </span>
  )
}

function payTooltip(detail: APBillDetail, canPay: boolean): string {
  if (canPay) {
    return 'Record an outgoing payment and post AP / cash to the general ledger'
  }
  const paid = (detail.display_status || detail.status) === 'Paid' || detail.status === 'Paid'
  if (paid) {
    return 'Payment is unavailable because this bill is already paid'
  }
  return 'Payment is unavailable until this bill is approved'
}

export function BillDetail() {
  const { invoiceId: rawId } = useParams<{ invoiceId: string }>()
  const billId = decodeURIComponent(rawId || '').trim()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<APBillDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [paying, setPaying] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  const load = async () => {
    if (!billId) return
    setLoading(true)
    setError(null)
    try {
      setDetail(await apBillService.getBillDetail(billId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bill')
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [billId])

  const currency = detail?.currency || 'USD'
  const collectionBadge = statusColors(detail?.display_status || detail?.status || '')
  const approvalBadge = statusColors(detail?.approval_status || '')
  const siStatus = (detail?.supplier_invoice_status || '').toUpperCase()
  const sourceId = detail?.source_order_id || detail?.purchase_order_id || ''
  const sourceHref = sourceOrderHref(detail?.source_type, sourceId)
  const unpaid = Boolean(detail) && detail!.status !== 'Paid' && (detail!.display_status || '') !== 'Paid'
  const approved =
    (detail?.approval_status || '').toUpperCase() === 'APPROVED' || siStatus === 'APPROVED'
  const canPay = unpaid && approved
  const canSubmit = siStatus === 'DRAFT' && Boolean(detail?.supplier_invoice_id)
  const canApprove =
    (siStatus === 'DRAFT' || siStatus === 'PENDING_APPROVAL') && Boolean(detail?.supplier_invoice_id)
  const isNonPo =
    (detail?.invoice_type || '').toUpperCase() === 'EXPENSE' ||
    (detail?.invoice_type || '').toUpperCase() === 'LANDED_COST' ||
    (detail?.source_type || '').toUpperCase() === 'NON_PO'

  const handlePrint = () => {
    if (!detail) return
    setPrinting(true)
    try {
      generateSupplierBillPdf(detail)
    } finally {
      setPrinting(false)
    }
  }

  const handleEmailVendor = () => {
    if (!detail) return
    const email = (detail.vendor_email || '').trim()
    if (!email) {
      setError('No vendor email on file. Add a contact email on the vendor record.')
      return
    }
    generateSupplierBillPdf(detail)
    const subject = encodeURIComponent(`Bill ${detail.bill_id} from Grand-Tek Technology USA`)
    const body = encodeURIComponent(
      [
        `Please find bill ${detail.bill_id} for ${money(detail.total_amount ?? detail.amount, currency)}.`,
        `Source order: ${sourceId || '—'}`,
        `Due: ${formatDate(detail.due_date)}`,
        '',
        'The bill PDF was downloaded so you can attach it to this email.',
      ].join('\n'),
    )
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank')
  }

  const handleSubmit = async () => {
    if (!detail?.supplier_invoice_id) return
    setSubmitting(true)
    setError(null)
    try {
      await vendorInvoiceService.submit(detail.supplier_invoice_id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleApprove = async () => {
    if (!detail?.supplier_invoice_id) return
    setApproving(true)
    setError(null)
    try {
      await vendorInvoiceService.approve(detail.supplier_invoice_id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setApproving(false)
    }
  }

  const handlePay = async (choice: CashPaymentChoice) => {
    if (!detail || !canPay) return
    setPaying(true)
    setError(null)
    try {
      if (detail.supplier_invoice_id) {
        await vendorInvoiceService.pay(detail.supplier_invoice_id, choice)
      } else {
        await apBillService.makePayment(detail.bill_id, choice)
      }
      setPayOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  if (!billId) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>No bill ID provided.</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStyle}>Loading bill…</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>{error || 'Bill not found'}</p>
          <button type="button" style={headerButtonStyle} onClick={() => navigate('/supplier-invoices')}>
            Back to Supplier Invoices
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h1 style={pageTitleStyle}>{detail.bill_id}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ ...badgeStyle, backgroundColor: collectionBadge.bg, color: collectionBadge.text }}>
              {detail.display_status || detail.status}
            </span>
            <span style={{ ...badgeStyle, backgroundColor: approvalBadge.bg, color: approvalBadge.text }}>
              {(detail.approval_status || 'DRAFT').replace(/_/g, ' ')}
            </span>
            {siStatus ? (
              <span style={{ ...badgeStyle, backgroundColor: '#f5f5f5', color: '#616161' }}>
                Supplier invoice {siStatus}
              </span>
            ) : null}
            {detail.invoice_type ? (
              <span style={{ ...badgeStyle, backgroundColor: '#eceff1', color: '#37474f' }}>
                {(detail.invoice_type || 'PO_MATCHED').replace(/_/g, ' ')}
              </span>
            ) : null}
          </div>
          <p style={pageSubStyle}>
            {detail.vendor_id}
            {detail.vendor_name ? ` · ${detail.vendor_name}` : ''}
            {sourceHref && sourceId ? (
              <>
                {' · '}
                <Link to={sourceHref} style={cashReferenceLinkStyle}>
                  {sourceId}
                </Link>
              </>
            ) : sourceId ? (
              ` · ${sourceId}`
            ) : null}
          </p>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            <HoverTip label="Download or print this bill as a PDF">
              <button type="button" style={primaryButtonStyle} onClick={handlePrint} disabled={printing}>
                {printing ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <FileDown size={15} />}
                PDF
              </button>
            </HoverTip>
            <HoverTip label="Email this bill to the vendor. The PDF downloads first so you can attach it.">
              <button type="button" style={secondaryButtonStyle} onClick={handleEmailVendor}>
                <Mail size={15} />
                Email vendor
              </button>
            </HoverTip>
            {canSubmit ? (
              <HoverTip label="Submit this draft bill for approval">
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={submitting}
                  onClick={() => void handleSubmit()}
                >
                  {submitting ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={15} />}
                  Submit
                </button>
              </HoverTip>
            ) : null}
            {canApprove ? (
              <HoverTip
                label={
                  isNonPo
                    ? 'Approve this Non-PO invoice and post expense or inventory to Accounts Payable'
                    : 'Approve this supplier invoice and post GRNI → AP to the general ledger'
                }
              >
                <button type="button" style={primaryButtonStyle} disabled={approving} onClick={() => void handleApprove()}>
                  {approving ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={15} />}
                  Approve
                </button>
              </HoverTip>
            ) : null}
            <HoverTip label={payTooltip(detail, canPay)}>
              <button
                type="button"
                style={{
                  ...secondaryButtonStyle,
                  opacity: canPay ? 1 : 0.55,
                  cursor: canPay ? 'pointer' : 'not-allowed',
                  pointerEvents: canPay ? 'auto' : 'none',
                }}
                disabled={!canPay || paying}
                onClick={() => setPayOpen(true)}
              >
                {paying ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Banknote size={15} />}
                {paying ? 'Paying…' : 'Pay'}
              </button>
            </HoverTip>
          </div>
          <div style={actionRowStyle}>
            <HoverTip label="Back to the supplier invoice list">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/supplier-invoices')}>
                <ArrowLeft size={15} />
                Supplier Invoices
              </button>
            </HoverTip>
            <HoverTip label="Back to AP Aging & Payments">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/accounts-payable')}>
                AP Aging
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

      {(detail.match_warnings || []).length > 0 && !isNonPo ? (
        <div style={warningBannerStyle}>
          <strong>3-way match warnings</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {detail.match_warnings!.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Header</h2>
        <div style={metaGridStyle}>
          <div style={metaColumnStyle}>
            <div style={metaRowStyle}>
              <div style={labelStyle}>Vendor</div>
              <div>
                {detail.vendor_id}
                {detail.vendor_name ? ` · ${detail.vendor_name}` : ''}
              </div>
            </div>
            <div style={metaRowStyle}>
              <div style={labelStyle}>{isNonPo ? 'Related Order' : 'Source Order'}</div>
              {sourceHref && sourceId ? (
                <Link to={sourceHref} style={cashReferenceLinkStyle}>
                  {sourceId}
                </Link>
              ) : (
                <div>{sourceId || '—'}</div>
              )}
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
                <th style={thStyle}>Part # / Description</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Unit Price ($)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Subtotal ($)</th>
              </tr>
            </thead>
            <tbody>
              {(detail.lines || []).length === 0 ? (
                <tr>
                  <td colSpan={4} style={tdStyle}>
                    No line items on this bill.
                  </td>
                </tr>
              ) : (
                detail.lines.map((line, idx) => (
                  <tr key={`${line.item_id}-${idx}`}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>
                        {line.item_id ? (
                          <Link
                            to={`/items/${encodeURIComponent(line.item_id)}`}
                            style={cashReferenceLinkStyle}
                            title="View item details"
                          >
                            {line.item_id}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </div>
                      <div style={{ color: 'var(--text)', fontSize: 12 }}>{line.description || '—'}</div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{formatQty(line.quantity)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{money(line.unit_price, currency)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{money(line.line_subtotal, currency)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
      <RecordCashPaymentDialog
        open={payOpen}
        title={`Pay ${detail.bill_id}`}
        subtitle="Choose the bank account and payment instrument for this disbursement."
        amount={detail.total_amount ?? detail.amount}
        confirmLabel="Pay"
        submitting={paying}
        onCancel={() => setPayOpen(false)}
        onConfirm={(choice) => void handlePay(choice)}
      />
    </div>
  )
}

const containerStyle: CSSProperties = {
  padding: 24,
  maxWidth: 1200,
  margin: '0 auto',
  textAlign: 'left',
}
const pageHeaderStyle: CSSProperties = {
  marginBottom: 24,
  borderBottom: '1px solid var(--border, #ddd)',
  paddingBottom: 16,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  gap: 12,
}
const pageTitleStyle: CSSProperties = { margin: 0, fontSize: 28, fontWeight: 'bold', color: 'var(--text-h, #212121)' }
const pageSubStyle: CSSProperties = { margin: '8px 0 0', fontSize: 14, color: 'var(--text, #616161)' }
const cardStyle: CSSProperties = {
  backgroundColor: 'var(--bg, #fff)',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
}
const sectionHeadingStyle: CSSProperties = {
  margin: '0 0 16px',
  fontSize: 18,
  fontWeight: 'bold',
  color: 'var(--text-h, #212121)',
  borderBottom: '2px solid var(--border, #ddd)',
  paddingBottom: 8,
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
const theadRowStyle: CSSProperties = { borderBottom: '2px solid var(--border, #ddd)', backgroundColor: 'var(--social-bg, #f5f5f5)' }
const thStyle: CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h, #212121)' }
const tdStyle: CSSProperties = { padding: '12px 10px', color: 'var(--text, #424242)', verticalAlign: 'top' }
const badgeStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 700,
}
const headerActionsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
}
const actionRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
}
const compactButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}
const primaryButtonStyle: CSSProperties = {
  ...compactButtonStyle,
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
}
const headerButtonStyle: CSSProperties = {
  ...compactButtonStyle,
  backgroundColor: 'transparent',
  color: 'var(--text-h, #212121)',
  border: '1px solid var(--border, #ddd)',
}
const secondaryButtonStyle: CSSProperties = {
  ...compactButtonStyle,
  backgroundColor: 'transparent',
  color: 'var(--text-h, #212121)',
  border: '1px solid var(--border, #ddd)',
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
const warningBannerStyle: CSSProperties = {
  backgroundColor: '#fff8e1',
  color: '#6d4c41',
  border: '1px solid #ffe082',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 16,
  fontSize: 13,
}
const emptyStyle: CSSProperties = { padding: 30, textAlign: 'center', color: 'var(--text, #666)' }

export default BillDetail
