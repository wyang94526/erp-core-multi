/**
 * @author: Wendy Yang
 * @date: 2026-09-24
 */

import type { BankTransfer } from '../types'

export function bankTransferPath(id: number, suffix: '' | '/edit' = '') {
  return `/bank-transfers/${id}${suffix}`
}

export function isBankTransferEditable(transfer?: Pick<BankTransfer, 'approval_status' | 'status'> | null) {
  if (!transfer) return false
  if ((transfer.status || '').toUpperCase() === 'POSTED') return false
  const approval = (transfer.approval_status || 'DRAFT').toUpperCase()
  return approval === 'DRAFT' || approval === 'REJECTED'
}

export function isBankTransferDeletable(transfer?: Pick<BankTransfer, 'approval_status' | 'status'> | null) {
  if (!transfer) return false
  const gl = (transfer.status || 'DRAFT').toUpperCase()
  const approval = (transfer.approval_status || 'DRAFT').toUpperCase()
  return gl === 'DRAFT' && approval === 'DRAFT'
}

export function approvalBadgeColors(status?: string | null) {
  const value = (status || 'DRAFT').toUpperCase()
  if (value === 'APPROVED') return { backgroundColor: '#e8f5e9', color: '#2e7d32' }
  if (value === 'PENDING_APPROVAL') return { backgroundColor: '#fff8e1', color: '#f57f17' }
  if (value === 'REJECTED') return { backgroundColor: '#ffebee', color: '#c62828' }
  return { backgroundColor: '#eceff1', color: '#546e7a' }
}
