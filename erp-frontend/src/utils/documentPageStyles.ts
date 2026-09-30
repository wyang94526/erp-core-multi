/**
 * Shared document-page header and action-button styles.
 * Sales Invoice / Supplier Invoice are the visual source of truth.
 */

import { createElement, type CSSProperties, type ReactNode } from 'react'

export function HoverTip({ label, children }: { label: string; children: ReactNode }) {
  return createElement('span', { title: label, style: { display: 'inline-flex' } }, children)
}

export const documentPageHeaderStyle: CSSProperties = {
  marginBottom: 24,
  borderBottom: '1px solid var(--border, #ddd)',
  paddingBottom: 16,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  flexWrap: 'nowrap',
  gap: 16,
}

export const documentPageTitleBlockStyle: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
}

export const documentPageTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 28,
  fontWeight: 'bold',
  color: 'var(--text-h, #212121)',
}

export const documentPageSubStyle: CSSProperties = {
  margin: '8px 0 0',
  fontSize: 14,
  color: 'var(--text, #616161)',
}

export const headerActionsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
  flex: '0 1 auto',
  marginLeft: 'auto',
  maxWidth: '62%',
}

export const actionRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
}

export const badgeStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 700,
}

export const compactButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

export const primaryButtonStyle: CSSProperties = {
  ...compactButtonStyle,
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
}

export const secondaryButtonStyle: CSSProperties = {
  ...compactButtonStyle,
  backgroundColor: 'transparent',
  color: 'var(--text-h, #212121)',
  border: '1px solid var(--border, #ddd)',
}

export const headerButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
}

export const dangerButtonStyle: CSSProperties = {
  ...compactButtonStyle,
  backgroundColor: 'transparent',
  color: '#c62828',
  border: '1px solid #ef9a9a',
}

export function disabledActionStyle(enabled: boolean): CSSProperties {
  return {
    opacity: enabled ? 1 : 0.55,
    cursor: enabled ? 'pointer' : 'not-allowed',
    pointerEvents: enabled ? 'auto' : 'none',
  }
}
