/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { goodsReceiptService } from '../api/services'
import type { GoodsReceiptJournal, JournalEntry } from '../types'
import { JournalEntryViewModal } from './JournalEntryViewModal'
import { billDetailHref, cashReferenceLinkStyle, sourceOrderHref } from '../utils/cashReference'
import {
  formatReceiptMoney,
  formatReceiptQty,
  goodsReceiptStatusColors,
  goodsReceiptStatusLabel,
  journalPurposeLabel,
  receiptLinkStyle,
  receiptWarehouseLabel,
  toJournalEntry,
} from '../utils/goodsReceipts'
import { shortJournalId } from '../utils/journalEntries'
import {
  HoverTip,
  actionRowStyle,
  badgeStyle,
  documentPageHeaderStyle,
  documentPageSubStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
} from '../utils/documentPageStyles'

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

function sourceLabel(sourceType: string | null | undefined): string {
  const type = (sourceType || '').toUpperCase()
  if (type === 'SUBCONTRACT_ORDER') return 'Subcontract Order'
  if (type === 'PURCHASE_ORDER') return 'Purchase Order'
  return 'Source Document'
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={metaRowStyle}>
      <dt style={labelStyle}>{label}</dt>
      <dd style={valueStyle}>{children}</dd>
    </div>
  )
}

export function GoodsReceiptDetail() {
  const { receiptId: rawId } = useParams<{ receiptId: string }>()
  const receiptKey = decodeURIComponent(rawId || '').trim()
  const navigate = useNavigate()
  const [viewingJournal, setViewingJournal] = useState<JournalEntry | null>(null)
  const {
    data: detail = null,
    error: queryError,
    isLoading: loading,
  } = useQuery({
    queryKey: ['goodsReceipts', receiptKey],
    queryFn: () => goodsReceiptService.get(receiptKey),
    enabled: Boolean(receiptKey),
  })
  const error = queryError instanceof Error ? queryError.message : queryError ? 'Failed to load goods receipt' : null

  if (loading) {
    return (
      <div style={containerStyle}>
        <p style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          Loading receipt…
        </p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>{error || 'Goods receipt not found'}</p>
          <button type="button" style={headerButtonStyle} onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
      </div>
    )
  }

  const statusKey = detail.status_label || goodsReceiptStatusLabel(detail.status)
  const badge = goodsReceiptStatusColors(detail.status)
  const sourceHref = sourceOrderHref(detail.source_type, detail.source_order_id)
  const journals = detail.journals || []
  const invoices = detail.related_invoices || []
  const lines = detail.lines || []
  const backHref = sourceHref || '/purchase-orders'

  return (
    <div style={containerStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>{detail.receipt_number}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ ...badgeStyle, backgroundColor: badge.bg, color: badge.text }}>{statusKey}</span>
            <span style={{ ...badgeStyle, backgroundColor: '#eceff1', color: '#37474f' }}>
              {sourceLabel(detail.source_type)}
            </span>
          </div>
          <p style={documentPageSubStyle}>
            Receipt of goods against {sourceLabel(detail.source_type).toLowerCase()}{' '}
            {sourceHref ? (
              <Link to={sourceHref} style={cashReferenceLinkStyle}>
                {detail.source_order_id}
              </Link>
            ) : (
              detail.source_order_id
            )}
            {detail.operational_receipt_id && detail.operational_receipt_id !== detail.receipt_number
              ? ` · Warehouse ticket ${detail.operational_receipt_id}`
              : null}
          </p>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            <HoverTip label={sourceHref ? `Back to ${detail.source_order_id}` : 'Go back'}>
              <button type="button" style={headerButtonStyle} onClick={() => navigate(backHref)}>
                <ArrowLeft size={15} />
                {sourceHref ? `Back to ${detail.source_order_id}` : 'Back'}
              </button>
            </HoverTip>
          </div>
        </div>
      </header>

      <section style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Receipt header</h2>
        <dl style={metaGridStyle}>
          <div style={metaColumnStyle}>
            <MetaRow label="Receipt ID">{detail.receipt_number}</MetaRow>
            <MetaRow label="Source Document">
              {sourceHref ? (
                <Link to={sourceHref} style={receiptLinkStyle}>
                  {detail.source_order_id}
                </Link>
              ) : (
                detail.source_order_id
              )}
            </MetaRow>
            <MetaRow label="Vendor / Supplier">
              {detail.vendor_id}
              {detail.vendor_name ? ` · ${detail.vendor_name}` : ''}
            </MetaRow>
          </div>
          <div style={metaColumnStyle}>
            <MetaRow label="Posting Date">{formatDate(detail.receipt_date)}</MetaRow>
            <MetaRow label="Warehouse / Bin">{receiptWarehouseLabel(detail)}</MetaRow>
            <MetaRow label="Received By">{detail.received_by || '—'}</MetaRow>
          </div>
        </dl>
        {detail.notes ? <p style={{ margin: '16px 0 0', color: 'var(--text)' }}>{detail.notes}</p> : null}
      </section>

      <section style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Line items</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>Item ID</th>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Ordered Qty</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Received Qty</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Receipt Unit Cost</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Allocated Landed</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Actual Unit Cost</th>
                <th style={thStyle}>UOM</th>
                <th style={thStyle}>Lot / Serial</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ ...tdStyle, fontStyle: 'italic', color: '#666' }}>
                    No lines on this receipt.
                  </td>
                </tr>
              ) : (
                lines.map((line) => {
                  const lotSerial = [line.lot_number, line.serial_number].filter(Boolean).join(' / ')
                  return (
                    <tr key={line.id} style={tbodyRowStyle}>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 700 }}>
                        <Link to={`/items/${encodeURIComponent(line.item_id)}`} style={receiptLinkStyle}>
                          {line.item_id}
                        </Link>
                      </td>
                      <td style={tdStyle}>{line.item_description || line.description || '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatReceiptQty(line.quantity_ordered)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                        {formatReceiptQty(line.quantity_received)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatReceiptMoney(line.unit_cost)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatReceiptMoney(line.allocated_landed_amount)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                        {formatReceiptMoney(line.actual_unit_cost ?? line.landed_unit_cost ?? line.unit_cost)}
                      </td>
                      <td style={tdStyle}>{line.uom || '—'}</td>
                      <td style={{ ...tdStyle, color: lotSerial ? 'var(--text)' : '#9e9e9e' }}>
                        {lotSerial || 'Not tracked'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Status & accounting trail</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
          This receipt is <strong>{statusKey}</strong>. Receiving creates draft journal entries (inventory or
          expense debit, GRNI credit). Those journals stay Draft / DRAFT until they are approved and posted
          on the General Ledger. Approving a matching supplier invoice creates another draft to clear GRNI
          to Accounts Payable.
        </p>

        <h3 style={subHeadingStyle}>Journal entries</h3>
        {journals.length === 0 ? (
          <p style={{ color: 'var(--text)', fontStyle: 'italic' }}>No journal entries linked to this receipt.</p>
        ) : (
          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Journal</th>
                  <th style={thStyle}>Purpose</th>
                  <th style={thStyle}>Posting Date</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {journals.map((journal) => (
                  <JournalRow
                    key={journal.id}
                    journal={journal}
                    onView={() => setViewingJournal(toJournalEntry(journal))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 style={subHeadingStyle}>Related supplier invoices</h3>
        {invoices.length === 0 ? (
          <p style={{ color: 'var(--text)', fontStyle: 'italic' }}>
            No supplier invoices have been created against this source document yet.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Invoice</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                  <th style={thStyle}>Link</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const href = billDetailHref(invoice.ap_bill_id || invoice.invoice_number)
                  return (
                    <tr key={invoice.id} style={tbodyRowStyle}>
                      <td style={tdStyle}>
                        <Link to={href} style={receiptLinkStyle}>
                          {invoice.invoice_number}
                        </Link>
                      </td>
                      <td style={tdStyle}>{formatDate(invoice.invoice_date)}</td>
                      <td style={tdStyle}>{invoice.status}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                        {formatReceiptMoney(invoice.total_amount)}
                      </td>
                      <td style={tdStyle}>
                        {invoice.link_type === 'RECEIPT_MATCH' ? 'Matched to this receipt' : 'Same source document'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <JournalEntryViewModal entry={viewingJournal} onClose={() => setViewingJournal(null)} />
    </div>
  )
}

function JournalRow({
  journal,
  onView,
}: {
  journal: GoodsReceiptJournal
  onView: () => void
}) {
  return (
    <tr style={tbodyRowStyle}>
      <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 700 }}>{shortJournalId(journal.id)}</td>
      <td style={tdStyle}>{journalPurposeLabel(journal.purpose)}</td>
      <td style={tdStyle}>{formatDate(journal.posting_date || journal.created_at)}</td>
      <td style={tdStyle}>{journal.description}</td>
      <td style={tdStyle}>
        {journal.posting_status || 'Draft'} / {journal.approval_status || 'DRAFT'}
      </td>
      <td style={tdStyle}>
        <button type="button" style={linkButtonStyle} onClick={onView}>
          View
        </button>
      </td>
    </tr>
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
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
}
const sectionHeadingStyle: CSSProperties = {
  margin: '0 0 16px',
  fontSize: 18,
  fontWeight: 'bold',
  color: 'var(--text-h, #212121)',
  borderBottom: '2px solid var(--border, #ddd)',
  paddingBottom: 8,
}
const subHeadingStyle: CSSProperties = {
  margin: '0 0 10px',
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-h, #212121)',
}
const metaGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 32,
  fontSize: 14,
}
const metaColumnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
const metaRowStyle: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 12, margin: 0 }
const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#757575',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  minWidth: 130,
  flexShrink: 0,
}
const valueStyle: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text, #424242)' }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRowStyle: CSSProperties = {
  borderBottom: '2px solid var(--border, #ddd)',
  backgroundColor: 'var(--social-bg, #f5f5f5)',
}
const tbodyRowStyle: CSSProperties = { borderBottom: '1px solid var(--border, #eee)' }
const thStyle: CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h, #212121)' }
const tdStyle: CSSProperties = { padding: '12px 10px', color: 'var(--text, #424242)', verticalAlign: 'middle' }
const linkButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--accent, #1565c0)',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  textDecoration: 'underline',
  padding: 0,
}

export default GoodsReceiptDetail
