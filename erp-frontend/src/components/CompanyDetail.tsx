/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { companyService } from '../api/services'
import type { Company } from '../types'
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
  code: '',
  name: '',
  country: '',
  baseCurrency: 'USD',
  parentId: '',
}

const valueStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 400,
  color: 'var(--text-h, #212121)',
}

export default function CompanyDetail() {
  const { companyId } = useParams<{ companyId: string }>()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isNew = !companyId
  const isEdit = !isNew && pathname.endsWith('/edit')
  const [rows, setRows] = useState<Company[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    companyService
      .list()
      .then((loaded) => {
        setRows(loaded)
        if (!companyId) return
        const row = loaded.find((item) => item.id === companyId)
        if (!row) {
          setError('Company not found')
          return
        }
        setForm({
          code: row.code,
          name: row.name,
          country: row.country ?? '',
          baseCurrency: row.base_currency,
          parentId: row.parent_company_id ?? '',
        })
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [companyId])

  const company = rows.find((row) => row.id === companyId)
  const parent = rows.find((row) => row.id === form.parentId)
  const parentChoices = rows.filter((row) => row.id !== companyId)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSaving(true)
    const body = {
      name: form.name.trim(),
      country: form.country.trim() || null,
      base_currency: form.baseCurrency.trim().toUpperCase(),
      parent_company_id: form.parentId || null,
    }
    try {
      if (isNew) {
        const created = await companyService.create({ code: form.code.trim(), ...body })
        navigate(`/admin/companies/${created.id}`)
      } else if (companyId) {
        await companyService.update(companyId, body)
        navigate(`/admin/companies/${companyId}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save company')
    } finally {
      setSaving(false)
    }
  }

  const title = isNew ? 'New company' : isEdit ? 'Edit company' : company?.name || 'Company'
  const subtitle = isNew
    ? 'Add a parent company or a subsidiary. Letterhead for each company stays under Company Profile.'
    : isEdit
      ? `${form.code} · Changes apply to this company only.`
      : form.code
        ? `${form.code}${parent ? ` · subsidiary of ${parent.code}` : ''}`
        : undefined

  return (
    <div style={adminPageStyle}>
      <PageHeader title={title} subtitle={subtitle}>
        {!isNew && !isEdit && company ? (
          <button type="button" style={primaryButtonStyle} onClick={() => navigate(`/admin/companies/${company.id}/edit`)}>
            Edit
          </button>
        ) : null}
        <button
          type="button"
          style={headerButtonStyle}
          onClick={() => navigate(isEdit && companyId ? `/admin/companies/${companyId}` : '/admin/companies')}
        >
          {isEdit ? 'Cancel' : 'Back to Companies'}
        </button>
      </PageHeader>
      {error ? <p role="alert" style={adminErrorStyle}>{error}</p> : null}
      {loading ? <p style={{ color: '#616161' }}>Loading company…</p> : null}
      {!loading && (isNew || isEdit) && (isNew || company) ? (
        <form onSubmit={(event) => void onSubmit(event)} style={{ ...adminCardStyle, ...adminFormRow }}>
          <label style={adminFieldStyle}>
            Code
            <input
              aria-label="Company code"
              style={adminInputStyle}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
              disabled={!isNew}
            />
          </label>
          <label style={{ ...adminFieldStyle, flex: '1 1 280px' }}>
            Name
            <input
              aria-label="Company name"
              style={{ ...adminInputStyle, minWidth: 260 }}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label style={adminFieldStyle}>
            Country
            <input
              aria-label="Country"
              style={adminInputStyle}
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            />
          </label>
          <label style={adminFieldStyle}>
            Base currency
            <input
              aria-label="Base currency"
              style={{ ...adminInputStyle, width: 90 }}
              value={form.baseCurrency}
              onChange={(e) => setForm({ ...form, baseCurrency: e.target.value })}
              maxLength={3}
              required
            />
          </label>
          <label style={adminFieldStyle}>
            Parent company
            <select
              aria-label="Parent company"
              style={adminInputStyle}
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            >
              <option value="">Top-level company</option>
              {parentChoices.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} — {row.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" style={{ ...primaryButtonStyle, alignSelf: 'end' }} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Add company' : 'Save company'}
          </button>
        </form>
      ) : null}
      {!loading && !isNew && !isEdit && company ? (
        <div style={adminCardStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            <div style={adminFieldStyle}>
              Code
              <span style={valueStyle}>{company.code}</span>
            </div>
            <div style={adminFieldStyle}>
              Name
              <span style={valueStyle}>{company.name}</span>
            </div>
            <div style={adminFieldStyle}>
              Country
              <span style={valueStyle}>{company.country || '—'}</span>
            </div>
            <div style={adminFieldStyle}>
              Parent company
              <span style={valueStyle}>{parent ? `${parent.code} — ${parent.name}` : 'Top-level company'}</span>
            </div>
            <div style={adminFieldStyle}>
              Base currency
              <span style={valueStyle}>{company.base_currency}</span>
            </div>
            <div style={adminFieldStyle}>
              Status
              <span style={valueStyle}>{company.is_active ? 'Active' : 'Inactive'}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
