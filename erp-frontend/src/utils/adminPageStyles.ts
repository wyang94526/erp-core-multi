/**
 * Shared layout for Administration screens.
 * Matches Company Profile: page title, white cards, labeled fields, and document buttons.
 */

import type { CSSProperties } from 'react'

export const adminPageStyle: CSSProperties = { padding: 24, textAlign: 'left' }

export const adminCardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  marginBottom: 16,
}

export const adminSectionTitle: CSSProperties = { margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-h, #212121)' }

export const adminHintStyle: CSSProperties = { margin: '0 0 16px', fontSize: 13, color: '#616161', lineHeight: 1.5 }

export const adminFormRow: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }

export const adminFieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  fontWeight: 700,
  color: '#424242',
  minWidth: 160,
  marginBottom: 0,
}

export const adminInputStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #cfd8dc',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 400,
  fontFamily: 'inherit',
  background: 'var(--bg, #fff)',
  color: 'var(--text-h, #212121)',
}

export const adminTableWrap: CSSProperties = { overflowX: 'auto' }

export const adminTableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }

export const adminTheadStyle: CSSProperties = { backgroundColor: 'var(--social-bg, #f5f5f5)' }

export const adminThStyle: CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h, #212121)',
}

export const adminTdStyle: CSSProperties = {
  padding: '12px 10px',
  borderBottom: '1px solid var(--divider, #eee)',
  color: 'var(--text, #424242)',
  verticalAlign: 'middle',
}

export const adminErrorStyle: CSSProperties = {
  margin: '0 0 12px',
  padding: '10px 12px',
  background: '#ffebee',
  color: '#c62828',
  borderRadius: 6,
}

export const adminSuccessStyle: CSSProperties = {
  margin: '0 0 12px',
  padding: '10px 12px',
  background: '#e8f5e9',
  color: '#2e7d32',
  borderRadius: 6,
}

export const adminTabRow: CSSProperties = { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }
