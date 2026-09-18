export const SCO_RECEIVE_REQUIRES_APPROVAL_MESSAGE =
  'Finished goods cannot be received until the Subcontract Order receives full management approval.'

export function scoCanReceiveFinishedGoods(sco: {
  status?: string | null
  approval_status?: string | null
}): boolean {
  const status = (sco.status || '').toUpperCase()
  if (status === 'COMPLETED' || status === 'CANCELLED') return false
  return (sco.approval_status || 'DRAFT').toUpperCase() === 'APPROVED'
}

export function scoReceiveBlockedReason(sco: {
  status?: string | null
  approval_status?: string | null
}): string | null {
  const status = (sco.status || '').toUpperCase()
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return 'This subcontract order is closed. Finished goods cannot be received.'
  }
  if ((sco.approval_status || 'DRAFT').toUpperCase() !== 'APPROVED') {
    return SCO_RECEIVE_REQUIRES_APPROVAL_MESSAGE
  }
  return null
}
