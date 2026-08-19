import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getArticlesForPath } from '../../data/userGuideData'
import HelpArticleView from './HelpArticleView'

type HelpDrawerProps = {
  open: boolean
  onClose: () => void
}

export default function HelpDrawer({ open, onClose }: HelpDrawerProps) {
  const { pathname } = useLocation()
  const articles = getArticlesForPath(pathname)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <>
      <div className="ai-drawer-backdrop" onClick={onClose} aria-hidden />
      <aside
        id="help-drawer"
        ref={panelRef}
        className="ai-drawer help-drawer"
        aria-label="Contextual help"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <header className="ai-drawer-header">
          <div>
            <div className="ai-drawer-title">Help for this page</div>
            <div className="ai-drawer-sub">
              {pathname === '/' ? 'Dashboard' : pathname}
              <span className="help-shortcut-hint"> Ctrl/⌘ + /</span>
            </div>
          </div>
          <button type="button" className="ai-drawer-close" onClick={onClose} aria-label="Close help">
            ✕
          </button>
        </header>

        <div className="help-drawer-body">
          {articles.length === 0 ? (
            <p className="help-empty">
              No specific article is tagged for this route.{' '}
              <Link to="/help" onClick={onClose}>
                Browse the full User Guide
              </Link>
              .
            </p>
          ) : (
            articles.map((article) => (
              <HelpArticleView key={article.id} article={article} compact />
            ))
          )}
        </div>

        <footer className="help-drawer-footer">
          <Link to="/help" onClick={onClose}>
            Open User Guide
          </Link>
        </footer>
      </aside>
    </>
  )
}
