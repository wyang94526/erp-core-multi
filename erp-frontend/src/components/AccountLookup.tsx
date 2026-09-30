/**
 * @author: Wendy Yang
 * @date: 2026-09-30
 *
 * Searchable chart-of-accounts picker. Matches account code, name, and type
 * so users can type "Expense" instead of scrolling a native select.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChartOfAccount } from '../types'
import { matchesSearch } from '../utils/csvExport'

type AccountLookupProps = {
  accounts: ChartOfAccount[]
  value: string
  onSelect: (account: ChartOfAccount | null) => void
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
}

export function accountDisplayLabel(account: ChartOfAccount): string {
  return `${account.account_code} · ${account.account_name}`
}

export default function AccountLookup({
  accounts,
  value,
  onSelect,
  disabled = false,
  placeholder = 'Search code, name, or type…',
  ariaLabel = 'Account lookup',
}: AccountLookupProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 360 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = accounts.find((account) => account.id === value)
  const searchTerm = open ? query : ''

  const filtered = useMemo(() => {
    return accounts
      .filter((account) =>
        matchesSearch(searchTerm, account.account_code, account.account_name, account.account_type),
      )
      .slice(0, 80)
  }, [accounts, searchTerm])

  useEffect(() => {
    if (!open) {
      setQuery(selected ? accountDisplayLabel(selected) : value || '')
    }
  }, [open, selected, value])

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
      const width = Math.max(rect.width, 360)
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
  }, [open, query, filtered.length])

  useEffect(() => {
    setHighlight(0)
  }, [searchTerm, filtered.length])

  const choose = (account: ChartOfAccount) => {
    onSelect(account)
    setQuery(accountDisplayLabel(account))
    setOpen(false)
  }

  const openMenu = () => {
    if (disabled) return
    setOpen(true)
    setQuery('')
    inputRef.current?.focus()
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', minWidth: 220 }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          value={open ? query : selected ? accountDisplayLabel(selected) : query}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={openMenu}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            if (!event.target.value) onSelect(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setHighlight((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlight((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter' && open && filtered[highlight]) {
              event.preventDefault()
              choose(filtered[highlight])
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 32px 8px 10px',
            borderRadius: 6,
            border: '1px solid #ccc',
            fontSize: 13,
            color: 'var(--text-h, #212121)',
            backgroundColor: disabled ? '#f5f5f5' : 'var(--bg, #fff)',
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Open account list"
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault()
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
            color: 'var(--text, #616161)',
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
              background: 'var(--bg, #fff)',
              border: '1px solid var(--border, #ddd)',
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text, #616161)' }}>
                No matching accounts.
              </div>
            ) : (
              filtered.map((account, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={account.id === value}
                  key={account.id}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(account)
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    border: 'none',
                    background:
                      index === highlight || account.id === value
                        ? 'var(--accent-bg, #e3f2fd)'
                        : 'transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--text-h, #212121)',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {account.account_code} · {account.account_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text, #616161)' }}>{account.account_type}</div>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
