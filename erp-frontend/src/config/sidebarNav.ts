/**
 * Sidebar navigation configuration.
 * Supports category → optional subgroup → link nesting.
 */

export type NavLinkItem = {
  kind: 'link'
  label: string
  to: string
  end?: boolean
  permission?: string
  /** Extra path prefixes that count as active for this link */
  matchPrefixes?: string[]
}

export type NavGroup = {
  kind: 'group'
  id: string
  label: string
  items: NavLinkItem[]
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
          },
          {
            kind: 'link',
            label: 'General Ledger',
            to: '/general-ledger',
            permission: 'journal:view',
          },
        ],
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

export function flattenNavLinks(entries: NavEntry[]): NavLinkItem[] {
  const links: NavLinkItem[] = []
  for (const entry of entries) {
    if (entry.kind === 'link') links.push(entry)
    else links.push(...entry.items)
  }
  return links
}

export function isNavLinkActive(pathname: string, item: NavLinkItem): boolean {
  if (item.to === '/') {
    return pathname === '/'
  }
  if (item.to === '/help/workflows') {
    return pathname === '/help/workflows' || pathname.startsWith('/help/workflows/')
  }
  if (item.to === '/help') {
    if (pathname === '/help/workflows' || pathname.startsWith('/help/workflows/')) return false
    return pathname === '/help' || pathname.startsWith('/help/')
  }
  if (item.to === '/sales-orders') {
    return (
      pathname === '/sales-orders' ||
      pathname.startsWith('/sales-orders/') ||
      pathname.startsWith('/orders')
    )
  }
  const prefixes = [item.to, ...(item.matchPrefixes ?? [])]
  for (const prefix of prefixes) {
    if (item.end) {
      if (pathname === prefix) return true
      continue
    }
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true
  }
  return false
}

export function findActiveCategoryId(pathname: string): string | null {
  for (const category of NAV_CATEGORIES) {
    if (flattenNavLinks(category.entries).some((item) => isNavLinkActive(pathname, item))) {
      return category.id
    }
  }
  return null
}

export function findActiveGroupId(pathname: string, category: NavCategory): string | null {
  for (const entry of category.entries) {
    if (entry.kind === 'group' && entry.items.some((item) => isNavLinkActive(pathname, item))) {
      return entry.id
    }
  }
  return null
}

function stripLeadingEmoji(label: string): string {
  return label.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '').trim()
}

/** Build breadcrumb trail for the current path from nav config. */
export function getBreadcrumbs(pathname: string): BreadcrumbCrumb[] {
  for (const category of NAV_CATEGORIES) {
    for (const entry of category.entries) {
      if (entry.kind === 'link' && isNavLinkActive(pathname, entry)) {
        if (entry.to === '/') return [{ label: entry.label }]
        return [{ label: stripLeadingEmoji(category.label) }, { label: entry.label }]
      }
      if (entry.kind === 'group') {
        for (const item of entry.items) {
          if (isNavLinkActive(pathname, item)) {
            return [
              { label: stripLeadingEmoji(category.label) },
              { label: stripLeadingEmoji(entry.label) },
              { label: item.label },
            ]
          }
        }
      }
    }
  }
  return []
}
