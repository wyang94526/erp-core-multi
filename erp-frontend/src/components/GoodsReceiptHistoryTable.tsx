import { Link } from 'react-router-dom'
import type { CSSProperties } from 'react'
import type { GoodsReceipt } from '../types'
import {
  formatReceiptMoney,
  formatReceiptQty,
  goodsReceiptHref,
  goodsReceiptStatusColors,
  goodsReceiptStatusLabel,
  receiptLinkStyle,
} from '../utils/goodsReceipts'

type GoodsReceiptHistoryTableProps = {
  receipts: GoodsReceipt[]
  emptyText?: string
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

export function GoodsReceiptHistoryTable({
  receipts,
  emptyText = 'No goods receipts posted yet.',
}: GoodsReceiptHistoryTableProps) {
  if (!receipts.length) {
    return <p style={{ color: 'var(--text)', fontStyle: 'italic', margin: 0 }}>{emptyText}</p>
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>Receipt ID</th>
            <th style={thStyle}>Posting Date</th>
            <th style={thStyle}>Status</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Lines</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Received Qty</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((receipt) => {
            const badge = goodsReceiptStatusColors(receipt.status)
            const qty = (receipt.lines || []).reduce((sum, line) => sum + Number(line.quantity_received || 0), 0)
            return (
              <tr key={receipt.id || receipt.receipt_number} style={tbodyRowStyle}>
                <td style={tdStyle}>
                  <Link
                    to={goodsReceiptHref(receipt.receipt_number)}
                    style={receiptLinkStyle}
                    title={`Open receipt ${receipt.receipt_number}`}
                  >
                    {receipt.receipt_number}
                  </Link>
                </td>
                <td style={tdStyle}>{formatDate(receipt.receipt_date)}</td>
                <td style={tdStyle}>
                  <span style={{ ...badgeStyle, backgroundColor: badge.bg, color: badge.text }}>
                    {receipt.status_label || goodsReceiptStatusLabel(receipt.status)}
                  </span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{receipt.lines?.length || 0}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{formatReceiptQty(qty)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatReceiptMoney(receipt.total_amount)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadRowStyle: CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
}
const tbodyRowStyle: CSSProperties = { borderBottom: '1px solid var(--border)' }
const thStyle: CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const tdStyle: CSSProperties = { padding: '12px 10px', color: 'var(--text)', verticalAlign: 'middle' }
const badgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '3px 8px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 700,
}
