/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { inspectionService } from '../api/services'
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

export default function InspectionDetail() {
  const { inspectionId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [characteristic, setCharacteristic] = useState('Visual')
  const [specification, setSpecification] = useState('')
  const [measured, setMeasured] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: inspection = null, isLoading, error: loadError } = useQuery({
    queryKey: ['inspections', inspectionId],
    queryFn: () => inspectionService.get(inspectionId),
    enabled: Boolean(inspectionId),
  })

  const decide = async (decision: 'accept' | 'reject') => {
    setError(null)
    setBusy(true)
    const body = {
      results: [
        {
          characteristic: characteristic.trim() || 'Visual',
          specification: specification.trim() || undefined,
          measured_value: measured,
          passed: decision === 'accept',
        },
      ],
    }
    try {
      if (decision === 'accept') await inspectionService.accept(inspectionId, body)
      else await inspectionService.reject(inspectionId, body)
      await queryClient.invalidateQueries({ queryKey: ['inspections'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record inspection')
    } finally {
      setBusy(false)
    }
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
          </div>
          <div style={metaColumnStyle}>
            <MetaRow label="Inspected">
              {inspection.inspected_at ? new Date(inspection.inspected_at).toLocaleString() : '—'}
            </MetaRow>
            <MetaRow label="Notes">{inspection.notes || '—'}</MetaRow>
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

      {inspection.status === 'pending' ? (
        <form
          style={cardStyle}
          onSubmit={(event) => {
            event.preventDefault()
          }}
        >
          <h2 style={sectionHeadingStyle}>Record result</h2>
          <p style={hintStyle}>
            Accept posts a production receipt into on-hand stock. Reject keeps that quantity out of available stock.
          </p>
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
        </form>
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
