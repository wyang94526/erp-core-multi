/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { inventoryService, workCenterService } from '../api/services'
import type { Warehouse, WorkCenter } from '../types'
import {
  adminCardStyle,
  adminErrorStyle,
  adminFieldStyle,
  adminFormRow,
  adminInputStyle,
  adminPageStyle,
} from '../utils/adminPageStyles'
import { headerButtonStyle, primaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'

const emptyForm = {
  work_center_id: '',
  name: '',
  warehouse_id: '',
  hourly_rate: '0',
  is_active: true,
}

function money(value: string | number | null | undefined): string {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return '0.00'
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const valueStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 400,
  color: 'var(--text-h, #212121)',
}

export default function WorkCenterDetail() {
  const { workCenterId } = useParams<{ workCenterId: string }>()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const decodedId = workCenterId ? decodeURIComponent(workCenterId) : ''
  const isNew = !workCenterId
  const isEdit = !isNew && pathname.endsWith('/edit')
  const [rows, setRows] = useState<WorkCenter[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    inventoryService.listWarehouses(0, 200).then(setWarehouses).catch(() => setWarehouses([]))
    if (isNew) return
    workCenterService
      .listWorkCenters(0, 500)
      .then((loaded) => {
        setRows(loaded)
        const row = loaded.find((item) => item.work_center_id === decodedId)
        if (!row) {
          setError('Work center not found')
          return
        }
        setForm({
          work_center_id: row.work_center_id,
          name: row.name,
          warehouse_id: row.warehouse_id || '',
          hourly_rate: String(row.hourly_rate ?? 0),
          is_active: row.is_active !== false,
        })
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [decodedId, isNew])

  const center = rows.find((row) => row.work_center_id === decodedId)
  const warehouseLabel = (id: string | null | undefined) => {
    if (!id) return 'None'
    const match = warehouses.find((row) => row.warehouse_id === id)
    return match ? `${match.code || match.warehouse_id} — ${match.name}` : id
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const rate = Number(form.hourly_rate)
    if (!Number.isFinite(rate) || rate < 0) {
      setError('Hourly rate must be zero or a positive amount.')
      return
    }
    setSaving(true)
    setError(null)
    const body = {
      name: form.name.trim(),
      warehouse_id: form.warehouse_id || null,
      hourly_rate: rate,
      is_active: form.is_active,
    }
    try {
      if (isNew) {
        const created = await workCenterService.create({ work_center_id: form.work_center_id.trim(), ...body })
        navigate(`/work-centers/${encodeURIComponent(created.work_center_id)}`)
      } else {
        await workCenterService.update(decodedId, body)
        navigate(`/work-centers/${encodeURIComponent(decodedId)}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the work center')
    } finally {
      setSaving(false)
    }
  }

  const title = isNew ? 'New work center' : isEdit ? 'Edit work center' : center?.name || 'Work center'
  const subtitle = isNew
    ? 'Add a workstation, production line, or machine used by routing and the shop floor.'
    : isEdit
      ? `${form.work_center_id} · The work center ID stays the same.`
      : form.work_center_id || undefined

  return (
    <div style={adminPageStyle}>
      <PageHeader title={title} subtitle={subtitle}>
        {!isNew && !isEdit && center ? (
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => navigate(`/work-centers/${encodeURIComponent(center.work_center_id)}/edit`)}
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          style={headerButtonStyle}
          onClick={() =>
            navigate(isEdit && decodedId ? `/work-centers/${encodeURIComponent(decodedId)}` : '/work-centers')
          }
        >
          {isEdit ? 'Cancel' : 'Back to Work Centers'}
        </button>
      </PageHeader>
      {error ? <p role="alert" style={adminErrorStyle}>{error}</p> : null}
      {loading ? <p style={{ color: '#616161' }}>Loading work center…</p> : null}
      {!loading && (isNew || isEdit) && (isNew || center) ? (
        <form onSubmit={(event) => void onSubmit(event)} style={{ ...adminCardStyle, ...adminFormRow }}>
          <label style={adminFieldStyle}>
            Work center ID
            <input
              aria-label="Work center ID"
              style={adminInputStyle}
              value={form.work_center_id}
              onChange={(e) => setForm({ ...form, work_center_id: e.target.value })}
              required
              disabled={!isNew}
            />
          </label>
          <label style={{ ...adminFieldStyle, flex: '1 1 240px' }}>
            Name
            <input
              aria-label="Work center name"
              style={{ ...adminInputStyle, minWidth: 220 }}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label style={adminFieldStyle}>
            Warehouse
            <select
              aria-label="Work center warehouse"
              style={adminInputStyle}
              value={form.warehouse_id}
              onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
            >
              <option value="">None</option>
              {warehouses.map((row) => (
                <option key={row.warehouse_id} value={row.warehouse_id}>
                  {row.code || row.warehouse_id} — {row.name}
                </option>
              ))}
            </select>
          </label>
          <label style={adminFieldStyle}>
            Hourly rate
            <input
              aria-label="Hourly rate"
              style={{ ...adminInputStyle, width: 120 }}
              type="number"
              min={0}
              step="0.01"
              value={form.hourly_rate}
              onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })}
              required
            />
          </label>
          <label style={{ ...adminFieldStyle, flexDirection: 'row', alignItems: 'center', paddingTop: 22 }}>
            <input
              aria-label="Work center active"
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            Active
          </label>
          <button type="submit" style={{ ...primaryButtonStyle, alignSelf: 'end' }} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Add work center' : 'Save work center'}
          </button>
        </form>
      ) : null}
      {!loading && !isNew && !isEdit && center ? (
        <div style={adminCardStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            <div style={adminFieldStyle}>
              Work center ID
              <span style={valueStyle}>{center.work_center_id}</span>
            </div>
            <div style={adminFieldStyle}>
              Name
              <span style={valueStyle}>{center.name}</span>
            </div>
            <div style={adminFieldStyle}>
              Warehouse
              <span style={valueStyle}>{warehouseLabel(center.warehouse_id)}</span>
            </div>
            <div style={adminFieldStyle}>
              Hourly rate
              <span style={valueStyle}>{money(center.hourly_rate)}</span>
            </div>
            <div style={adminFieldStyle}>
              Status
              <span style={valueStyle}>{center.is_active === false ? 'Inactive' : 'Active'}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
