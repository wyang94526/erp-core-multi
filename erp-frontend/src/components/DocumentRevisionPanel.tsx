/**
 * @author: Wendy Yang
 * @date: 2026-09-27
 *
 * Frozen revision snapshots and field-level change logs for SO / PO / SCO.
 */

import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DocumentChangeLog, DocumentRevision } from '../types'

type DocumentKind = 'sales-orders' | 'purchase-orders' | 'subcontract-orders'

type DocumentRevisionPanelProps = {
  kind: DocumentKind
  documentId: string
  revisionNumber?: number | null
  listRevisions: (id: string) => Promise<DocumentRevision[]>
  listChangeLogs: (id: string) => Promise<DocumentChangeLog[]>
}

const KIND_LABEL: Record<DocumentKind, string> = {
  'sales-orders': 'sales order',
  'purchase-orders': 'purchase order',
  'subcontract-orders': 'subcontract order',
}

export function DocumentRevisionPanel({
  kind,
  documentId,
  revisionNumber = 0,
  listRevisions,
  listChangeLogs,
}: DocumentRevisionPanelProps) {
  const { data: revisions = [], isLoading: loadingRevisions } = useQuery({
    queryKey: [kind, documentId, 'revisions'],
    queryFn: () => listRevisions(documentId),
    enabled: Boolean(documentId),
  })
  const { data: changeLogs = [], isLoading: loadingLogs } = useQuery({
    queryKey: [kind, documentId, 'change-logs'],
    queryFn: () => listChangeLogs(documentId),
    enabled: Boolean(documentId),
  })

  const currentRev = Number(revisionNumber || 0)
  if (currentRev <= 0 && revisions.length === 0 && changeLogs.length === 0) {
    return null
  }

  return (
    <section style={panelStyle} aria-label="Revision history">
      <div style={headerRowStyle}>
        <h3 style={titleStyle}>Revision history</h3>
        {currentRev > 0 ? <span style={badgeStyle}>Rev {currentRev}</span> : null}
      </div>
      <p style={hintStyle}>
        The {KIND_LABEL[kind]} number stays the same. Each Create Revision freezes the last
        approved snapshot, then field changes are logged when it is approved again.
      </p>
      {loadingRevisions || loadingLogs ? (
        <p style={hintStyle}>Loading revision history…</p>
      ) : null}
      {revisions.length > 0 ? (
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Rev</th>
                <th style={thStyle}>Frozen at</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>{row.revision_number}</td>
                  <td style={tdStyle}>{formatWhen(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {changeLogs.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Rev</th>
                <th style={thStyle}>Field</th>
                <th style={thStyle}>Before</th>
                <th style={thStyle}>After</th>
                <th style={thStyle}>When</th>
              </tr>
            </thead>
            <tbody>
              {changeLogs.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>{row.revision_number}</td>
                  <td style={tdStyle}>{row.field_name}</td>
                  <td style={tdStyle}>{row.old_value || '—'}</td>
                  <td style={tdStyle}>{row.new_value || '—'}</td>
                  <td style={tdStyle}>{formatWhen(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : currentRev > 0 ? (
        <p style={hintStyle}>No field-level changes have been logged yet.</p>
      ) : null}
    </section>
  )
}

function formatWhen(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

const panelStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
}

const headerRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  color: 'var(--text-h)',
}

const badgeStyle: CSSProperties = {
  background: '#efebe9',
  color: '#4e342e',
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 700,
  padding: '4px 10px',
}

const hintStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 13,
  color: 'var(--text)',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #eee',
  padding: '8px 6px',
  color: 'var(--text-h)',
}

const tdStyle: CSSProperties = {
  borderBottom: '1px solid #f5f5f5',
  padding: '8px 6px',
  verticalAlign: 'top',
}
