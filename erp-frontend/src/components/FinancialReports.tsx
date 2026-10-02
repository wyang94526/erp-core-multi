/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Financial Reports hub — card-style catalog grouped by statement type.
 */

import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Layers, PieChart, Scale } from 'lucide-react'
import { financialReportService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import {
  REPORT_CATEGORY_META,
  REPORT_HUB_CATALOG,
  groupReports,
  reportCardId,
  reportCategorySectionId,
} from '../utils/financialReports'
import { containerStyle, emptyStateStyle, primaryButtonStyle } from './dashboard/dashboardStyles'
import { PageHeader } from './PageHeader'

const CATEGORY_ICONS = {
  primary: Scale,
  operational: Layers,
  managerial: PieChart,
} as const

export default function FinancialReports() {
  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission } = useAuth()
  const canView = hasPermission('report:view')

  const { data = REPORT_HUB_CATALOG, isError, error } = useQuery({
    queryKey: ['financialReports'],
    queryFn: () => financialReportService.listReports(),
    enabled: canView,
    placeholderData: REPORT_HUB_CATALOG,
  })

  const targetSectionId = location.hash.replace(/^#/, '')

  useEffect(() => {
    if (!canView || !targetSectionId) return
    const frame = window.requestAnimationFrame(() => {
      const el = document.getElementById(targetSectionId)
      el?.scrollIntoView({
        behavior: 'smooth',
        block: targetSectionId.startsWith('report-card-') ? 'center' : 'start',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [canView, targetSectionId])

  if (!canView) {
    return (
      <div style={containerStyle}>
        <PageHeader
          title="Financial Reports"
          subtitle="You need the report:view permission to open financial statements."
        />
      </div>
    )
  }

  const groups = groupReports(data.length > 0 ? data : REPORT_HUB_CATALOG)

  return (
    <div style={containerStyle} className="report-hub">
      <PageHeader
        title="Financial Reports"
        subtitle="Open a statement from the cards below. Category names in the sidebar return here; report names open the generator."
      />

      {isError ? (
        <p style={{ ...emptyStateStyle, color: '#c62828' }}>
          {error instanceof Error ? error.message : 'Could not refresh the report catalog. Showing the standard set.'}
        </p>
      ) : null}

      {groups.map((group) => {
        const Icon = CATEGORY_ICONS[group.id as keyof typeof CATEGORY_ICONS] || BarChart3
        const meta = REPORT_CATEGORY_META[group.id as keyof typeof REPORT_CATEGORY_META]
        const accent = meta?.accent || '#2196F3'
        const sectionId = reportCategorySectionId(group.id)
        const sectionTargeted = targetSectionId === sectionId
        return (
          <section
            key={group.id}
            id={sectionId}
            className={`report-hub-section${sectionTargeted ? ' is-target' : ''}`}
            style={{ ['--report-accent' as string]: accent }}
          >
            <div className="report-hub-section-header">
              <span className="report-hub-section-icon" aria-hidden>
                <Icon size={16} strokeWidth={2.2} />
              </span>
              <h3 className="report-hub-section-title">{group.label}</h3>
            </div>
            <div className="report-hub-grid">
              {group.items.map((report) => {
                const cardId = reportCardId(report.id)
                const cardTargeted = targetSectionId === cardId
                return (
                <article
                  key={report.id}
                  id={cardId}
                  className={`report-hub-card${cardTargeted ? ' is-target' : ''}`}
                >
                  <h4 className="report-hub-card-title">{report.title}</h4>
                  <p className="report-hub-card-body">{report.description}</p>
                  <div className="report-hub-chips" aria-label="Required parameters">
                    {report.parameters.map((parameter) => (
                      <span key={parameter} className="report-hub-chip">
                        {parameter}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={() => navigate(`/financial-reports/${report.id}`)}
                  >
                    {report.default_action}
                  </button>
                </article>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
