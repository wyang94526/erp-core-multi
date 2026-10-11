/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { inventoryService, workCenterService } from '../api/services'
import type { Warehouse, WorkCenter } from '../types'
import {
  adminCardStyle,
  adminErrorStyle,
  adminPageStyle,
  adminTableStyle,
  adminTdStyle,
  adminThStyle,
  adminTheadStyle,
} from '../utils/adminPageStyles'
import { primaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'

function money(value: string | number | null | undefined): string {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return '0.00'
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const actionButtonStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'inherit',
}

const viewButtonStyle: CSSProperties = {
  ...actionButtonStyle,
  backgroundColor: '#e3f2fd',
  color: '#1565c0',
  border: '1px solid #bbdefb',
  marginRight: 6,
}

const editButtonStyle: CSSProperties = {
  ...actionButtonStyle,
  backgroundColor: '#fff3e0',
  color: '#e65100',
  border: '1px solid #ffe0b2',
}

const codeLinkStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  color: '#1565c0',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 'inherit',
}

export default function WorkCentersPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<WorkCenter[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    workCenterService.listWorkCenters(0, 500).then(setRows).catch((err: Error) => setError(err.message))
    inventoryService.listWarehouses(0, 200).then(setWarehouses).catch(() => setWarehouses([]))
  }, [])

  const warehouseName = (id: string | null | undefined) => {
    if (!id) return '—'
    const match = warehouses.find((row) => row.warehouse_id === id)
    return match ? `${match.code || match.warehouse_id} — ${match.name}` : id
  }

  const open = (id: string, edit = false) => {
    const path = `/work-centers/${encodeURIComponent(id)}`
    navigate(edit ? `${path}/edit` : path)
  }

  return (
    <div style={adminPageStyle}>
      <PageHeader
        title="Work Centers"
        subtitle="Workstations, production lines, and machines used by routing and the shop floor."
      >
        <button type="button" style={primaryButtonStyle} onClick={() => navigate('/work-centers/new')}>
          Add work center
        </button>
      </PageHeader>
      {error ? <p role="alert" style={adminErrorStyle}>{error}</p> : null}
      <div style={adminCardStyle}>
        <table style={adminTableStyle}>
          <thead>
            <tr style={adminTheadStyle}>
              <th style={adminThStyle}>Work center</th>
              <th style={adminThStyle}>Name</th>
              <th style={adminThStyle}>Warehouse</th>
              <th style={{ ...adminThStyle, textAlign: 'right' }}>Hourly rate</th>
              <th style={adminThStyle}>Status</th>
              <th style={{ ...adminThStyle, textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.work_center_id}>
                <td style={adminTdStyle}>
                  <button type="button" style={codeLinkStyle} onClick={() => open(row.work_center_id)}>
                    {row.work_center_id}
                  </button>
                </td>
                <td style={adminTdStyle}>{row.name}</td>
                <td style={adminTdStyle}>{warehouseName(row.warehouse_id)}</td>
                <td style={{ ...adminTdStyle, textAlign: 'right' }}>{money(row.hourly_rate)}</td>
                <td style={adminTdStyle}>{row.is_active === false ? 'Inactive' : 'Active'}</td>
                <td style={{ ...adminTdStyle, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button type="button" style={viewButtonStyle} onClick={() => open(row.work_center_id)}>
                    View
                  </button>
                  <button type="button" style={editButtonStyle} onClick={() => open(row.work_center_id, true)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !error ? <p style={{ margin: '12px 0 0', color: '#616161' }}>No work centers yet.</p> : null}
      </div>
    </div>
  )
}
