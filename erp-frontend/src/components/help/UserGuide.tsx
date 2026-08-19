import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  HELP_ARTICLES,
  HELP_MODULES,
  getArticleById,
  searchHelpArticles,
  type HelpModule,
} from '../../data/userGuideData'
import HelpArticleView from './HelpArticleView'

export default function UserGuide() {
  const { articleId } = useParams<{ articleId?: string }>()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [moduleFilter, setModuleFilter] = useState<HelpModule | 'all'>('all')

  const filtered = useMemo(() => {
    const searched = searchHelpArticles(query)
    if (moduleFilter === 'all') return searched
    return searched.filter((article) => article.module === moduleFilter)
  }, [query, moduleFilter])

  const selected = getArticleById(articleId) || filtered[0] || HELP_ARTICLES[0]

  useEffect(() => {
    if (!articleId && selected) {
      navigate(`/help/${selected.id}`, { replace: true })
    }
  }, [articleId, selected, navigate])

  useEffect(() => {
    if (articleId && !getArticleById(articleId) && selected) {
      navigate(`/help/${selected.id}`, { replace: true })
    }
  }, [articleId, selected, navigate])

  useEffect(() => {
    const main = document.querySelector('.help-main')
    main?.scrollTo({ top: 0 })
  }, [selected?.id])

  return (
    <div className="help-page">
      <header className="help-page-header">
        <div>
          <h1 className="help-page-title">User Guide & Self-Help</h1>
          <p className="help-page-sub">
            Daily operations for Grand-Tek Technology USA — search topics or browse by module.
          </p>
        </div>
        <div className="help-page-header-actions">
          <Link to="/help/workflows" className="workflow-guide-link">
            Process Workflows
          </Link>
          <label className="help-search">
            <span className="visually-hidden">Search the user guide</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search topics, steps, and FAQs…"
              aria-label="Search the user guide"
            />
          </label>
        </div>
      </header>

      <div className="help-layout">
        <aside className="help-toc" aria-label="Guide topics">
          <nav>
            <Link to="/help/workflows" className="help-toc-link help-toc-workflows">
              Process Workflows
            </Link>
            <button
              type="button"
              className={`help-toc-module${moduleFilter === 'all' ? ' active' : ''}`}
              onClick={() => setModuleFilter('all')}
            >
              All modules
            </button>
            {HELP_MODULES.map((mod) => {
              const items = filtered.filter((article) => article.module === mod.id)
              const allInModule = HELP_ARTICLES.filter((article) => article.module === mod.id)
              if (moduleFilter !== 'all' && moduleFilter !== mod.id) return null
              if (query && items.length === 0) return null
              return (
                <div key={mod.id} className="help-toc-group">
                  <button
                    type="button"
                    className={`help-toc-module${moduleFilter === mod.id ? ' active' : ''}`}
                    onClick={() => {
                      setModuleFilter(mod.id)
                      const first = (query ? items : allInModule)[0]
                      if (first && selected?.module !== mod.id) {
                        navigate(`/help/${first.id}`)
                      }
                    }}
                  >
                    {mod.label}
                    <span className="help-toc-count">{query ? items.length : allInModule.length}</span>
                  </button>
                  <ul>
                    {(query ? items : allInModule).map((article) => (
                      <li key={article.id}>
                        <Link
                          to={`/help/${article.id}`}
                          className={`help-toc-link${selected?.id === article.id ? ' active' : ''}`}
                        >
                          {article.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </nav>
        </aside>

        <div className="help-main">
          {filtered.length === 0 ? (
            <p className="help-empty">No topics match “{query}”. Try another keyword or clear the search.</p>
          ) : (
            <HelpArticleView article={selected} />
          )}
        </div>
      </div>
    </div>
  )
}
