/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * WarehousesBins — Warehouse and bin location master data
 */

import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Warehouse } from 'lucide-react'
import { inventoryService } from '../api/services'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import {
  HoverTip,
  actionRowStyle,
  documentPageHeaderStyle,
  documentPageSubStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../utils/documentPageStyles'

const WH_FILTERS: FilterField[] = []

function slugToken(value: string, max = 20) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
}

function nextId(prefix: string, token: string) {
  const slug = slugToken(token) || Date.now().toString(36).toUpperCase()
  const suffix = Math.floor(100 + Math.random() * 900)
  return `${prefix}-${slug}-${suffix}`.slice(0, 50)
}

export function WarehousesBins() {
  const queryClient = useQueryClient()
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('all')
  const [warehouseOpen, setWarehouseOpen] = useState(false)
  const [binOpen, setBinOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [warehouseForm, setWarehouseForm] = useState({ code: '', name: '', address: '' })
  const [binForm, setBinForm] = useState({ warehouse_id: '', bin_code: '', description: '' })

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

  const { values } = useListFilterParams(WH_FILTERS)
  const filteredWarehouses = useMemo(
    () =>
      warehouses.filter((wh) =>
        matchesSearch(values.q, wh.warehouse_id, wh.code, wh.name, wh.address),
      ),
    [warehouses, values.q],
  )
  const filteredBins = useMemo(() => {
    return bins.filter((b) => {
      if (selectedWarehouseId !== 'all' && b.warehouse_id !== selectedWarehouseId) return false
      const warehouse = warehouses.find((wh) => wh.warehouse_id === b.warehouse_id)
      return matchesSearch(
        values.q,
        b.bin_id,
        b.bin_code,
        b.description,
        warehouse?.code,
        warehouse?.name,
      )
    })
  }, [bins, selectedWarehouseId, warehouses, values.q])

  const openWarehouseDialog = () => {
    setFormError(null)
    setWarehouseForm({ code: '', name: '', address: '' })
    setWarehouseOpen(true)
  }

  const openBinDialog = () => {
    setFormError(null)
    setBinForm({
      warehouse_id: selectedWarehouseId !== 'all' ? selectedWarehouseId : warehouses[0]?.warehouse_id || '',
      bin_code: '',
      description: '',
    })
    setBinOpen(true)
  }

  const handleCreateWarehouse = async (event: FormEvent) => {
    event.preventDefault()
    const code = slugToken(warehouseForm.code)
    const name = warehouseForm.name.trim()
    if (!code || !name) {
      setFormError('Code and name are required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await inventoryService.createWarehouse({
        warehouse_id: nextId('WH', code),
        code,
        name,
        address: warehouseForm.address.trim() || null,
        is_active: true,
      })
      setWarehouseOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['inventoryWarehouses'] })
      await queryClient.invalidateQueries({ queryKey: ['inventoryBins'] })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add warehouse')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateBin = async (event: FormEvent) => {
    event.preventDefault()
    const warehouseId = binForm.warehouse_id
    const binCode = slugToken(binForm.bin_code, 50)
    if (!warehouseId || !binCode) {
      setFormError('Warehouse and bin code are required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await inventoryService.createBin({
        bin_id: nextId('BIN', binCode),
        warehouse_id: warehouseId,
        bin_code: binCode,
        description: binForm.description.trim() || null,
        is_active: true,
      })
      setBinOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['inventoryBins'] })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add bin')
    } finally {
      setSaving(false)
    }
  }

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
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>Warehouses &amp; Bins</h1>
          <p style={documentPageSubStyle}>
            Warehouse sites and bin locations used for stock placement
          </p>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            <HoverTip label="Add a warehouse site">
              <button type="button" style={primaryButtonStyle} onClick={openWarehouseDialog}>
                <Warehouse size={15} />
                Add warehouse
              </button>
            </HoverTip>
            <HoverTip
              label={
                warehouses.length === 0
                  ? 'Add a warehouse first before creating bins'
                  : 'Add a bin location inside a warehouse'
              }
            >
              <button
                type="button"
                style={{
                  ...secondaryButtonStyle,
                  opacity: warehouses.length === 0 ? 0.55 : 1,
                  cursor: warehouses.length === 0 ? 'not-allowed' : 'pointer',
                }}
                onClick={openBinDialog}
                disabled={warehouses.length === 0}
              >
                <Plus size={15} />
                Add bin
              </button>
            </HoverTip>
          </div>
        </div>
      </header>

      <ListFilterBar
        fields={WH_FILTERS}
        searchPlaceholder="Search warehouse, bin, address…"
        exportCount={filteredWarehouses.length + filteredBins.length}
        onExport={() =>
          downloadCsv(
            csvFilename('warehouses-bins'),
            ['Type', 'ID', 'Code', 'Name / Description', 'Warehouse', 'Address', 'Status'],
            [
              ...filteredWarehouses.map((wh) => [
                'Warehouse',
                wh.warehouse_id,
                wh.code,
                wh.name,
                '',
                wh.address,
                wh.is_active ? 'Active' : 'Inactive',
              ]),
              ...filteredBins.map((bin) => [
                'Bin',
                bin.bin_id,
                bin.bin_code,
                bin.description,
                warehouses.find((wh) => wh.warehouse_id === bin.warehouse_id)?.code || bin.warehouse_id,
                '',
                bin.is_active ? 'Active' : 'Inactive',
              ]),
            ],
          )
        }
      />

      <div style={dashboardSectionStyle}>
        <h3 style={sectionTitleStyle}>Warehouses</h3>
        {filteredWarehouses.length === 0 ? (
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
                {filteredWarehouses.map((wh) => (
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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
          <button type="button" style={secondaryButtonStyle} onClick={openBinDialog} disabled={warehouses.length === 0}>
            Add bin
          </button>
          </div>
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

      {warehouseOpen ? (
        <div style={overlayStyle} onClick={() => setWarehouseOpen(false)}>
          <form style={dialogStyle} onClick={(event) => event.stopPropagation()} onSubmit={(event) => void handleCreateWarehouse(event)}>
            <h3 style={dialogTitleStyle}>Add warehouse</h3>
            <p style={dialogSubStyle}>Creates the site plus a default RECEIVING bin for purchase receipts.</p>
            <label style={labelStyle}>
              Code
              <input
                style={inputStyle}
                value={warehouseForm.code}
                onChange={(event) => setWarehouseForm((prev) => ({ ...prev, code: event.target.value }))}
                placeholder="MDC"
                maxLength={20}
                required
              />
            </label>
            <label style={labelStyle}>
              Name
              <input
                style={inputStyle}
                value={warehouseForm.name}
                onChange={(event) => setWarehouseForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Main Distribution Center"
                required
              />
            </label>
            <label style={labelStyle}>
              Address
              <input
                style={inputStyle}
                value={warehouseForm.address}
                onChange={(event) => setWarehouseForm((prev) => ({ ...prev, address: event.target.value }))}
                placeholder="Optional"
              />
            </label>
            {formError ? <div style={errorStyle} role="alert">{formError}</div> : null}
            <div style={actionsStyle}>
              <button type="button" style={secondaryButtonStyle} onClick={() => setWarehouseOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button type="submit" style={primaryButtonStyle} disabled={saving}>
                {saving ? 'Saving…' : 'Save warehouse'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {binOpen ? (
        <div style={overlayStyle} onClick={() => setBinOpen(false)}>
          <form style={dialogStyle} onClick={(event) => event.stopPropagation()} onSubmit={(event) => void handleCreateBin(event)}>
            <h3 style={dialogTitleStyle}>Add bin</h3>
            <p style={dialogSubStyle}>Bins are storage locations inside a warehouse (aisle, rack, or receiving dock).</p>
            <label style={labelStyle}>
              Warehouse
              <select
                style={inputStyle}
                value={binForm.warehouse_id}
                onChange={(event) => setBinForm((prev) => ({ ...prev, warehouse_id: event.target.value }))}
                required
              >
                <option value="">Select warehouse</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.warehouse_id} value={warehouse.warehouse_id}>
                    {warehouse.code} — {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Bin code
              <input
                style={inputStyle}
                value={binForm.bin_code}
                onChange={(event) => setBinForm((prev) => ({ ...prev, bin_code: event.target.value }))}
                placeholder="A-01-01"
                required
              />
            </label>
            <label style={labelStyle}>
              Description
              <input
                style={inputStyle}
                value={binForm.description}
                onChange={(event) => setBinForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Finished goods aisle A"
              />
            </label>
            {formError ? <div style={errorStyle} role="alert">{formError}</div> : null}
            <div style={actionsStyle}>
              <button type="button" style={secondaryButtonStyle} onClick={() => setBinOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button type="submit" style={primaryButtonStyle} disabled={saving}>
                {saving ? 'Saving…' : 'Save bin'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
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

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const dialogStyle: CSSProperties = {
  width: 'min(460px, 100%)',
  background: '#fff',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
}

const dialogTitleStyle: CSSProperties = { margin: 0, fontSize: 18, color: '#212121' }
const dialogSubStyle: CSSProperties = { margin: '8px 0 0', fontSize: 13, color: '#616161' }
const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 16,
  fontSize: 12,
  fontWeight: 700,
  color: '#757575',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
}
const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #ddd',
  fontSize: 14,
  fontWeight: 600,
  color: '#212121',
  fontFamily: 'inherit',
}
const actionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }
const errorStyle: CSSProperties = {
  marginTop: 12,
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ef9a9a',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
}

export default WarehousesBins
