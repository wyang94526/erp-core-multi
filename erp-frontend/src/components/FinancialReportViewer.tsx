/**
 * Financial report viewer with global filters and PDF / CSV / Excel export.
 */

import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { financialReportService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type { FinancialReportExportFormat, FinancialReportQuery } from '../types'
import {
  EXPORT_FORMATS,
  REPORT_CURRENCIES,
  defaultReportFilters,
  downloadTextFile,
  filtersFromPeriod,
  formatReportNumber,
  reportFileStem,
  reportToCsv,
} from '../utils/financialReports'
import {
  containerStyle,
  pageHeaderStyle,
  pageSubStyle,
  pageTitleStyle,
} from './dashboard/dashboardStyles'

export default function FinancialReportViewer() {
  const { reportType } = useParams<{ reportType: string }>()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canView = hasPermission('report:view')
  const [filters, setFilters] = useState<FinancialReportQuery>(() => defaultReportFilters())
  const [applied, setApplied] = useState<FinancialReportQuery>(() => defaultReportFilters())
  const [exportFormat, setExportFormat] = useState<FinancialReportExportFormat>('pdf')

  const type = (reportType || '').trim()

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['financialReport', type, applied],
    queryFn: () => financialReportService.getFinancialReport(type, applied),
    enabled: canView && Boolean(type),
  })

  const catalogQuery = useQuery({
    queryKey: ['financialReports'],
    queryFn: () => financialReportService.listReports(),
    enabled: canView,
  })
  const catalogTitle = catalogQuery.data?.find((item) => item.id === type)?.title

  const handleApply = (event: FormEvent) => {
    event.preventDefault()
    setApplied({ ...filters })
  }

  const handleExport = () => {
    if (!data) return
    if (exportFormat === 'pdf') {
      window.print()
      return
    }
    const csv = reportToCsv(data)
    const stem = reportFileStem(data)
    if (exportFormat === 'excel') {
      downloadTextFile(`${stem}.csv`, `\uFEFF${csv}`, 'application/vnd.ms-excel;charset=utf-8')
      return
    }
    downloadTextFile(`${stem}.csv`, csv, 'text/csv;charset=utf-8')
  }

  const currency = data?.currency || filters.currency || 'USD'

  const summaryEntries = useMemo(() => {
    if (!data?.summary) return []
    return Object.entries(data.summary).filter(([, value]) => typeof value === 'number')
  }, [data])

  if (!canView) {
    return (
      <div style={containerStyle}>
        <h2 style={pageTitleStyle}>Financial Reports</h2>
        <p style={pageSubStyle}>You need the report:view permission to view this statement.</p>
      </div>
    )
  }

  return (
    <div style={containerStyle} className="financial-report-page">
      <header style={pageHeaderStyle} className="financial-report-no-print">
        <div>
          <h2 style={pageTitleStyle}>{data?.title || catalogTitle || 'Financial Report'}</h2>
          <p style={pageSubStyle}>{data?.subtitle || 'Set period filters, then generate the statement.'}</p>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={() => navigate('/financial-reports')}>
          Financial Reports
        </button>
      </header>

      <form style={filterBarStyle} onSubmit={handleApply} className="financial-report-no-print">
        <label style={filterLabelStyle}>
          As of date
          <input
            type="date"
            style={inputStyle}
            value={filters.as_of_date || ''}
            onChange={(e) => setFilters((current) => ({ ...current, as_of_date: e.target.value }))}
          />
        </label>
        <label style={filterLabelStyle}>
          Date from
          <input
            type="date"
            style={inputStyle}
            value={filters.date_from || ''}
            onChange={(e) => setFilters((current) => ({ ...current, date_from: e.target.value }))}
          />
        </label>
        <label style={filterLabelStyle}>
          Date to
          <input
            type="date"
            style={inputStyle}
            value={filters.date_to || ''}
            onChange={(e) => setFilters((current) => ({ ...current, date_to: e.target.value }))}
          />
        </label>
        <label style={filterLabelStyle}>
          Period
          <input
            type="month"
            style={inputStyle}
            value={filters.period || ''}
            onChange={(e) => setFilters((current) => filtersFromPeriod(e.target.value, current))}
          />
        </label>
        <label style={filterLabelStyle}>
          Fiscal year
          <input
            type="number"
            style={inputStyle}
            value={filters.fiscal_year ?? ''}
            onChange={(e) =>
              setFilters((current) => ({ ...current, fiscal_year: Number(e.target.value) || undefined }))
            }
          />
        </label>
        <label style={filterLabelStyle}>
          Currency
          <select
            style={inputStyle}
            value={filters.currency || 'USD'}
            onChange={(e) => setFilters((current) => ({ ...current, currency: e.target.value }))}
          >
            {REPORT_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label style={filterLabelStyle}>
          Branch
          <select style={inputStyle} value={filters.branch || 'COMPANY'} disabled>
            <option value="COMPANY">Company-wide</option>
          </select>
        </label>
        <label style={filterLabelStyle}>
          Export format
          <select
            style={inputStyle}
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as FinancialReportExportFormat)}
          >
            {EXPORT_FORMATS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div style={filterActionsStyle}>
          <button type="submit" style={primaryButtonStyle} disabled={isFetching}>
            {isFetching ? 'Generating…' : 'Generate Report'}
          </button>
          <button type="button" style={secondaryButtonStyle} onClick={handleExport} disabled={!data}>
            Export
          </button>
        </div>
      </form>

      {isLoading ? <p style={pageSubStyle}>Generating report…</p> : null}
      {isError ? (
        <p style={{ ...pageSubStyle, color: '#c62828' }}>
          {error instanceof Error ? error.message : 'Failed to generate report'}
          <button type="button" style={{ ...secondaryButtonStyle, marginLeft: 12 }} onClick={() => void refetch()}>
            Retry
          </button>
        </p>
      ) : null}

      {data ? (
        <div className="financial-report-print-root">
          <div style={printHeaderStyle} className="financial-report-print-only">
            <h2 style={{ ...pageTitleStyle, fontSize: 20 }}>{data.title}</h2>
            <p style={pageSubStyle}>{data.subtitle}</p>
          </div>
          {summaryEntries.length > 0 ? (
            <div style={summaryGrid} className="financial-report-no-print">
              {summaryEntries.map(([key, value]) => (
                <div key={key} style={summaryCard}>
                  <div style={summaryLabel}>{key.replace(/_/g, ' ')}</div>
                  <div style={summaryValue}>
                    {typeof value === 'number'
                      ? formatReportNumber(value, currency, 'number')
                      : String(value)}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {data.columns.map((column) => (
                    <th
                      key={column.key}
                      style={{
                        ...thStyle,
                        textAlign: column.align,
                      }}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  <tr key={row.id || `${index}`} style={rowStyle(row.emphasis)}>
                    {data.columns.map((column, columnIndex) => {
                      const raw = row.cells[column.key]
                      const indent = columnIndex === 0 ? (row.indent || 0) * 16 : 0
                      const isAmount = column.format === 'number' || column.format === 'percent'
                      const negative = isAmount && typeof raw === 'number' && raw < 0
                      let content: ReactNode
                      if (raw === null || raw === undefined || raw === '') {
                        content = ''
                      } else if (isAmount) {
                        content = formatReportNumber(raw, currency, column.format === 'percent' ? 'percent' : 'number')
                      } else {
                        content = String(raw)
                      }
                      const clickable = Boolean(row.link && columnIndex === 0 && content)
                      return (
                        <td
                          key={column.key}
                          style={{
                            ...tdStyle,
                            textAlign: column.align,
                            paddingLeft: 12 + indent,
                            fontVariantNumeric: isAmount ? 'tabular-nums' : undefined,
                            color: negative ? '#c62828' : undefined,
                            fontWeight: row.emphasis === 'section' || row.emphasis === 'total' || row.emphasis === 'net' ? 700 : 400,
                            borderBottom:
                              row.emphasis === 'net'
                                ? '3px double var(--text-h)'
                                : row.emphasis === 'total'
                                  ? '1px solid var(--text-h)'
                                  : tdStyle.borderBottom,
                          }}
                        >
                          {clickable && row.link ? (
                            <Link to={row.link} style={linkStyle}>
                              {content}
                            </Link>
                          ) : (
                            content
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.notes?.length ? (
            <ul style={notesStyle}>
              {data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function rowStyle(emphasis?: string): CSSProperties {
  if (emphasis === 'section') {
    return { backgroundColor: 'var(--social-bg)' }
  }
  return {}
}

const filterBarStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
  gap: 12,
  marginBottom: 20,
  padding: 16,
  border: '1px solid var(--border)',
  borderRadius: 8,
  backgroundColor: 'var(--bg)',
}

const filterLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text)',
}

const filterActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 8,
  gridColumn: 'span 2',
}

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 13,
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
}

const primaryButtonStyle: CSSProperties = {
  padding: '9px 14px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  fontFamily: 'inherit',
}

const secondaryButtonStyle: CSSProperties = {
  padding: '9px 14px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  fontFamily: 'inherit',
}

const tableWrap: CSSProperties = {
  overflowX: 'auto',
  border: '1px solid var(--border)',
  borderRadius: 8,
  backgroundColor: 'var(--bg)',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
}

const thStyle: CSSProperties = {
  padding: '10px 12px',
  backgroundColor: 'var(--social-bg)',
  borderBottom: '1px solid var(--border)',
  fontSize: 12,
  color: 'var(--text)',
  whiteSpace: 'nowrap',
}

const tdStyle: CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-h)',
  verticalAlign: 'top',
}

const summaryGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 12,
  marginBottom: 16,
}

const summaryCard: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  backgroundColor: 'var(--bg)',
}

const summaryLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  color: 'var(--text)',
  marginBottom: 4,
}

const summaryValue: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--text-h)',
  fontVariantNumeric: 'tabular-nums',
}

const notesStyle: CSSProperties = {
  margin: '16px 0 0',
  paddingLeft: 18,
  color: 'var(--text)',
  fontSize: 13,
  lineHeight: 1.45,
}

const linkStyle: CSSProperties = {
  color: '#1565c0',
  fontWeight: 700,
  textDecoration: 'none',
}

const printHeaderStyle: CSSProperties = {
  display: 'none',
  marginBottom: 12,
}
