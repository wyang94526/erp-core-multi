/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { FinancialReport, FinancialReportCatalogItem, FinancialReportQuery } from '../types'

export const REPORT_CATEGORY_ORDER = ['primary', 'operational', 'managerial'] as const

export const REPORT_CATEGORY_META: Record<
  (typeof REPORT_CATEGORY_ORDER)[number],
  { accent: string; label: string }
> = {
  primary: { accent: '#2196F3', label: 'Primary Financial Statements' },
  operational: { accent: '#00897b', label: 'Operational & Sub-Ledger Reports' },
  managerial: { accent: '#fb8c00', label: 'Managerial & Cash Reports' },
}

export function reportCategorySectionId(category: string): string {
  return `report-category-${category}`
}

export function reportCardId(reportId: string): string {
  return `report-card-${reportId}`
}

export const REPORT_HUB_CATALOG: FinancialReportCatalogItem[] = [
  {
    id: 'balance-sheet',
    title: 'Balance Sheet',
    category: 'primary',
    category_label: REPORT_CATEGORY_META.primary.label,
    description:
      'Assets, liabilities, and equity as of the selected date, with current-period net income plugged to equity.',
    parameters: ['As Of Date', 'Fiscal Year', 'Currency'],
    default_action: 'Generate Report',
  },
  {
    id: 'income-statement',
    title: 'Income Statement (Profit & Loss)',
    category: 'primary',
    category_label: REPORT_CATEGORY_META.primary.label,
    description: 'Revenue, cost of sales, and operating expenses for the selected period with net income.',
    parameters: ['Date Range', 'Financial Period', 'Currency'],
    default_action: 'Generate Report',
  },
  {
    id: 'cash-flow',
    title: 'Statement of Cash Flows',
    category: 'primary',
    category_label: REPORT_CATEGORY_META.primary.label,
    description: 'Operating, investing, and financing cash movements from posted cash and bank G/L activity.',
    parameters: ['Date Range', 'Currency'],
    default_action: 'Generate Report',
  },
  {
    id: 'ar-aging',
    title: 'Accounts Receivable Aging',
    category: 'operational',
    category_label: REPORT_CATEGORY_META.operational.label,
    description: 'Open customer invoices bucketed Current / 1–30 / 31–60 / 61–90 / 90+ by due date.',
    parameters: ['As Of Date'],
    default_action: 'View',
  },
  {
    id: 'ap-aging',
    title: 'Accounts Payable Aging',
    category: 'operational',
    category_label: REPORT_CATEGORY_META.operational.label,
    description: 'Open supplier bills bucketed Current / 1–30 / 31–60 / 61–90 / 90+ by due date.',
    parameters: ['As Of Date'],
    default_action: 'View',
  },
  {
    id: 'trial-balance',
    title: 'Trial Balance',
    category: 'operational',
    category_label: REPORT_CATEGORY_META.operational.label,
    description: 'Debit and credit totals by G/L account from posted journals through the as-of date.',
    parameters: ['As Of Date', 'Currency'],
    default_action: 'Generate Report',
  },
  {
    id: 'fixed-asset-schedule',
    title: 'Fixed Asset Schedule',
    category: 'operational',
    category_label: REPORT_CATEGORY_META.operational.label,
    description:
      'Beginning balance, additions, disposals, and ending net book value for PPE and contra-depreciation accounts.',
    parameters: ['Date Range', 'As Of Date'],
    default_action: 'Generate Report',
  },
  {
    id: 'cash-flow-forecast',
    title: 'Cash Flow Forecast',
    category: 'managerial',
    category_label: REPORT_CATEGORY_META.managerial.label,
    description: 'Starting cash plus expected AR collections and AP payments by due-date bucket.',
    parameters: ['As Of Date'],
    default_action: 'View',
  },
  {
    id: 'budget-vs-actual',
    title: 'Budget vs. Actual',
    category: 'managerial',
    category_label: REPORT_CATEGORY_META.managerial.label,
    description: 'P&L actuals against the budget book (or prior-year actuals when no budget is loaded).',
    parameters: ['Financial Period', 'Fiscal Year', 'Currency'],
    default_action: 'Generate Report',
  },
  {
    id: 'bank-reconciliation',
    title: 'Bank Reconciliation Summary',
    category: 'managerial',
    category_label: REPORT_CATEGORY_META.managerial.label,
    description: 'Book balance versus cleared and outstanding cash instruments per company bank account.',
    parameters: ['As Of Date', 'Period'],
    default_action: 'View',
  },
]

export const REPORT_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'CNY', 'JPY', 'TWD']

export const EXPORT_FORMATS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'csv', label: 'CSV' },
  { value: 'excel', label: 'Excel' },
] as const

export function pad2(value: number) {
  return String(value).padStart(2, '0')
}

export function isoDate(value: Date) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
}

export function monthPeriod(value: Date = new Date()) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}`
}

export function monthBounds(period: string): { from: string; to: string } {
  const [yearText, monthText] = period.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const last = new Date(year, month, 0).getDate()
  return {
    from: `${yearText}-${monthText}-01`,
    to: `${yearText}-${monthText}-${pad2(last)}`,
  }
}

export function defaultReportFilters(): FinancialReportQuery {
  const today = new Date()
  const period = monthPeriod(today)
  const bounds = monthBounds(period)
  return {
    as_of_date: isoDate(today),
    date_from: bounds.from,
    date_to: isoDate(today) < bounds.to ? isoDate(today) : bounds.to,
    period,
    fiscal_year: today.getFullYear(),
    currency: 'USD',
    branch: 'COMPANY',
  }
}

export function filtersFromPeriod(period: string, current: FinancialReportQuery): FinancialReportQuery {
  const bounds = monthBounds(period)
  const today = isoDate(new Date())
  const asOf = today < bounds.to ? today : bounds.to
  return {
    ...current,
    period,
    fiscal_year: Number(period.slice(0, 4)) || current.fiscal_year,
    date_from: bounds.from,
    date_to: bounds.to,
    as_of_date: asOf,
  }
}

export function groupReports(items: FinancialReportCatalogItem[]) {
  const groups: { id: string; label: string; items: FinancialReportCatalogItem[] }[] = []
  for (const category of REPORT_CATEGORY_ORDER) {
    const grouped = items.filter((item) => item.category === category)
    if (grouped.length === 0) continue
    groups.push({
      id: category,
      label: grouped[0].category_label,
      items: grouped,
    })
  }
  const leftovers = items.filter((item) => !REPORT_CATEGORY_ORDER.includes(item.category as (typeof REPORT_CATEGORY_ORDER)[number]))
  if (leftovers.length > 0) {
    groups.push({ id: 'other', label: 'Other Reports', items: leftovers })
  }
  return groups
}

export function formatReportNumber(
  value: string | number | null | undefined,
  currency: string,
  format: 'number' | 'percent',
) {
  if (value === null || value === undefined || value === '') return ''
  const amount = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(amount)) return String(value)
  if (format === 'percent') {
    return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(amount)}%`
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function reportToCsv(report: FinancialReport) {
  const header = report.columns.map((column) => csvEscape(column.label)).join(',')
  const lines = report.rows.map((row) =>
    report.columns
      .map((column) => {
        const raw = row.cells[column.key]
        if (raw === null || raw === undefined) return ''
        if (column.format === 'number' || column.format === 'percent') {
          return csvEscape(String(raw))
        }
        return csvEscape(String(raw))
      })
      .join(','),
  )
  return [header, ...lines].join('\n')
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function reportFileStem(report: FinancialReport) {
  const stamp = (report.filters?.as_of_date || report.filters?.period || '').replace(/[^\d-]/g, '')
  return `${report.report_type}${stamp ? `-${stamp}` : ''}`
}
