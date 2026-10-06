/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

export const SCO_ISSUE_REQUIRES_APPROVAL_MESSAGE =
  'Materials cannot be issued until the Subcontract Order is approved.'

export function overIssueDetail(itemId: string, qty: number, remaining: number): string {
  return `Quantity ${qty} exceeds remaining issuable ${remaining} for ${itemId}. Over-issue is not allowed.`
}

export function scoCanIssueMaterials(sco: {
  status?: string | null
  approval_status?: string | null
}): boolean {
  return scoIssueBlockedReason(sco) == null
}

export function scoIssueBlockedReason(sco: {
  status?: string | null
  approval_status?: string | null
}): string | null {
  const status = (sco.status || '').toUpperCase()
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return 'This subcontract order is closed. Materials cannot be issued.'
  }
  if ((sco.approval_status || 'DRAFT').toUpperCase() !== 'APPROVED') {
    return SCO_ISSUE_REQUIRES_APPROVAL_MESSAGE
  }
  return null
}
