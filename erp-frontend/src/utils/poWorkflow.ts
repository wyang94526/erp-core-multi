/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

export const PURCHASE_ORDER_LOCKED_EDIT_MESSAGE =
  'Approved purchase orders cannot be modified directly. Use Create Revision.'

type PurchaseOrderLockFields = {
  status?: string | null
  approval_status?: string | null
  has_posted_receipts?: boolean | null
  has_supplier_invoices?: boolean | null
}

function normalizePoFlag(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
}

export function isRecallablePurchaseOrder(
  status?: string | null,
  approvalStatus?: string | null,
): boolean {
  if ((status || '') === 'Void') return false
  const approval = normalizePoFlag(approvalStatus)
  if (['APPROVED', 'PENDING_APPROVAL', 'SUBMITTED', 'PENDING'].includes(approval)) {
    return true
  }
  return status === 'Approved' || status === 'Submitted'
}

export function purchaseOrderLockReason(
  po: PurchaseOrderLockFields,
): string | null {
  if ((po.status || '') === 'Void') {
    return 'Voided purchase orders cannot be edited.'
  }
  if (po.has_posted_receipts) {
    return 'Posted goods receipts exist for this purchase order. Header and line items cannot be edited.'
  }
  if (po.has_supplier_invoices) {
    return 'Supplier invoices exist for this purchase order. Header and line items cannot be edited.'
  }
  const approval = normalizePoFlag(po.approval_status || 'DRAFT')
  const status = po.status || ''
  if (
    ['APPROVED', 'PENDING_APPROVAL', 'SUBMITTED', 'PENDING'].includes(approval) ||
    status === 'Approved' ||
    status === 'Submitted'
  ) {
    if (['PENDING_APPROVAL', 'SUBMITTED', 'PENDING'].includes(approval) || status === 'Submitted') {
      return 'This purchase order is in approval. Use Create Revision to edit.'
    }
    return PURCHASE_ORDER_LOCKED_EDIT_MESSAGE
  }
  return null
}

export function isPurchaseOrderEditable(po: PurchaseOrderLockFields): boolean {
  return purchaseOrderLockReason(po) == null
}

export function purchaseOrderDeleteReason(po: PurchaseOrderLockFields): string | null {
  if (po.has_posted_receipts) {
    return 'Posted goods receipts exist. Open Goods Receipts to view the PU67- receipt and journal.'
  }
  if (po.has_supplier_invoices) {
    return 'Supplier invoices exist for this purchase order. It cannot be deleted.'
  }
  const approval = normalizePoFlag(po.approval_status || 'DRAFT')
  const status = po.status || ''
  if (!['DRAFT', 'REJECTED'].includes(approval) || (status && status !== 'Draft')) {
    return 'Only draft purchase orders with no receipts or invoices can be deleted.'
  }
  return null
}

export function canDeletePurchaseOrder(po: PurchaseOrderLockFields): boolean {
  return purchaseOrderDeleteReason(po) == null
}
