/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { companyService } from '../api/services'
import type { Company } from '../types'
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

function orderedCompanies(rows: Company[]): Company[] {
  const parents = rows.filter((row) => !row.parent_company_id).sort((a, b) => a.code.localeCompare(b.code))
  const children = rows.filter((row) => row.parent_company_id)
  const placed = new Set<string>()
  const ordered: Company[] = []
  for (const parent of parents) {
    ordered.push(parent)
    placed.add(parent.id)
    for (const child of children
      .filter((row) => row.parent_company_id === parent.id)
      .sort((a, b) => a.code.localeCompare(b.code))) {
      ordered.push(child)
      placed.add(child.id)
    }
  }
  for (const row of children) {
    if (!placed.has(row.id)) ordered.push(row)
  }
  return ordered
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

export default function CompaniesPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Company[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    companyService.list().then(setRows).catch((err: Error) => setError(err.message))
  }, [])

  const byId = new Map(rows.map((row) => [row.id, row]))
  const visible = orderedCompanies(rows)

  return (
    <div style={adminPageStyle}>
      <PageHeader
        title="Companies"
        subtitle="Set up the parent and its subsidiaries here. Document letterhead stays under Company Profile."
      >
        <button type="button" style={primaryButtonStyle} onClick={() => navigate('/admin/companies/new')}>
          Add company
        </button>
      </PageHeader>
      {error ? <p role="alert" style={adminErrorStyle}>{error}</p> : null}
      <div style={adminCardStyle}>
        <table style={adminTableStyle}>
          <thead>
            <tr style={adminTheadStyle}>
              <th style={adminThStyle}>Code</th>
              <th style={adminThStyle}>Name</th>
              <th style={adminThStyle}>Country</th>
              <th style={adminThStyle}>Parent</th>
              <th style={adminThStyle}>Base currency</th>
              <th style={{ ...adminThStyle, textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td style={adminTdStyle}>
                  <button type="button" style={codeLinkStyle} onClick={() => navigate(`/admin/companies/${row.id}`)}>
                    {row.parent_company_id ? `↳ ${row.code}` : row.code}
                  </button>
                </td>
                <td style={adminTdStyle}>{row.name}</td>
                <td style={adminTdStyle}>{row.country || '—'}</td>
                <td style={adminTdStyle}>
                  {row.parent_company_id ? byId.get(row.parent_company_id)?.code ?? '—' : '—'}
                </td>
                <td style={adminTdStyle}>{row.base_currency}</td>
                <td style={{ ...adminTdStyle, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    style={viewButtonStyle}
                    onClick={() => navigate(`/admin/companies/${row.id}`)}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    style={editButtonStyle}
                    onClick={() => navigate(`/admin/companies/${row.id}/edit`)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
