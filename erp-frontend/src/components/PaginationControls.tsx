/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { formatPaginationLabel } from '../utils/pagination'

type PaginationControlsProps = {
  skip: number
  pageCount: number
  total: number
  onPrevious: () => void
  onNext: () => void
  noun?: string
}

export function PaginationControls({
  skip,
  pageCount,
  total,
  onPrevious,
  onNext,
  noun = 'result',
}: PaginationControlsProps) {
  const atStart = skip <= 0
  const atEnd = skip + pageCount >= total
  return (
    <div style={rowStyle}>
      <button
        type="button"
        onClick={onPrevious}
        disabled={atStart}
        style={{
          ...buttonStyle,
          opacity: atStart ? 0.5 : 1,
          cursor: atStart ? 'not-allowed' : 'pointer',
        }}
      >
        ← Previous
      </button>
      <span style={labelStyle}>{formatPaginationLabel({ skip, pageCount, total, noun })}</span>
      <button
        type="button"
        onClick={onNext}
        disabled={atEnd}
        style={{
          ...buttonStyle,
          opacity: atEnd ? 0.5 : 1,
          cursor: atEnd ? 'not-allowed' : 'pointer',
        }}
      >
        Next →
      </button>
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  marginTop: '20px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
}

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--text)',
}

export default PaginationControls
