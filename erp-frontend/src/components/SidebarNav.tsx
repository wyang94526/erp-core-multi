import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isUnassignedUser } from '../config/dashboardRoles'
import {
  NAV_CATEGORIES,
  findActiveCategoryId,
  findActiveGroupId,
  flattenNavLinks,
  isNavLinkActive,
  type NavCategory,
  type NavEntry,
  type NavGroup,
  type NavLinkItem,
} from '../config/sidebarNav'

type SidebarNavProps = {
  collapsed: boolean
  onNavigate?: () => void
}

function filterEntries(
  entries: NavEntry[],
  opts: {
    loading: boolean
    hasPermission: (code: string) => boolean
    homeLabel: string
  },
): NavEntry[] {
  const { loading, hasPermission, homeLabel } = opts
  const result: NavEntry[] = []

  for (const entry of entries) {
    if (entry.kind === 'link') {
      const link: NavLinkItem =
        entry.to === '/' ? { ...entry, label: homeLabel } : entry
      if (!link.permission || loading || hasPermission(link.permission)) {
        result.push(link)
      }
      continue
    }

    const items = entry.items.filter(
      (item) => !item.permission || loading || hasPermission(item.permission),
    )
    if (items.length > 0) {
      result.push({ ...entry, items })
    }
  }

  return result
}

function NavLinkRow({
  item,
  pathname,
  nested,
  onNavigate,
}: {
  item: NavLinkItem
  pathname: string
  nested?: boolean
  onNavigate?: () => void
}) {
  const active = isNavLinkActive(pathname, item)
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          `app-nav-link${nested ? ' nested' : ''}${isActive || active ? ' active' : ''}`
        }
        onClick={onNavigate}
      >
        {item.label}
      </NavLink>
    </li>
  )
}

function NavGroupBlock({
  group,
  pathname,
  open,
  onToggle,
  onNavigate,
}: {
  group: NavGroup
  pathname: string
  open: boolean
  onToggle: () => void
  onNavigate?: () => void
}) {
  const hasActiveChild = group.items.some((item) => isNavLinkActive(pathname, item))

  return (
    <li className="app-nav-subgroup">
      <button
        type="button"
        className={`app-nav-subgroup-header${hasActiveChild ? ' active' : ''}`}
        onClick={(e) => {
          onToggle()
          ;(e.currentTarget as HTMLButtonElement).blur()
        }}
        aria-expanded={open}
      >
        <span>{group.label}</span>
        <span className="app-nav-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <ul className="app-nav-subgroup-items">
          {group.items.map((item) => (
            <NavLinkRow
              key={item.to}
              item={item}
              pathname={pathname}
              nested
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function SidebarNav({ collapsed, onNavigate }: SidebarNavProps) {
  const location = useLocation()
  const { user, hasPermission, hasAnyRole, loading } = useAuth()
  const homeLabel = isUnassignedUser(user) ? 'Welcome' : 'Dashboard'
  const activeCategoryId = findActiveCategoryId(location.pathname)

  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const category of NAV_CATEGORIES) {
      // Only the route-active category starts open — same for every section
      initial[category.id] = category.id === activeCategoryId
    }
    return initial
  })

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const category of NAV_CATEGORIES) {
      const activeGroup = findActiveGroupId(location.pathname, category)
      for (const entry of category.entries) {
        if (entry.kind === 'group') {
          initial[entry.id] = entry.id === activeGroup
        }
      }
    }
    return initial
  })

  // Keep only the active category open (accordion) so Finance doesn't stay expanded
  // and visually emphasized after you leave finance pages.
  useEffect(() => {
    if (!activeCategoryId) return
    setOpenCategories(() => {
      const next: Record<string, boolean> = {}
      for (const category of NAV_CATEGORIES) {
        next[category.id] = category.id === activeCategoryId
      }
      return next
    })

    const category = NAV_CATEGORIES.find((c) => c.id === activeCategoryId)
    if (!category) return
    const activeGroupId = findActiveGroupId(location.pathname, category)
    setOpenGroups((prev) => {
      const next = { ...prev }
      for (const entry of category.entries) {
        if (entry.kind === 'group') {
          next[entry.id] = entry.id === activeGroupId
        }
      }
      return next
    })
  }, [activeCategoryId, location.pathname])

  const toggleCategory = (id: string) => {
    setOpenCategories((prev) => {
      const willOpen = !prev[id]
      const next: Record<string, boolean> = {}
      for (const category of NAV_CATEGORIES) {
        // Accordion: at most one top-level section open
        next[category.id] = willOpen ? category.id === id : false
      }
      return next
    })
  }

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const visibleCategories: Array<NavCategory & { entries: NavEntry[] }> = NAV_CATEGORIES.filter(
    (category) => loading || hasAnyRole(category.roles),
  )
    .map((category) => ({
      ...category,
      entries: filterEntries(category.entries, { loading, hasPermission, homeLabel }),
    }))
    .filter((category) => flattenNavLinks(category.entries).length > 0)

  return (
    <aside
      className={`app-sidebar${collapsed ? ' collapsed' : ''}`}
      aria-hidden={collapsed}
    >
      <div className="app-sidebar-inner">
        <div className="app-sidebar-brand">Grand-Tek Technology USA</div>
        <nav className="app-sidebar-nav" aria-label="Main">
          {visibleCategories.map((category) => {
            const isOpen = Boolean(openCategories[category.id])
            // Only route-match highlights the header — never "open" alone
            const isActiveCategory = category.id === activeCategoryId

            return (
              <div key={category.id} className="app-nav-category">
                <button
                  type="button"
                  className={`app-nav-category-header${isActiveCategory ? ' active' : ''}`}
                  onClick={(e) => {
                    toggleCategory(category.id)
                    // Avoid sticky focus styling that looks like a permanent highlight
                    ;(e.currentTarget as HTMLButtonElement).blur()
                  }}
                  aria-expanded={isOpen}
                >
                  <span>{category.label}</span>
                  <span className="app-nav-chevron" aria-hidden>
                    {isOpen ? '▾' : '▸'}
                  </span>
                </button>
                {isOpen && (
                  <ul className="app-nav-items">
                    {category.entries.map((entry) =>
                      entry.kind === 'link' ? (
                        <NavLinkRow
                          key={entry.to}
                          item={entry}
                          pathname={location.pathname}
                          onNavigate={onNavigate}
                        />
                      ) : (
                        <NavGroupBlock
                          key={entry.id}
                          group={entry}
                          pathname={location.pathname}
                          open={Boolean(openGroups[entry.id])}
                          onToggle={() => toggleGroup(entry.id)}
                          onNavigate={onNavigate}
                        />
                      ),
                    )}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>
        <div className="app-sidebar-footer">
          <NavLink
            to="/help"
            className={({ isActive }) =>
              `app-nav-link${isActive || (location.pathname.startsWith('/help') && location.pathname !== '/help/workflows' && !location.pathname.startsWith('/help/workflows/')) ? ' active' : ''}`
            }
            onClick={onNavigate}
          >
            User Guide
          </NavLink>
          <NavLink
            to="/help/workflows"
            className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}
            onClick={onNavigate}
          >
            Process Workflows
          </NavLink>
        </div>
      </div>
    </aside>
  )
}
