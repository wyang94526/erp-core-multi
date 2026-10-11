/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useState, type CSSProperties, type FormEvent } from 'react'
import type { ProductionOrderRouting } from '../types'

const SCRAP_REASONS = [
  ['OPERATOR_ERROR', 'Operator error'],
  ['MACHINE_MALFUNCTION', 'Machine malfunction'],
  ['RAW_MATERIAL_DEFECT', 'Raw material defect'],
  ['TOOLING', 'Tooling'],
  ['OTHER', 'Other'],
] as const

const DEFECT_CLASSES = [
  ['DIMENSIONAL', 'Dimensional'],
  ['COSMETIC', 'Cosmetic'],
  ['FUNCTIONAL', 'Functional'],
  ['MATERIAL', 'Material'],
  ['OTHER', 'Other'],
] as const

const DOWNTIME_REASONS = [
  ['MAINTENANCE', 'Maintenance'],
  ['TOOL_CHANGE', 'Tool change'],
  ['WAITING_MATERIAL', 'Waiting for material'],
  ['NO_OPERATOR', 'Waiting for operator'],
  ['OTHER', 'Other'],
] as const

export interface StepCompletion {
  good_quantity: number
  scrap_quantity: number
  rework_quantity: number
  scrap_reason_code?: string | null
  defect_class?: string | null
  setup_minutes_actual: number
  run_minutes_actual: number
  lot_number?: string | null
  serial_number?: string | null
  quality_checks: {
    characteristic: string
    specification?: string
    measured_value?: string
    passed: boolean
    defect_class?: string | null
  }[]
  downtime: { reason_code: string; minutes: number; notes?: string | null }[]
  parameters: { name: string; value: string; unit?: string | null }[]
}

export default function ShopFloorPanel({
  step,
  plannedQuantity,
  busy,
  onComplete,
}: {
  step: ProductionOrderRouting
  plannedQuantity: number
  busy: boolean
  onComplete: (body: StepCompletion) => void
}) {
  const [good, setGood] = useState(String(plannedQuantity))
  const [scrap, setScrap] = useState('0')
  const [rework, setRework] = useState('0')
  const [reason, setReason] = useState('OPERATOR_ERROR')
  const [defect, setDefect] = useState('')
  const [setup, setSetup] = useState('0')
  const [run, setRun] = useState('0')
  const [lot, setLot] = useState('')
  const [serial, setSerial] = useState('')
  const [characteristic, setCharacteristic] = useState('')
  const [specification, setSpecification] = useState('')
  const [measured, setMeasured] = useState('')
  const [passed, setPassed] = useState(true)
  const [downtimeReason, setDowntimeReason] = useState('')
  const [downtimeMinutes, setDowntimeMinutes] = useState('')
  const [parameterName, setParameterName] = useState('')
  const [parameterValue, setParameterValue] = useState('')
  const [parameterUnit, setParameterUnit] = useState('')

  const openLabor = (step.labor_logs || []).find((log) => !log.stopped_at)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const scrapQty = Number(scrap || 0)
    const body: StepCompletion = {
      good_quantity: Number(good || 0),
      scrap_quantity: scrapQty,
      rework_quantity: Number(rework || 0),
      scrap_reason_code: scrapQty > 0 ? reason : null,
      defect_class: defect || null,
      setup_minutes_actual: Number(setup || 0),
      run_minutes_actual: Number(run || 0),
      lot_number: lot.trim() || null,
      serial_number: serial.trim() || null,
      quality_checks: characteristic.trim()
        ? [{
            characteristic: characteristic.trim(),
            specification: specification.trim() || undefined,
            measured_value: measured.trim() || undefined,
            passed,
            defect_class: defect || null,
          }]
        : [],
      downtime: downtimeReason && Number(downtimeMinutes) > 0
        ? [{ reason_code: downtimeReason, minutes: Number(downtimeMinutes) }]
        : [],
      parameters: parameterName.trim() && parameterValue.trim()
        ? [{ name: parameterName.trim(), value: parameterValue.trim(), unit: parameterUnit.trim() || null }]
        : [],
    }
    onComplete(body)
  }

  return (
    <form onSubmit={submit} style={panelStyle} aria-label={`Record ${step.operation_name}`}>
      <h3 style={headingStyle}>
        Record sequence {step.operation_sequence} · {step.operation_name}
        {step.work_center_id ? ` · ${step.work_center_id}` : ''}
      </h3>
      <p style={hintStyle}>
        {openLabor
          ? `Labor timer started ${new Date(openLabor.started_at).toLocaleString()}.`
          : 'Starting the step opened a labor timer. Completing it records the hours.'}
        {' '}Good and scrap quantities backflush components that are still unissued. Rework does not consume more material.
      </p>
      <div style={gridStyle}>
        <label style={fieldStyle}>
          Good quantity
          <input style={inputStyle} aria-label="Good quantity" type="number" min={0} value={good} onChange={(e) => setGood(e.target.value)} required />
        </label>
        <label style={fieldStyle}>
          Scrap quantity
          <input style={inputStyle} aria-label="Scrap quantity" type="number" min={0} value={scrap} onChange={(e) => setScrap(e.target.value)} required />
        </label>
        <label style={fieldStyle}>
          Rework quantity
          <input style={inputStyle} aria-label="Rework quantity" type="number" min={0} value={rework} onChange={(e) => setRework(e.target.value)} required />
        </label>
        <label style={fieldStyle}>
          Scrap reason
          <select style={inputStyle} aria-label="Scrap reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={Number(scrap) <= 0}>
            {SCRAP_REASONS.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          Defect class
          <select style={inputStyle} aria-label="Defect class" value={defect} onChange={(e) => setDefect(e.target.value)}>
            <option value="">None</option>
            {DEFECT_CLASSES.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          Actual setup minutes
          <input style={inputStyle} aria-label="Actual setup minutes" type="number" min={0} step="0.01" value={setup} onChange={(e) => setSetup(e.target.value)} />
        </label>
        <label style={fieldStyle}>
          Actual run minutes
          <input style={inputStyle} aria-label="Actual run minutes" type="number" min={0} step="0.01" value={run} onChange={(e) => setRun(e.target.value)} />
        </label>
        <label style={fieldStyle}>
          Lot consumed
          <input style={inputStyle} aria-label="Lot consumed" value={lot} onChange={(e) => setLot(e.target.value)} />
        </label>
        <label style={fieldStyle}>
          Serial consumed
          <input style={inputStyle} aria-label="Serial consumed" value={serial} onChange={(e) => setSerial(e.target.value)} />
        </label>
      </div>
      <h4 style={subHeadingStyle}>In-process check</h4>
      <div style={gridStyle}>
        <label style={fieldStyle}>
          Characteristic
          <input style={inputStyle} aria-label="Characteristic" value={characteristic} onChange={(e) => setCharacteristic(e.target.value)} />
        </label>
        <label style={fieldStyle}>
          Specification
          <input style={inputStyle} aria-label="Specification" value={specification} onChange={(e) => setSpecification(e.target.value)} />
        </label>
        <label style={fieldStyle}>
          Measured value
          <input style={inputStyle} aria-label="Measured value" value={measured} onChange={(e) => setMeasured(e.target.value)} />
        </label>
        <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}>
          <input type="checkbox" aria-label="Check passed" checked={passed} onChange={(e) => setPassed(e.target.checked)} />
          Passed
        </label>
      </div>
      <h4 style={subHeadingStyle}>Downtime and machine reading</h4>
      <div style={gridStyle}>
        <label style={fieldStyle}>
          Downtime reason
          <select style={inputStyle} aria-label="Downtime reason" value={downtimeReason} onChange={(e) => setDowntimeReason(e.target.value)}>
            <option value="">None</option>
            {DOWNTIME_REASONS.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          Downtime minutes
          <input style={inputStyle} aria-label="Downtime minutes" type="number" min={0} step="0.01" value={downtimeMinutes} onChange={(e) => setDowntimeMinutes(e.target.value)} />
        </label>
        <label style={fieldStyle}>
          Reading name
          <input style={inputStyle} aria-label="Reading name" value={parameterName} onChange={(e) => setParameterName(e.target.value)} placeholder="Temperature" />
        </label>
        <label style={fieldStyle}>
          Reading value
          <input style={inputStyle} aria-label="Reading value" value={parameterValue} onChange={(e) => setParameterValue(e.target.value)} />
        </label>
        <label style={fieldStyle}>
          Reading unit
          <input style={inputStyle} aria-label="Reading unit" value={parameterUnit} onChange={(e) => setParameterUnit(e.target.value)} placeholder="C" />
        </label>
      </div>
      <button type="submit" style={submitStyle} disabled={busy}>
        Complete step
      </button>
    </form>
  )
}

const panelStyle: CSSProperties = {
  marginTop: 16,
  padding: 16,
  border: '1px solid var(--border, #ddd)',
  borderRadius: 8,
  background: 'var(--social-bg, #fafafa)',
}
const headingStyle: CSSProperties = { margin: '0 0 8px', fontSize: 15 }
const subHeadingStyle: CSSProperties = { margin: '16px 0 8px', fontSize: 13 }
const hintStyle: CSSProperties = { margin: '0 0 12px', fontSize: 13, color: 'var(--text, #424242)' }
const gridStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 }
const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700, minWidth: 160 }
const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border, #ccc)',
  fontSize: 14,
  fontWeight: 400,
  fontFamily: 'inherit',
  background: 'var(--bg, #fff)',
}
const submitStyle: CSSProperties = {
  marginTop: 16,
  padding: '8px 14px',
  borderRadius: 6,
  border: 'none',
  background: '#1565c0',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
}
