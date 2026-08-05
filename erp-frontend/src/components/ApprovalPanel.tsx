/**
 * ApprovalPanel — submit / approve / reject + history timeline
 */

import { useEffect, useState } from 'react'
import { approvalService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import type { ApprovalHistory, ApprovalStatus } from '../types'
import ApprovalActionModal from './ApprovalActionModal'

const MODULE_SUBMIT: Record<string, string> = {
  'sales-orders': 'sales_order:submit',
  'purchase-orders': 'po:submit_for_approval',
  'subcontract-orders': 'subcontract:submit',
  'ar-invoices': 'ar_invoice:submit',
  'ap-bills': 'ap_bill:submit',
  'cash-transactions': 'cash:submit',
  'journal-entries': 'journal:submit',
}

const MODULE_APPROVE: Record<string, string> = {
  'sales-orders': 'sales_order:approve',
  'purchase-orders': 'po:approve',
  'subcontract-orders': 'subcontract:approve',
  'ar-invoices': 'ar_invoice:approve',
  'ap-bills': 'ap_bill:approve',
  'cash-transactions': 'cash:approve',
  'journal-entries': 'journal:approve',
}

type ApprovalPanelProps = {
  module: string
  documentId: string
  approvalStatus?: ApprovalStatus | string | null
  currentApprovalStep?: number | null
  onStatusChange?: () => void
}

export function ApprovalPanel({
  module,
  documentId,
  approvalStatus,
  currentApprovalStep,
  onStatusChange,
}: ApprovalPanelProps) {
  const { hasPermission } = useAuth()
  const [history, setHistory] = useState<ApprovalHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<'approve' | 'reject' | null>(null)

  const status = (approvalStatus || 'DRAFT').toUpperCase()

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const hist = await approvalService.getHistory(module, documentId)
      setHistory(hist)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approval data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, documentId, status, currentApprovalStep])

  const canSubmit =
    (status === 'DRAFT' || status === 'REJECTED') &&
    hasPermission(MODULE_SUBMIT[module] || '')
  const canApprove =
    status === 'PENDING_APPROVAL' && hasPermission(MODULE_APPROVE[module] || '')

  const runSubmit = async () => {
    setBusy(true)
    setError(null)
    try {
      await approvalService.submit(module, documentId)
      await load()
      onStatusChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit failed')
    } finally {
      setBusy(false)
    }
  }

  const runModalAction = async (comments: string) => {
    if (!modal) return
    setBusy(true)
    setError(null)
    try {
      if (modal === 'approve') {
        await approvalService.approve(module, documentId, comments || undefined)
      } else {
        await approvalService.reject(module, documentId, comments)
      }
      setModal(null)
      await load()
      onStatusChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : `${modal} failed`)
    } finally {
      setBusy(false)
    }
  }

  const colors = getApprovalColors(status)

  return (
    <div style={panelStyle}>
      <div style={headerRowStyle}>
        <h3 style={titleStyle}>Approval Workflow</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {status === 'PENDING_APPROVAL' && currentApprovalStep != null && (
            <span style={stepBadge}>Step {currentApprovalStep}</span>
          )}
          <span style={{ ...badgeStyle, backgroundColor: colors.bg, color: colors.text }}>
            {status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {(canSubmit || canApprove) && (
        <div style={buttonRowStyle}>
          {canSubmit && (
            <button
              type="button"
              disabled={busy}
              style={{ ...btnStyle, backgroundColor: '#1976d2' }}
              onClick={runSubmit}
            >
              Submit for Approval
            </button>
          )}
          {canApprove && (
            <>
              <button
                type="button"
                disabled={busy}
                style={{ ...btnStyle, backgroundColor: '#2e7d32' }}
                onClick={() => setModal('approve')}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                style={{ ...btnStyle, backgroundColor: '#c62828' }}
                onClick={() => setModal('reject')}
              >
                Reject
              </button>
            </>
          )}
        </div>
      )}

      {error && <p style={errorStyle}>{error}</p>}

      <h4 style={historyTitleStyle}>Approval History</h4>
      {loading ? (
        <p style={mutedStyle}>Loading history...</p>
      ) : history.length === 0 ? (
        <p style={mutedStyle}>No approval events yet.</p>
      ) : (
        <ul style={listStyle}>
          {history.map((h) => (
            <li key={h.id} style={listItemStyle}>
              <strong>{h.action}</strong>
              {h.step_name && <span style={mutedStyle}> · {h.step_name}</span>}
              <span style={mutedStyle}>
                {' '}
                · {new Date(h.timestamp || h.created_at).toLocaleString()}
                {h.actor_name
                  ? ` · ${h.actor_name}`
                  : h.performed_by_user_id
                    ? ` · ${String(h.performed_by_user_id).slice(0, 8)}…`
                    : ''}
              </span>
              {h.comments && <div style={commentStyle}>{h.comments}</div>}
            </li>
          ))}
        </ul>
      )}

      <ApprovalActionModal
        mode={modal || 'approve'}
        open={modal != null}
        busy={busy}
        onClose={() => setModal(null)}
        onConfirm={runModalAction}
      />
    </div>
  )
}

function getApprovalColors(status: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    PENDING_APPROVAL: { bg: '#fff3e0', text: '#e65100' },
    APPROVED: { bg: '#e8f5e9', text: '#2e7d32' },
    REJECTED: { bg: '#ffebee', text: '#c62828' },
    CANCELLED: { bg: '#eceff1', text: '#455a64' },
  }
  return map[status] || { bg: '#f5f5f5', text: '#616161' }
}

const panelStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '20px 24px',
  marginTop: '20px',
  boxShadow: 'var(--shadow)',
}

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
  gap: '12px',
  flexWrap: 'wrap',
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '16px',
  fontWeight: 700,
  color: 'var(--text-h)',
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: '12px',
  fontSize: '11px',
  fontWeight: 'bold',
}

const stepBadge: React.CSSProperties = {
  ...badgeStyle,
  backgroundColor: '#e3f2fd',
  color: '#1565c0',
}

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
  marginBottom: '16px',
}

const btnStyle: React.CSSProperties = {
  padding: '8px 14px',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

const errorStyle: React.CSSProperties = {
  color: '#c62828',
  fontSize: '13px',
  margin: '0 0 12px 0',
}

const historyTitleStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: '14px',
  color: 'var(--text-h)',
}

const mutedStyle: React.CSSProperties = {
  color: 'var(--text)',
  fontSize: '12px',
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
}

const listItemStyle: React.CSSProperties = {
  padding: '8px 0',
  borderBottom: '1px solid var(--border)',
  fontSize: '13px',
}

const commentStyle: React.CSSProperties = {
  marginTop: '4px',
  color: 'var(--text)',
  fontStyle: 'italic',
}

export default ApprovalPanel
