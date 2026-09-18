/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  BookOpen,
  CalendarCheck,
  Clock,
  CreditCard,
  DollarSign,
  FileSpreadsheet,
  Layers,
  LineChart,
  List,
  Package,
  Percent,
  PieChart,
  Scale,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isUnassignedUser } from '../config/dashboardRoles'
import {
  NAV_CATEGORIES,
  collectActiveGroupIds,
  findActiveCategoryId,
  flattenNavLinks,
  isNavGroupActive,
  isNavGroupDestinationActive,
  isNavLinkActive,
  splitNavTo,
  type NavCategory,
  type NavEntry,
  type NavGroup,
  type NavGroupItem,
  type NavLinkItem,
} from '../config/sidebarNav'

type SidebarNavProps = {
  collapsed: boolean
  onNavigate?: () => void
}

const NAV_ICONS: Record<string, LucideIcon> = {
  scale: Scale,
  layers: Layers,
  'pie-chart': PieChart,
  'file-spreadsheet': FileSpreadsheet,
  'trending-up': TrendingUp,
  'dollar-sign': DollarSign,
  clock: Clock,
  'credit-card': CreditCard,
  list: List,
  package: Package,
  'line-chart': LineChart,
  percent: Percent,
  'shield-check': ShieldCheck,
  'book-open': BookOpen,
  'calendar-check': CalendarCheck,
}

function NavIcon({ name, size }: { name?: string; size: number }) {
  if (!name) return null
  const Icon = NAV_ICONS[name]
  if (!Icon) return null
  return <Icon className="app-nav-icon" size={size} strokeWidth={2} aria-hidden />
}

function filterGroupItems(
  items: NavGroupItem[],
  opts: { loading: boolean; hasPermission: (code: string) => boolean },
): NavGroupItem[] {
  const { loading, hasPermission } = opts
  const result: NavGroupItem[] = []
  for (const item of items) {
    if (item.kind === 'link') {
      if (!item.permission || loading || hasPermission(item.permission)) result.push(item)
      continue
    }
    const nested = filterGroupItems(item.items, opts)
    if (nested.length > 0) result.push({ ...item, items: nested })
  }
  return result
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

    const items = filterGroupItems(entry.items, { loading, hasPermission })
    if (items.length > 0) {
      result.push({ ...entry, items })
    }
  }

  return result
}

function NavLinkRow({
  item,
  pathname,
  hash,
  nested,
  depth = 1,
  onNavigate,
}: {
  item: NavLinkItem
  pathname: string
  hash: string
  nested?: boolean
  depth?: number
  onNavigate?: () => void
}) {
  const active = isNavLinkActive(pathname, item, hash)
  const { hash: itemHash } = splitNavTo(item.to)
  const depthClass = nested ? ` nested depth-${depth}` : ''
  const iconClass = item.icon ? ' has-icon' : ''
  const className = `app-nav-link${depthClass}${iconClass}${active ? ' active' : ''}`
  const icon = <NavIcon name={item.icon} size={depth >= 2 ? 14 : 15} />
  const handleClick = () => {
    onNavigate?.()
    if (itemHash && (hash === itemHash || window.location.hash === itemHash)) {
      document.getElementById(itemHash.slice(1))?.scrollIntoView({
        behavior: 'smooth',
        block: itemHash.slice(1).startsWith('report-card-') ? 'center' : 'start',
      })
    }
  }

  return (
    <li>
      {itemHash ? (
        <Link
          to={item.to}
          className={className}
          aria-current={active ? 'page' : undefined}
          onClick={handleClick}
        >
          {icon}
          <span className="app-nav-label">{item.label}</span>
        </Link>
      ) : (
        <Link
          to={item.to}
          className={className}
          aria-current={active ? 'page' : undefined}
          onClick={onNavigate}
        >
          {icon}
          <span className="app-nav-label">{item.label}</span>
        </Link>
      )}
    </li>
  )
}

function NavGroupBlock({
  group,
  pathname,
  hash,
  open,
  onToggle,
  openGroups,
  onToggleGroup,
  onNavigate,
  depth = 0,
}: {
  group: NavGroup
  pathname: string
  hash: string
  open: boolean
  onToggle: () => void
  openGroups: Record<string, boolean>
  onToggleGroup: (id: string, accordionSiblings?: string[]) => void
  onNavigate?: () => void
  depth?: number
}) {
  const hasActiveChild = isNavGroupActive(pathname, group, hash)
  const destActive = isNavGroupDestinationActive(pathname, group, hash)
  const nestedGroups = group.items.filter((item): item is NavGroup => item.kind === 'group')
  const nestedSiblingIds = nestedGroups.map((item) => item.id)
  const { hash: destHash } = splitNavTo(group.to || '')

  const handleDestinationClick = () => {
    onNavigate?.()
    if (!open) onToggle()
    if (destHash && (hash === destHash || window.location.hash === destHash)) {
      document.getElementById(destHash.slice(1))?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }

  const iconSize = depth >= 1 ? 14 : 15
  const icon = <NavIcon name={group.icon} size={iconSize} />

  return (
    <li className={`app-nav-subgroup depth-${depth}`}>
      {group.to ? (
        <div className={`app-nav-subgroup-header-row${hasActiveChild ? ' active' : ''}`}>
          <Link
            to={group.to}
            className={`app-nav-subgroup-link${group.icon ? ' has-icon' : ''}${destActive ? ' current' : ''}`}
            aria-current={destActive ? 'page' : undefined}
            onClick={handleDestinationClick}
          >
            {icon}
            <span className="app-nav-label">{group.label}</span>
          </Link>
          <button
            type="button"
            className="app-nav-subgroup-toggle"
            aria-label={open ? `Collapse ${group.label}` : `Expand ${group.label}`}
            aria-expanded={open}
            onClick={(e) => {
              onToggle()
              ;(e.currentTarget as HTMLButtonElement).blur()
            }}
          >
            <span className="app-nav-chevron" aria-hidden>
              {open ? '▾' : '▸'}
            </span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`app-nav-subgroup-header${group.icon ? ' has-icon' : ''}${hasActiveChild ? ' active' : ''}`}
          onClick={(e) => {
            onToggle()
            ;(e.currentTarget as HTMLButtonElement).blur()
          }}
          aria-expanded={open}
        >
          {icon}
          <span className="app-nav-label">{group.label}</span>
          <span className="app-nav-chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        </button>
      )}
      {open && (
        <ul className="app-nav-subgroup-items">
          {group.items.map((item) =>
            item.kind === 'group' ? (
              <NavGroupBlock
                key={item.id}
                group={item}
                pathname={pathname}
                hash={hash}
                open={Boolean(openGroups[item.id])}
                onToggle={() => onToggleGroup(item.id, nestedSiblingIds)}
                openGroups={openGroups}
                onToggleGroup={onToggleGroup}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            ) : (
              <NavLinkRow
                key={item.to}
                item={item}
                pathname={pathname}
                hash={hash}
                nested
                depth={depth + 1}
                onNavigate={onNavigate}
              />
            ),
          )}
        </ul>
      )}
    </li>
  )
}

export default function SidebarNav({ collapsed, onNavigate }: SidebarNavProps) {
  const location = useLocation()
  const { user, hasPermission, hasAnyRole, loading } = useAuth()
  const homeLabel = isUnassignedUser(user) ? 'Welcome' : 'Dashboard'
  const activeCategoryId = findActiveCategoryId(location.pathname, location.hash)

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
    const activeIds = new Set(
      collectActiveGroupIds(location.pathname, location.hash, NAV_CATEGORIES.flatMap((c) => c.entries)),
    )
    const visit = (items: NavEntry[] | NavGroupItem[]) => {
      for (const item of items) {
        if (item.kind !== 'group') continue
        initial[item.id] = activeIds.has(item.id)
        visit(item.items)
      }
    }
    for (const category of NAV_CATEGORIES) visit(category.entries)
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
    const activeIds = new Set(collectActiveGroupIds(location.pathname, location.hash, category.entries))
    setOpenGroups((prev) => {
      const next = { ...prev }
      const visit = (items: NavEntry[] | NavGroupItem[]) => {
        for (const item of items) {
          if (item.kind !== 'group') continue
          next[item.id] = activeIds.has(item.id)
          visit(item.items)
        }
      }
      visit(category.entries)
      return next
    })
  }, [activeCategoryId, location.pathname, location.hash])

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

  const toggleGroup = (id: string, accordionSiblings?: string[]) => {
    setOpenGroups((prev) => {
      const willOpen = !prev[id]
      const next = { ...prev, [id]: willOpen }
      if (willOpen && accordionSiblings?.length) {
        for (const sibling of accordionSiblings) {
          if (sibling !== id) next[sibling] = false
        }
      }
      return next
    })
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
                          hash={location.hash}
                          onNavigate={onNavigate}
                        />
                      ) : (
                        <NavGroupBlock
                          key={entry.id}
                          group={entry}
                          pathname={location.pathname}
                          hash={location.hash}
                          open={Boolean(openGroups[entry.id])}
                          onToggle={() => toggleGroup(entry.id)}
                          openGroups={openGroups}
                          onToggleGroup={toggleGroup}
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
