/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { inspectionService } from '../api/services'
import type { Inspection } from '../types'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'
import { formatPaginationLabel } from '../utils/pagination'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import { primaryButtonStyle, secondaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'

const FILTERS: FilterField[] = [
  {
    key: 'status',
    label: 'Status',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'pending', label: 'Pending' },
      { value: 'accepted', label: 'Accepted' },
      { value: 'rejected', label: 'Rejected' },
    ],
  },
  {
    key: 'source',
    label: 'Source',
    allValue: 'ALL',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'production_receipt', label: 'Production receipt' },
      { value: 'goods_receipt', label: 'Goods receipt' },
    ],
  },
]

export function sourceLabel(sourceType: string): string {
  if (sourceType === 'production_receipt') return 'Production receipt'
  if (sourceType === 'goods_receipt') return 'Goods receipt'
  return sourceType
}

export function inspectionStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function inspectionStatusColors(status: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    pending: { bg: '#fff8e1', text: '#f9a825' },
    accepted: { bg: '#e8f5e9', text: '#2e7d32' },
    rejected: { bg: '#ffebee', text: '#c62828' },
  }
  return colors[status] || { bg: '#f5f5f5', text: '#616161' }
}

export default function InspectionsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [opening, setOpening] = useState(false)
  const [skip, setSkip] = useState(0)
  const limit = 10
  const { values } = useListFilterParams(FILTERS)
  const [sourceType, setSourceType] = useState<'goods_receipt' | 'production_receipt'>('goods_receipt')
  const [sourceId, setSourceId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: documents = [], isLoading: documentsLoading, isError: documentsFailed } = useQuery({
    queryKey: ['inspection-documents', sourceType],
    queryFn: () => inspectionService.documents(sourceType),
    enabled: opening,
  })

  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['inspections', values.status, values.source, values.q],
    queryFn: () =>
      inspectionService.list({
        status: values.status !== 'ALL' ? values.status : undefined,
        source: values.source !== 'ALL' ? values.source : undefined,
        q: values.q || undefined,
      }),
  })

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (values.status !== 'ALL' && row.status !== values.status) return false
      if (values.source !== 'ALL' && row.source_type !== values.source) return false
      return matchesSearch(
        values.q,
        row.document_no || row.source_id,
        row.reference_document,
        row.inspector_name,
        sourceLabel(row.source_type),
        row.status,
      )
    })
  }, [rows, values.status, values.source, values.q])

  useEffect(() => {
    setSkip(0)
  }, [values.status, values.source, values.q])

  const pageRows = filtered.slice(skip, skip + limit)
  const { items: sorted, requestSort, sortConfig } = useSortableData(pageRows, {
    columnTypes: { created_at: 'date' },
  })

  const openInspection = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    setSaving(true)
    try {
      const created = await inspectionService.create({ source_type: sourceType, source_id: sourceId.trim() })
      await queryClient.invalidateQueries({ queryKey: ['inspections'] })
      navigate(`/inspections/${created.id}`)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not open inspection')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <p style={emptyStyle}>Loading inspections…</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStyle, color: '#c62828' }}>
          <p>Error loading inspections.</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <PageHeader
        title="Inspections"
        subtitle="Accepting a production receipt posts finished goods. Rejecting it leaves the quantity out of available stock. Goods-receipt inspections are tracking only."
      >
        <button type="button" onClick={() => setOpening((open) => !open)} style={opening ? secondaryButtonStyle : primaryButtonStyle}>
          {opening ? <X size={15} /> : <Plus size={15} />}
          {opening ? 'Cancel' : 'Open Inspection'}
        </button>
      </PageHeader>

      {opening ? (
        <form onSubmit={openInspection} style={cardStyle}>
          <h2 style={sectionHeadingStyle}>Open inspection</h2>
          {formError ? <p style={errorStyle}>{formError}</p> : null}
          {documentsFailed ? <p style={errorStyle}>Could not load documents.</p> : null}
          <div style={gridStyle}>
            <label style={fieldStyle}>
              Source
              <select
                aria-label="Source"
                style={inputStyle}
                value={sourceType}
                onChange={(e) => {
                  setSourceType(e.target.value as 'goods_receipt' | 'production_receipt')
                  setSourceId('')
                }}
              >
                <option value="goods_receipt">Goods receipt</option>
                <option value="production_receipt">Production receipt</option>
              </select>
            </label>
            <label style={fieldStyle}>
              Status
              <select aria-label="Inspection status" style={inputStyle} value="pending" disabled>
                <option value="pending">Pending</option>
              </select>
            </label>
            <label style={fieldStyle}>
              Document
              <select
                aria-label="Document"
                style={inputStyle}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                required
                disabled={documentsLoading || documents.length === 0}
              >
                <option value="">
                  {documentsLoading ? 'Loading documents…' : documents.length === 0 ? 'No documents' : 'Select a document'}
                </option>
                {documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" style={primaryButtonStyle} disabled={saving || !sourceId}>
              {saving ? 'Opening…' : 'Open'}
            </button>
          </div>
        </form>
      ) : null}

      <ListFilterBar
        fields={FILTERS}
        searchPlaceholder="Search document or status…"
        exportCount={filtered.length}
        onExport={() =>
          downloadCsv(
            csvFilename('inspections'),
            ['Document', 'Source', 'Reference', 'Status', 'Inspector', 'Date'],
            filtered.map((row) => [
              row.document_no || row.source_id,
              sourceLabel(row.source_type),
              row.reference_document || '',
              row.status,
              row.inspector_name || '',
              row.created_at || row.inspected_at || '',
            ]),
          )
        }
      />

      <div style={cardStyle}>
        {filtered.length === 0 ? (
          <div style={emptyStyle}>No inspections found.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadStyle}>
                    <SortableTh label="Document" columnKey="source_id" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Source" columnKey="source_type" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Reference" columnKey="reference_document" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Status" columnKey="status" sortConfig={sortConfig} onRequestSort={requestSort} align="center" />
                    <SortableTh label="Inspector" columnKey="inspector_name" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <SortableTh label="Date" columnKey="created_at" sortConfig={sortConfig} onRequestSort={requestSort} />
                    <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row: Inspection) => {
                    const colors = inspectionStatusColors(row.status)
                    return (
                      <tr key={row.id} style={rowStyle}>
                        <td style={tdStyle}>{row.document_no || row.source_id}</td>
                        <td style={tdStyle}>{sourceLabel(row.source_type)}</td>
                        <td style={tdStyle}>{row.reference_document || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span style={{ ...badgeStyle, backgroundColor: colors.bg, color: colors.text }}>
                            {inspectionStatusLabel(row.status)}
                          </span>
                        </td>
                        <td style={tdStyle}>{row.inspector_name || '—'}</td>
                        <td style={tdStyle}>{row.created_at ? new Date(row.created_at).toLocaleDateString() : '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <button type="button" style={viewButtonStyle} onClick={() => navigate(`/inspections/${row.id}`)}>
                            View
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={paginationStyle}>
              <button type="button" onClick={() => setSkip(Math.max(0, skip - limit))} disabled={skip === 0} style={pageButton(skip === 0)}>
                ← Previous
              </button>
              <span style={{ fontSize: 13, color: 'var(--text)' }}>
                {formatPaginationLabel({ skip, pageCount: pageRows.length, total: filtered.length })}
              </span>
              <button
                type="button"
                onClick={() => setSkip(skip + limit)}
                disabled={skip + limit >= filtered.length}
                style={pageButton(skip + limit >= filtered.length)}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const containerStyle: CSSProperties = { padding: 24, maxWidth: 1200, margin: '0 auto', textAlign: 'left' }
const cardStyle: CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
  boxShadow: 'var(--shadow)',
}
const sectionHeadingStyle: CSSProperties = { margin: '0 0 16px', fontSize: 18, fontWeight: 'bold', color: 'var(--text-h)' }
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }
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
  margin: '0 0 12px',
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: 6,
  padding: '12px 16px',
  fontSize: 14,
}
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const theadStyle: CSSProperties = { backgroundColor: 'var(--social-bg)' }
const thStyle: CSSProperties = { padding: '12px 10px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-h)' }
const rowStyle: CSSProperties = { borderBottom: '1px solid var(--divider)' }
const tdStyle: CSSProperties = { padding: '12px 10px', color: 'var(--text)', verticalAlign: 'middle' }
const badgeStyle: CSSProperties = { padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 'bold' }
const viewButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 'bold',
  backgroundColor: '#e3f2fd',
  color: '#1565c0',
  border: '1px solid #bbdefb',
  fontFamily: 'inherit',
}
const emptyStyle: CSSProperties = { padding: 30, textAlign: 'center', color: '#666', fontStyle: 'italic' }
const paginationStyle: CSSProperties = { marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }

function pageButton(disabled: boolean): CSSProperties {
  return { ...secondaryButtonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }
}
