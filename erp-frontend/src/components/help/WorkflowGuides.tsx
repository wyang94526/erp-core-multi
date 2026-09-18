/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Maximize2, RotateCcw, X } from 'lucide-react'
import {
  WORKFLOW_FLOW_LANES,
  WORKFLOW_GUIDES,
  WORKFLOW_STORAGE_KEY,
  type WorkflowGuide,
  type WorkflowId,
} from '../../data/workflowGuides'

type TabId = 'all' | WorkflowId

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'all', label: 'All workflows' },
  { id: 'o2c', label: 'Order to Cash' },
  { id: 'sco', label: 'Subcontract to Pay' },
  { id: 'p2p', label: 'Procure to Pay' },
  { id: 'close', label: 'Period Close' },
]

function loadChecks(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(WORKFLOW_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

export default function WorkflowGuides() {
  const [tab, setTab] = useState<TabId>('all')
  const [checks, setChecks] = useState<Record<string, boolean>>(loadChecks)
  const [diagramOpen, setDiagramOpen] = useState(false)
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({})

  useEffect(() => {
    localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(checks))
  }, [checks])

  useEffect(() => {
    if (!diagramOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDiagramOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [diagramOpen])

  const visible = useMemo(
    () => (tab === 'all' ? WORKFLOW_GUIDES : WORKFLOW_GUIDES.filter((guide) => guide.id === tab)),
    [tab],
  )

  const toggleStep = (stepId: string) => {
    setChecks((prev) => ({ ...prev, [stepId]: !prev[stepId] }))
  }

  const toggleOpen = (stepId: string) => {
    setOpenSteps((prev) => ({ ...prev, [stepId]: prev[stepId] === false }))
  }

  const resetGuide = (guide: WorkflowGuide) => {
    setChecks((prev) => {
      const next = { ...prev }
      for (const step of guide.steps) delete next[step.id]
      return next
    })
  }

  return (
    <div className="help-page workflow-page">
      <header className="help-page-header">
        <div>
          <h1 className="help-page-title">Process Workflows & Daily Operations</h1>
          <p className="help-page-sub">
            Interactive checklists for Order-to-Cash, Subcontract-to-Pay (and SO fulfillment),
            Procure-to-Pay, and period close. Jump from each step into the live screen.
          </p>
        </div>
        <Link to="/help" className="workflow-guide-link">
          Open User Guide
        </Link>
      </header>

      <section className="workflow-diagram" aria-label="High-level process flow">
        <div className="workflow-diagram-bar">
          <h2 className="workflow-diagram-title">High-level process flow</h2>
          <button
            type="button"
            className="workflow-diagram-zoom"
            onClick={() => setDiagramOpen(true)}
          >
            <Maximize2 size={16} aria-hidden />
            Expand
          </button>
        </div>
        <WorkflowFlowDiagram onSelectLane={setTab} />
      </section>

      <div className="workflow-tabs" role="tablist" aria-label="Workflows">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`workflow-tab${tab === item.id ? ' active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="workflow-cards">
        {visible.map((guide) => (
          <WorkflowCard
            key={guide.id}
            guide={guide}
            checks={checks}
            openSteps={openSteps}
            onToggleCheck={toggleStep}
            onToggleOpen={toggleOpen}
            onReset={() => resetGuide(guide)}
          />
        ))}
      </div>

      {diagramOpen && (
        <div className="workflow-lightbox" role="dialog" aria-modal="true" aria-label="Process flow diagram">
          <button
            type="button"
            className="workflow-lightbox-backdrop"
            aria-label="Close diagram"
            onClick={() => setDiagramOpen(false)}
          />
          <div className="workflow-lightbox-panel">
            <header className="workflow-lightbox-header">
              <h2>Grand-Tek ERP process workflows</h2>
              <button type="button" className="ai-drawer-close" onClick={() => setDiagramOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </header>
            <WorkflowFlowDiagram
              large
              onSelectLane={(id) => {
                setTab(id)
                setDiagramOpen(false)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function WorkflowFlowDiagram({
  large = false,
  onSelectLane,
}: {
  large?: boolean
  onSelectLane?: (id: WorkflowId) => void
}) {
  return (
    <div className={`workflow-flow${large ? ' large' : ''}`}>
      {WORKFLOW_FLOW_LANES.map((lane) => (
        <div key={lane.id} className={`workflow-flow-lane workflow-flow-lane-${lane.id}`}>
          <span className="workflow-flow-pill">{lane.label}</span>
          <ol className="workflow-flow-nodes">
            {lane.nodes.map((node, index) => (
              <li key={node} className="workflow-flow-item">
                {index > 0 && (
                  <span className="workflow-flow-arrow" aria-hidden>
                    →
                  </span>
                )}
                <button
                  type="button"
                  className="workflow-flow-node"
                  onClick={() => onSelectLane?.(lane.id)}
                >
                  <span className="workflow-flow-num">{index + 1}</span>
                  <span className="workflow-flow-node-label">{node}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}

function WorkflowCard({
  guide,
  checks,
  openSteps,
  onToggleCheck,
  onToggleOpen,
  onReset,
}: {
  guide: WorkflowGuide
  checks: Record<string, boolean>
  openSteps: Record<string, boolean>
  onToggleCheck: (id: string) => void
  onToggleOpen: (id: string) => void
  onReset: () => void
}) {
  const done = guide.steps.filter((step) => checks[step.id]).length
  const total = guide.steps.length

  return (
    <article className="workflow-card" aria-labelledby={`workflow-${guide.id}`}>
      <header className="workflow-card-header">
        <div>
          <span className={`workflow-badge workflow-badge-${guide.id}`}>{guide.badge}</span>
          <h2 id={`workflow-${guide.id}`} className="workflow-card-title">
            {guide.title}
          </h2>
          <p className="workflow-card-summary">{guide.summary}</p>
        </div>
        <div className="workflow-card-meta">
          <span className="workflow-progress">
            {done} / {total} complete
          </span>
          <button type="button" className="workflow-reset" onClick={onReset}>
            <RotateCcw size={14} aria-hidden />
            Reset
          </button>
        </div>
      </header>

      <ol className="workflow-steps">
        {guide.steps.map((step, index) => {
          const checked = Boolean(checks[step.id])
          const expanded = openSteps[step.id] !== false
          return (
            <li key={step.id} className={`workflow-step${checked ? ' done' : ''}`}>
              {index < guide.steps.length - 1 && <span className="workflow-step-rail" aria-hidden />}
              <div className="workflow-step-index" aria-hidden>
                {checked ? <Check size={14} /> : index + 1}
              </div>
              <div className="workflow-step-body">
                <div className="workflow-step-top">
                  <label className="workflow-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleCheck(step.id)}
                    />
                    <span>{step.title}</span>
                  </label>
                  <button
                    type="button"
                    className="workflow-step-toggle"
                    aria-expanded={expanded}
                    onClick={() => onToggleOpen(step.id)}
                  >
                    {expanded ? 'Collapse' : 'Expand'}
                  </button>
                </div>
                {expanded && (
                  <>
                    <p className="workflow-nav-path">{step.navPath}</p>
                    <p className="workflow-step-text">{step.body}</p>
                    <div className="workflow-step-links">
                      {step.links.map((link) => (
                        <Link key={link.to + link.label} to={link.to} className="workflow-action">
                          {link.label}
                          <ArrowRight size={14} aria-hidden />
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </article>
  )
}
