/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { MoreHorizontal } from 'lucide-react'

export type MenuAction = {
  id: string
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

type RowActionMenuProps = {
  actions: MenuAction[]
  disabled?: boolean
  label?: string
}

export default function RowActionMenu({
  actions,
  disabled,
  label = 'More actions',
}: RowActionMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (actions.length === 0) return null

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        style={{
          ...menuBtnStyle,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div role="menu" style={menuPanelStyle}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              disabled={action.disabled || disabled}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                action.onClick()
              }}
              style={{
                ...menuItemStyle,
                color: action.danger ? '#c62828' : 'var(--text-h)',
                opacity: action.disabled ? 0.5 : 1,
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const menuBtnStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  borderRadius: 6,
  width: 30,
  height: 30,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-h)',
}

const menuPanelStyle: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 4px)',
  minWidth: 160,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  zIndex: 5,
  padding: 4,
}

const menuItemStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  padding: '8px 10px',
  borderRadius: 6,
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
}
