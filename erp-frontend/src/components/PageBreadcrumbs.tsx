import { Link, useLocation } from 'react-router-dom'
import { getBreadcrumbs } from '../config/sidebarNav'

export default function PageBreadcrumbs() {
  const { pathname } = useLocation()
  const crumbs = getBreadcrumbs(pathname)

  if (crumbs.length < 2) return null

  return (
    <nav className="app-breadcrumbs" aria-label="Breadcrumb">
      <ol className="app-breadcrumbs-list">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <li key={`${crumb.label}-${index}`} className="app-breadcrumbs-item">
              {index > 0 && (
                <span className="app-breadcrumbs-sep" aria-hidden>
                  ›
                </span>
              )}
              {isLast || !crumb.to ? (
                <span className="app-breadcrumbs-current" aria-current={isLast ? 'page' : undefined}>
                  {crumb.label}
                </span>
              ) : (
                <Link to={crumb.to} className="app-breadcrumbs-link">
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
