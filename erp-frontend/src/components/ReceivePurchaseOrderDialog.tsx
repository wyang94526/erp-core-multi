/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { PurchaseOrderItem } from '../types'
import { remainingReceiveQty } from '../utils/poP2p'
import { isAmountOnlyLine } from '../utils/itemTypes'
import { formatReceiptQty } from '../utils/goodsReceipts'
import { primaryButtonStyle, secondaryButtonStyle } from '../utils/documentPageStyles'

export type ReceivePoLinePayload = {
  source_line_id: number
  quantity_received: number
  unit_cost?: number | null
}

type ReceivePurchaseOrderDialogProps = {
  open: boolean
  poNumber: string
  items: PurchaseOrderItem[]
  busy?: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (payload: {
    receipt_date: string
    notes: string | null
    lines: ReceivePoLinePayload[]
  }) => void
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function qtyKey(item: PurchaseOrderItem) {
  return String(item.id)
}

export function ReceivePurchaseOrderDialog({
  open,
  poNumber,
  items,
  busy = false,
  error = null,
  onClose,
  onSubmit,
}: ReceivePurchaseOrderDialogProps) {
  const receivable = useMemo(
    () => items.filter((item) => remainingReceiveQty(item) > 0 && item.sku),
    [items],
  )
  const [receiptDate, setReceiptDate] = useState(todayIso)
  const [notes, setNotes] = useState('')
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setReceiptDate(todayIso())
    setNotes('')
    setFormError(null)
    setQtyByLine(
      Object.fromEntries(receivable.map((item) => [qtyKey(item), String(remainingReceiveQty(item))])),
    )
    // Reset only when the dialog opens for a PO, not on each parent rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, poNumber])

  if (!open) return null

  const setQty = (item: PurchaseOrderItem, value: string) => {
    setQtyByLine((prev) => ({ ...prev, [qtyKey(item)]: value }))
    setFormError(null)
  }

  const fillRemaining = () => {
    setQtyByLine(
      Object.fromEntries(receivable.map((item) => [qtyKey(item), String(remainingReceiveQty(item))])),
    )
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const lines: ReceivePoLinePayload[] = []
    for (const item of receivable) {
      const remaining = remainingReceiveQty(item)
      const raw = qtyByLine[qtyKey(item)]
      const qty = Number(raw)
      if (!raw || raw.trim() === '' || qty === 0) continue
      if (!Number.isFinite(qty) || qty < 0) {
        setFormError(`Enter a valid quantity for ${item.sku}.`)
        return
      }
      if (qty > remaining) {
        setFormError(`${item.sku}: this receipt cannot exceed remaining ${formatReceiptQty(remaining)}.`)
        return
      }
      lines.push({
        source_line_id: Number(item.id),
        quantity_received: qty,
        unit_cost: item.unit_price,
      })
    }
    if (lines.length === 0) {
      setFormError('Enter a quantity on at least one line. Leave other lines at 0 to receive later.')
      return
    }
    if (!receiptDate) {
      setFormError('Receipt date is required.')
      return
    }
    onSubmit({
      receipt_date: receiptDate,
      notes: notes.trim() || null,
      lines,
    })
  }

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="receive-po-title">
      <form style={modalStyle} onSubmit={handleSubmit}>
        <h3 id="receive-po-title" style={titleStyle}>
          Receive goods — {poNumber}
        </h3>
        <p style={hintStyle}>
          Enter the quantity arriving now. You can receive less than the remaining quantity and
          post another receipt later.
        </p>

        <div style={headerFieldsStyle}>
          <label style={labelStyle}>
            Receipt date
            <input
              type="date"
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
              required
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Notes (optional)
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Packing slip, short shipment, etc."
              style={inputStyle}
            />
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button type="button" style={secondaryButtonStyle} onClick={fillRemaining} disabled={busy}>
            Fill remaining
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Item</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Ordered</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Received</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Remaining</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>This receipt</th>
              </tr>
            </thead>
            <tbody>
              {receivable.map((item) => {
                const remaining = remainingReceiveQty(item)
                const already = Number(item.quantity_received || 0)
                const amountOnly = isAmountOnlyLine(item.item_type, item.quantity, item.sku)
                return (
                  <tr key={item.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700 }}>{item.sku}</div>
                      {item.description ? <div style={descStyle}>{item.description}</div> : null}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {amountOnly ? 'Amount' : formatReceiptQty(item.quantity)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{formatReceiptQty(already)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{formatReceiptQty(remaining)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        step="any"
                        aria-label={`Quantity to receive for ${item.sku}`}
                        value={qtyByLine[qtyKey(item)] ?? ''}
                        onChange={(e) => setQty(item, e.target.value)}
                        style={qtyInputStyle}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {(formError || error) && (
          <p style={errorStyle} role="alert">
            {formError || error}
          </p>
        )}

        <div style={actionsStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" style={primaryButtonStyle} disabled={busy}>
            {busy ? 'Receiving…' : 'Post receipt'}
          </button>
        </div>
      </form>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
}

const modalStyle: CSSProperties = {
  background: 'var(--bg)',
  borderRadius: 10,
  padding: '20px 24px',
  width: 'min(820px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  border: '1px solid var(--border)',
}

const titleStyle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 18,
  color: 'var(--text-h)',
}

const hintStyle: CSSProperties = {
  margin: '0 0 16px',
  fontSize: 13,
  color: 'var(--text)',
}

const headerFieldsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(160px, 200px) 1fr',
  gap: 12,
  marginBottom: 16,
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-h)',
}

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 400,
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--text)',
  padding: '8px 6px',
  borderBottom: '1px solid var(--border)',
}

const tdStyle: CSSProperties = {
  padding: '8px 6px',
  fontSize: 13,
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'middle',
}

const descStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text)',
  fontWeight: 400,
  marginTop: 2,
}

const qtyInputStyle: CSSProperties = {
  ...inputStyle,
  width: 96,
  textAlign: 'right',
}

const errorStyle: CSSProperties = {
  margin: '12px 0 0',
  color: '#c62828',
  fontSize: 13,
}

const actionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 16,
}
