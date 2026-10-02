/**
 * @author: Wendy Yang
 * @date: 2026-09-24
 *
 * Bank Transfers — internal movements between company bank accounts.
 */

import { type CSSProperties, useMemo, useState } from 'react'
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
import { Plus } from 'lucide-react'
import { csvFilename, downloadCsv, matchesSearch } from '../utils/csvExport'
import { primaryButtonStyle } from '../utils/documentPageStyles'
import { PageHeader } from './PageHeader'
import ListFilterBar, { useListFilterParams, type FilterField } from './ListFilterBar'

const TRANSFER_FILTERS: FilterField[] = [
  {
    key: 'approval',
    label: 'Approval',
    options: [
      { value: 'ALL', label: 'All' },
      { value: 'DRAFT', label: 'Draft' },
      { value: 'PENDING_APPROVAL', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'REJECTED', label: 'Rejected' },
    ],
  },
]

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

  const { values } = useListFilterParams(TRANSFER_FILTERS)
  const filteredTransfers = useMemo(() => {
    return transfers.filter((row) => {
      if (values.approval !== 'ALL' && (row.approval_status || 'DRAFT').toUpperCase() !== values.approval) {
        return false
      }
      return matchesSearch(
        values.q,
        row.reference_number,
        row.from_account_name,
        row.to_account_name,
        row.from_account_id,
        row.to_account_id,
        row.status,
        row.approval_status,
      )
    })
  }, [transfers, values.q, values.approval])

  const { items: sortedTransfers, requestSort, sortConfig } = useSortableData(filteredTransfers, {
    columnTypes: {
      amount: 'number',
      transfer_date: 'date',
    },
  })

  return (
    <div style={containerStyle}>
      <PageHeader
        title="Bank Transfers"
        subtitle="Move funds between company bank accounts. Submit a draft for approval; the generated journal stays Draft until the G/L entry is approved."
      >
        <button type="button" style={primaryButtonStyle} onClick={() => navigate('/bank-transfers/new')}>
          <Plus size={15} />
          New Bank Transfer
        </button>
      </PageHeader>

      <ListFilterBar
        fields={TRANSFER_FILTERS}
        searchPlaceholder="Search reference, from/to bank…"
        exportCount={filteredTransfers.length}
        onExport={() =>
          downloadCsv(
            csvFilename('bank-transfers'),
            ['Date', 'Reference', 'From', 'To', 'Amount', 'G/L Status', 'Approval'],
            filteredTransfers.map((row) => [
              row.transfer_date,
              row.reference_number,
              row.from_account_name || row.from_account_id,
              row.to_account_name || row.to_account_id,
              row.amount,
              row.status,
              row.approval_status || 'DRAFT',
            ]),
          )
        }
      />

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
const directoryTbodyRowStyle: CSSProperties = { borderBottom: '1px solid var(--divider)' }
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
