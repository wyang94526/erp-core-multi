/**
 * WarehousesBins — Warehouse and bin location master data
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { inventoryService } from '../api/services'

export function WarehousesBins() {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('all')

  const {
    data: warehouses = [],
    isLoading: loadingWh,
    isError: errorWh,
    error: whError,
  } = useQuery({
    queryKey: ['inventoryWarehouses'],
    queryFn: () => inventoryService.listWarehouses(),
  })

  const {
    data: bins = [],
    isLoading: loadingBins,
    isError: errorBins,
    error: binsError,
  } = useQuery({
    queryKey: ['inventoryBins'],
    queryFn: () => inventoryService.listBins(),
  })

  const filteredBins = useMemo(() => {
    if (selectedWarehouseId === 'all') return bins
    return bins.filter((b) => b.warehouse_id === selectedWarehouseId)
  }, [bins, selectedWarehouseId])

  if (loadingWh || loadingBins) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading warehouses &amp; bins...</p>
        </div>
      </div>
    )
  }

  if (errorWh || errorBins) {
    const err = whError || binsError
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
          <p>Error loading warehouse data:</p>
          <p>{err instanceof Error ? err.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Warehouses &amp; Bins</h2>
          <p style={pageSubStyle}>
            Warehouse sites and bin locations used for stock placement
          </p>
        </div>
      </header>

      <div style={dashboardSectionStyle}>
        <h3 style={sectionTitleStyle}>Warehouses</h3>
        {warehouses.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No warehouses configured.</div>
        ) : (
          <div style={{ overflowX: 'auto', marginBottom: '28px' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <th style={directoryThStyle}>Warehouse ID</th>
                  <th style={directoryThStyle}>Code</th>
                  <th style={directoryThStyle}>Name</th>
                  <th style={directoryThStyle}>Address</th>
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((wh) => (
                  <tr key={wh.warehouse_id} style={directoryTbodyRowStyle}>
                    <td style={directoryTdStyle}>{wh.warehouse_id}</td>
                    <td style={{ ...directoryTdStyle, fontWeight: 700, color: 'var(--text-h)' }}>
                      {wh.code}
                    </td>
                    <td style={directoryTdStyle}>{wh.name}</td>
                    <td style={directoryTdStyle}>{wh.address || '—'}</td>
                    <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                      <span
                        style={{
                          ...statusBadgeStyle,
                          backgroundColor: wh.is_active ? '#e8f5e9' : '#f5f5f5',
                          color: wh.is_active ? '#2e7d32' : '#616161',
                        }}
                      >
                        {wh.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={binHeaderRowStyle}>
          <h3 style={{ ...sectionTitleStyle, margin: 0 }}>Bin Locations</h3>
          <label style={filterLabelStyle}>
            Warehouse
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              style={selectStyle}
            >
              <option value="all">All warehouses</option>
              {warehouses.map((wh) => (
                <option key={wh.warehouse_id} value={wh.warehouse_id}>
                  {wh.code} — {wh.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {filteredBins.length === 0 ? (
          <div style={directoryEmptyTdWrapperStyle}>No bins found for this filter.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <th style={directoryThStyle}>Bin ID</th>
                  <th style={directoryThStyle}>Warehouse</th>
                  <th style={directoryThStyle}>Bin Code</th>
                  <th style={directoryThStyle}>Description</th>
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredBins.map((bin) => (
                  <tr key={bin.bin_id} style={directoryTbodyRowStyle}>
                    <td style={directoryTdStyle}>{bin.bin_id}</td>
                    <td style={directoryTdStyle}>{bin.warehouse_code}</td>
                    <td style={{ ...directoryTdStyle, fontWeight: 700, color: 'var(--text-h)' }}>
                      {bin.bin_code}
                    </td>
                    <td style={directoryTdStyle}>{bin.description || '—'}</td>
                    <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                      <span
                        style={{
                          ...statusBadgeStyle,
                          backgroundColor: bin.is_active ? '#e8f5e9' : '#f5f5f5',
                          color: bin.is_active ? '#2e7d32' : '#616161',
                        }}
                      >
                        {bin.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
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

const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: 'var(--shadow)',
}

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: '18px',
  fontWeight: 600,
  color: 'var(--text-h)',
}

const binHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
  marginBottom: '12px',
}

const filterLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  color: 'var(--text)',
  fontWeight: 600,
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '13px',
  fontFamily: 'inherit',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
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

export default WarehousesBins
