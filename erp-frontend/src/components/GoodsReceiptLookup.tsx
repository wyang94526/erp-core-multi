/**
 * @author: Wendy Yang
 * @date: 2026-09-23
 *
 * Two-step landed-cost allocation: search a PO, then pick a receipt on that PO.
 * The invoice still stores goods_receipt_id.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { goodsReceiptService, vendorInvoiceService } from '../api/services'
import type { GoodsReceipt } from '../types'

type Props = {
  poNumber: string
  receiptId: string
  receiptNumber?: string
  onChange: (next: { poNumber: string; receipt: GoodsReceipt | null }) => void
  error?: boolean
  disabled?: boolean
}

type PoOption = {
  poNumber: string
  vendor: string
}

export function GoodsReceiptLookup({
  poNumber,
  receiptId,
  receiptNumber,
  onChange,
  error,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const { data: searchReceipts = [], isFetching: searchingPos } = useQuery({
    queryKey: ['postedGoodsReceipts', 'po-search', search],
    queryFn: () =>
      vendorInvoiceService.listGoodsReceipts({
        source_type: 'PURCHASE_ORDER',
        q: search || undefined,
        limit: 80,
      }),
    enabled: open && !disabled,
    placeholderData: (previous) => previous,
  })

  const { data: poReceipts = [], isFetching: loadingReceipts } = useQuery({
    queryKey: ['postedGoodsReceipts', 'by-po', poNumber],
    queryFn: () =>
      vendorInvoiceService.listGoodsReceipts({
        source_type: 'PURCHASE_ORDER',
        source_order_id: poNumber,
        limit: 80,
      }),
    enabled: Boolean(poNumber) && !disabled,
  })

  useEffect(() => {
    if (!receiptId || poNumber) return
    let cancelled = false
    goodsReceiptService
      .get(receiptId)
      .then((receipt) => {
        if (cancelled || !receipt?.source_order_id) return
        onChangeRef.current({ poNumber: receipt.source_order_id, receipt })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [receiptId, poNumber])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const poOptions = useMemo(() => uniquePurchaseOrders(searchReceipts, search), [searchReceipts, search])

  const choosePo = (nextPo: string) => {
    const samePo = nextPo === poNumber
    const current = poReceipts.find((row) => String(row.id) === receiptId)
    onChange({
      poNumber: nextPo,
      receipt: samePo ? current || null : null,
    })
    setSearch('')
    setOpen(false)
  }

  const chooseReceipt = (nextId: string) => {
    if (!nextId) {
      onChange({ poNumber, receipt: null })
      return
    }
    const receipt = poReceipts.find((row) => String(row.id) === nextId) || null
    onChange({ poNumber, receipt })
  }

  return (
    <div ref={wrapRef} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <label style={fieldLabelStyle}>
        Purchase order
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={open ? search : poNumber}
            disabled={disabled}
            placeholder="Search PO number…"
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
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                const typed = search.trim()
                if (typed) choosePo(typed)
              } else if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
            style={{
              ...inputStyle,
              border: error ? '1px solid #f44336' : inputStyle.border,
            }}
          />
          {open && !disabled && (
            <div style={menuStyle}>
              {poNumber ? (
                <button
                  type="button"
                  style={optionStyle}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choosePo('')}
                >
                  Clear PO
                </button>
              ) : null}
              {poOptions.map((option) => (
                <button
                  key={option.poNumber}
                  type="button"
                  style={optionStyle}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choosePo(option.poNumber)}
                >
                  <strong>{option.poNumber}</strong>
                  {option.vendor ? (
                    <span style={{ color: 'var(--text)', marginLeft: 8 }}>{option.vendor}</span>
                  ) : null}
                </button>
              ))}
              {poOptions.length === 0 && (
                <div style={{ ...optionStyle, cursor: 'default' }}>
                  {searchingPos ? 'Searching purchase orders…' : 'No purchase orders with posted receipts'}
                </div>
              )}
            </div>
          )}
        </div>
      </label>
      <label style={fieldLabelStyle}>
        Goods receipt
        <select
          value={receiptId}
          disabled={disabled || !poNumber}
          onChange={(event) => chooseReceipt(event.target.value)}
          style={inputStyle}
        >
          <option value="">
            {poNumber ? 'Expense to GL (no receipt)' : 'Select a PO first'}
          </option>
          {receiptId && !poReceipts.some((receipt) => String(receipt.id) === receiptId) ? (
            <option value={receiptId}>
              {receiptNumber || `Receipt ${receiptId}`}
            </option>
          ) : null}
          {poReceipts.map((receipt) => (
            <option key={receipt.id} value={String(receipt.id)}>
              {receiptLabel(receipt)}
            </option>
          ))}
        </select>
        {poNumber && !loadingReceipts && poReceipts.length === 0 ? (
          <span style={hintStyle}>No posted receipts for {poNumber}.</span>
        ) : (
          <span style={hintStyle}>Allocation posts to the selected receipt ID.</span>
        )}
      </label>
    </div>
  )
}

function uniquePurchaseOrders(receipts: GoodsReceipt[], search: string): PoOption[] {
  const needle = search.trim().toLowerCase()
  const seen = new Map<string, PoOption>()
  for (const receipt of receipts) {
    const po = (receipt.source_order_id || '').trim()
    if (!po || seen.has(po)) continue
    const vendor = receipt.vendor_name || receipt.vendor_id || ''
    if (
      needle &&
      !po.toLowerCase().includes(needle) &&
      !vendor.toLowerCase().includes(needle)
    ) {
      continue
    }
    seen.set(po, { poNumber: po, vendor })
  }
  const typed = search.trim()
  if (typed.includes('-') && ![...seen.keys()].some((po) => po.toLowerCase() === needle)) {
    seen.set(typed, { poNumber: typed, vendor: '' })
  }
  return [...seen.values()]
}

function receiptLabel(receipt: GoodsReceipt): string {
  const vendor = receipt.vendor_name || receipt.vendor_id || ''
  const date = receipt.receipt_date || ''
  return [receipt.receipt_number, vendor, date].filter(Boolean).join(' · ')
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-h)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  fontSize: 14,
  color: 'var(--text-h)',
  backgroundColor: 'var(--bg)',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}

const menuStyle: React.CSSProperties = {
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

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--muted, #666)',
  fontWeight: 400,
  marginTop: 4,
}

export default GoodsReceiptLookup
