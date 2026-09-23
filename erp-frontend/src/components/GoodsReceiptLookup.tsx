/**
 * @author: Wendy Yang
 * @date: 2026-09-23
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { vendorInvoiceService } from '../api/services'
import type { GoodsReceipt } from '../types'

type Props = {
  value: string
  onSelect: (receipt: GoodsReceipt | null) => void
  error?: boolean
  disabled?: boolean
}

export function GoodsReceiptLookup({ value, onSelect, error, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<GoodsReceipt | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const { data: receipts = [], isFetching } = useQuery({
    queryKey: ['postedGoodsReceipts', search],
    queryFn: () =>
      vendorInvoiceService.listGoodsReceipts({
        q: search || undefined,
        limit: 40,
      }),
    enabled: open && !disabled,
    placeholderData: (previous) => previous,
  })

  useEffect(() => {
    if (!value) {
      setSelected(null)
      return
    }
    if (selected && String(selected.id) === value) return
    const match = receipts.find((receipt) => String(receipt.id) === value)
    if (match) setSelected(match)
  }, [value, receipts, selected])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const display = selected && String(selected.id) === value ? label(selected) : value

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={open ? search : display}
        disabled={disabled}
        placeholder="Search PO number, receipt, or goods vendor…"
        autoComplete="off"
        onFocus={() => {
          if (disabled) return
          setSearch('')
          setOpen(true)
        }}
        onChange={(event) => {
          setSearch(event.target.value)
          setOpen(true)
        }}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 6,
          border: error ? '1px solid #f44336' : '1px solid var(--border)',
          fontSize: 14,
          color: 'var(--text-h)',
          backgroundColor: 'var(--bg)',
          boxSizing: 'border-box',
        }}
      />
      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: 'var(--shadow)',
          }}
        >
          <button
            type="button"
            style={optionStyle}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setSelected(null)
              setSearch('')
              onSelect(null)
              setOpen(false)
            }}
          >
            Expense to GL (no inventory capitalization)
          </button>
          {receipts.map((receipt) => (
            <button
              key={receipt.id}
              type="button"
              style={optionStyle}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSelected(receipt)
                setSearch('')
                onSelect(receipt)
                setOpen(false)
              }}
            >
              <strong>{receipt.source_order_id}</strong>
              <span style={{ color: 'var(--text)', marginLeft: 8 }}>
                {receipt.receipt_number} · {receipt.vendor_name || receipt.vendor_id} ·{' '}
                {receipt.receipt_date}
              </span>
            </button>
          ))}
          {receipts.length === 0 && (
            <div style={{ ...optionStyle, cursor: 'default' }}>
              {isFetching ? 'Searching…' : 'No posted goods receipts found'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function label(receipt: GoodsReceipt): string {
  const vendor = receipt.vendor_name || receipt.vendor_id || 'goods vendor'
  return `${receipt.source_order_id} — ${receipt.receipt_number} (${vendor})`
}

const optionStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '10px 12px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text-h)',
}

export default GoodsReceiptLookup
