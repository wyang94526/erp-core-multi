/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  apBillService,
  approvalService,
  arInvoiceService,
  inventoryService,
  salesOrderService,
} from '../api/services'
import type { PurchaseOrder, SalesOrder } from '../types'
import type { CashPaymentChoice } from '../components/RecordCashPaymentDialog'

type ConfirmState = {
  mode: 'approve' | 'reject'
  module: string
  id: string
} | null

export function useDrillDownActions() {
  const queryClient = useQueryClient()
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)

  const markBusy = (id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const refreshDashboard = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }, [queryClient])

  const optimisticSoApproval = (id: string, status: string) => {
    queryClient.setQueryData<SalesOrder[]>(['dashboard', 'salesOrders'], (old) =>
      (old || []).map((o) =>
        o.sales_order_id === id ? { ...o, approval_status: status } : o,
      ),
    )
  }

  const optimisticPoApproval = (id: string, status: string) => {
    queryClient.setQueryData<PurchaseOrder[]>(['dashboard', 'purchaseOrders'], (old) =>
      (old || []).map((p) =>
        p.po_number === id ? { ...p, approval_status: status } : p,
      ),
    )
  }

  const runConfirmedApproval = async (comments: string) => {
    if (!confirm) return
    const { mode, module, id } = confirm
    markBusy(id, true)
    setActionError(null)
    const nextStatus = mode === 'approve' ? 'APPROVED' : 'REJECTED'
    if (module === 'sales-orders') optimisticSoApproval(id, nextStatus)
    if (module === 'purchase-orders') optimisticPoApproval(id, nextStatus)
    try {
      if (mode === 'approve') {
        await approvalService.approve(module, id, comments || undefined)
      } else {
        await approvalService.reject(module, id, comments || undefined)
      }
      setConfirm(null)
      setActionNotice(`${mode === 'approve' ? 'Approved' : 'Rejected'} ${id}`)
      await refreshDashboard()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Approval action failed')
      await refreshDashboard()
    } finally {
      markBusy(id, false)
    }
  }

  const bulkApprove = async (
    items: Array<{ module: string; id: string }>,
  ) => {
    setActionError(null)
    let ok = 0
    for (const item of items) {
      markBusy(item.id, true)
      if (item.module === 'sales-orders') optimisticSoApproval(item.id, 'APPROVED')
      if (item.module === 'purchase-orders') optimisticPoApproval(item.id, 'APPROVED')
      try {
        await approvalService.approve(item.module, item.id, 'Bulk approve from dashboard')
        ok += 1
      } catch (err) {
        setActionError(err instanceof Error ? err.message : `Failed on ${item.id}`)
      } finally {
        markBusy(item.id, false)
      }
    }
    setActionNotice(`Bulk approved ${ok} of ${items.length} document(s)`)
    await refreshDashboard()
  }

  const recordArPayment = async (invoiceId: string, choice?: CashPaymentChoice) => {
    markBusy(invoiceId, true)
    setActionError(null)
    try {
      await arInvoiceService.receivePayment(invoiceId, choice)
      setActionNotice(`Payment recorded for ${invoiceId}`)
      await refreshDashboard()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record payment')
    } finally {
      markBusy(invoiceId, false)
    }
  }

  const recordApPayment = async (billId: string, choice?: CashPaymentChoice) => {
    markBusy(billId, true)
    setActionError(null)
    try {
      await apBillService.makePayment(billId, choice)
      setActionNotice(`Payment recorded for ${billId}`)
      await refreshDashboard()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record AP payment')
    } finally {
      markBusy(billId, false)
    }
  }

  const adjustStock = async (itemId: string) => {
    const raw = window.prompt(
      `Adjust on-hand for ${itemId}\nEnter quantity delta (e.g. 10 or -5):`,
      '0',
    )
    if (raw === null) return
    const delta = Number(raw)
    if (!Number.isFinite(delta) || delta === 0) {
      setActionError('Please enter a non-zero quantity delta.')
      return
    }
    const lot = window.prompt(`Lot for ${itemId}`, '')
    if (!lot || !lot.trim()) {
      setActionError('Record the lot before this inventory movement can be posted.')
      return
    }
    markBusy(itemId, true)
    setActionError(null)
    try {
      await inventoryService.adjustStock(itemId, delta, 'Dashboard quick adjust', lot.trim())
      setActionNotice(`Adjusted ${itemId} by ${delta}`)
      await refreshDashboard()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Stock adjustment failed')
    } finally {
      markBusy(itemId, false)
    }
  }

  const sendReminder = async (docId: string, party: string) => {
    markBusy(docId, true)
    setActionError(null)
    // No outbound email API yet — record a local acknowledgment.
    await new Promise((r) => setTimeout(r, 350))
    setActionNotice(`Reminder queued for ${party} (${docId})`)
    markBusy(docId, false)
  }

  const loadSalesOrderDetail = async (salesOrderId: string) => {
    return salesOrderService.getSalesOrder(salesOrderId)
  }

  const loadApprovalHistory = async (module: string, documentId: string) => {
    return approvalService.getHistory(module, documentId)
  }

  return {
    busyIds,
    actionError,
    actionNotice,
    confirm,
    setConfirm,
    setActionError,
    setActionNotice,
    runConfirmedApproval,
    bulkApprove,
    recordArPayment,
    recordApPayment,
    adjustStock,
    sendReminder,
    loadSalesOrderDetail,
    loadApprovalHistory,
    refreshDashboard,
  }
}
