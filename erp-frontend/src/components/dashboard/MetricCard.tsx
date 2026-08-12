import { useState } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { MetricAccent } from '../../types/dashboard'
import { METRIC_ACCENT_HEX } from '../../services/dashboardDetails'

type MetricCardProps = {
  label: string
  value: string | number
  subtext?: string
  accent?: MetricAccent
  icon: LucideIcon
  onClick?: () => void
  active?: boolean
  clickHint?: string
}

export default function MetricCard({
  label,
  value,
  subtext,
  accent = 'blue',
  icon: Icon,
  onClick,
  active = false,
  clickHint = 'Open filtered list',
}: MetricCardProps) {
  const borderColor = METRIC_ACCENT_HEX[accent]
  const interactive = Boolean(onClick)
  const [hovered, setHovered] = useState(false)

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? active : undefined}
      title={interactive ? clickHint : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: 'var(--bg)',
        border: `1px solid ${active || hovered ? borderColor : 'var(--border)'}`,
        borderLeftWidth: '4px',
        borderLeftColor: borderColor,
        borderRadius: '8px',
        padding: '16px 18px',
        boxShadow: hovered || active ? '0 6px 18px rgba(25, 118, 210, 0.14)' : 'var(--shadow)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minHeight: '110px',
        cursor: interactive ? 'pointer' : 'default',
        transition: 'box-shadow 160ms ease, border-color 160ms ease, transform 160ms ease',
        transform: hovered && interactive ? 'translateY(-1px)' : 'none',
        outline: 'none',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', letterSpacing: '0.02em' }}>
          {label}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {interactive ? (
            <ChevronRight
              size={16}
              color={hovered || active ? borderColor : 'var(--text)'}
              aria-hidden
            />
          ) : null}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: `${borderColor}18`,
              color: borderColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={18} strokeWidth={2} />
          </div>
        </div>
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-h)', lineHeight: 1.2 }}>
        {value}
      </div>
      {subtext ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text)' }}>{subtext}</div>
      ) : null}
      {interactive ? (
        <div
          style={{
            marginTop: 'auto',
            fontSize: '0.7rem',
            color: hovered || active ? borderColor : 'var(--text)',
            fontWeight: 500,
          }}
        >
          {clickHint}
        </div>
      ) : null}
    </div>
  )
}
