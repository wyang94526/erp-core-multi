/**
 * StockMovements — Receipts / Issues / Adjustments / Transfers
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { inventoryService } from '../api/services'
import type { StockMovementType } from '../types'

export function StockMovements() {
  const [searchParams, setSearchParams] = useSearchParams()
  const productFilter = searchParams.get('product') || undefined

  const {
    data: movements = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['inventoryMovements', productFilter ?? 'all'],
    queryFn: () => inventoryService.listMovements(productFilter),
  })

  const titleSuffix = useMemo(
    () => (productFilter ? ` · ${productFilter}` : ''),
    [productFilter],
  )

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading stock movements...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
          <p>Error loading movements:</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Stock Movements{titleSuffix}</h2>
          <p style={pageSubStyle}>
            Receipts, issues, adjustments, and transfers across warehouses
          </p>
        </div>
        {productFilter && (
          <button
            type="button"
            onClick={() => setSearchParams({})}
            style={secondaryButtonStyle}
          >
            Clear product filter
          </button>
        )}
      </header>

      <div style={dashboardSectionStyle}>
        {movements.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No stock movements found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <th style={directoryThStyle}>Movement ID</th>
                  <th style={directoryThStyle}>Date</th>
                  <th style={directoryThStyle}>Product</th>
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Type</th>
                  <th style={{ ...directoryThStyle, textAlign: 'right' }}>Qty</th>
                  <th style={directoryThStyle}>Warehouse / Bin</th>
                  <th style={directoryThStyle}>Reference</th>
                  <th style={directoryThStyle}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const colors = getMovementColors(m.movement_type)
                  return (
                    <tr key={m.movement_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>{m.movement_id}</td>
                      <td style={directoryTdStyle}>{formatDate(m.movement_date)}</td>
                      <td style={directoryTdStyle}>
                        <Link to={`/items/${m.item_id}`} style={productLinkStyle}>
                          {m.item_id}
                        </Link>
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <span
                          style={{
                            ...statusBadgeStyle,
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {m.movement_type}
                        </span>
                      </td>
                      <td
                        style={{
                          ...directoryTdStyle,
                          textAlign: 'right',
                          fontWeight: 700,
                          color: m.quantity < 0 ? '#c62828' : '#2e7d32',
                        }}
                      >
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </td>
                      <td style={directoryTdStyle}>
                        {m.warehouse_code || m.warehouse_id} / {m.bin_code || m.bin_id}
                      </td>
                      <td style={directoryTdStyle}>{m.reference || '—'}</td>
                      <td style={directoryTdStyle}>{m.notes || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function getMovementColors(type: StockMovementType): { bg: string; text: string } {
  const map: Record<StockMovementType, { bg: string; text: string }> = {
    Receipt: { bg: '#e8f5e9', text: '#2e7d32' },
    Issue: { bg: '#ffebee', text: '#c62828' },
    Adjustment: { bg: '#fff3e0', text: '#e65100' },
    Transfer: { bg: '#e3f2fd', text: '#1565c0' },
  }
  return map[type] || { bg: '#f5f5f5', text: '#616161' }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString()
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
}

const pageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const pageSubStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  fontSize: '14px',
  color: 'var(--text)',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: 'var(--shadow)',
}

const directoryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const directoryTheadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
}

const directoryThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const directoryTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
  transition: 'background-color 0.2s',
}

const directoryTdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
}

const directoryEmptyTdWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

const statusBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: '12px',
  fontSize: '11px',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
}

const productLinkStyle: React.CSSProperties = {
  color: '#1976d2',
  fontWeight: 700,
  textDecoration: 'none',
}

export default StockMovements
