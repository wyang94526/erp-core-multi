/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import React from 'react';

interface POActionToolbarProps {
  isReadOnly: boolean;
  editLocked?: boolean;
  editLockedReason?: string | null;
  onToggleMode: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onReset: () => void;
  isSubmitting: boolean;
  hasValidationError: boolean;
  canRecall?: boolean;
  recallDisabledReason?: string | null;
  onRecall?: () => void;
  isRecalling?: boolean;
  showRecall?: boolean;
}

export function POActionToolbar({
  isReadOnly,
  editLocked = false,
  editLockedReason = null,
  onToggleMode,
  onSaveDraft,
  onSubmit,
  onReset,
  isSubmitting,
  hasValidationError,
  canRecall = false,
  recallDisabledReason = null,
  onRecall,
  isRecalling = false,
  showRecall = false,
}: POActionToolbarProps) {
  const workflowLocked = showRecall;
  return (
    <div style={toolbarStyle} role="toolbar" aria-label="Purchase Order actions">
      <div style={leftGroupStyle}>
        {/* Toggle Mode Button */}
        <span
          title={
            editLocked
              ? editLockedReason || 'This purchase order cannot be edited inline'
              : isReadOnly
                ? 'Switch to edit mode'
                : 'View read-only mode'
          }
          style={{ display: 'inline-block', cursor: editLocked ? 'not-allowed' : 'pointer' }}
        >
        <button
          type="button"
          onClick={() => {
            if (editLocked) return
            onToggleMode()
          }}
          disabled={editLocked}
          aria-pressed={!isReadOnly && !editLocked}
          aria-disabled={editLocked}
          aria-label={
            editLocked
              ? `Switch to Edit Mode. ${editLockedReason || 'This purchase order cannot be edited inline'}`
              : isReadOnly
                ? 'Switch to Edit Mode'
                : 'View Read-Only Mode'
          }
          style={{
            ...buttonBaseStyle,
            backgroundColor: editLocked ? '#90a4ae' : isReadOnly ? '#aa3bff' : '#f5f5f5',
            color: editLocked || isReadOnly ? 'white' : '#333',
            border: editLocked || isReadOnly ? 'none' : '1px solid #ccc',
            cursor: editLocked ? 'not-allowed' : 'pointer',
            opacity: editLocked ? 0.75 : 1,
            pointerEvents: editLocked ? 'none' : 'auto',
          }}
          onMouseEnter={(e) => {
            if (editLocked) return
            if (isReadOnly) {
              e.currentTarget.style.backgroundColor = '#932adc';
            } else {
              e.currentTarget.style.backgroundColor = '#e0e0e0';
            }
          }}
          onMouseLeave={(e) => {
            if (editLocked) {
              e.currentTarget.style.backgroundColor = '#90a4ae';
              return
            }
            if (isReadOnly) {
              e.currentTarget.style.backgroundColor = '#aa3bff';
            } else {
              e.currentTarget.style.backgroundColor = '#f5f5f5';
            }
          }}
        >
          {isReadOnly || editLocked ? '✍️ Switch to Edit Mode' : '👁️ View Read-Only Mode'}
        </button>
        </span>
      </div>

      <div style={rightGroupStyle}>
        {showRecall && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <button
              type="button"
              onClick={onRecall}
              disabled={!canRecall || isRecalling || isSubmitting}
              title={
                canRecall
                  ? 'Return this purchase order to Draft for revision'
                  : recallDisabledReason || 'Recall is not available'
              }
              style={{
                ...buttonBaseStyle,
                backgroundColor: canRecall ? '#ef6c00' : '#bdbdbd',
                color: 'white',
                border: 'none',
                cursor: canRecall && !isRecalling ? 'pointer' : 'not-allowed',
                opacity: canRecall ? 1 : 0.9,
              }}
            >
              {isRecalling ? 'Recalling…' : 'Recall / Reopen for Revision'}
            </button>
            {!canRecall && recallDisabledReason ? (
              <span style={{ fontSize: 12, color: '#c62828', maxWidth: 360, textAlign: 'right' }}>
                {recallDisabledReason}
              </span>
            ) : null}
          </div>
        )}

        {!isReadOnly && !workflowLocked && (
          <>
            {/* Reset Form Button */}
            <button
              type="button"
              onClick={onReset}
              disabled={isSubmitting}
              style={{
                ...buttonBaseStyle,
                backgroundColor: 'transparent',
                color: '#d32f2f',
                border: '1px solid #d32f2f',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#ffebee')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Reset Form
            </button>

            {/* Save Draft Button */}
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={isSubmitting}
              style={{
                ...buttonBaseStyle,
                backgroundColor: '#757575',
                color: 'white',
                border: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#616161')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#757575')}
            >
              Save Draft
            </button>

            {/* Submit PO Button */}
            <button
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting}
              style={{
                ...buttonBaseStyle,
                backgroundColor: hasValidationError ? '#90caf9' : '#1976d2',
                color: 'white',
                border: 'none',
                cursor: hasValidationError ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!hasValidationError) e.currentTarget.style.backgroundColor = '#1565c0';
              }}
              onMouseLeave={(e) => {
                if (!hasValidationError) e.currentTarget.style.backgroundColor = '#1976d2';
              }}
              title={hasValidationError ? 'Please correct form validation errors before submitting' : 'Submit Purchase Order'}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Purchase Order'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Styles
const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 24px',
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
  flexWrap: 'wrap',
  gap: '16px',
};

const leftGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
};

const rightGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap',
};

const buttonBaseStyle: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 'bold',
  cursor: 'pointer',
  transition: 'background-color 0.2s, color 0.2s',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  outline: 'none',
  fontFamily: 'inherit',
};
export default POActionToolbar;
