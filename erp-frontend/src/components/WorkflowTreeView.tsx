/**
 * WorkflowTreeView — module-grouped tree with optional CRUD actions on bands & steps.
 */

import type { RoleDetail, WorkflowDefinition, WorkflowStep } from '../types'

export const WORKFLOW_MODULES = [
  'SALES_ORDER',
  'PURCHASE_ORDER',
  'SUBCONTRACT_ORDER',
  'AR_INVOICE',
  'AP_BILL',
  'CASH_TRANSACTION',
  'JOURNAL_ENTRY',
] as const

type WorkflowTreeViewProps = {
  workflows: WorkflowDefinition[]
  roles?: RoleDetail[]
  canManage?: boolean
  onAddBand?: (module?: string) => void
  onEditBand?: (workflow: WorkflowDefinition) => void
  onDeleteBand?: (workflow: WorkflowDefinition) => void
  onAddStep?: (workflow: WorkflowDefinition) => void
  onEditStep?: (workflow: WorkflowDefinition, step: WorkflowStep) => void
  onDeleteStep?: (workflow: WorkflowDefinition, step: WorkflowStep) => void
}

export function formatMoney(value: number | string | null | undefined): string {
  if (value == null || value === '') return '∞'
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n)
}

export function amountBandLabel(wf: WorkflowDefinition): string {
  const min = Number(wf.min_amount)
  const max = wf.max_amount == null ? null : Number(wf.max_amount)
  if (max == null) return `≥ ${formatMoney(min)}`
  if (min <= 0) return `≤ ${formatMoney(max)}`
  return `${formatMoney(min)} – ${formatMoney(max)}`
}

export const MODULE_LABELS: Record<string, string> = {
  SALES_ORDER: 'Sales Order',
  PURCHASE_ORDER: 'Purchase Order',
  SUBCONTRACT_ORDER: 'Subcontract Order',
  AR_INVOICE: 'AR Invoice',
  AP_BILL: 'AP Bill',
  CASH_TRANSACTION: 'Cash Transaction',
  JOURNAL_ENTRY: 'Journal Entry',
}

export function humanModule(module: string): string {
  if (MODULE_LABELS[module]) return MODULE_LABELS[module]
  return module
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ')
}

function stepApproverLabel(
  step: WorkflowStep,
  roleNameById: Record<string, string>,
): string {
  if (step.required_role_id) {
    return roleNameById[step.required_role_id] || step.required_role_id
  }
  if (step.required_permission) return step.required_permission
  return 'Any approver'
}

function sortedSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return [...(steps || [])].sort((a, b) => a.step_number - b.step_number)
}

export function WorkflowTreeView({
  workflows,
  roles = [],
  canManage = false,
  onAddBand,
  onEditBand,
  onDeleteBand,
  onAddStep,
  onEditStep,
  onDeleteStep,
}: WorkflowTreeViewProps) {
  const roleNameById = Object.fromEntries(roles.map((r) => [r.role_id, r.role_name]))

  const byModule = new Map<string, WorkflowDefinition[]>()
  for (const wf of workflows) {
    const list = byModule.get(wf.module) || []
    list.push(wf)
    byModule.set(wf.module, list)
  }
  for (const list of byModule.values()) {
    list.sort((a, b) => Number(a.min_amount) - Number(b.min_amount))
  }

  const modules = [...byModule.keys()].sort()

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <p style={legendStyle}>
          Each module routes a submitted document by amount into a branch. Follow nodes
          left → right until <strong>Approved</strong>.
          {canManage ? ' Click a node action to maintain bands and steps.' : ''}
        </p>
        {canManage && (
          <button type="button" style={primaryBtn} onClick={() => onAddBand?.()}>
            + Add amount band
          </button>
        )}
      </div>

      {modules.length === 0 ? (
        <p style={emptyStyle}>No workflow definitions found.</p>
      ) : (
        modules.map((module) => {
          const defs = byModule.get(module) || []
          return (
            <section key={module} style={moduleCardStyle}>
              <header style={moduleHeaderStyle}>
                <h3 style={moduleTitleStyle}>{humanModule(module)}</h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={moduleMetaStyle}>
                    {defs.length} amount band{defs.length === 1 ? '' : 's'}
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      style={ghostBtn}
                      onClick={() => onAddBand?.(module)}
                    >
                      + Band
                    </button>
                  )}
                </div>
              </header>

              <div style={treeStyle}>
                <div style={rootNodeRowStyle}>
                  <div style={{ ...nodeStyle, ...submitNodeStyle }}>
                    <span style={nodeEyebrowStyle}>Start</span>
                    <span style={nodeTitleStyle}>Document submitted</span>
                  </div>
                </div>
                <div style={trunkStyle} aria-hidden />

                <ul style={branchListStyle}>
                  {defs.map((wf, index) => {
                    const steps = sortedSteps(wf.steps || [])
                    const isLast = index === defs.length - 1
                    const isAuto = steps.length === 0

                    return (
                      <li key={wf.id} style={branchItemStyle}>
                        <div style={branchRailWrapStyle}>
                          <div style={branchElbowStyle} aria-hidden />
                          {!isLast && <div style={branchContinueStyle} aria-hidden />}
                        </div>

                        <div
                          style={{
                            ...branchBodyStyle,
                            opacity: wf.is_active ? 1 : 0.55,
                          }}
                        >
                          <div style={{ ...nodeStyle, ...gateNodeStyle }}>
                            <span style={nodeEyebrowStyle}>Amount gate</span>
                            <span style={nodeTitleStyle}>{amountBandLabel(wf)}</span>
                            <span style={nodeSubStyle}>
                              {wf.name || wf.id}
                              {!wf.is_active ? ' · inactive' : ''}
                            </span>
                            {canManage && (
                              <div style={nodeActionsStyle}>
                                <button type="button" style={nodeActionBtn} onClick={() => onEditBand?.(wf)}>
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  style={{ ...nodeActionBtn, color: '#c62828' }}
                                  onClick={() => onDeleteBand?.(wf)}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>

                          <span style={arrowStyle} aria-hidden>
                            →
                          </span>

                          {isAuto ? (
                            <div style={{ ...nodeStyle, ...autoNodeStyle }}>
                              <span style={nodeEyebrowStyle}>Step</span>
                              <span style={nodeTitleStyle}>Auto-approve</span>
                              <span style={nodeSubStyle}>No human steps</span>
                              {canManage && (
                                <div style={nodeActionsStyle}>
                                  <button
                                    type="button"
                                    style={nodeActionBtn}
                                    onClick={() => onAddStep?.(wf)}
                                  >
                                    + Step
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            steps.map((step, stepIdx) => (
                              <div key={step.id} style={stepChainStyle}>
                                <div style={{ ...nodeStyle, ...stepNodeStyle }}>
                                  <span style={nodeEyebrowStyle}>Step {step.step_number}</span>
                                  <span style={nodeTitleStyle}>{step.step_name}</span>
                                  <span style={nodeSubStyle}>
                                    {stepApproverLabel(step, roleNameById)}
                                  </span>
                                  {canManage && (
                                    <div style={nodeActionsStyle}>
                                      <button
                                        type="button"
                                        style={nodeActionBtn}
                                        onClick={() => onEditStep?.(wf, step)}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        style={{ ...nodeActionBtn, color: '#c62828' }}
                                        onClick={() => onDeleteStep?.(wf, step)}
                                      >
                                        Del
                                      </button>
                                    </div>
                                  )}
                                </div>
                                {stepIdx < steps.length - 1 && (
                                  <span style={arrowStyle} aria-hidden>
                                    →
                                  </span>
                                )}
                              </div>
                            ))
                          )}

                          {!isAuto && canManage && (
                            <>
                              <span style={arrowStyle} aria-hidden>
                                →
                              </span>
                              <button
                                type="button"
                                style={addStepPill}
                                onClick={() => onAddStep?.(wf)}
                              >
                                + Step
                              </button>
                            </>
                          )}

                          <span style={arrowStyle} aria-hidden>
                            →
                          </span>

                          <div style={{ ...nodeStyle, ...doneNodeStyle }}>
                            <span style={nodeEyebrowStyle}>End</span>
                            <span style={nodeTitleStyle}>Approved</span>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
}

const legendStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: 'var(--text)',
  lineHeight: 1.45,
  flex: 1,
}

const emptyStyle: React.CSSProperties = {
  color: 'var(--text)',
  fontStyle: 'italic',
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  border: 'none',
  background: '#1976d2',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 600,
  fontSize: '13px',
  whiteSpace: 'nowrap',
}

const ghostBtn: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '12px',
}

const moduleCardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: '10px',
  padding: '16px 18px 12px',
  background: 'var(--bg)',
  boxShadow: 'var(--shadow)',
}

const moduleHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '12px',
  marginBottom: '14px',
  flexWrap: 'wrap',
}

const moduleTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '16px',
  fontWeight: 700,
  color: 'var(--text-h)',
}

const moduleMetaStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--text)',
}

const treeStyle: React.CSSProperties = { position: 'relative' }
const rootNodeRowStyle: React.CSSProperties = { display: 'flex', paddingLeft: '2px' }
const trunkStyle: React.CSSProperties = {
  width: '2px',
  height: '14px',
  marginLeft: '18px',
  background: '#90a4ae',
}
const branchListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
}
const branchItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  minHeight: '72px',
}
const branchRailWrapStyle: React.CSSProperties = {
  position: 'relative',
  width: '28px',
  flexShrink: 0,
}
const branchElbowStyle: React.CSSProperties = {
  position: 'absolute',
  left: '17px',
  top: 0,
  width: '14px',
  height: '36px',
  borderLeft: '2px solid #90a4ae',
  borderBottom: '2px solid #90a4ae',
}
const branchContinueStyle: React.CSSProperties = {
  position: 'absolute',
  left: '17px',
  top: '36px',
  bottom: 0,
  width: '2px',
  background: '#90a4ae',
}
const branchBodyStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '8px',
  padding: '8px 0 16px',
  minWidth: 0,
  flex: 1,
}
const stepChainStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
}
const nodeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: '120px',
  maxWidth: '220px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: '#fff',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
}
const submitNodeStyle: React.CSSProperties = {
  borderColor: '#90caf9',
  background: '#e3f2fd',
}
const gateNodeStyle: React.CSSProperties = {
  borderColor: '#ffe082',
  background: '#fffde7',
  minWidth: '140px',
}
const stepNodeStyle: React.CSSProperties = {
  borderColor: '#ce93d8',
  background: '#f3e5f5',
}
const autoNodeStyle: React.CSSProperties = {
  borderColor: '#80cbc4',
  background: '#e0f2f1',
}
const doneNodeStyle: React.CSSProperties = {
  borderColor: '#a5d6a7',
  background: '#e8f5e9',
  minWidth: '100px',
}
const nodeEyebrowStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#607d8b',
}
const nodeTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  color: 'var(--text-h)',
  lineHeight: 1.25,
}
const nodeSubStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text)',
  lineHeight: 1.3,
}
const nodeActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  marginTop: '6px',
}
const nodeActionBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#1565c0',
  cursor: 'pointer',
  fontSize: '11px',
  fontWeight: 600,
  padding: 0,
  fontFamily: 'inherit',
}
const addStepPill: React.CSSProperties = {
  border: '1px dashed #9c27b0',
  background: '#faf5fc',
  color: '#7b1fa2',
  borderRadius: '8px',
  padding: '10px 12px',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 600,
  fontFamily: 'inherit',
}
const arrowStyle: React.CSSProperties = {
  color: '#78909c',
  fontSize: '16px',
  fontWeight: 600,
  flexShrink: 0,
}

export default WorkflowTreeView
