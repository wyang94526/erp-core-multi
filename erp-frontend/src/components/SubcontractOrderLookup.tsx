import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { subcontractOrderService } from '../api/services'
import type { EligibleMaterialPoSco } from '../types'

type Props = {
  value: string
  onSelect: (sco: EligibleMaterialPoSco | null) => void
  error?: boolean
  disabled?: boolean
}

export function SubcontractOrderLookup({ value, onSelect, error, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<EligibleMaterialPoSco | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const { data: orders = [], isFetching } = useQuery({
    queryKey: ['eligibleMaterialPos', search],
    queryFn: () => subcontractOrderService.listEligibleForMaterialPo(search, 0, 40),
    enabled: open && !disabled,
    placeholderData: (previous) => previous,
  })

  useEffect(() => {
    if (!value) {
      setSelected(null)
      return
    }
    if (selected?.sco_number === value) return
    const match = orders.find((order) => order.sco_number === value)
    if (match) setSelected(match)
  }, [value, orders, selected])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const display =
    selected && selected.sco_number === value ? label(selected) : value

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={open ? search : display}
        disabled={disabled}
        placeholder="Search subcontract order, FG SKU, or subcontractor…"
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
            maxHeight: 240,
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
            Clear selection
          </button>
          {orders.map((order) => (
            <button
              key={order.sco_number}
              type="button"
              style={optionStyle}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSelected(order)
                setSearch('')
                onSelect(order)
                setOpen(false)
              }}
            >
              <strong>{order.sco_number}</strong>
              <span style={{ color: 'var(--text)', marginLeft: 8 }}>
                {order.item_id} · {order.supplier_name || order.supplier_id} · {order.status}
              </span>
            </button>
          ))}
          {orders.length === 0 && (
            <div style={{ ...optionStyle, cursor: 'default' }}>
              {isFetching ? 'Searching…' : 'No open subcontract orders found'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function label(order: EligibleMaterialPoSco): string {
  return `${order.sco_number} — ${order.item_id} (${order.supplier_name || order.supplier_id})`
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

export default SubcontractOrderLookup
