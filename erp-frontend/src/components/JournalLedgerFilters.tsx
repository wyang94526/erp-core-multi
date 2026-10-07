/**
 * @author: Wendy Yang
 * @date: 2026-09-30
 */

import { useSearchParams } from 'react-router-dom'
import { useMemo, type CSSProperties, type ChangeEvent } from 'react'
import type { PostingRule } from '../types'
import {
  EMPTY_JOURNAL_LEDGER_FILTERS,
  JOURNAL_SOURCE_FILTER_OPTIONS,
  JOURNAL_SOURCE_VALUES,
  encodeJournalSources,
  journalLedgerFiltersActive,
  journalSourceIsSelected,
  journalSourcesAreAll,
  operatingJournalSources,
  parseJournalSources,
  type JournalLedgerFilters,
} from '../utils/journalEntries'

type JournalLedgerFiltersBarProps = {
  rules: PostingRule[]
  onExport?: () => void
  exportCount?: number
  exportDisabled?: boolean
}

export function useJournalLedgerFilters() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryKey = searchParams.toString()
  const filters = useMemo<JournalLedgerFilters>(
    () => ({
      q: searchParams.get('q') || '',
      source: searchParams.get('source') || 'ALL',
      origin: searchParams.get('origin') || 'ALL',
      date_from: searchParams.get('date_from') || '',
      date_to: searchParams.get('date_to') || '',
      period: searchParams.get('period') || '',
      rule: searchParams.get('rule') || 'ALL',
      posting: searchParams.get('posting') || 'Posted',
      approval: searchParams.get('approval') || 'ALL',
    }),
    [queryKey, searchParams],
  )

  const setFilter = (key: keyof JournalLedgerFilters, value: string) => {
    const next = new URLSearchParams(searchParams)
    const fallback = EMPTY_JOURNAL_LEDGER_FILTERS[key]
    if (!value || value === fallback) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true })

  return {
    filters,
    setFilter,
    clearFilters,
    hasActiveFilters: journalLedgerFiltersActive(filters),
  }
}

export function JournalLedgerFiltersBar({
  rules,
  onExport,
  exportCount,
  exportDisabled,
}: JournalLedgerFiltersBarProps) {
  const { filters, setFilter, clearFilters, hasActiveFilters } = useJournalLedgerFilters()
  const canExport = Boolean(onExport) && !exportDisabled && (exportCount ?? 0) > 0
  const allSourcesSelected = journalSourcesAreAll(filters.source)
  const excludeCloseActive = filters.source === operatingJournalSources()

  const onChange =
    (key: keyof JournalLedgerFilters) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFilter(key, event.target.value)
    }

  const toggleSource = (value: string, checked: boolean) => {
    const current = allSourcesSelected ? [...JOURNAL_SOURCE_VALUES] : parseJournalSources(filters.source)
    const next = checked ? [...current, value] : current.filter((item) => item !== value)
    setFilter('source', encodeJournalSources(next))
  }

  return (
    <div style={filtersBarStyle}>
      <label style={{ ...fieldStyle, flex: '2 1 220px', maxWidth: 320 }}>
        <span style={labelStyle}>Search</span>
        <input
          type="search"
          value={filters.q}
          onChange={onChange('q')}
          placeholder="Journal ID, description, reference, source #, rule id"
          style={inputStyle}
        />
      </label>
      <div style={{ ...fieldStyle, flex: '2 1 520px', maxWidth: 720, minWidth: 280 }}>
        <span style={labelStyle}>Journal source</span>
        <div style={sourceToolbarStyle}>
          <button
            type="button"
            onClick={() => setFilter('source', operatingJournalSources())}
            disabled={excludeCloseActive}
            title="Leave out Month-End Close and Year-End Close so the list matches the Income Statement"
            style={{
              ...sourceChipStyle,
              background: excludeCloseActive ? '#1565c0' : 'var(--bg)',
              color: excludeCloseActive ? '#fff' : 'var(--text-h)',
              borderColor: excludeCloseActive ? '#1565c0' : 'var(--border)',
              cursor: excludeCloseActive ? 'default' : 'pointer',
            }}
          >
            Exclude close
          </button>
          <button
            type="button"
            onClick={() => setFilter('source', 'ALL')}
            disabled={allSourcesSelected}
            title="Include every journal source"
            style={sourceChipStyle}
          >
            All sources
          </button>
        </div>
        <div style={sourceGridStyle} role="group" aria-label="Journal sources">
          {JOURNAL_SOURCE_FILTER_OPTIONS.filter((option) => option.value !== 'ALL').map((option) => (
            <label key={option.value} style={sourceOptionStyle}>
              <input
                type="checkbox"
                checked={journalSourceIsSelected(filters.source, option.value)}
                onChange={(event) => toggleSource(option.value, event.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>
      <label style={fieldStyle}>
        <span style={labelStyle}>Origin</span>
        <select value={filters.origin} onChange={onChange('origin')} style={inputStyle}>
          <option value="ALL">All</option>
          <option value="SYSTEM">System generated</option>
          <option value="MANUAL">Manual / imported</option>
        </select>
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>Posted from</span>
        <input type="date" value={filters.date_from} onChange={onChange('date_from')} style={inputStyle} />
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>Posted to</span>
        <input type="date" value={filters.date_to} onChange={onChange('date_to')} style={inputStyle} />
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>Period</span>
        <input type="month" value={filters.period} onChange={onChange('period')} style={inputStyle} />
      </label>
      <label style={{ ...fieldStyle, flex: '1.4 1 200px', maxWidth: 280 }}>
        <span style={labelStyle}>Posting rule</span>
        <select value={filters.rule} onChange={onChange('rule')} style={inputStyle}>
          <option value="ALL">All rules</option>
          {rules.map((rule) => (
            <option key={rule.id} value={rule.id}>
              {rule.rule_code} — {rule.name}
            </option>
          ))}
        </select>
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>Posting</span>
        <select value={filters.posting} onChange={onChange('posting')} style={inputStyle}>
          <option value="ALL">All</option>
          <option value="Draft">Draft</option>
          <option value="Posted">Posted</option>
        </select>
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>Approval</span>
        <select value={filters.approval} onChange={onChange('approval')} style={inputStyle}>
          <option value="ALL">All</option>
          <option value="DRAFT">Draft</option>
          <option value="PENDING_APPROVAL">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      <div style={clearWrapStyle}>
        {hasActiveFilters ? (
          <button type="button" onClick={clearFilters} style={clearButtonStyle}>
            Clear filters
          </button>
        ) : null}
        {onExport ? (
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport}
            title={
              canExport
                ? `Export ${exportCount} journal${exportCount === 1 ? '' : 's'} matching current filters`
                : 'No journals match the current filters'
            }
            style={{
              ...clearButtonStyle,
              background: canExport ? '#1565c0' : 'var(--bg)',
              color: canExport ? '#fff' : '#90a4ae',
              borderColor: canExport ? '#1565c0' : 'var(--border)',
              cursor: canExport ? 'pointer' : 'not-allowed',
            }}
          >
            Export CSV
          </button>
        ) : null}
      </div>
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

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 150,
  flex: '1 1 150px',
  maxWidth: 220,
}

const labelStyle: CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  color: 'var(--text)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const sourceToolbarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
}

const sourceChipStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-h)',
  fontSize: '0.75rem',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const sourceGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: '4px 12px',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  backgroundColor: 'var(--bg)',
}

const sourceOptionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: '0.8rem',
  color: 'var(--text-h)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
  fontSize: '0.875rem',
  fontFamily: 'inherit',
}

const clearWrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 8,
  paddingBottom: 1,
  marginLeft: 'auto',
}

const clearButtonStyle: CSSProperties = {
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
