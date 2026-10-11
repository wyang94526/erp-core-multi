/**
 * @author: Wendy Yang
 * @date: 2026-10-11
 */

import { useEffect, useState, type FormEvent } from 'react'
import { documentPrefixService, type DocumentPrefix } from '../api/services'
import {
  adminCardStyle,
  adminErrorStyle,
  adminInputStyle,
  adminPageStyle,
  adminSuccessStyle,
  adminTableStyle,
  adminTdStyle,
  adminThStyle,
  adminTheadStyle,
} from '../utils/adminPageStyles'
import { primaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'

export default function DocumentPrefixesPage() {
  const [rows, setRows] = useState<DocumentPrefix[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = () => {
    documentPrefixService
      .list()
      .then((loaded) => {
        setRows(loaded)
        setDrafts(Object.fromEntries(loaded.map((row) => [row.doc_type, row.prefix])))
      })
      .catch((err: Error) => setError(err.message))
  }

  useEffect(() => {
    load()
  }, [])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSaved(null)
    setSaving(true)
    try {
      const savedRows = await documentPrefixService.save(
        rows.map((row) => ({ doc_type: row.doc_type, prefix: drafts[row.doc_type] ?? row.prefix })),
      )
      setRows(savedRows)
      setDrafts(Object.fromEntries(savedRows.map((row) => [row.doc_type, row.prefix])))
      setSaved('Prefixes saved. New documents use them. Numbers already issued stay the same.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save prefixes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={adminPageStyle}>
      <PageHeader
        title="Document numbers"
        subtitle="Each company chooses the prefix. The number is still prefix, year, month, and a four-digit sequence."
      />
      {error ? <p style={adminErrorStyle}>{error}</p> : null}
      {saved ? <p style={adminSuccessStyle}>{saved}</p> : null}
      <form onSubmit={(event) => void onSubmit(event)} style={adminCardStyle}>
        <table style={{ ...adminTableStyle, tableLayout: 'fixed' }}>
          <thead>
            <tr style={adminTheadStyle}>
              <th style={adminThStyle}>Document</th>
              <th style={{ ...adminThStyle, width: 200 }}>Prefix</th>
              <th style={{ ...adminThStyle, width: 220 }}>Next number</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.doc_type}>
                <td style={adminTdStyle}>{row.label}</td>
                <td style={adminTdStyle}>
                  <input
                    aria-label={`${row.label} prefix`}
                    style={{ ...adminInputStyle, width: 140 }}
                    value={drafts[row.doc_type] ?? ''}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [row.doc_type]: event.target.value.toUpperCase() }))
                    }
                    required
                  />
                </td>
                <td style={adminTdStyle}>{row.next_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="submit" style={{ ...primaryButtonStyle, marginTop: 16 }} disabled={saving || rows.length === 0}>
          {saving ? 'Saving…' : 'Save prefixes'}
        </button>
      </form>
    </div>
  )
}
