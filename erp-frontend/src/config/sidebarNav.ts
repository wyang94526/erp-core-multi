/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Sidebar navigation configuration.
 * Supports category → optional subgroup → link nesting.
 */

import {
  REPORT_CATEGORY_META,
  REPORT_CATEGORY_ORDER,
  REPORT_HUB_CATALOG,
  reportCardId,
  reportCategorySectionId,
} from '../utils/financialReports'

export type NavLinkItem = {
  kind: 'link'
  label: string
  to: string
  end?: boolean
  permission?: string
  /** Optional Lucide icon key rendered in the sidebar. */
  icon?: string
  /** Extra path prefixes that count as active for this link */
  matchPrefixes?: string[]
}

export type NavGroupItem = NavLinkItem | NavGroup

export type NavGroup = {
  kind: 'group'
  id: string
  label: string
  items: NavGroupItem[]
  /** Optional Lucide icon key rendered in the sidebar. */
  icon?: string
  /** Optional destination — used so report category folders can open the hub. */
  to?: string
  /** Path prefixes that keep this group current even when no child hash matches. */
  matchPrefixes?: string[]
}

export type NavEntry = NavLinkItem | NavGroup

export type NavCategory = {
  id: string
  label: string
  /** Role IDs that may see this category (Admin always allowed via hasAnyRole). */
  roles: string[]
  entries: NavEntry[]
}

export type BreadcrumbCrumb = {
  label: string
  to?: string
}

export const ALL_ROLES = [
  'ROLE-ADMIN',
  'ROLE-UNASSIGNED',
  'ROLE-SALES-REP',
  'ROLE-SALES-MGR',
  'ROLE-PURCH-AGENT',
  'ROLE-PURCH-MGR',
  'ROLE-SCO-SUP',
  'ROLE-FIN-APPR',
  'ROLE-MANAGER',
]

const REPORT_NAV_ICONS: Record<string, string> = {
  primary: 'scale',
  operational: 'layers',
  managerial: 'pie-chart',
  'balance-sheet': 'file-spreadsheet',
  'income-statement': 'trending-up',
  'cash-flow': 'dollar-sign',
  'ar-aging': 'clock',
  'ap-aging': 'credit-card',
  'trial-balance': 'list',
  'fixed-asset-schedule': 'package',
  'cash-flow-forecast': 'line-chart',
  'budget-vs-actual': 'percent',
  'bank-reconciliation': 'shield-check',
}

export const NAV_CATEGORIES: NavCategory[] = [
  {
    id: 'home',
    label: '🏠 Home',
    roles: ALL_ROLES,
    entries: [
      { kind: 'link', label: 'Dashboard', to: '/', end: true },
      { kind: 'link', label: 'User Guide', to: '/help' },
      { kind: 'link', label: 'Process Workflows', to: '/help/workflows' },
    ],
  },
  {
    id: 'sales-procurement',
    label: '📦 Sales & Procurement',
    roles: [
      'ROLE-SALES-REP',
      'ROLE-SALES-MGR',
      'ROLE-PURCH-AGENT',
      'ROLE-PURCH-MGR',
      'ROLE-ADMIN',
    ],
    entries: [
      { kind: 'link', label: 'Sales Orders', to: '/sales-orders', permission: 'sales_order:view' },
      { kind: 'link', label: 'Item Fulfillments', to: '/fulfillments', permission: 'sales_order:view' },
      { kind: 'link', label: 'Purchase Orders', to: '/purchase-orders', permission: 'po:view' },
    ],
  },
  {
    id: 'manufacturing',
    label: '🏭 Manufacturing',
    roles: [
      'ROLE-SCO-SUP',
      'ROLE-PURCH-AGENT',
      'ROLE-PURCH-MGR',
      'ROLE-FIN-APPR',
      'ROLE-ADMIN',
    ],
    entries: [
      {
        kind: 'link',
        label: 'Subcontract Orders',
        to: '/subcontract-orders',
        permission: 'subcontract:view',
      },
    ],
  },
  {
    id: 'inventory',
    label: '📋 Inventory',
    roles: ['ROLE-SCO-SUP', 'ROLE-PURCH-AGENT', 'ROLE-MANAGER', 'ROLE-ADMIN'],
    entries: [
      { kind: 'link', label: 'Items', to: '/items' },
      { kind: 'link', label: 'Stock On-Hand & ATP', to: '/inventory', end: true },
      { kind: 'link', label: 'Stock Movements', to: '/inventory/movements' },
      { kind: 'link', label: 'Warehouses & Bins', to: '/inventory/warehouses' },
    ],
  },
  {
    id: 'master-data',
    label: '🤝 Master Data',
    roles: ['ROLE-ADMIN', 'ROLE-MANAGER'],
    entries: [
      { kind: 'link', label: 'Customers', to: '/customers' },
      { kind: 'link', label: 'Vendors', to: '/vendors' },
      { kind: 'link', label: 'Payment Terms', to: '/payment-terms' },
    ],
  },
  {
    id: 'finance-accounting',
    label: '💰 Finance & Accounting',
    roles: ['ROLE-FIN-APPR', 'ROLE-MANAGER', 'ROLE-ADMIN'],
    entries: [
      {
        kind: 'group',
        id: 'accounts-receivable',
        label: '📥 Accounts Receivable',
        items: [
          {
            kind: 'link',
            label: 'Sales Invoices (Customer Invoicing)',
            to: '/sales-invoices',
            permission: 'sales_order:view',
          },
          {
            kind: 'link',
            label: 'AR Aging & Collections',
            to: '/accounts-receivable',
            permission: 'ar_invoice:view',
            matchPrefixes: ['/ar-invoices'],
          },
        ],
      },
      {
        kind: 'group',
        id: 'accounts-payable',
        label: '📤 Accounts Payable',
        items: [
          {
            kind: 'link',
            label: 'Supplier Invoices / Bills',
            to: '/supplier-invoices',
            permission: 'ap_bill:view',
            matchPrefixes: ['/vendor-invoices'],
          },
          {
            kind: 'link',
            label: 'AP Aging & Payments',
            to: '/accounts-payable',
            permission: 'ap_bill:view',
            matchPrefixes: ['/ap-bills'],
          },
        ],
      },
      {
        kind: 'group',
        id: 'cash-treasury',
        label: '🏦 Cash & Treasury Management',
        items: [
          {
            kind: 'link',
            label: 'Cash Management',
            to: '/cash-management',
            permission: 'cash:view',
            end: true,
          },
          {
            kind: 'link',
            label: 'Bank Accounts',
            to: '/bank-accounts',
            permission: 'cash:view',
            matchPrefixes: ['/cash-management/bank-accounts'],
          },
          {
            kind: 'link',
            label: 'Bank Transfers',
            to: '/bank-transfers',
            permission: 'cash:view',
            matchPrefixes: ['/bank-transfers'],
          },
        ],
      },
      {
        kind: 'group',
        id: 'gl-setup',
        label: '📊 General Ledger & Setup',
        items: [
          {
            kind: 'link',
            label: 'Chart of Accounts',
            to: '/chart-of-accounts',
            permission: 'journal:view',
            icon: 'list',
          },
          {
            kind: 'link',
            label: 'Posting Rules',
            to: '/posting-rules',
            permission: 'journal:view',
            icon: 'scale',
          },
          {
            kind: 'link',
            label: 'Payment Terms',
            to: '/payment-terms',
            icon: 'clock',
          },
          {
            kind: 'link',
            label: 'General Ledger',
            to: '/general-ledger',
            permission: 'journal:view',
            end: true,
            icon: 'scale',
          },
          {
            kind: 'link',
            label: 'Manual Journal Entry',
            to: '/general-ledger/journals/new',
            permission: 'journal:create',
            matchPrefixes: ['/general-ledger/journals'],
            icon: 'book-open',
          },
          {
            kind: 'link',
            label: 'Month-End Close',
            to: '/general-ledger/month-end-close',
            permission: 'journal:view',
            end: true,
            icon: 'calendar-check',
          },
          {
            kind: 'link',
            label: 'Year-End Close',
            to: '/general-ledger/year-end-close',
            permission: 'journal:view',
            end: true,
            icon: 'calendar-range',
          },
        ],
      },
      {
        kind: 'group',
        id: 'financial-reports',
        label: '📈 Reports & Analytics',
        to: '/financial-reports',
        matchPrefixes: ['/financial-reports'],
        items: REPORT_CATEGORY_ORDER.map((category) => ({
          kind: 'group' as const,
          id: `rpt-${category}`,
          label: REPORT_CATEGORY_META[category].label,
          icon: REPORT_NAV_ICONS[category],
          to: `/financial-reports#${reportCategorySectionId(category)}`,
          items: REPORT_HUB_CATALOG.filter((report) => report.category === category).map((report) => ({
            kind: 'link' as const,
            label: report.title,
            icon: REPORT_NAV_ICONS[report.id],
            to: `/financial-reports/${report.id}`,
            permission: 'report:view',
            end: true,
          })),
        })),
      },
    ],
  },
  {
    id: 'admin',
    label: '⚙️ Administration',
    roles: ['ROLE-ADMIN'],
    entries: [
      { kind: 'link', label: 'Users & Roles', to: '/admin/rbac', permission: 'admin:manage' },
      {
        kind: 'link',
        label: 'CSV Import',
        to: '/admin/data-import',
        permission: 'admin:manage',
      },
    ],
  },
]

export function flattenNavLinks(entries: Array<NavEntry | NavGroupItem>): NavLinkItem[] {
  const links: NavLinkItem[] = []
  for (const entry of entries) {
    if (entry.kind === 'link') links.push(entry)
    else links.push(...flattenNavLinks(entry.items))
  }
  return links
}

export function splitNavTo(to: string): { path: string; hash: string } {
  const index = to.indexOf('#')
  if (index === -1) return { path: to, hash: '' }
  return { path: to.slice(0, index), hash: to.slice(index) }
}

function normalizeHash(hash: string): string {
  if (!hash) return ''
  return hash.startsWith('#') ? hash : `#${hash}`
}

export function isNavLinkActive(pathname: string, item: NavLinkItem, hash = ''): boolean {
  const { path, hash: itemHash } = splitNavTo(item.to)
  const currentHash = normalizeHash(hash)

  if (itemHash) {
    if (pathname === path) return currentHash === itemHash
    if (pathname.startsWith(`${path}/`)) {
      const reportId = pathname.slice(path.length + 1)
      return itemHash === `#${reportCardId(reportId)}`
    }
    return false
  }

  if (path === '/') {
    return pathname === '/'
  }
  if (path === '/help/workflows') {
    return pathname === '/help/workflows' || pathname.startsWith('/help/workflows/')
  }
  if (path === '/help') {
    if (pathname === '/help/workflows' || pathname.startsWith('/help/workflows/')) return false
    return pathname === '/help' || pathname.startsWith('/help/')
  }
  if (path === '/sales-orders') {
    return (
      pathname === '/sales-orders' ||
      pathname.startsWith('/sales-orders/') ||
      pathname.startsWith('/orders')
    )
  }
  const prefixes = [path, ...(item.matchPrefixes ?? [])]
  for (const prefix of prefixes) {
    if (item.end) {
      if (pathname === prefix) return true
      continue
    }
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true
  }
  return false
}

export function isNavGroupDestinationActive(
  pathname: string,
  group: NavGroup,
  hash = '',
): boolean {
  if (!group.to) return false
  const { path, hash: itemHash } = splitNavTo(group.to)
  if (itemHash) return pathname === path && normalizeHash(hash) === itemHash
  return pathname === path && !normalizeHash(hash)
}

export function isNavGroupActive(pathname: string, group: NavGroup, hash = ''): boolean {
  if (isNavGroupDestinationActive(pathname, group, hash)) return true
  for (const item of group.items) {
    if (item.kind === 'link' && isNavLinkActive(pathname, item, hash)) return true
    if (item.kind === 'group' && isNavGroupActive(pathname, item, hash)) return true
  }
  return (group.matchPrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function collectActiveGroupIds(
  pathname: string,
  hash: string,
  items: Array<NavEntry | NavGroupItem>,
): string[] {
  const ids: string[] = []
  for (const item of items) {
    if (item.kind !== 'group') continue
    if (!isNavGroupActive(pathname, item, hash)) continue
    ids.push(item.id)
    ids.push(...collectActiveGroupIds(pathname, hash, item.items))
  }
  return ids
}

export function findActiveCategoryId(pathname: string, hash = ''): string | null {
  for (const category of NAV_CATEGORIES) {
    const hit = category.entries.some((entry) =>
      entry.kind === 'link'
        ? isNavLinkActive(pathname, entry, hash)
        : isNavGroupActive(pathname, entry, hash),
    )
    if (hit) return category.id
  }
  return null
}

export function findActiveGroupId(
  pathname: string,
  category: NavCategory,
  hash = '',
): string | null {
  for (const entry of category.entries) {
    if (entry.kind === 'group' && isNavGroupActive(pathname, entry, hash)) {
      return entry.id
    }
  }
  return null
}

function findActiveGroupDestination(
  items: NavGroupItem[],
  pathname: string,
  hash: string,
): NavGroup | undefined {
  for (const item of items) {
    if (item.kind !== 'group') continue
    if (isNavGroupDestinationActive(pathname, item, hash)) return item
    const nested = findActiveGroupDestination(item.items, pathname, hash)
    if (nested) return nested
  }
  return undefined
}

function findActiveNavLink(
  items: NavGroupItem[],
  pathname: string,
  hash: string,
): NavLinkItem | undefined {
  for (const item of items) {
    if (item.kind === 'link' && isNavLinkActive(pathname, item, hash)) return item
    if (item.kind === 'group') {
      const nested = findActiveNavLink(item.items, pathname, hash)
      if (nested) return nested
    }
  }
  return undefined
}

function stripLeadingEmoji(label: string): string {
  return label.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '').trim()
}

/** Build breadcrumb trail for the current path from nav config. */
export function getBreadcrumbs(pathname: string, hash = ''): BreadcrumbCrumb[] {
  for (const category of NAV_CATEGORIES) {
    for (const entry of category.entries) {
      if (entry.kind === 'link' && isNavLinkActive(pathname, entry, hash)) {
        if (splitNavTo(entry.to).path === '/') return [{ label: entry.label }]
        return [{ label: stripLeadingEmoji(category.label) }, { label: entry.label }]
      }
      if (entry.kind === 'group') {
        const groupLabel = stripLeadingEmoji(entry.label)
        const categoryLabel = stripLeadingEmoji(category.label)
        if (entry.id === 'financial-reports' && pathname.startsWith('/financial-reports/')) {
          const reportId = pathname.slice('/financial-reports/'.length)
          const report = REPORT_HUB_CATALOG.find((item) => item.id === reportId)
          return [
            { label: categoryLabel },
            { label: groupLabel, to: '/financial-reports' },
            { label: report?.title ?? 'Report' },
          ]
        }

        const destGroup = findActiveGroupDestination(entry.items, pathname, hash)
        if (destGroup) {
          return [
            { label: categoryLabel },
            { label: groupLabel, to: '/financial-reports' },
            { label: destGroup.label },
          ]
        }

        const hashItem = findActiveNavLink(entry.items, pathname, hash)
        if (hashItem) {
          return [
            { label: categoryLabel },
            { label: groupLabel, to: entry.to || undefined },
            { label: hashItem.label },
          ]
        }

        if (isNavGroupActive(pathname, entry, hash)) {
          return [{ label: categoryLabel }, { label: groupLabel }]
        }
      }
    }
  }
  return []
}
