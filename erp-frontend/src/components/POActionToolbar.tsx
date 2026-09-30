/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import React from 'react';
import { Eye, Pencil, RotateCcw, Save, Send, Undo2 } from 'lucide-react';
import {
  HoverTip,
  dangerButtonStyle,
  disabledActionStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../utils/documentPageStyles';

interface POActionToolbarProps {
  isReadOnly: boolean;
  editLocked?: boolean;
  editLockedReason?: string | null;
  onToggleMode: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onReset: () => void;
  isSubmitting: boolean;
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
        <HoverTip
          label={
            editLocked
              ? editLockedReason || 'This purchase order cannot be edited inline'
              : isReadOnly
                ? 'Switch to edit mode'
                : 'View read-only mode'
          }
        >
          <button
            type="button"
            onClick={() => {
              if (editLocked) return;
              onToggleMode();
            }}
            disabled={editLocked}
            aria-pressed={!isReadOnly && !editLocked}
            aria-disabled={editLocked}
            style={{
              ...(isReadOnly && !editLocked ? primaryButtonStyle : secondaryButtonStyle),
              ...disabledActionStyle(!editLocked),
            }}
          >
            {isReadOnly || editLocked ? <Pencil size={15} /> : <Eye size={15} />}
            {isReadOnly || editLocked ? 'Edit' : 'View'}
          </button>
        </HoverTip>
      </div>

      <div style={rightGroupStyle}>
        {showRecall && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <HoverTip
              label={
                canRecall
                  ? 'Create a revision of this purchase order'
                  : recallDisabledReason || 'Create Revision is not available'
              }
            >
              <button
                type="button"
                onClick={onRecall}
                disabled={!canRecall || isRecalling || isSubmitting}
                style={{
                  ...secondaryButtonStyle,
                  ...disabledActionStyle(canRecall && !isRecalling && !isSubmitting),
                }}
              >
                <RotateCcw size={15} />
                {isRecalling ? 'Opening…' : 'Create Revision'}
              </button>
            </HoverTip>
            {!canRecall && recallDisabledReason ? (
              <span style={{ fontSize: 12, color: '#c62828', maxWidth: 360, textAlign: 'right' }}>
                {recallDisabledReason}
              </span>
            ) : null}
          </div>
        )}

        {!isReadOnly && !workflowLocked && (
          <>
            <HoverTip label="Clear the current form values">
              <button type="button" onClick={onReset} disabled={isSubmitting} style={dangerButtonStyle}>
                <Undo2 size={15} />
                Reset
              </button>
            </HoverTip>

            <HoverTip label="Save this purchase order as a draft">
              <button
                type="button"
                onClick={onSaveDraft}
                disabled={isSubmitting}
                style={secondaryButtonStyle}
              >
                <Save size={15} />
                Save Draft
              </button>
            </HoverTip>

            <HoverTip label="Submit Purchase Order">
              <button
                type="button"
                onClick={onSubmit}
                disabled={isSubmitting}
                style={primaryButtonStyle}
              >
                <Send size={15} />
                {isSubmitting ? 'Submitting…' : 'Submit'}
              </button>
            </HoverTip>
          </>
        )}
      </div>
    </div>
  );
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 16px',
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
  flexWrap: 'wrap',
  gap: '12px',
};

const leftGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
};

const rightGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
};

export default POActionToolbar;
