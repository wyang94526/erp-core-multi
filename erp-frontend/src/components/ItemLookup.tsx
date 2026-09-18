/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { itemService } from '../api/services'
import type { Item } from '../types'

export type ItemLookupCatalog = 'all' | 'purchase' | 'assembly'

type ItemLookupProps = {
  items: Item[]
  value: string
  onSelect: (item: Item | null) => void
  catalog?: ItemLookupCatalog
  disabled?: boolean
  error?: boolean
  placeholder?: string
  ariaLabel?: string
}

function matchesQuery(item: Item, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    item.item_id.toLowerCase().includes(q) ||
    (item.customer_part_number || '').toLowerCase().includes(q) ||
    (item.description || '').toLowerCase().includes(q)
  )
}

export function itemDisplayLabel(item: Item): string {
  const desc = item.description || item.customer_part_number || item.item_id
  return `${item.item_id} — ${desc}`
}

export default function ItemLookup({
  items,
  value,
  onSelect,
  catalog = 'all',
  disabled = false,
  error = false,
  placeholder = 'Search internal part number…',
  ariaLabel = 'Item lookup',
}: ItemLookupProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [remoteItems, setRemoteItems] = useState<Item[]>([])
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 320 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const catalogItems = useMemo(() => {
    const byId = new Map<string, Item>()
    for (const item of items) byId.set(item.item_id, item)
    for (const item of remoteItems) byId.set(item.item_id, item)
    return [...byId.values()]
  }, [items, remoteItems])

  const selected = catalogItems.find((item) => item.item_id === value)
  const searchTerm = open ? query : ''

  useEffect(() => {
    if (!open) {
      setQuery(selected ? itemDisplayLabel(selected) : value || '')
    }
  }, [selected, value, open])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (wrapRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!open || !wrapRef.current) return
    const update = () => {
      const rect = wrapRef.current!.getBoundingClientRect()
      const width = Math.max(rect.width, 320)
      const estimatedHeight = 280
      const spaceBelow = window.innerHeight - rect.bottom
      const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow
      setMenuPos({
        top: openUp ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - width - 8),
        width,
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, query, remoteItems])

  useEffect(() => {
    if (!open) return
    const term = query.trim()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const rows = await itemService.listItems(0, 80, {
          q: term || undefined,
          catalog: catalog === 'all' ? undefined : catalog,
        })
        if (!cancelled) setRemoteItems(rows)
      } catch {
        if (!cancelled) setRemoteItems([])
      }
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query, catalog])

  const filtered = useMemo(() => {
    return catalogItems.filter((item) => matchesQuery(item, searchTerm)).slice(0, 80)
  }, [catalogItems, searchTerm])

  useEffect(() => {
    setHighlight(0)
  }, [searchTerm, filtered.length])

  const choose = (item: Item) => {
    onSelect(item)
    setQuery(itemDisplayLabel(item))
    setOpen(false)
  }

  const openMenu = () => {
    if (disabled) return
    setOpen(true)
    setQuery('')
    inputRef.current?.focus()
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          value={open ? query : selected ? itemDisplayLabel(selected) : query}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={openMenu}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            if (!e.target.value) onSelect(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setHighlight((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter' && open && filtered[highlight]) {
              e.preventDefault()
              choose(filtered[highlight])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 32px 8px 10px',
            borderRadius: 4,
            border: error ? '1px solid #f44336' : '1px solid var(--border)',
            fontSize: 13,
            color: 'var(--text-h)',
            backgroundColor: 'var(--bg)',
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Open part number list"
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault()
            if (open) setOpen(false)
            else openMenu()
          }}
          style={{
            position: 'absolute',
            right: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            border: 'none',
            background: 'transparent',
            cursor: disabled ? 'default' : 'pointer',
            color: 'var(--text)',
            fontSize: 12,
            padding: '4px 6px',
            lineHeight: 1,
          }}
        >
          {open ? '▲' : '▼'}
        </button>
      </div>
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            style={{
              position: 'fixed',
              zIndex: 10000,
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: 280,
              overflowY: 'auto',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text)' }}>
                No matching part numbers.
              </div>
            ) : (
              filtered.map((item, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={item.item_id === value}
                  key={item.item_id}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(item)
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    border: 'none',
                    background:
                      index === highlight || item.item_id === value ? 'var(--accent-bg, #e3f2fd)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--text-h)',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{item.item_id}</div>
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>
                    {item.customer_part_number ? `Cust P/N ${item.customer_part_number}` : 'No customer P/N'}
                    {item.description ? ` · ${item.description}` : ''}
                  </div>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
