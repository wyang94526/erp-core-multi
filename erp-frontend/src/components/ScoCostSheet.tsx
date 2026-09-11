import type { SubcontractCharge } from '../types'
import { defaultCostSheet, rollupCostSheet } from '../utils/scoCostSheet'

type Props = {
  quantity: number
  charges: SubcontractCharge[]
  onChange: (charges: SubcontractCharge[]) => void
  readOnly?: boolean
}

export function ScoCostSheet({ quantity, charges, onChange, readOnly }: Props) {
  const sheet = rollupCostSheet(
    charges.length ? charges : readOnly ? [] : defaultCostSheet(),
    quantity,
  )

  const updateRow = (index: number, patch: Partial<SubcontractCharge>) => {
    const next = sheet.charges.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    onChange(rollupCostSheet(next, quantity).charges)
  }

  const addRow = () => {
    const margin = sheet.charges.find((row) => row.is_margin)
    const others = sheet.charges.filter((row) => !row.is_margin)
    others.push({
      line_no: others.length + 1,
      name: 'New component',
      detail_explanation: '',
      labor_minutes: 0,
      sf_rate: 0,
      cost_per_unit: 0,
      is_margin: false,
    })
    onChange(rollupCostSheet(margin ? [...others, margin] : others, quantity).charges)
  }

  const removeRow = (index: number) => {
    const next = sheet.charges.filter((_, rowIndex) => rowIndex !== index)
    onChange(rollupCostSheet(next, quantity).charges)
  }

  return (
    <div>
      {readOnly && sheet.charges.length === 0 ? (
        <p style={{ color: 'var(--text)', fontStyle: 'italic', margin: '8px 0' }}>
          No vendor charges entered.
        </p>
      ) : (
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Line</th>
            <th style={thStyle}>Cost Component</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Minutes</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>SF Rate</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Cost/Unit</th>
            {!readOnly && <th style={thStyle} />}
          </tr>
        </thead>
        <tbody>
          {sheet.charges.map((row, index) => (
            <tr key={`${row.line_no}-${row.name}`}>
              <td style={tdStyle}>{row.line_no}</td>
              <td style={tdStyle}>
                {readOnly ? (
                  <>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    {row.detail_explanation && (
                      <div style={{ fontSize: 12, color: 'var(--text)' }}>{row.detail_explanation}</div>
                    )}
                  </>
                ) : (
                  <>
                    <input
                      value={row.name}
                      onChange={(event) => updateRow(index, { name: event.target.value })}
                      style={inputStyle}
                    />
                    <textarea
                      value={row.detail_explanation || ''}
                      onChange={(event) => updateRow(index, { detail_explanation: event.target.value })}
                      style={{ ...inputStyle, minHeight: 44, marginTop: 6 }}
                      placeholder="Detail explanation"
                    />
                    {row.is_margin && (
                      <label style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
                        Margin %
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={row.margin_percent ?? 0}
                          onChange={(event) =>
                            updateRow(index, { margin_percent: Number(event.target.value) })
                          }
                          style={{ ...inputStyle, marginTop: 4 }}
                        />
                      </label>
                    )}
                  </>
                )}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {row.is_margin ? (
                  '—'
                ) : readOnly ? (
                  row.labor_minutes ?? '—'
                ) : (
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={row.labor_minutes ?? ''}
                    onChange={(event) =>
                      updateRow(index, {
                        labor_minutes: event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                    style={{ ...inputStyle, textAlign: 'right' }}
                  />
                )}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {row.is_margin ? (
                  '—'
                ) : readOnly ? (
                  row.sf_rate ?? '—'
                ) : (
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={row.sf_rate ?? ''}
                    onChange={(event) =>
                      updateRow(index, {
                        sf_rate: event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                    style={{ ...inputStyle, textAlign: 'right' }}
                  />
                )}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                {row.is_margin && !readOnly ? (
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.cost_per_unit}
                    onChange={(event) => updateRow(index, { cost_per_unit: Number(event.target.value) })}
                    style={{ ...inputStyle, textAlign: 'right' }}
                  />
                ) : (
                  Number(row.cost_per_unit || 0).toFixed(2)
                )}
              </td>
              {!readOnly && (
                <td style={tdStyle}>
                  {!row.is_margin && (
                    <button type="button" onClick={() => removeRow(index)} style={linkButton}>
                      Remove
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      )}
      {!readOnly && (
        <button type="button" onClick={addRow} style={linkButton}>
          + Add component
        </button>
      )}
      <div style={{ marginTop: 12, fontSize: 14, color: 'var(--text-h)' }}>
        <div>Unit Price: <strong>{sheet.unitPrice.toFixed(2)}</strong></div>
        <div>Assembly Quantity: <strong>{quantity}</strong></div>
        <div>Total Amount: <strong>{sheet.lineTotal.toFixed(2)}</strong></div>
      </div>
    </div>
  )
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const thStyle: React.CSSProperties = {
  padding: '8px 6px',
  textAlign: 'left',
  borderBottom: '2px solid var(--border)',
}
const tdStyle: React.CSSProperties = {
  padding: '8px 6px',
  verticalAlign: 'top',
  borderBottom: '1px solid var(--border)',
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-h)',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const linkButton: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#1565c0',
  cursor: 'pointer',
  fontWeight: 600,
  padding: 0,
}

export default ScoCostSheet
