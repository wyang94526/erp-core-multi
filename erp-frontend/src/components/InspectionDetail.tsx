/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { inspectionService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type { CurrentUser, InspectionPlan } from '../types'
import {
  actionRowStyle,
  badgeStyle,
  dangerButtonStyle,
  documentPageHeaderStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
  primaryButtonStyle,
} from '../utils/documentPageStyles'
import { inspectionStatusColors, inspectionStatusLabel, sourceLabel } from './InspectionsPage'

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={metaRowStyle}>
      <dt style={labelStyle}>{label}</dt>
      <dd style={valueStyle}>{children}</dd>
    </div>
  )
}

function ownsRole(user: CurrentUser | null, roleId: string) {
  return Boolean(user?.roles?.some((role) => role.role_id === roleId))
}

function dispositionLabel(value: string | null | undefined) {
  if (value === 'unrestricted') return 'Unrestricted stock'
  if (value === 'quarantine') return 'Quarantine'
  if (value === 'scrap') return 'Scrap'
  if (value === 'rework') return 'Rework'
  if (value === 'unposted') return 'Not posted'
  return '—'
}

function planHint(plan: InspectionPlan) {
  if (plan.method === 'numeric') {
    const unit = plan.unit ? ` ${plan.unit}` : ''
    return `${plan.min_value ?? '—'} to ${plan.max_value ?? '—'}${unit}`
  }
  return plan.options || 'Pass, Fail'
}

export default function InspectionDetail() {
  const { inspectionId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [characteristic, setCharacteristic] = useState('')
  const [specification, setSpecification] = useState('')
  const [measured, setMeasured] = useState('')
  const [measurements, setMeasurements] = useState<Record<string, string>>({})
  const [planName, setPlanName] = useState('')
  const [planMethod, setPlanMethod] = useState<'numeric' | 'attribute'>('attribute')
  const [planMin, setPlanMin] = useState('')
  const [planMax, setPlanMax] = useState('')
  const [planUnit, setPlanUnit] = useState('')
  const [planOptions, setPlanOptions] = useState('Pass,Fail,Scratch,Dent')
  const [planPass, setPlanPass] = useState('Pass')
  const [reopenReason, setReopenReason] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: inspection = null, isLoading, error: loadError } = useQuery({
    queryKey: ['inspections', inspectionId],
    queryFn: () => inspectionService.get(inspectionId),
    enabled: Boolean(inspectionId),
  })

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inspections'] })
  }

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null)
    setBusy(true)
    try {
      await action()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  const decide = (decision: 'accept' | 'reject') => {
    const plans = inspection?.plans ?? []
    const results = plans.length
      ? plans.map((plan) => ({
          characteristic: plan.characteristic,
          measured_value: measurements[plan.characteristic] || '',
          passed: false,
        }))
      : [
          {
            characteristic: characteristic.trim(),
            specification: specification.trim() || undefined,
            measured_value: measured,
            passed: decision === 'accept',
          },
        ]
    return run(
      () =>
        decision === 'accept'
          ? inspectionService.accept(inspectionId, { results })
          : inspectionService.reject(inspectionId, { results }),
      'Could not record inspection',
    )
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <p style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          Loading inspection…
        </p>
      </div>
    )
  }

  if (!inspection) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>{loadError instanceof Error ? loadError.message : 'Inspection not found'}</p>
          <button type="button" style={headerButtonStyle} onClick={() => navigate('/inspections')}>
            <ArrowLeft size={15} />
            Inspections
          </button>
        </div>
      </div>
    )
  }

  const colors = inspectionStatusColors(inspection.status)
  const plans = inspection.plans ?? []
  const isQc = ownsRole(user, 'ROLE-QC-INSP') || ownsRole(user, 'ROLE-QC-MGR')
  const isQcManager = ownsRole(user, 'ROLE-QC-MGR')
  const isAdmin = ownsRole(user, 'ROLE-ADMIN')
  const isReceiver = Boolean(user?.id && inspection.received_by_user_id && user.id === inspection.received_by_user_id)
  const canSignOff = isQc && !isReceiver
  const productionLot = inspection.source_type === 'production_receipt'
  const request = inspection.reinspection_request
  const signoffMessage = !isQc
    ? 'Accept and Reject are limited to a Quality Inspector or Quality Manager.'
    : isReceiver
      ? 'The person who received this lot cannot sign off the inspection.'
      : null

  return (
    <div style={containerStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>{inspection.source_id}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ ...badgeStyle, backgroundColor: colors.bg, color: colors.text }}>
              {inspectionStatusLabel(inspection.status)}
            </span>
            <span style={{ ...badgeStyle, backgroundColor: '#eceff1', color: '#37474f' }}>
              {sourceLabel(inspection.source_type)}
            </span>
          </div>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            <button type="button" style={headerButtonStyle} onClick={() => navigate('/inspections')}>
              <ArrowLeft size={15} />
              Inspections
            </button>
          </div>
        </div>
      </header>

      {error ? <p style={errorStyle}>{error}</p> : null}

      <section style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Inspection</h2>
        <dl style={metaGridStyle}>
          <div style={metaColumnStyle}>
          <MetaRow label="Source">{sourceLabel(inspection.source_type)}</MetaRow>
          <MetaRow label="Document">{inspection.document_no || inspection.source_id}</MetaRow>
          <MetaRow label="Reference">{inspection.reference_document || '—'}</MetaRow>
          <MetaRow label="Inspector">{inspection.inspector_name || '—'}</MetaRow>
          <MetaRow label="Received by">{inspection.received_by_name || '—'}</MetaRow>
          </div>
          <div style={metaColumnStyle}>
            <MetaRow label="Inspected">
              {inspection.inspected_at ? new Date(inspection.inspected_at).toLocaleString() : '—'}
            </MetaRow>
            <MetaRow label="Stock">{dispositionLabel(inspection.stock_disposition)}</MetaRow>
            <MetaRow label="Notes">{inspection.notes || '—'}</MetaRow>
            {(inspection.audit_notes ?? []).some((note) => note.note_code === 'Legacy_Stock_Override') ? (
              <MetaRow label="Audit">Legacy_Stock_Override</MetaRow>
            ) : null}
          </div>
        </dl>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Results</h2>
        {inspection.results.length === 0 ? (
          <p style={hintStyle}>No characteristics recorded yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadStyle}>
                  <th style={thStyle}>Characteristic</th>
                  <th style={thStyle}>Specification</th>
                  <th style={thStyle}>Measured</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {inspection.results.map((result) => (
                  <tr key={result.id} style={rowStyle}>
                    <td style={tdStyle}>{result.characteristic}</td>
                    <td style={tdStyle}>{result.specification || '—'}</td>
                    <td style={tdStyle}>{result.measured_value || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <span
                        style={{
                          ...badgeStyle,
                          backgroundColor: result.passed ? '#e8f5e9' : '#ffebee',
                          color: result.passed ? '#2e7d32' : '#c62828',
                        }}
                      >
                        {result.passed ? 'Pass' : 'Fail'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {productionLot && inspection.item_id ? (
        <section style={cardStyle}>
          <h2 style={sectionHeadingStyle}>Inspection plan</h2>
          {plans.length === 0 ? (
            <p style={hintStyle}>A Quality Manager defines the characteristics before this lot can be accepted or rejected.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadStyle}>
                    <th style={thStyle}>Characteristic</th>
                    <th style={thStyle}>Method</th>
                    <th style={thStyle}>Criteria</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id} style={rowStyle}>
                      <td style={tdStyle}>{plan.characteristic}</td>
                      <td style={tdStyle}>{plan.method === 'numeric' ? 'Numeric' : 'Attribute'}</td>
                      <td style={tdStyle}>{planHint(plan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isQcManager ? (
            <form
              style={{ marginTop: 16 }}
              onSubmit={(event) => {
                event.preventDefault()
                void run(
                  () =>
                    inspectionService.addPlan({
                      item_id: inspection.item_id || '',
                      characteristic: planName.trim(),
                      method: planMethod,
                      min_value: planMethod === 'numeric' && planMin !== '' ? Number(planMin) : null,
                      max_value: planMethod === 'numeric' && planMax !== '' ? Number(planMax) : null,
                      unit: planUnit.trim() || null,
                      options: planMethod === 'attribute' ? planOptions.trim() : null,
                      pass_options: planMethod === 'attribute' ? planPass.trim() : null,
                    }),
                  'Could not save the inspection plan',
                )
              }}
            >
              <div style={gridStyle}>
                <label style={fieldStyle}>
                  Characteristic
                  <input style={inputStyle} value={planName} onChange={(e) => setPlanName(e.target.value)} required />
                </label>
                <label style={fieldStyle}>
                  Method
                  <select style={inputStyle} value={planMethod} onChange={(e) => setPlanMethod(e.target.value as 'numeric' | 'attribute')}>
                    <option value="attribute">Attribute</option>
                    <option value="numeric">Numeric</option>
                  </select>
                </label>
                {planMethod === 'numeric' ? (
                  <>
                    <label style={fieldStyle}>
                      Minimum
                      <input style={inputStyle} value={planMin} onChange={(e) => setPlanMin(e.target.value)} />
                    </label>
                    <label style={fieldStyle}>
                      Maximum
                      <input style={inputStyle} value={planMax} onChange={(e) => setPlanMax(e.target.value)} />
                    </label>
                    <label style={fieldStyle}>
                      Unit
                      <input style={inputStyle} value={planUnit} onChange={(e) => setPlanUnit(e.target.value)} />
                    </label>
                  </>
                ) : (
                  <>
                    <label style={fieldStyle}>
                      Choices
                      <input style={inputStyle} value={planOptions} onChange={(e) => setPlanOptions(e.target.value)} />
                    </label>
                    <label style={fieldStyle}>
                      Passing values
                      <input style={inputStyle} value={planPass} onChange={(e) => setPlanPass(e.target.value)} />
                    </label>
                  </>
                )}
              </div>
              <div style={{ ...actionRowStyle, justifyContent: 'flex-start', marginTop: 16 }}>
                <button type="submit" style={primaryButtonStyle} disabled={busy || !planName.trim()}>
                  Add characteristic
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      {inspection.status === 'pending' ? (
        <form
          style={cardStyle}
          onSubmit={(event) => {
            event.preventDefault()
          }}
        >
          <h2 style={sectionHeadingStyle}>Record result</h2>
          <p style={hintStyle}>
            {productionLot
              ? 'Accept moves this receipt into unrestricted stock. Reject moves it to quarantine, where it is not available for production.'
              : 'This goods-receipt inspection records the decision and does not change stock.'}
          </p>
          {plans.length > 0 ? (
            <div style={gridStyle}>
              {plans.map((plan) => (
                <label key={plan.id} style={fieldStyle}>
                  {plan.characteristic}
                  <span style={{ fontWeight: 400, color: '#757575' }}>{planHint(plan)}</span>
                  {plan.method === 'attribute' ? (
                    <select
                      style={inputStyle}
                      value={measurements[plan.characteristic] || ''}
                      onChange={(e) => setMeasurements((current) => ({ ...current, [plan.characteristic]: e.target.value }))}
                    >
                      <option value="">Select</option>
                      {(plan.options || 'Pass,Fail').split(',').map((option) => (
                        <option key={option.trim()} value={option.trim()}>
                          {option.trim()}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      style={inputStyle}
                      value={measurements[plan.characteristic] || ''}
                      onChange={(e) => setMeasurements((current) => ({ ...current, [plan.characteristic]: e.target.value }))}
                    />
                  )}
                </label>
              ))}
            </div>
          ) : productionLot ? null : (
            <div style={gridStyle}>
              <label style={fieldStyle}>
                Characteristic
                <input style={inputStyle} value={characteristic} onChange={(e) => setCharacteristic(e.target.value)} required />
              </label>
              <label style={fieldStyle}>
                Specification
                <input style={inputStyle} value={specification} onChange={(e) => setSpecification(e.target.value)} />
              </label>
              <label style={fieldStyle}>
                Measured value
                <input style={inputStyle} value={measured} onChange={(e) => setMeasured(e.target.value)} />
              </label>
            </div>
          )}
          {signoffMessage ? <p style={{ ...hintStyle, marginTop: 16 }}>{signoffMessage}</p> : null}
          {canSignOff && (!productionLot || plans.length > 0) ? (
            <div style={{ ...actionRowStyle, justifyContent: 'flex-start', marginTop: 16 }}>
              <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => void decide('accept')}>
                <CheckCircle2 size={15} />
                Accept
              </button>
              <button type="button" style={dangerButtonStyle} disabled={busy} onClick={() => void decide('reject')}>
                <XCircle size={15} />
                Reject
              </button>
            </div>
          ) : null}
        </form>
      ) : (
        <section style={cardStyle}>
          <h2 style={sectionHeadingStyle}>Re-inspection</h2>
          <p style={hintStyle}>
            This lot is closed. Another inspection opens only after a Quality Manager approves a re-inspection request.
          </p>
          {request ? (
            <p style={{ ...hintStyle, marginTop: 12 }}>
              Request is {request.status}. {request.reason}
            </p>
          ) : null}
          {request?.status === 'pending' && isQcManager && user?.id !== request.requested_by_user_id ? (
            <div style={{ ...actionRowStyle, justifyContent: 'flex-start', marginTop: 16 }}>
              <button
                type="button"
                style={primaryButtonStyle}
                disabled={busy}
                onClick={() => void run(() => inspectionService.decideReinspection(request.id, true), 'Could not approve the re-inspection')}
              >
                Approve re-inspection
              </button>
              <button
                type="button"
                style={dangerButtonStyle}
                disabled={busy}
                onClick={() => void run(() => inspectionService.decideReinspection(request.id, false), 'Could not reject the re-inspection')}
              >
                Deny
              </button>
            </div>
          ) : null}
          {!request || request.status === 'rejected' || request.status === 'consumed' ? (
            <form
              style={{ marginTop: 16 }}
              onSubmit={(event) => {
                event.preventDefault()
                void run(
                  () => inspectionService.requestReinspection(inspection.id, reopenReason.trim()),
                  'Could not request a re-inspection',
                )
              }}
            >
              <label style={fieldStyle}>
                Reason
                <input style={inputStyle} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} required />
              </label>
              <div style={{ ...actionRowStyle, justifyContent: 'flex-start', marginTop: 16 }}>
                <button type="submit" style={headerButtonStyle} disabled={busy || !reopenReason.trim()}>
                  Request re-inspection
                </button>
              </div>
            </form>
          ) : null}
        </section>
      )}

      {(inspection.audit_notes ?? []).length > 0 ? (
        <section style={cardStyle}>
          <h2 style={sectionHeadingStyle}>Audit notes</h2>
          {inspection.audit_notes?.map((note) => (
            <p key={note.id} style={{ ...hintStyle, marginBottom: 8 }}>
              <strong>{note.note_code}</strong>
              {note.alerted ? ' · plant leadership alerted' : ''}. {note.message}
            </p>
          ))}
        </section>
      ) : null}

      {productionLot && inspection.status === 'rejected' && inspection.stock_disposition === 'quarantine' && isQcManager && !isReceiver ? (
        <section style={cardStyle}>
          <h2 style={sectionHeadingStyle}>Quarantine disposition</h2>
          <p style={hintStyle}>Scrap and rework are terminal. The quantity stays out of unrestricted stock.</p>
          <div style={{ ...actionRowStyle, justifyContent: 'flex-start', marginTop: 16 }}>
            <button
              type="button"
              style={dangerButtonStyle}
              disabled={busy}
              onClick={() => void run(() => inspectionService.dispose(inspection.id, 'scrap'), 'Could not scrap this lot')}
            >
              Scrap
            </button>
            <button
              type="button"
              style={headerButtonStyle}
              disabled={busy}
              onClick={() => void run(() => inspectionService.dispose(inspection.id, 'rework'), 'Could not send this lot to rework')}
            >
              Rework
            </button>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section style={cardStyle}>
          <h2 style={sectionHeadingStyle}>Emergency admin override</h2>
          <p style={hintStyle}>
            This bypasses the quality sign-off. The justification is audited and an alert is sent to plant leadership.
          </p>
          <label style={{ ...fieldStyle, marginTop: 16 }}>
            Justification
            <input style={inputStyle} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
          </label>
          <div style={{ ...actionRowStyle, justifyContent: 'flex-start', marginTop: 16 }}>
            {inspection.status === 'pending' ? (
              <>
                <button type="button" style={primaryButtonStyle} disabled={busy || overrideReason.trim().length < 20} onClick={() => void run(() => inspectionService.emergencyOverride(inspection.id, { action: 'accept', justification: overrideReason.trim() }), 'Could not apply the override')}>
                  Override accept
                </button>
                <button type="button" style={dangerButtonStyle} disabled={busy || overrideReason.trim().length < 20} onClick={() => void run(() => inspectionService.emergencyOverride(inspection.id, { action: 'reject', justification: overrideReason.trim() }), 'Could not apply the override')}>
                  Override reject
                </button>
              </>
            ) : null}
            {inspection.status === 'rejected' && inspection.stock_disposition === 'unrestricted' ? (
              <button type="button" style={headerButtonStyle} disabled={busy || overrideReason.trim().length < 20} onClick={() => void run(() => inspectionService.emergencyOverride(inspection.id, { action: 'quarantine', justification: overrideReason.trim() }), 'Could not move this lot to quarantine')}>
                Move rejected quantity to quarantine
              </button>
            ) : null}
            {inspection.stock_disposition === 'quarantine' ? (
              <>
                <button type="button" style={dangerButtonStyle} disabled={busy || overrideReason.trim().length < 20} onClick={() => void run(() => inspectionService.emergencyOverride(inspection.id, { action: 'scrap', justification: overrideReason.trim() }), 'Could not scrap this lot')}>
                  Emergency scrap
                </button>
                <button type="button" style={headerButtonStyle} disabled={busy || overrideReason.trim().length < 20} onClick={() => void run(() => inspectionService.emergencyOverride(inspection.id, { action: 'rework', justification: overrideReason.trim() }), 'Could not send this lot to rework')}>
                  Emergency rework
                </button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

const containerStyle: CSSProperties = { padding: 24, maxWidth: 1200, margin: '0 auto', textAlign: 'left' }
const cardStyle: CSSProperties = {
  backgroundColor: 'var(--bg, #fff)',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
}
const sectionHeadingStyle: CSSProperties = { margin: '0 0 16px', fontSize: 18, fontWeight: 'bold', color: 'var(--text-h, #212121)' }
const metaGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, fontSize: 14 }
const metaColumnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
const metaRowStyle: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 12, margin: 0 }
const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#757575',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  minWidth: 130,
  flexShrink: 0,
}
const valueStyle: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text, #424242)' }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadStyle: CSSProperties = { backgroundColor: 'var(--social-bg, #f5f5f5)' }
const rowStyle: CSSProperties = { borderBottom: '1px solid var(--divider, #eee)' }
const thStyle: CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h, #212121)' }
const tdStyle: CSSProperties = { padding: '12px 10px', color: 'var(--text, #424242)', verticalAlign: 'middle' }
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginTop: 16 }
const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 'bold', color: 'var(--text-h)' }
const inputStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  fontSize: 14,
  fontWeight: 400,
  color: 'var(--text-h)',
  backgroundColor: 'var(--bg)',
  fontFamily: 'inherit',
}
const errorStyle: CSSProperties = {
  margin: '0 0 16px',
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: 6,
  padding: '12px 16px',
  fontSize: 14,
}
const hintStyle: CSSProperties = { margin: 0, color: 'var(--text)', fontSize: 14, lineHeight: 1.5 }
