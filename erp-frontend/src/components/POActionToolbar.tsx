import React from 'react';

interface POActionToolbarProps {
  isReadOnly: boolean;
  onToggleMode: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onReset: () => void;
  isSubmitting: boolean;
  hasValidationError: boolean;
}

export function POActionToolbar({
  isReadOnly,
  onToggleMode,
  onSaveDraft,
  onSubmit,
  onReset,
  isSubmitting,
  hasValidationError,
}: POActionToolbarProps) {
  return (
    <div style={toolbarStyle} role="toolbar" aria-label="Purchase Order actions">
      <div style={leftGroupStyle}>
        {/* Toggle Mode Button */}
        <button
          type="button"
          onClick={onToggleMode}
          style={{
            ...buttonBaseStyle,
            backgroundColor: isReadOnly ? '#aa3bff' : '#f5f5f5',
            color: isReadOnly ? 'white' : '#333',
            border: isReadOnly ? 'none' : '1px solid #ccc',
          }}
          onMouseEnter={(e) => {
            if (isReadOnly) {
              e.currentTarget.style.backgroundColor = '#932adc';
            } else {
              e.currentTarget.style.backgroundColor = '#e0e0e0';
            }
          }}
          onMouseLeave={(e) => {
            if (isReadOnly) {
              e.currentTarget.style.backgroundColor = '#aa3bff';
            } else {
              e.currentTarget.style.backgroundColor = '#f5f5f5';
            }
          }}
          aria-pressed={!isReadOnly}
        >
          {isReadOnly ? '✍️ Switch to Edit Mode' : '👁️ View Read-Only Mode'}
        </button>
      </div>

      <div style={rightGroupStyle}>
        {!isReadOnly && (
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
