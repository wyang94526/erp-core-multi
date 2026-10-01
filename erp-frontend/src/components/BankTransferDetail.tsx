/**
 * @author: Wendy Yang
 * @date: 2026-09-24
 *
 * Bank Transfer detail — view fields and run approval.
 */

import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type CSSProperties } from 'react'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { bankTransferService } from '../api/services'
import { ApprovalPanel } from './ApprovalPanel'
import {
  approvalBadgeColors,
  bankTransferPath,
  isBankTransferDeletable,
  isBankTransferEditable,
} from '../utils/bankTransfers'
import { journalEditPath } from '../utils/journalEntries'
import {
  HoverTip,
  actionRowStyle,
  badgeStyle,
  dangerButtonStyle,
  documentPageHeaderStyle,
  documentPageSubStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
  secondaryButtonStyle,
} from '../utils/documentPageStyles'

function formatCurrency(amount: number, currency = 'USD') {
  return Number(amount || 0).toLocaleString('en-US', {
    style: 'currency',
    currency,
  })
}

export function BankTransferDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const transferId = Number(id)

  const { data: transfer, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['bankTransfers', transferId],
    queryFn: () => bankTransferService.get(transferId),
    enabled: Number.isFinite(transferId),
  })

  if (!Number.isFinite(transferId)) {
    return (
      <div style={containerStyle}>
        <p style={errorStyle}>Error: No transfer ID provided</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={{ padding: 30, textAlign: 'center' }}>Loading bank transfer…</div>
      </div>
    )
  }

  if (isError || !transfer) {
    return (
      <div style={containerStyle}>
        <p style={errorStyle}>{error instanceof Error ? error.message : 'Bank transfer not found'}</p>
        <button type="button" style={headerButtonStyle} onClick={() => navigate('/bank-transfers')}>
          Back to Bank Transfers
        </button>
      </div>
    )
  }

  const canEdit = isBankTransferEditable(transfer)
  const canDelete = isBankTransferDeletable(transfer)
  const glPosted = (transfer.status || '').toUpperCase() === 'POSTED'

  const handleDelete = async () => {
    if (!canDelete) return
    const label = transfer.reference_number || `BTR-${String(transfer.id).padStart(6, '0')}`
    if (!window.confirm(`Delete draft bank transfer ${label}? This cannot be undone.`)) {
      return
    }
    setDeleting(true)
    try {
      await bankTransferService.remove(transfer.id)
      await queryClient.invalidateQueries({ queryKey: ['bankTransfers'] })
      navigate('/bank-transfers')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete bank transfer')
      setDeleting(false)
    }
  }

  return (
    <div style={containerStyle}>
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>
            {transfer.reference_number || `BTR-${String(transfer.id).padStart(6, '0')}`}
          </h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span
              style={{
                ...badgeStyle,
                backgroundColor: glPosted ? '#e8f5e9' : '#fff8e1',
                color: glPosted ? '#2e7d32' : '#f57f17',
              }}
            >
              {transfer.status || 'DRAFT'}
            </span>
            <span style={{ ...badgeStyle, ...approvalBadgeColors(transfer.approval_status) }}>
              {(transfer.approval_status || 'DRAFT').toString().replace(/_/g, ' ')}
            </span>
          </div>
          <p style={documentPageSubStyle}>
            {transfer.from_account_name || transfer.from_account_id}
            {' → '}
            {transfer.to_account_name || transfer.to_account_id}
            {' · '}
            {formatCurrency(transfer.amount)}
          </p>
        </div>
        <div style={headerActionsStyle}>
          <div style={actionRowStyle}>
            {canEdit ? (
              <HoverTip label="Edit this draft bank transfer">
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => navigate(bankTransferPath(transfer.id, '/edit'))}
                >
                  <Pencil size={15} />
                  Edit
                </button>
              </HoverTip>
            ) : null}
            {canDelete ? (
              <HoverTip label="Delete this draft bank transfer">
                <button type="button" style={dangerButtonStyle} disabled={deleting} onClick={() => void handleDelete()}>
                  <Trash2 size={15} />
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </HoverTip>
            ) : null}
          </div>
          <div style={actionRowStyle}>
            <HoverTip label="Back to the bank transfer list">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/bank-transfers')}>
                <ArrowLeft size={15} />
                Bank Transfers
              </button>
            </HoverTip>
          </div>
        </div>
      </header>

      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Transfer Details</h3>
        <div style={gridStyle}>
          <Field label="Reference" value={transfer.reference_number || `BTR-${String(transfer.id).padStart(6, '0')}`} mono />
          <Field label="Transfer Date" value={transfer.transfer_date?.slice(0, 10) || '—'} />
          <Field label="From Account" value={transfer.from_account_name || transfer.from_account_id} />
          <Field label="To Account" value={transfer.to_account_name || transfer.to_account_id} />
          <Field label="Amount" value={formatCurrency(transfer.amount)} />
          <div>
            <label style={labelStyle}>G/L Status</label>
            <p style={valueStyle}>
              <span
                style={{
                  ...badgeStyle,
                  backgroundColor: glPosted ? '#e8f5e9' : '#fff8e1',
                  color: glPosted ? '#2e7d32' : '#f57f17',
                }}
              >
                {transfer.status || 'DRAFT'}
              </span>
            </p>
          </div>
          <div>
            <label style={labelStyle}>Approval</label>
            <p style={valueStyle}>
              <span style={{ ...badgeStyle, ...approvalBadgeColors(transfer.approval_status) }}>
                {transfer.approval_status || 'DRAFT'}
              </span>
            </p>
          </div>
          <div>
            <label style={labelStyle}>Journal Entry</label>
            {transfer.journal_entry_id ? (
              <p style={{ ...valueStyle, margin: '4px 0 0 0' }}>
                <Link
                  to={journalEditPath(transfer.journal_entry_id, { from: `/bank-transfers/${transfer.id}` })}
                  title={transfer.journal_entry_id}
                  style={journalLinkStyle}
                >
                  {transfer.journal_entry_id}
                </Link>
              </p>
            ) : (
              <p style={valueStyle}>Created after transfer approval (Draft)</p>
            )}
          </div>
        </div>
        {transfer.journal_entry_id ? (
          <p style={hintStyle}>
            The linked journal is created as Draft and posts to the G/L only after journal approval.
          </p>
        ) : (
          <p style={hintStyle}>
            Approving this transfer creates a Draft journal entry. That journal must be approved
            before cash moves in the G/L.
          </p>
        )}
      </div>

      <ApprovalPanel
        module="bank-transfers"
        documentId={String(transfer.id)}
        approvalStatus={transfer.approval_status}
        currentApprovalStep={transfer.current_approval_step}
        onStatusChange={async () => {
          await refetch()
          await queryClient.invalidateQueries({ queryKey: ['bankTransfers'] })
          await queryClient.invalidateQueries({ queryKey: ['journalEntries'] })
        }}
      />
    </div>
  )
}

function Field({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <p style={{ ...valueStyle, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</p>
    </div>
  )
}

const containerStyle: CSSProperties = {
  padding: '24px',
  maxWidth: '800px',
  margin: '0 auto',
  textAlign: 'left',
}
const cardStyle: CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
}
const sectionHeadingStyle: CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  borderBottom: '2px solid var(--border)',
  paddingBottom: '8px',
}
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '12px 16px',
}
const labelStyle: CSSProperties = { display: 'block', fontSize: 12, color: 'var(--text)', fontWeight: 600 }
const valueStyle: CSSProperties = { margin: '4px 0 0 0', fontSize: 14, color: 'var(--text-h)' }
const hintStyle: CSSProperties = { margin: '16px 0 0 0', fontSize: 13, color: 'var(--text)' }
const journalLinkStyle: CSSProperties = {
  display: 'inline-block',
  color: '#1565c0',
  fontWeight: 700,
  fontFamily: 'monospace',
  textDecoration: 'underline',
  wordBreak: 'break-all',
}
const errorStyle: CSSProperties = { color: '#c62828', fontSize: 13 }

export default BankTransferDetail
