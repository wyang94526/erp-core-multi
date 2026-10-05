/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Banknote, CheckCircle2, FileDown, Loader2, Mail, Pencil, Send, Undo2, XCircle } from 'lucide-react'
import { apBillService, vendorInvoiceService, vendorService } from '../api/services'
import type { APBillDetail } from '../types'
import { generateSupplierBillPdf } from '../utils/generateSupplierBillPdf'
import { loadCompanyPdfBranding } from '../utils/pdfLetterhead'
import { cashReferenceLinkStyle, goodsReceiptHref, purchaseOrderHref, sourceOrderHref } from '../utils/cashReference'
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
    REJECTED: { bg: '#ffebee', text: '#c62828' },
    APPROVED: { bg: '#e3f2fd', text: '#1565c0' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  }
  return map[status] || { bg: '#f5f5f5', text: '#616161' }
}

function payTooltip(detail: APBillDetail, canPay: boolean): string {
  if (canPay) {
    if ((detail.payments || []).length > 0) {
      return 'Record another outgoing payment against the remaining balance'
    }
    return 'Record an outgoing payment. You can pay part of the balance now and the rest later.'
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
  const queryClient = useQueryClient()
  const [detail, setDetail] = useState<APBillDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rescinding, setRescinding] = useState(false)
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
  const poId = detail?.purchase_order_id || detail?.po_number || detail?.reference_po_number || null
  const sourceId = poId || detail?.source_order_id || ''
  const sourceHref = poId ? purchaseOrderHref(poId) : sourceOrderHref(detail?.source_type, sourceId)
  const goodsReceipts = detail?.goods_receipts || []
  const outstanding = Number(detail?.outstanding_balance)
  const hasRemaining = Number.isFinite(outstanding)
    ? outstanding > 0
    : Boolean(detail) && detail!.status !== 'Paid' && (detail!.display_status || '') !== 'Paid'
  const approved =
    (detail?.approval_status || '').toUpperCase() === 'APPROVED' || siStatus === 'APPROVED'
  const canPay = hasRemaining && approved
  const canSubmit =
    (siStatus === 'DRAFT' || siStatus === 'REJECTED') && Boolean(detail?.supplier_invoice_id)
  const canApprove =
    (siStatus === 'DRAFT' || siStatus === 'PENDING_APPROVAL' || siStatus === 'REJECTED') &&
    Boolean(detail?.supplier_invoice_id)
  const canReject = siStatus === 'PENDING_APPROVAL' && Boolean(detail?.supplier_invoice_id)
  const isNonPo =
    (detail?.invoice_type || '').toUpperCase() === 'EXPENSE' ||
    (detail?.invoice_type || '').toUpperCase() === 'LANDED_COST' ||
    (detail?.source_type || '').toUpperCase() === 'NON_PO'
  const canEdit =
    isNonPo &&
    (siStatus === 'DRAFT' || siStatus === 'REJECTED' || siStatus === 'PENDING_APPROVAL') &&
    Boolean(detail?.supplier_invoice_id)
  const canRescind =
    isNonPo &&
    siStatus === 'APPROVED' &&
    Boolean(detail?.supplier_invoice_id) &&
    (detail?.status || '') !== 'Paid' &&
    (detail?.display_status || '') !== 'Paid'
  const workflowHint = !isNonPo
    ? null
    : siStatus === 'DRAFT'
      ? 'This Non-PO invoice is still a draft. Use Edit to change vendor, GL, or amounts, then Submit.'
      : siStatus === 'REJECTED'
        ? 'This Non-PO invoice was returned. Use Edit to correct it, then Submit again.'
        : siStatus === 'PENDING_APPROVAL'
          ? 'Awaiting approval. The reviewer can Edit the voucher or Return it to the requester.'
          : siStatus === 'APPROVED' && canRescind
            ? 'Approved. Use Rescind to reverse the AP posting if the voucher is wrong, then Edit and resubmit.'
            : null

  const exportBillPdf = async (bill: APBillDetail) => {
    const [branding, vendor] = await Promise.all([
      loadCompanyPdfBranding().catch(() => null),
      bill.vendor_id ? vendorService.getVendor(bill.vendor_id).catch(() => null) : Promise.resolve(null),
    ])
    generateSupplierBillPdf({
      detail: bill,
      branding,
      vendor,
    })
  }

  const handlePrint = async () => {
    if (!detail) return
    setPrinting(true)
    setError(null)
    try {
      await exportBillPdf(detail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to print bill PDF')
    } finally {
      setPrinting(false)
    }
  }

  const handleEmailVendor = async () => {
    if (!detail) return
    const email = (detail.vendor_email || '').trim()
    if (!email) {
      setError('No vendor email on file. Add a contact email on the vendor record.')
      return
    }
    await exportBillPdf(detail)
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

  const handleRescind = async () => {
    if (!detail?.supplier_invoice_id) return
    if (
      !window.confirm(
        'Rescind approval for this Non-PO invoice? The AP posting will be reversed so you can edit and resubmit.',
      )
    ) {
      return
    }
    setRescinding(true)
    setError(null)
    try {
      await vendorInvoiceService.rescind(detail.supplier_invoice_id)
      await Promise.all([
        load(),
        queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] }),
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['goodsReceipts'] }),
        queryClient.invalidateQueries({ queryKey: ['postedGoodsReceipts'] }),
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rescind failed')
    } finally {
      setRescinding(false)
    }
  }

  const handleReject = async () => {
    if (!detail?.supplier_invoice_id) return
    if (!window.confirm('Return this bill to the requester so they can edit and resubmit?')) {
      return
    }
    setRejecting(true)
    setError(null)
    try {
      await vendorInvoiceService.reject(detail.supplier_invoice_id)
      await Promise.all([
        load(),
        queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] }),
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setRejecting(false)
    }
  }

  const handleSubmit = async () => {
    if (!detail?.supplier_invoice_id) return
    setSubmitting(true)
    setError(null)
    try {
      await vendorInvoiceService.submit(detail.supplier_invoice_id)
      await Promise.all([
        load(),
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['goodsReceipts'] }),
        queryClient.invalidateQueries({ queryKey: ['postedGoodsReceipts'] }),
        queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] }),
      ])
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
      await Promise.all([
        load(),
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['goodsReceipts'] }),
        queryClient.invalidateQueries({ queryKey: ['postedGoodsReceipts'] }),
        queryClient.invalidateQueries({ queryKey: ['vendorInvoices'] }),
      ])
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
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>{detail.bill_id}</h1>
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
          <p style={documentPageSubStyle}>
            {detail.vendor_id}
            {detail.vendor_name ? ` · ${detail.vendor_name}` : ''}
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
            {canEdit ? (
              <HoverTip
                label={
                  siStatus === 'PENDING_APPROVAL'
                    ? 'Correct this Non-PO invoice before approving or returning it'
                    : 'Edit vendor, GL accounts, or amounts on this Non-PO invoice'
                }
              >
                <button
                  type="button"
                  style={siStatus === 'PENDING_APPROVAL' ? secondaryButtonStyle : primaryButtonStyle}
                  onClick={() => navigate(`/supplier-invoices/${encodeURIComponent(detail.bill_id)}/edit`)}
                >
                  <Pencil size={15} />
                  Edit
                </button>
              </HoverTip>
            ) : null}
            {canSubmit ? (
              <HoverTip label="Submit this draft or rejected bill for approval">
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
            {canReject ? (
              <HoverTip label="Return this bill to the requester so they can correct it and resubmit">
                <button
                  type="button"
                  style={dangerButtonStyle}
                  disabled={rejecting}
                  onClick={() => void handleReject()}
                >
                  {rejecting ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <XCircle size={15} />}
                  Return
                </button>
              </HoverTip>
            ) : null}
            {canRescind ? (
              <HoverTip label="Reverse the AP posting and return this Non-PO invoice to draft so it can be edited">
                <button
                  type="button"
                  style={dangerButtonStyle}
                  disabled={rescinding}
                  onClick={() => void handleRescind()}
                >
                  {rescinding ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Undo2 size={15} />}
                  Rescind
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

      {workflowHint ? (
        <div style={workflowBannerStyle} role="status">
          {workflowHint}
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
              <div style={labelStyle}>Bill #</div>
              <div>{detail.bill_id}</div>
            </div>
            <div style={metaRowStyle}>
              <div style={labelStyle}>Supplier Invoice Number</div>
              <div>{detail.vendor_invoice_number || '—'}</div>
            </div>
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
              <div style={labelStyle}>Goods Receipt</div>
              {goodsReceipts.length > 0 ? (
                <div>
                  {goodsReceipts.map((receipt, index) => {
                    const href = goodsReceiptHref(receipt.receipt_number)
                    return (
                      <span key={receipt.receipt_number}>
                        {index > 0 ? ', ' : null}
                        {href ? (
                          <Link to={href} style={cashReferenceLinkStyle} title="Open goods receipt">
                            {receipt.receipt_number}
                          </Link>
                        ) : (
                          receipt.receipt_number
                        )}
                      </span>
                    )
                  })}
                </div>
              ) : (
                <div>—</div>
              )}
            </div>
            <div style={metaRowStyle}>
              <div style={labelStyle}>Invoice Date</div>
              <div>{formatDate(detail.issue_date)}</div>
            </div>
            <div style={metaRowStyle}>
              <div style={labelStyle}>Posting Date</div>
              <div>{formatDate(detail.posting_date || detail.issue_date)}</div>
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
              <div style={labelStyle}>Outstanding</div>
              <div>{money(detail.outstanding_balance ?? detail.total_amount ?? detail.amount, currency)}</div>
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
                <th style={thStyle}>Receipt</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Unit Price ($)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Subtotal ($)</th>
              </tr>
            </thead>
            <tbody>
              {(detail.lines || []).length === 0 ? (
                <tr>
                  <td colSpan={6} style={tdStyle}>
                    No line items on this bill.
                  </td>
                </tr>
              ) : (
                detail.lines.map((line, idx) => (
                  <tr key={`${line.item_id}-${idx}`}>
                    <td style={tdStyle}>{idx + 1}</td>
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
                    <td style={tdStyle}>
                      {line.goods_receipt_number && goodsReceiptHref(line.goods_receipt_number) ? (
                        <Link
                          to={goodsReceiptHref(line.goods_receipt_number)!}
                          style={cashReferenceLinkStyle}
                          title="Open goods receipt"
                        >
                          {line.goods_receipt_number}
                        </Link>
                      ) : (
                        line.goods_receipt_number || '—'
                      )}
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
        subtitle="Enter the amount and date for this disbursement. You can record additional payments later until the balance is zero."
        amount={detail.outstanding_balance ?? detail.total_amount ?? detail.amount}
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
const workflowBannerStyle: CSSProperties = {
  backgroundColor: '#e3f2fd',
  color: '#1565c0',
  border: '1px solid #bbdefb',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 16,
  fontSize: 13,
}
const emptyStyle: CSSProperties = { padding: 30, textAlign: 'center', color: 'var(--text, #666)' }

export default BillDetail
