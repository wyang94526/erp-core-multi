/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useState, type CSSProperties, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { masterRoutingService, workCenterService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type { MasterRouting } from '../types'
import { primaryButtonStyle, secondaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'

export default function RouteLibraryPage() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('routing:edit')
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [opCode, setOpCode] = useState('')
  const [opName, setOpName] = useState('')
  const [routeCode, setRouteCode] = useState('')
  const [routeName, setRouteName] = useState('')
  const [stepOperationId, setStepOperationId] = useState('')
  const [stepSequence, setStepSequence] = useState('10')

  const { data: operations = [] } = useQuery({
    queryKey: ['standardOperations'],
    queryFn: () => masterRoutingService.listOperations(),
  })
  const { data: routings = [] } = useQuery({
    queryKey: ['masterRoutings'],
    queryFn: () => masterRoutingService.list(),
  })
  const { data: workCenters = [] } = useQuery({
    queryKey: ['workCenters', 'route-library'],
    queryFn: () => workCenterService.listWorkCenters(),
  })

  const selected = routings.find((row) => row.id === selectedId) ?? routings[0] ?? null

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['standardOperations'] })
    await queryClient.invalidateQueries({ queryKey: ['masterRoutings'] })
  }

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    }
  }

  const createOperation = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      await masterRoutingService.createOperation({ operation_code: opCode.trim(), name: opName.trim() })
      setOpCode('')
      setOpName('')
    })
  }

  const createRouting = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const created = await masterRoutingService.create({ routing_code: routeCode.trim(), name: routeName.trim() })
      setSelectedId(created.id)
      setRouteCode('')
      setRouteName('')
    })
  }

  return (
    <div style={containerStyle}>
      <PageHeader
        title="Route library"
        subtitle="Templates live apart from items. A new version leaves production orders on the revision they already copied."
      />
      {error ? <p style={errorStyle}>{error}</p> : null}
      {!canEdit ? <p style={hintStyle}>You can view work instructions. Editing the library is limited to engineering and planning.</p> : null}

      <section style={cardStyle}>
        <h2 style={headingStyle}>Standard operations</h2>
        {operations.length === 0 ? <p style={hintStyle}>No standard operations yet.</p> : (
          <ul style={listStyle}>
            {operations.map((operation) => (
              <li key={operation.id}>
                {operation.operation_code} — {operation.name}
                {operation.work_center_id ? ` · ${operation.work_center_id}` : ''}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <form onSubmit={createOperation} style={rowStyle}>
            <input style={inputStyle} value={opCode} onChange={(e) => setOpCode(e.target.value)} placeholder="Code" required />
            <input style={inputStyle} value={opName} onChange={(e) => setOpName(e.target.value)} placeholder="Name" required />
            <button type="submit" style={primaryButtonStyle}>Add operation</button>
          </form>
        ) : null}
      </section>

      <section style={cardStyle}>
        <h2 style={headingStyle}>Master routings</h2>
        {canEdit ? (
          <form onSubmit={createRouting} style={{ ...rowStyle, marginBottom: 16 }}>
            <input style={inputStyle} value={routeCode} onChange={(e) => setRouteCode(e.target.value)} placeholder="Route code" required />
            <input style={inputStyle} value={routeName} onChange={(e) => setRouteName(e.target.value)} placeholder="Name" required />
            <button type="submit" style={primaryButtonStyle}>New template</button>
          </form>
        ) : null}
        <div style={rowStyle}>
          {routings.map((routing) => (
            <button
              key={routing.id}
              type="button"
              onClick={() => setSelectedId(routing.id)}
              style={selected?.id === routing.id ? primaryButtonStyle : secondaryButtonStyle}
            >
              {routing.routing_code} v{routing.version_no} · {routing.status}
            </button>
          ))}
        </div>
        {selected ? <RoutingDetail routing={selected} canEdit={canEdit} operations={operations} workCenterLabel={(id) => workCenters.find((row) => row.work_center_id === id)?.name || id || '—'} stepOperationId={stepOperationId} setStepOperationId={setStepOperationId} stepSequence={stepSequence} setStepSequence={setStepSequence} onAddStep={() => void run(() => masterRoutingService.addStep(selected.id, { sequence: Number(stepSequence), standard_operation_id: Number(stepOperationId) }))} onRevise={() => void run(async () => {
            const created = await masterRoutingService.revise(selected.id)
            setSelectedId(created.id)
          })} onActivate={() => void run(() => masterRoutingService.activate(selected.id))} /> : <p style={hintStyle}>No route templates yet.</p>}
      </section>
    </div>
  )
}

function RoutingDetail({
  routing,
  canEdit,
  operations,
  workCenterLabel,
  stepOperationId,
  setStepOperationId,
  stepSequence,
  setStepSequence,
  onAddStep,
  onRevise,
  onActivate,
}: {
  routing: MasterRouting
  canEdit: boolean
  operations: { id: number; operation_code: string; name: string }[]
  workCenterLabel: (id: string | null) => string
  stepOperationId: string
  setStepOperationId: (value: string) => void
  stepSequence: string
  setStepSequence: (value: string) => void
  onAddStep: () => void
  onRevise: () => void
  onActivate: () => void
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={headingStyle}>{routing.routing_code} — {routing.name} · v{routing.version_no} · {routing.status}</h3>
      {routing.operations.length === 0 ? <p style={hintStyle}>No operations on this revision.</p> : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Seq</th>
              <th style={thStyle}>Operation</th>
              <th style={thStyle}>Work center</th>
            </tr>
          </thead>
          <tbody>
            {routing.operations.map((step) => (
              <tr key={step.id}>
                <td style={tdStyle}>{step.sequence}</td>
                <td style={tdStyle}>{step.operation_name}</td>
                <td style={tdStyle}>{workCenterLabel(step.work_center_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit ? (
        <div style={{ ...rowStyle, marginTop: 12 }}>
          <input style={inputStyle} value={stepSequence} onChange={(e) => setStepSequence(e.target.value)} />
          <select style={inputStyle} value={stepOperationId} onChange={(e) => setStepOperationId(e.target.value)}>
            <option value="">Standard operation</option>
            {operations.map((operation) => (
              <option key={operation.id} value={operation.id}>{operation.operation_code} — {operation.name}</option>
            ))}
          </select>
          <button type="button" style={primaryButtonStyle} disabled={!stepOperationId || routing.status === 'obsolete'} onClick={onAddStep}>Add step</button>
          <button type="button" style={secondaryButtonStyle} onClick={onRevise}>New version</button>
          <button type="button" style={secondaryButtonStyle} disabled={routing.status === 'active'} onClick={onActivate}>Activate</button>
        </div>
      ) : null}
    </div>
  )
}

const containerStyle: CSSProperties = { padding: 24, maxWidth: 1200, margin: '0 auto', textAlign: 'left' }
const cardStyle: CSSProperties = { backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, marginBottom: 20 }
const headingStyle: CSSProperties = { margin: '0 0 12px', fontSize: 18, color: 'var(--text-h)' }
const hintStyle: CSSProperties = { margin: '0 0 12px', color: 'var(--text)', fontStyle: 'italic' }
const errorStyle: CSSProperties = { margin: '0 0 12px', backgroundColor: '#ffebee', color: '#c62828', borderRadius: 6, padding: '12px 16px' }
const listStyle: CSSProperties = { margin: '0 0 16px', paddingLeft: 18 }
const rowStyle: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }
const inputStyle: CSSProperties = { padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit', backgroundColor: 'var(--bg)', color: 'var(--text-h)' }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const thStyle: CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }
const tdStyle: CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--divider)' }
