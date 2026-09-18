/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type React from 'react'

export const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1400px',
  margin: '0 auto',
}

export const pageHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  marginBottom: '20px',
  paddingBottom: '16px',
  borderBottom: '1px solid var(--border)',
  flexWrap: 'wrap',
}

export const pageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.5rem',
  fontWeight: 700,
  color: 'var(--text-h)',
}

export const pageSubStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: '0.9rem',
  color: 'var(--text)',
}

export const metricsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '16px',
  marginBottom: '20px',
}

export const sectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '20px 24px',
  boxShadow: 'var(--shadow)',
  marginBottom: '16px',
}

export const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--text-h)',
}

export const twoColStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '16px',
  marginBottom: '16px',
}

export const directoryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
}

export const directoryTheadRowStyle: React.CSSProperties = {
  backgroundColor: 'var(--social-bg)',
}

export const directoryThStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  color: 'var(--text-h)',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}

export const directoryTdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-h)',
}

export const directoryTbodyRowStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
}

export const emptyStateStyle: React.CSSProperties = {
  padding: '16px 0',
  color: 'var(--text)',
  fontSize: '0.9rem',
}

export const linkStyle: React.CSSProperties = {
  color: '#1565c0',
  textDecoration: 'none',
  fontWeight: 500,
}

export const primaryButtonStyle: React.CSSProperties = {
  backgroundColor: '#1976d2',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  padding: '10px 16px',
  fontSize: '0.875rem',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
}
