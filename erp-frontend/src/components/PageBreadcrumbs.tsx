import { Link, useLocation } from 'react-router-dom'
import { getBreadcrumbs, type BreadcrumbCrumb } from '../config/sidebarNav'
import { getArticleById } from '../data/userGuideData'

function helpCrumbs(pathname: string): BreadcrumbCrumb[] | null {
  if (pathname !== '/help' && !pathname.startsWith('/help/')) return null
  if (pathname === '/help/workflows' || pathname.startsWith('/help/workflows/')) {
    return [
      { label: 'Home', to: '/' },
      { label: 'User Guide', to: '/help' },
      { label: 'Process Workflows' },
    ]
  }
  const article = getArticleById(pathname.split('/')[2])
  if (!article) {
    return [{ label: 'Home', to: '/' }, { label: 'User Guide' }]
  }
  return [
    { label: 'Home', to: '/' },
    { label: 'User Guide', to: '/help' },
    { label: article.title },
  ]
}

export default function PageBreadcrumbs() {
  const { pathname } = useLocation()
  const crumbs = helpCrumbs(pathname) ?? getBreadcrumbs(pathname)

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
