/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { bomRoutingService, itemBomService, masterRoutingService, workCenterService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type { BomRoutingOperation, ItemBOMHeader, MasterRouting, WorkCenter } from '../types'
import { primaryButtonStyle } from '../utils/documentPageStyles'

export function BomRoutingPanel({ itemId }: { itemId: string }) {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('routing:edit')
  const [headers, setHeaders] = useState<ItemBOMHeader[]>([])
  const [headerId, setHeaderId] = useState<number | ''>('')
  const [steps, setSteps] = useState<BomRoutingOperation[]>([])
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([])
  const [templates, setTemplates] = useState<MasterRouting[]>([])
  const [templateId, setTemplateId] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sequence, setSequence] = useState('10')
  const [name, setName] = useState('')
  const [workCenterId, setWorkCenterId] = useState('')
  const [setupMinutes, setSetupMinutes] = useState('0')
  const [runMinutes, setRunMinutes] = useState('0')

  useEffect(() => {
    itemBomService
      .listHeaders(itemId)
      .then((rows) => {
        setHeaders(rows)
        const active = rows.find((row) => row.status === 'active') ?? rows[0]
        if (active) setHeaderId(active.bom_header_id)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoaded(true))
    workCenterService.listWorkCenters().then(setWorkCenters).catch(() => setWorkCenters([]))
    if (canEdit) {
      masterRoutingService.list('active').then(setTemplates).catch(() => setTemplates([]))
    }
  }, [itemId, canEdit])

  useEffect(() => {
    if (!headerId) return
    bomRoutingService.list(itemId, headerId).then(setSteps).catch((err: Error) => setError(err.message))
  }, [itemId, headerId])

  const addStep = async () => {
    if (!headerId) return
    setError(null)
    try {
      await bomRoutingService.add(itemId, headerId, {
        sequence: Number(sequence),
        name: name.trim(),
        work_center_id: workCenterId.trim() || null,
        setup_minutes: Number(setupMinutes || 0),
        run_minutes_per_unit: Number(runMinutes || 0),
      })
      setName('')
      setSteps(await bomRoutingService.list(itemId, headerId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add routing step')
    }
  }

  if (!loaded) return null
  if (headers.length === 0) {
    return (
      <p style={hintStyle}>
        Routing appears here after this item has a BOM version. Add a component and save the item first.
      </p>
    )
  }

  return (
    <section style={{ marginTop: 28 }}>
      <div style={tableHeaderStyle}>
        <h3 style={headingStyle}>Routing</h3>
        <label style={versionLabelStyle}>
          BOM version
          <select
            aria-label="BOM version for routing"
            value={headerId}
            onChange={(event) => setHeaderId(Number(event.target.value))}
            style={inputStyle}
          >
            {headers.map((header) => (
              <option key={header.bom_header_id} value={header.bom_header_id}>
                v{header.version_no} ({header.status})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p style={hintStyle}>
        Work-center steps for this BOM revision. Applying a library template fills this sequence and leaves the item record unchanged. Production orders keep the revision copied when the order is saved.
      </p>
      {canEdit ? (
        <div style={{ ...gridStyle, marginBottom: 16, alignItems: 'end' }}>
          <label style={fieldStyle}>
            Route library
            <select style={inputStyle} value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              <option value="">Select an active template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.routing_code} v{template.version_no} — {template.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={!templateId || !headerId}
            onClick={() => {
              if (!headerId || !templateId) return
              setError(null)
              void bomRoutingService
                .applyTemplate(itemId, headerId, Number(templateId))
                .then(() => bomRoutingService.list(itemId, headerId))
                .then(setSteps)
                .catch((err: Error) => setError(err.message))
            }}
          >
            Apply template
          </button>
        </div>
      ) : null}
      {error ? <p style={errorStyle}>{error}</p> : null}
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr style={theadStyle}>
              <th style={thStyle}>Seq</th>
              <th style={thStyle}>Operation</th>
              <th style={thStyle}>Work center</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Setup min</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Run min / unit</th>
              <th style={{ ...thStyle, textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {steps.length === 0 ? (
              <tr>
                <td style={{ ...tdStyle, textAlign: 'center', fontStyle: 'italic' }} colSpan={6}>
                  No routing steps yet.
                </td>
              </tr>
            ) : (
              steps.map((step) => (
                <tr key={step.id} style={rowStyle}>
                  <td style={tdStyle}>{step.sequence}</td>
                  <td style={tdStyle}>{step.name}</td>
                  <td style={tdStyle}>{step.work_center_id || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{step.setup_minutes}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{step.run_minutes_per_unit}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {canEdit ? (
                      <button
                        type="button"
                        style={removeButtonStyle}
                        onClick={() => {
                          if (!headerId) return
                          void bomRoutingService.remove(itemId, headerId, step.id).then(() =>
                            bomRoutingService.list(itemId, headerId).then(setSteps),
                          )
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {canEdit ? <div style={{ marginTop: 16 }}>
        <div style={gridStyle}>
          <label style={fieldStyle}>
            Sequence
            <input style={inputStyle} value={sequence} onChange={(e) => setSequence(e.target.value)} required />
          </label>
          <label style={fieldStyle}>
            Operation
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label style={fieldStyle}>
            Work center
            <select style={inputStyle} value={workCenterId} onChange={(e) => setWorkCenterId(e.target.value)}>
              <option value="">None</option>
              {workCenters.map((center) => (
                <option key={center.work_center_id} value={center.work_center_id}>
                  {center.work_center_id} — {center.name}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldStyle}>
            Setup minutes
            <input style={inputStyle} value={setupMinutes} onChange={(e) => setSetupMinutes(e.target.value)} />
          </label>
          <label style={fieldStyle}>
            Run minutes per unit
            <input style={inputStyle} value={runMinutes} onChange={(e) => setRunMinutes(e.target.value)} />
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => void addStep()} style={primaryButtonStyle} disabled={!name.trim()}>
            Add step
          </button>
        </div>
      </div> : null}
    </section>
  )
}

const headingStyle: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 'bold', color: 'var(--text-h)' }
const tableHeaderStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }
const versionLabelStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 'bold', color: 'var(--text-h)' }
const hintStyle: CSSProperties = { margin: '0 0 16px', color: 'var(--text)', fontSize: 14 }
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }
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
  margin: '0 0 12px',
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: 6,
  padding: '12px 16px',
  fontSize: 14,
}
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadStyle: CSSProperties = { backgroundColor: 'var(--social-bg)' }
const rowStyle: CSSProperties = { borderBottom: '1px solid var(--divider)' }
const thStyle: CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const tdStyle: CSSProperties = { padding: '12px 10px', color: 'var(--text)', verticalAlign: 'middle' }
const removeButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 'bold',
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  fontFamily: 'inherit',
}
