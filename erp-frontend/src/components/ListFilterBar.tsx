/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { Link, useSearchParams } from 'react-router-dom'
import type { CSSProperties, ReactNode } from 'react'
import { METRIC_PAGE_TITLES } from '../config/metricRoutes'
import type { MetricDrillKey } from '../types/dashboard'

export type FilterOption = { value: string; label: string }

export type FilterField = {
  key: string
  label: string
  options: FilterOption[]
  /** Value treated as "no filter" and removed from the URL */
  allValue?: string
}

type ListFilterBarProps = {
  fields: FilterField[]
  /** Optional extra content on the right of the filter row */
  trailing?: ReactNode
}

export function useListFilterParams(fields: FilterField[]) {
  const [searchParams, setSearchParams] = useSearchParams()
  const fromDashboard = searchParams.get('from') === 'dashboard'
  const metric = (searchParams.get('metric') || '') as MetricDrillKey | ''

  const values: Record<string, string> = {}
  for (const field of fields) {
    const allValue = field.allValue ?? 'ALL'
    values[field.key] = searchParams.get(field.key) || allValue
  }

  const updateParam = (key: string, value: string) => {
    const field = fields.find((f) => f.key === key)
    const allValue = field?.allValue ?? 'ALL'
    const next = new URLSearchParams(searchParams)
    if (!value || value === allValue) next.delete(key)
    else next.set(key, value)
    if (fromDashboard) next.set('from', 'dashboard')
    if (metric) next.set('metric', metric)
    setSearchParams(next, { replace: true })
  }

  const clearFilters = () => {
    const next = new URLSearchParams()
    if (fromDashboard) next.set('from', 'dashboard')
    if (metric) next.set('metric', metric)
    setSearchParams(next, { replace: true })
  }

  const hasActiveFilters = fields.some((field) => {
    const allValue = field.allValue ?? 'ALL'
    return (searchParams.get(field.key) || allValue) !== allValue
  })

  const metricTitle =
    (metric && METRIC_PAGE_TITLES[metric]) || 'Filtered from Dashboard'

  return {
    searchParams,
    values,
    updateParam,
    clearFilters,
    hasActiveFilters,
    fromDashboard,
    metric,
    metricTitle,
  }
}

export function DashboardContextBanner({
  title,
  subtitle,
  onClear,
  showClear,
}: {
  title: string
  subtitle?: string
  onClear?: () => void
  showClear?: boolean
}) {
  return (
    <div style={contextBannerStyle}>
      <div>
        <div style={contextEyebrowStyle}>FROM DASHBOARD</div>
        <div style={contextTitleStyle}>{title}</div>
        {subtitle ? <div style={contextSubStyle}>{subtitle}</div> : null}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link to="/" style={linkBtnStyle}>
          ← Back to Dashboard
        </Link>
        {showClear && onClear ? (
          <button type="button" onClick={onClear} style={ghostBtnStyle}>
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function ListFilterBar({ fields, trailing }: ListFilterBarProps) {
  const { values, updateParam, clearFilters, hasActiveFilters } = useListFilterParams(fields)

  return (
    <div style={filtersBarStyle}>
      {fields.map((field) => {
        const allValue = field.allValue ?? 'ALL'
        const selectId = `filter-${field.key}`
        return (
          <label key={field.key} htmlFor={selectId} style={filterFieldStyle}>
            <span style={filterLabelStyle}>{field.label}</span>
            <select
              id={selectId}
              value={values[field.key] || allValue}
              onChange={(e) => updateParam(field.key, e.target.value)}
              style={filterSelectStyle}
            >
              {field.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )
      })}
      {hasActiveFilters ? (
        <div style={filterClearWrapStyle}>
          <button type="button" onClick={clearFilters} style={ghostBtnStyle}>
            Clear filters
          </button>
        </div>
      ) : null}
      {trailing}
    </div>
  )
}

const filtersBarStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-end',
  flexWrap: 'wrap',
  gap: 16,
  marginBottom: 16,
  padding: '16px 18px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  boxShadow: 'var(--shadow)',
}

const filterFieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 150,
  flex: '1 1 150px',
  maxWidth: 220,
}

const filterLabelStyle: CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  color: 'var(--text)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const filterSelectStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
  fontSize: '0.875rem',
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const filterClearWrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  paddingBottom: 1,
  marginLeft: 'auto',
}

const contextBannerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
  marginBottom: 16,
  padding: '14px 16px',
  borderRadius: 8,
  border: '1px solid #90caf9',
  background: 'linear-gradient(135deg, #e3f2fd 0%, #f5f9fc 60%, #fff 100%)',
}

const contextEyebrowStyle: CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 700,
  color: '#1565c0',
  letterSpacing: '0.04em',
}

const contextTitleStyle: CSSProperties = {
  fontWeight: 600,
  color: 'var(--text-h)',
  marginTop: 2,
}

const contextSubStyle: CSSProperties = {
  fontSize: '0.85rem',
  color: 'var(--text)',
  marginTop: 4,
}

const linkBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '8px 12px',
  borderRadius: 6,
  background: '#1976d2',
  color: '#fff',
  textDecoration: 'none',
  fontSize: '0.8rem',
  fontWeight: 700,
}

const ghostBtnStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-h)',
  fontSize: '0.8rem',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
