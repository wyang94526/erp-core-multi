import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

type NavItem = {
  label: string
  to: string
  end?: boolean
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
      { label: 'Sales Orders', to: '/', end: true },
      { label: 'Purchase Orders', to: '/purchase-orders' },
      { label: 'Subcontract Orders', to: '/subcontract-orders' },
    ],
  },
  {
    id: 'entities-catalog',
    label: '🤝 Entities & Catalog',
    items: [
      { label: 'Customers', to: '/customers' },
      { label: 'Vendors', to: '/vendors' },
      { label: 'Products', to: '/products' },
    ],
  },
  {
    id: 'finance-accounting',
    label: '💰 Finance & Accounting',
    items: [
      { label: 'Accounts Receivable', to: '/ar-invoices' },
      { label: 'Accounts Payable', to: '/ap-bills' },
      { label: 'Cash Management', to: '/cash-management' },
      { label: 'General Ledger', to: '/general-ledger' },
    ],
  },
]

function isItemActive(pathname: string, item: NavItem): boolean {
  if (item.end || item.to === '/') {
    return pathname === '/' || pathname.startsWith('/orders')
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

  return (
    <aside
      className={`app-sidebar${collapsed ? ' collapsed' : ''}`}
      aria-hidden={collapsed}
    >
      <div className="app-sidebar-inner">
        <div className="app-sidebar-brand">GTT-USA ERP</div>
        <nav className="app-sidebar-nav" aria-label="Main">
          {NAV_CATEGORIES.map((category) => {
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
