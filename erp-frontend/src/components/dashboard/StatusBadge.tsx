type StatusBadgeProps = {
  status: string
}

function getStatusColors(status: string): { bg: string; text: string } {
  const key = (status || '').toUpperCase().replace(/\s+/g, '_')
  const map: Record<string, { bg: string; text: string }> = {
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    PENDING: { bg: '#fffde7', text: '#f9a825' },
    PENDING_APPROVAL: { bg: '#fffde7', text: '#f9a825' },
    SUBMITTED: { bg: '#e3f2fd', text: '#1565c0' },
    PROCESSING: { bg: '#e3f2fd', text: '#1565c0' },
    APPROVED: { bg: '#e8f5e9', text: '#2e7d32' },
    RECEIVED: { bg: '#e8f5e9', text: '#2e7d32' },
    DELIVERED: { bg: '#e8f5e9', text: '#1b5e20' },
    SHIPPED: { bg: '#fff3e0', text: '#e65100' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
    REJECTED: { bg: '#ffebee', text: '#c62828' },
    VOID: { bg: '#ffebee', text: '#c62828' },
    UNPAID: { bg: '#fff3e0', text: '#e65100' },
    PARTIAL: { bg: '#fffde7', text: '#f9a825' },
    PAID: { bg: '#e8f5e9', text: '#2e7d32' },
    'IN STOCK': { bg: '#e8f5e9', text: '#2e7d32' },
    'LOW STOCK': { bg: '#fff3e0', text: '#e65100' },
    'OUT OF STOCK': { bg: '#ffebee', text: '#c62828' },
    'LOW_STOCK': { bg: '#fff3e0', text: '#e65100' },
    'OUT_OF_STOCK': { bg: '#ffebee', text: '#c62828' },
  }

  // Also match Title Case PO statuses
  const titleMap: Record<string, { bg: string; text: string }> = {
    Draft: map.DRAFT,
    Submitted: map.SUBMITTED,
    Approved: map.APPROVED,
    Void: map.VOID,
    Unpaid: map.UNPAID,
    Partial: map.PARTIAL,
    Paid: map.PAID,
    'In Stock': map['IN STOCK'],
    'Low Stock': map['LOW STOCK'],
    'Out of Stock': map['OUT OF STOCK'],
  }

  return titleMap[status] || map[key] || { bg: '#f5f5f5', text: '#616161' }
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const colors = getStatusColors(status)
  const label = (status || '—').replace(/_/g, ' ')

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 'bold',
        backgroundColor: colors.bg,
        color: colors.text,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}
