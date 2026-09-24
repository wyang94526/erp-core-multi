/**
 * @author: Wendy Yang
 * @date: 2026-09-24
 *
 * Bank Transfers — internal movements between company bank accounts.
 */

import { type CSSProperties, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { bankTransferService } from '../api/services'
import { useSortableData } from '../hooks/useSortableData'
import SortableTh from './SortableTh'
import {
  approvalBadgeColors,
  bankTransferPath,
  isBankTransferDeletable,
  isBankTransferEditable,
} from '../utils/bankTransfers'

function formatCurrency(amount: number) {
  return Number(amount || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  return value.slice(0, 10)
}

function BankTransferList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: transfers = [], isLoading, isError, error } = useQuery({
    queryKey: ['bankTransfers'],
    queryFn: () => bankTransferService.list(),
  })

  const handleDelete = async (row: (typeof transfers)[number]) => {
    if (!isBankTransferDeletable(row)) return
    const label = row.reference_number || `BTR-${String(row.id).padStart(6, '0')}`
    if (!window.confirm(`Delete draft bank transfer ${label}? This cannot be undone.`)) {
      return
    }
    setDeletingId(row.id)
    try {
      await bankTransferService.remove(row.id)
      await queryClient.invalidateQueries({ queryKey: ['bankTransfers'] })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete bank transfer')
    } finally {
      setDeletingId(null)
    }
  }

  const { items: sortedTransfers, requestSort, sortConfig } = useSortableData(transfers, {
    columnTypes: {
      amount: 'number',
      transfer_date: 'date',
    },
  })

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Bank Transfers</h2>
          <p style={pageSubStyle}>
            Move funds between company bank accounts. Submit a draft for approval; the generated
            journal stays Draft until the G/L entry is approved.
          </p>
        </div>
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={() => navigate('/bank-transfers/new')}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
        >
          + New Bank Transfer
        </button>
      </header>

      <div style={dashboardSectionStyle}>
        {isLoading ? (
          <div style={emptyStateWrapperStyle}>Loading bank transfers…</div>
        ) : isError ? (
          <div style={{ ...emptyStateWrapperStyle, color: '#c62828' }}>
            {error instanceof Error ? error.message : 'Failed to load bank transfers'}
          </div>
        ) : sortedTransfers.length === 0 ? (
          <div style={emptyStateWrapperStyle}>No bank transfers yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <SortableTh
                    label="Date"
                    columnKey="transfer_date"
                    sortConfig={sortConfig}
                    onRequestSort={requestSort}
                  />
                  <SortableTh
                    label="Reference"
                    columnKey="reference_number"
                    sortConfig={sortConfig}
                    onRequestSort={requestSort}
                  />
                  <SortableTh
                    label="From"
                    columnKey="from_account_name"
                    sortConfig={sortConfig}
                    onRequestSort={requestSort}
                  />
                  <SortableTh
                    label="To"
                    columnKey="to_account_name"
                    sortConfig={sortConfig}
                    onRequestSort={requestSort}
                  />
                  <SortableTh
                    label="Amount"
                    columnKey="amount"
                    sortConfig={sortConfig}
                    onRequestSort={requestSort}
                  />
                  <SortableTh
                    label="G/L Status"
                    columnKey="status"
                    sortConfig={sortConfig}
                    onRequestSort={requestSort}
                  />
                  <SortableTh
                    label="Approval"
                    columnKey="approval_status"
                    sortConfig={sortConfig}
                    onRequestSort={requestSort}
                  />
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedTransfers.map((row) => {
                  const glPosted = (row.status || '').toUpperCase() === 'POSTED'
                  const canEdit = isBankTransferEditable(row)
                  const canDelete = isBankTransferDeletable(row)
                  return (
                    <tr key={row.id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>{formatDate(row.transfer_date)}</td>
                      <td style={{ ...directoryTdStyle, fontFamily: 'monospace' }}>
                        <button
                          type="button"
                          style={idButtonStyle}
                          onClick={() => navigate(bankTransferPath(row.id))}
                        >
                          {row.reference_number || `BTR-${String(row.id).padStart(6, '0')}`}
                        </button>
                      </td>
                      <td style={directoryTdStyle}>{row.from_account_name || row.from_account_id}</td>
                      <td style={directoryTdStyle}>{row.to_account_name || row.to_account_id}</td>
                      <td style={{ ...directoryTdStyle, fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(row.amount)}
                      </td>
                      <td style={directoryTdStyle}>
                        <span
                          style={{
                            ...statusBadgeStyle,
                            backgroundColor: glPosted ? '#e8f5e9' : '#fff8e1',
                            color: glPosted ? '#2e7d32' : '#f57f17',
                          }}
                        >
                          {row.status || 'DRAFT'}
                        </span>
                      </td>
                      <td style={directoryTdStyle}>
                        <span style={{ ...statusBadgeStyle, ...approvalBadgeColors(row.approval_status) }}>
                          {row.approval_status || 'DRAFT'}
                        </span>
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <button
                          type="button"
                          style={{
                            ...directoryActionButtonStyle,
                            backgroundColor: '#e3f2fd',
                            color: '#1565c0',
                            border: '1px solid #bbdefb',
                            marginRight: 6,
                          }}
                          onClick={() => navigate(bankTransferPath(row.id))}
                        >
                          View
                        </button>
                        {canEdit ? (
                          <button
                            type="button"
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: '#fff3e0',
                              color: '#e65100',
                              border: '1px solid #ffe0b2',
                              marginRight: canDelete ? 6 : 0,
                            }}
                            onClick={() => navigate(bankTransferPath(row.id, '/edit'))}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            style={{
                              ...directoryActionButtonStyle,
                              backgroundColor: '#ffebee',
                              color: '#c62828',
                              border: '1px solid #ffcdd2',
                            }}
                            disabled={deletingId === row.id}
                            title="Delete this draft bank transfer"
                            onClick={() => void handleDelete(row)}
                          >
                            {deletingId === row.id ? 'Deleting…' : 'Delete'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const containerStyle: CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
}
const pageHeaderStyle: CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
}
const pageTitleStyle: CSSProperties = { margin: 0, fontSize: '28px', fontWeight: 'bold', color: 'var(--text-h)' }
const pageSubStyle: CSSProperties = { margin: '4px 0 0 0', fontSize: '14px', color: 'var(--text)' }
const primaryButtonStyle: CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
  transition: 'background-color 0.2s',
}
const dashboardSectionStyle: CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
}
const directoryTableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const directoryTheadRowStyle: CSSProperties = { backgroundColor: 'var(--social-bg)' }
const directoryThStyle: CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--text)',
}
const directoryTbodyRowStyle: CSSProperties = { borderTop: '1px solid var(--border)' }
const directoryTdStyle: CSSProperties = { padding: '10px 12px', fontSize: 13 }
const emptyStateWrapperStyle: CSSProperties = { padding: '30px', textAlign: 'center' }
const statusBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 'bold',
}
const directoryActionButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 'bold',
  fontFamily: 'inherit',
}
const idButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: '#1565c0',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
}

export default BankTransferList
