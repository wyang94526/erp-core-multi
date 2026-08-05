/**
 * InventoryOverview — Stock On-Hand & Available to Promise (ATP)
 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { inventoryService } from '../api/services'
import type { InventoryStockItem, StockStatus } from '../types'

export function InventoryOverview() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [actionItemId, setActionItemId] = useState<string | null>(null)

  const {
    data: stock = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['inventoryStock'],
    queryFn: () => inventoryService.listStock(),
  })

  const alertCounts = useMemo(() => {
    const low = stock.filter((s) => s.status === 'Low Stock').length
    const out = stock.filter((s) => s.status === 'Out of Stock').length
    return { low, out, reorder: low + out }
  }, [stock])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['inventoryStock'] })

  const handleAdjust = async (item: InventoryStockItem) => {
    const raw = window.prompt(
      `Adjust on-hand for ${item.item_id}\nEnter quantity delta (e.g. 10 or -5):`,
      '0',
    )
    if (raw === null) return
    const delta = Number(raw)
    if (!Number.isFinite(delta) || delta === 0) {
      alert('Please enter a non-zero number.')
      return
    }
    setActionItemId(item.item_id)
    try {
      await inventoryService.adjustStock(item.item_id, delta)
      await refresh()
      await queryClient.invalidateQueries({ queryKey: ['inventoryMovements'] })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Adjustment failed')
    } finally {
      setActionItemId(null)
    }
  }

  const handleTransfer = async (item: InventoryStockItem) => {
    const dest = window.prompt(
      `Transfer ${item.item_id} from ${item.primary_warehouse_code}/${item.primary_bin_code}\nEnter destination as WAREHOUSE_CODE/BIN_CODE (e.g. ECH/E-01-01):`,
      'ECH/E-01-01',
    )
    if (dest === null) return
    const [whCode, binCode] = dest.split('/').map((s) => s.trim())
    if (!whCode || !binCode) {
      alert('Use format WAREHOUSE_CODE/BIN_CODE (e.g. ECH/E-01-01).')
      return
    }
    const qtyRaw = window.prompt('Quantity to transfer:', '1')
    if (qtyRaw === null) return
    const qty = Number(qtyRaw)
    if (!Number.isFinite(qty) || qty <= 0) {
      alert('Enter a positive quantity.')
      return
    }
    setActionItemId(item.item_id)
    try {
      const [warehouses, bins] = await Promise.all([
        inventoryService.listWarehouses(),
        inventoryService.listBins(),
      ])
      const warehouse = warehouses.find(
        (w) => w.code.toUpperCase() === whCode.toUpperCase(),
      )
      if (!warehouse) throw new Error(`Warehouse code ${whCode} not found`)
      const bin = bins.find(
        (b) =>
          b.warehouse_id === warehouse.warehouse_id &&
          b.bin_code.toUpperCase() === binCode.toUpperCase(),
      )
      if (!bin) throw new Error(`Bin ${binCode} not found in warehouse ${whCode}`)

      await inventoryService.transferStock(
        item.item_id,
        qty,
        warehouse.warehouse_id,
        bin.bin_id,
      )
      await refresh()
      await queryClient.invalidateQueries({ queryKey: ['inventoryMovements'] })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Transfer failed')
    } finally {
      setActionItemId(null)
    }
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading inventory...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
          <p>Error loading inventory:</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Stock On-Hand &amp; ATP</h2>
          <p style={pageSubStyle}>
            On-hand, allocations, on-order, and available-to-promise by item
          </p>
        </div>
      </header>

      <div style={alertRowStyle}>
        <div style={{ ...alertCardStyle, borderColor: '#ffc107' }}>
          <div style={alertLabelStyle}>Low Stock</div>
          <div style={{ ...alertValueStyle, color: '#e65100' }}>{alertCounts.low}</div>
        </div>
        <div style={{ ...alertCardStyle, borderColor: '#ef5350' }}>
          <div style={alertLabelStyle}>Out of Stock</div>
          <div style={{ ...alertValueStyle, color: '#c62828' }}>{alertCounts.out}</div>
        </div>
        <div style={{ ...alertCardStyle, borderColor: '#2196F3' }}>
          <div style={alertLabelStyle}>Reorder Alerts</div>
          <div style={{ ...alertValueStyle, color: '#1565c0' }}>{alertCounts.reorder}</div>
        </div>
      </div>

      <div style={dashboardSectionStyle}>
        {stock.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No inventory records found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <th style={directoryThStyle}>Product</th>
                  <th style={{ ...directoryThStyle, textAlign: 'right' }}>On-Hand</th>
                  <th style={{ ...directoryThStyle, textAlign: 'right' }}>Allocated</th>
                  <th style={{ ...directoryThStyle, textAlign: 'right' }}>On-Order</th>
                  <th style={{ ...directoryThStyle, textAlign: 'right' }}>ATP</th>
                  <th style={{ ...directoryThStyle, textAlign: 'right' }}>Reorder Pt</th>
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                  <th style={directoryThStyle}>Warehouse / Bin</th>
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((item) => {
                  const colors = getStatusColors(item.status)
                  const busy = actionItemId === item.item_id
                  return (
                    <tr key={item.item_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>
                        <Link
                          to={`/items/${item.item_id}`}
                          style={productLinkStyle}
                        >
                          {item.item_id}
                        </Link>
                        <div style={productDescStyle}>
                          {item.description || '—'} · {item.uom}
                        </div>
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {item.on_hand_quantity}
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {item.allocated_quantity}
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {item.on_order_quantity}
                      </td>
                      <td
                        style={{
                          ...directoryTdStyle,
                          textAlign: 'right',
                          fontWeight: 700,
                          color: item.available_to_promise < 0 ? '#c62828' : 'var(--text-h)',
                        }}
                      >
                        {item.available_to_promise}
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {item.reorder_point}
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <span
                          style={{
                            ...statusBadgeStyle,
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td style={directoryTdStyle}>
                        <span style={{ fontWeight: 600, color: 'var(--text-h)' }}>
                          {item.primary_warehouse_code}
                        </span>
                        <span style={{ color: 'var(--text)' }}> / {item.primary_bin_code}</span>
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <div style={actionsWrapStyle}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleAdjust(item)}
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: '#fff3e0',
                              color: '#e65100',
                              border: '1px solid #ffe0b2',
                              opacity: busy ? 0.6 : 1,
                            }}
                          >
                            Adjust Stock
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleTransfer(item)}
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: '#e3f2fd',
                              color: '#1565c0',
                              border: '1px solid #bbdefb',
                              opacity: busy ? 0.6 : 1,
                            }}
                          >
                            Transfer
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/inventory/movements?item=${item.item_id}`)
                            }
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: '#f5f5f5',
                              color: '#424242',
                              border: '1px solid #e0e0e0',
                            }}
                          >
                            View Movements
                          </button>
                        </div>
                      </td>
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

function getStatusColors(status: StockStatus): { bg: string; text: string } {
  const map: Record<StockStatus, { bg: string; text: string }> = {
    'In Stock': { bg: '#e8f5e9', text: '#2e7d32' },
    'Low Stock': { bg: '#fff3e0', text: '#e65100' },
    'Out of Stock': { bg: '#ffebee', text: '#c62828' },
  }
  return map[status] || { bg: '#f5f5f5', text: '#616161' }
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1400px',
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

const alertRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  flexWrap: 'wrap',
  marginBottom: '20px',
}

const alertCardStyle: React.CSSProperties = {
  flex: '1 1 160px',
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderLeftWidth: '4px',
  borderRadius: '8px',
  padding: '16px 18px',
  boxShadow: 'var(--shadow)',
}

const alertLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--text)',
  marginBottom: '6px',
  fontWeight: 600,
}

const alertValueStyle: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  lineHeight: 1.1,
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
  whiteSpace: 'nowrap',
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

const directoryActionButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '11px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
  fontFamily: 'inherit',
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

const productDescStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--text)',
  marginTop: '2px',
}

const actionsWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  justifyContent: 'center',
}

export default InventoryOverview
