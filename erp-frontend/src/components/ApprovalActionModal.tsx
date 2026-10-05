/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

type ApprovalActionModalProps = {
  mode: 'approve' | 'reject'
  open: boolean
  busy?: boolean
  onConfirm: (comments: string) => void
  onClose: () => void
  rejectTitle?: string
  rejectHint?: string
  rejectConfirmLabel?: string
}

export default function ApprovalActionModal({
  mode,
  open,
  busy,
  onConfirm,
  onClose,
  rejectTitle,
  rejectHint,
  rejectConfirmLabel,
}: ApprovalActionModalProps) {
  if (!open) return null

  const required = mode === 'reject'
  const title =
    mode === 'approve' ? 'Approve document' : rejectTitle || 'Reject document'
  const confirmLabel =
    mode === 'approve' ? 'Confirm Approve' : rejectConfirmLabel || 'Confirm Reject'

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="approval-modal-title">
      <form
        style={modalStyle}
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          const comments = String(fd.get('comments') || '')
          if (required && !comments.trim()) return
          onConfirm(comments)
        }}
      >
        <h3 id="approval-modal-title" style={titleStyle}>
          {title}
        </h3>
        <p style={hintStyle}>
          {required
            ? rejectHint || 'A rejection reason is required.'
            : 'Optional notes for the approval record.'}
        </p>
        <textarea
          name="comments"
          required={required}
          rows={4}
          placeholder={required ? 'Reason for rejection…' : 'Notes (optional)…'}
          style={textareaStyle}
          autoFocus
        />
        <div style={actionsStyle}>
          <button type="button" style={cancelBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{
              ...confirmBtn,
              backgroundColor: mode === 'approve' ? '#2e7d32' : '#c62828',
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '16px',
}

const modalStyle: React.CSSProperties = {
  background: 'var(--bg)',
  borderRadius: '10px',
  padding: '20px 24px',
  width: 'min(440px, 100%)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  border: '1px solid var(--border)',
}

const titleStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: '18px',
  color: 'var(--text-h)',
}

const hintStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: '13px',
  color: 'var(--text)',
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontFamily: 'inherit',
  fontSize: '13px',
  resize: 'vertical',
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  marginTop: '16px',
}

const cancelBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const confirmBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '6px',
  border: 'none',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 700,
  fontFamily: 'inherit',
}
