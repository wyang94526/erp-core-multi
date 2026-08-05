import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type NavItem = {
  label: string
  to: string
  end?: boolean
  permission?: string
}

type NavCategory = {
  id: string
  label: string
  items: NavItem[]
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    id: 'sales-purchasing',
    label: '📦 Sales & Purchasing',
    items: [
      { label: 'Sales Orders', to: '/', end: true, permission: 'sales_order:view' },
      { label: 'Purchase Orders', to: '/purchase-orders', permission: 'po:view' },
      { label: 'Subcontract Orders', to: '/subcontract-orders', permission: 'subcontract:view' },
    ],
  },
  {
    id: 'entities-catalog',
    label: '🤝 Entities & Catalog',
    items: [
      { label: 'Customers', to: '/customers' },
      { label: 'Vendors', to: '/vendors' },
      { label: 'Items', to: '/items' },
    ],
  },
  {
    id: 'inventory',
    label: '🏭 Inventory',
    items: [
      { label: 'Stock On-Hand & ATP', to: '/inventory', end: true },
      { label: 'Stock Movements', to: '/inventory/movements' },
      { label: 'Warehouses & Bins', to: '/inventory/warehouses' },
    ],
  },
  {
    id: 'finance-accounting',
    label: '💰 Finance & Accounting',
    items: [
      { label: 'Chart of Accounts', to: '/chart-of-accounts', permission: 'journal:view' },
      { label: 'Accounts Receivable', to: '/ar-invoices', permission: 'ar_invoice:view' },
      { label: 'Accounts Payable', to: '/ap-bills', permission: 'ap_bill:view' },
      { label: 'Cash Management', to: '/cash-management', permission: 'cash:view' },
      { label: 'General Ledger', to: '/general-ledger', permission: 'journal:view' },
    ],
  },
  {
    id: 'admin',
    label: '⚙️ Administration',
    items: [
      { label: 'Users & Roles', to: '/admin/rbac', permission: 'admin:manage' },
    ],
  },
]

function isItemActive(pathname: string, item: NavItem): boolean {
  if (item.to === '/') {
    return pathname === '/' || pathname.startsWith('/orders')
  }
  if (item.end) {
    return pathname === item.to
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

function findActiveCategoryId(pathname: string): string | null {
  for (const category of NAV_CATEGORIES) {
    if (category.items.some((item) => isItemActive(pathname, item))) {
      return category.id
    }
  }
  return null
}

type SidebarNavProps = {
  collapsed: boolean
  onNavigate?: () => void
}

export default function SidebarNav({ collapsed, onNavigate }: SidebarNavProps) {
  const location = useLocation()
  const { hasPermission, loading } = useAuth()
  const activeCategoryId = findActiveCategoryId(location.pathname)
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const category of NAV_CATEGORIES) {
      initial[category.id] = category.id === activeCategoryId
    }
    return initial
  })

  useEffect(() => {
    if (!activeCategoryId) return
    setOpenCategories((prev) => {
      if (prev[activeCategoryId]) return prev
      return { ...prev, [activeCategoryId]: true }
    })
  }, [activeCategoryId])

  const toggleCategory = (id: string) => {
    setOpenCategories((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const visibleCategories = NAV_CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter(
      (item) => !item.permission || loading || hasPermission(item.permission),
    ),
  })).filter((category) => category.items.length > 0)

  return (
    <aside
      className={`app-sidebar${collapsed ? ' collapsed' : ''}`}
      aria-hidden={collapsed}
    >
      <div className="app-sidebar-inner">
        <div className="app-sidebar-brand">GTT-USA ERP</div>
        <nav className="app-sidebar-nav" aria-label="Main">
          {visibleCategories.map((category) => {
            const isOpen = Boolean(openCategories[category.id])
            const isActiveCategory = category.id === activeCategoryId

            return (
              <div key={category.id} className="app-nav-category">
                <button
                  type="button"
                  className={`app-nav-category-header${isActiveCategory ? ' active' : ''}`}
                  onClick={() => toggleCategory(category.id)}
                  aria-expanded={isOpen}
                >
                  <span>{category.label}</span>
                  <span className="app-nav-chevron" aria-hidden>
                    {isOpen ? '▾' : '▸'}
                  </span>
                </button>
                {isOpen && (
                  <ul className="app-nav-items">
                    {category.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.end}
                          className={({ isActive }) =>
                            `app-nav-link${isActive || isItemActive(location.pathname, item) ? ' active' : ''}`
                          }
                          onClick={onNavigate}
                        >
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
