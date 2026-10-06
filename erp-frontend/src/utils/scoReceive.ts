/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { SubcontractOrder } from '../types'
import { overReceiveDetail } from './receiveQty'
import { scoHasUnissuedKitComponents } from './scoKitIssue'

export { overReceiveDetail }

export const SCO_RECEIVE_REQUIRES_APPROVAL_MESSAGE =
  'Finished goods cannot be received until the Subcontract Order receives full management approval.'

export const SCO_RECEIVE_REQUIRES_KIT_MESSAGE =
  'Finished goods cannot be received until all required kit components have been issued to the subcontractor.'

export function scoCanReceiveFinishedGoods(sco: {
  status?: string | null
  approval_status?: string | null
  remaining_closed?: boolean | null
  components?: Array<{ quantity_required?: number | string | null; quantity_issued?: number | string | null }> | null
}): boolean {
  return scoReceiveBlockedReason(sco) == null
}

export function scoReceivedQty(sco: Pick<SubcontractOrder, 'quantity_ordered' | 'lines' | 'finished_goods_receipts'>): number {
  const receipts = sco.finished_goods_receipts || []
  const receivedByLine: Record<number, number> = {}
  let headerQty = 0
  for (const receipt of receipts) {
    const qty = Number(receipt.quantity_received || 0)
    if (receipt.sco_line_id) {
      const lineId = Number(receipt.sco_line_id)
      receivedByLine[lineId] = (receivedByLine[lineId] || 0) + qty
    } else {
      headerQty += qty
    }
  }
  const lines = sco.lines || []
  if (lines.length) {
    return lines.reduce((sum, line) => {
      let got = receivedByLine[line.sco_line_id] || 0
      if (line.line_number === 1) got += headerQty
      return sum + got
    }, 0)
  }
  return headerQty + Object.values(receivedByLine).reduce((sum, qty) => sum + qty, 0)
}

export function scoRemainingToReceive(
  sco: Pick<SubcontractOrder, 'quantity_ordered' | 'item_id' | 'lines' | 'finished_goods_receipts'>,
  scoLineId?: number | null,
): number {
  const receipts = sco.finished_goods_receipts || []
  const lines = sco.lines || []
  if (scoLineId) {
    const line = lines.find((row) => Number(row.sco_line_id) === Number(scoLineId))
    const ordered = Number(line?.quantity_ordered ?? sco.quantity_ordered ?? 0)
    const got = receipts.reduce((sum, receipt) => {
      const receiptLine = receipt.sco_line_id == null ? null : Number(receipt.sco_line_id)
      const matchesLine = receiptLine === Number(scoLineId)
      const matchesHeaderFirstLine = receiptLine == null && Number(line?.line_number || 1) === 1
      if (!matchesLine && !matchesHeaderFirstLine) return sum
      return sum + Number(receipt.quantity_received || 0)
    }, 0)
    return Math.max(0, ordered - got)
  }
  const ordered = lines.length
    ? lines.reduce((sum, line) => sum + Number(line.quantity_ordered || 0), 0)
    : Number(sco.quantity_ordered || 0)
  return Math.max(0, ordered - scoReceivedQty(sco))
}

export function scoReceiveItemId(
  sco: Pick<SubcontractOrder, 'item_id' | 'lines'>,
  scoLineId?: number | null,
): string {
  if (scoLineId) {
    const line = (sco.lines || []).find((row) => Number(row.sco_line_id) === Number(scoLineId))
    if (line?.item_id) return line.item_id
  }
  return sco.item_id
}

export const BILL_RECEIVED_BEFORE_CANCEL_REMAINING =
  'Create a supplier invoice for the received quantity before cancelling remaining.'

export function scoCanShowCloseRemaining(sco: {
  can_close_remaining?: boolean | null
  remaining_closed?: boolean | null
  status?: string | null
  billing_status?: string | null
}): boolean {
  if (sco.remaining_closed) return false
  if (sco.can_close_remaining) return true
  const status = (sco.status || '').toUpperCase()
  const billing = (sco.billing_status || 'UNBILLED').toUpperCase()
  return status === 'PARTIALLY_RECEIVED' && billing !== 'FULLY_BILLED'
}

export function scoCloseRemainingBlockedReason(sco: {
  can_close_remaining?: boolean | null
  remaining_closed?: boolean | null
  status?: string | null
  billing_status?: string | null
}): string | null {
  if (sco.can_close_remaining) return null
  if (scoCanShowCloseRemaining(sco)) return BILL_RECEIVED_BEFORE_CANCEL_REMAINING
  return null
}

export function scoReceiveBlockedReason(sco: {
  status?: string | null
  approval_status?: string | null
  remaining_closed?: boolean | null
  components?: Array<{ quantity_required?: number | string | null; quantity_issued?: number | string | null }> | null
}): string | null {
  if (sco.remaining_closed) {
    return 'Remaining quantity was cancelled. Finished goods cannot be received.'
  }
  const status = (sco.status || '').toUpperCase()
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return 'This subcontract order is closed. Finished goods cannot be received.'
  }
  if (scoHasUnissuedKitComponents(sco.components)) {
    return SCO_RECEIVE_REQUIRES_KIT_MESSAGE
  }
  if ((sco.approval_status || 'DRAFT').toUpperCase() !== 'APPROVED') {
    return SCO_RECEIVE_REQUIRES_APPROVAL_MESSAGE
  }
  return null
}
