/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * PaymentTerms — global master list of Net / P02 / due-on-receipt terms.
 */

import { useEffect, useMemo, useState } from 'react'
import { paymentTermsService } from '../api/services'
import type { PaymentTerm } from '../types'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import { useSortableData } from '../hooks/useSortableData'
import { Plus } from 'lucide-react'
import { headerButtonStyle, primaryButtonStyle } from '../utils/documentPageStyles'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { PageHeader } from './PageHeader'

const TERM_FILTERS: FilterField[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
    ],
  },
]
import SortableTh from './SortableTh'

const EMPTY_FORM = {
  code: '',
  description: '',
  due_days: '30',
  discount_days: '',
  discount_percentage: '',
  is_active: true,
}

function PaymentTerms() {
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const loadTerms = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await paymentTermsService.list(true)
      setTerms([...data].sort((a, b) => a.code.localeCompare(b.code)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payment terms')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTerms()
  }, [])

  const { values } = useListFilterParams(TERM_FILTERS)
  const filteredTerms = useMemo(() => {
    return terms.filter((term) => {
      if (values.status === 'active' && !term.is_active) return false
      if (values.status === 'inactive' && term.is_active) return false
      return matchesSearch(values.q, term.code, term.description, term.due_days)
    })
  }, [terms, values.q, values.status])

  const { items: sortedTerms, requestSort, sortConfig } = useSortableData(filteredTerms, {
    columnTypes: {
      due_days: 'number',
      discount_days: 'number',
      discount_percentage: 'number',
      created_at: 'date',
    },
  })

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowForm(true)
  }

  const openEdit = (term: PaymentTerm) => {
    setEditingId(term.id)
    setForm({
      code: term.code,
      description: term.description,
      due_days: String(term.due_days ?? 0),
      discount_days: term.discount_days == null ? '' : String(term.discount_days),
      discount_percentage: term.discount_percentage == null ? '' : String(term.discount_percentage),
      is_active: term.is_active,
    })
    setFormError(null)
    setShowForm(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!form.code.trim() || !form.description.trim()) {
      setFormError('Code and description are required.')
      return
    }
    const dueDays = Number(form.due_days)
    if (!Number.isFinite(dueDays) || dueDays < 0) {
      setFormError('Due days must be zero or a positive number.')
      return
    }
    setSaving(true)
    const payload = {
      code: form.code.trim().toUpperCase(),
      description: form.description.trim(),
      due_days: dueDays,
      discount_days: form.discount_days === '' ? null : Number(form.discount_days),
      discount_percentage: form.discount_percentage === '' ? null : Number(form.discount_percentage),
      is_active: form.is_active,
    }
    try {
      if (editingId) {
        await paymentTermsService.update(editingId, payload)
      } else {
        await paymentTermsService.create(payload)
      }
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
      await loadTerms()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save payment term')
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (term: PaymentTerm) => {
    const nextActive = !term.is_active
    const action = nextActive ? 'activate' : 'deactivate'
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${term.code}?`)) {
      return
    }
    try {
      if (nextActive) {
        await paymentTermsService.update(term.id, { is_active: true })
      } else {
        await paymentTermsService.deactivate(term.id)
      }
      await loadTerms()
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${action} payment term`)
    }
  }

  return (
    <div style={containerStyle}>
      <PageHeader
        title="Payment Terms"
        subtitle="Master list used by vendors, customers, purchase orders, and AP/AR invoices"
      >
        <button
          type="button"
          style={showForm ? headerButtonStyle : primaryButtonStyle}
          onClick={() => {
            if (showForm) {
              setShowForm(false)
              setEditingId(null)
              setFormError(null)
            } else {
              openCreate()
            }
          }}
        >
          {showForm ? 'Cancel' : <><Plus size={15} /> Add Payment Term</>}
        </button>
      </PageHeader>

      <ListFilterBar
        fields={TERM_FILTERS}
        searchPlaceholder="Search code or description…"
        exportCount={filteredTerms.length}
        onExport={() =>
          downloadCsv(
            csvFilename('payment-terms'),
            ['Code', 'Description', 'Due Days', 'Discount Days', 'Discount %', 'Status'],
            filteredTerms.map((term) => [
              term.code,
              term.description,
              term.due_days,
              term.discount_days,
              term.discount_percentage,
              term.is_active ? 'Active' : 'Inactive',
            ]),
          )
        }
      />

      {showForm && (
        <form style={formCardStyle} onSubmit={handleSave}>
          <h3 style={formTitleStyle}>{editingId ? 'Edit Payment Term' : 'New Payment Term'}</h3>
          <div style={formGridStyle}>
            <label style={labelStyle}>
              Code
              <input
                style={inputStyle}
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="e.g. NET30"
              />
            </label>
            <label style={labelStyle}>
              Description
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Net 30 Days"
              />
            </label>
            <label style={labelStyle}>
              Due days
              <input
                style={inputStyle}
                type="number"
                min={0}
                value={form.due_days}
                onChange={(e) => setForm((f) => ({ ...f, due_days: e.target.value }))}
              />
            </label>
            <label style={labelStyle}>
              Discount days (optional)
              <input
                style={inputStyle}
                type="number"
                min={0}
                value={form.discount_days}
                onChange={(e) => setForm((f) => ({ ...f, discount_days: e.target.value }))}
              />
            </label>
            <label style={labelStyle}>
              Discount % (optional)
              <input
                style={inputStyle}
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={form.discount_percentage}
                onChange={(e) => setForm((f) => ({ ...f, discount_percentage: e.target.value }))}
              />
            </label>
            <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22 }}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              Active
            </label>
          </div>
          {formError && <p style={errorStyle}>{formError}</p>}
          <button type="submit" style={primaryButtonStyle} disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Term'}
          </button>
        </form>
      )}

      <div style={dashboardSectionStyle}>
        {loading ? (
          <div style={emptyStateWrapperStyle}>Loading payment terms…</div>
        ) : error ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>{error}</div>
        ) : sortedTerms.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No payment terms yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <SortableTh label="Code" columnKey="code" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Description" columnKey="description" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Due Days" columnKey="due_days" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Discount" columnKey="discount_percentage" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <SortableTh label="Status" columnKey="is_active" sortConfig={sortConfig} onRequestSort={requestSort} />
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedTerms.map((term) => (
                  <tr key={term.id} style={directoryTbodyRowStyle}>
                    <td style={{ ...directoryTdStyle, fontWeight: 700, fontFamily: 'monospace' }}>{term.code}</td>
                    <td style={directoryTdStyle}>{term.description}</td>
                    <td style={directoryTdStyle}>{term.due_days}</td>
                    <td style={directoryTdStyle}>
                      {term.discount_percentage == null || term.discount_percentage === ''
                        ? '—'
                        : `${term.discount_percentage}% / ${term.discount_days ?? '—'} days`}
                    </td>
                    <td style={directoryTdStyle}>
                      <span
                        style={{
                          ...statusBadgeStyle,
                          backgroundColor: term.is_active ? '#e8f5e9' : '#eceff1',
                          color: term.is_active ? '#2e7d32' : '#546e7a',
                        }}
                      >
                        {term.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                      <button type="button" style={ghostButtonStyle} onClick={() => openEdit(term)}>
                        Edit
                      </button>
                      <button type="button" style={ghostButtonStyle} onClick={() => handleDeactivate(term)}>
                        {term.is_active ? 'Deactivate' : 'Activate'}
                      </button>
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
const formCardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '20px 24px',
  marginBottom: '20px',
}
const formTitleStyle: React.CSSProperties = { margin: '0 0 16px 0', fontSize: '16px' }
const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '12px',
  marginBottom: '12px',
}
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }
const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontFamily: 'inherit',
}
const errorStyle: React.CSSProperties = { color: '#c62828', fontSize: 13 }
const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
}
const directoryTableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const directoryTheadRowStyle: React.CSSProperties = { backgroundColor: 'var(--social-bg)' }
const directoryThStyle: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--text)',
}
const directoryTbodyRowStyle: React.CSSProperties = { borderBottom: '1px solid var(--divider)' }
const directoryTdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13 }
const emptyStateWrapperStyle: React.CSSProperties = { padding: '30px', textAlign: 'center' }
const statusBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 'bold',
}
const ghostButtonStyle: React.CSSProperties = {
  margin: '0 4px',
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 'bold',
  fontFamily: 'inherit',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
}

export default PaymentTerms
