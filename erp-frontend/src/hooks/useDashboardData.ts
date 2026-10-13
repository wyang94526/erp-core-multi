/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  apBillService,
  arInvoiceService,
  auditLogService,
  cashTransactionService,
  inventoryService,
  itemService,
  purchaseOrderService,
  salesOrderService,
  subcontractOrderService,
} from '../api/services'
import { formatMoney } from '../utils/currency'
import type {
  APBill,
  ARInvoice,
  AuditLog,
  CashTransaction,
  InventoryStockItem,
  Item,
  PurchaseOrder,
  SalesOrder,
  StockMovement,
  SubcontractOrder,
} from '../types'
import type { DashboardAggregates, MonthlyTrendPoint } from '../types/dashboard'

const LIST_LIMIT = 100
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function isCurrentMonth(date: Date, now = new Date()): boolean {
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

function isPendingApproval(status: string | null | undefined): boolean {
  return (status || '').toUpperCase() === 'PENDING_APPROVAL'
}

function isOpenSalesOrder(order: SalesOrder): boolean {
  const status = (order.status || '').toUpperCase()
  return !['CANCELLED', 'DELIVERED', 'CLOSED'].includes(status)
}

function isOpenPurchaseOrder(po: PurchaseOrder): boolean {
  return po.status !== 'Void' && po.status !== 'Approved'
}

function isActiveSco(sco: SubcontractOrder): boolean {
  const status = (sco.status || '').toUpperCase()
  return !['COMPLETED', 'CANCELLED'].includes(status)
}

function isOutstanding(status: string): boolean {
  return status === 'Unpaid' || status === 'Partial'
}

function buildMonthlyTrend(
  salesOrders: SalesOrder[],
  purchaseOrders: PurchaseOrder[],
  months = 6,
): MonthlyTrendPoint[] {
  const now = new Date()
  const points: MonthlyTrendPoint[] = []

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = monthKey(d)
    points.push({
      month: key,
      label: MONTH_LABELS[d.getMonth()],
      salesTotal: 0,
      purchasingTotal: 0,
    })
  }

  const index = new Map(points.map((p, i) => [p.month, i]))

  for (const so of salesOrders) {
    const d = parseDate(so.order_date)
    if (!d) continue
    const idx = index.get(monthKey(d))
    if (idx === undefined) continue
    points[idx].salesTotal += toNumber(so.total_amount)
  }

  for (const po of purchaseOrders) {
    const d = parseDate(po.order_date)
    if (!d) continue
    const idx = index.get(monthKey(d))
    if (idx === undefined) continue
    points[idx].purchasingTotal += toNumber(po.grand_total)
  }

  return points
}

function aggregateDashboardData(
  salesOrders: SalesOrder[],
  purchaseOrders: PurchaseOrder[],
  subcontractOrders: SubcontractOrder[],
  stock: InventoryStockItem[],
  movements: StockMovement[],
  arInvoices: ARInvoice[],
  apBills: APBill[],
  cashTransactions: CashTransaction[],
  auditLogs: AuditLog[],
  items: Item[],
): DashboardAggregates {
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)

  const itemsById: Record<string, { unit_price?: number | null }> = {}
  for (const item of items) {
    itemsById[item.item_id] = { unit_price: item.unit_price }
  }

  const openSalesOrders = salesOrders.filter(isOpenSalesOrder).length
  const pendingSoApprovals = salesOrders.filter((o) => isPendingApproval(o.approval_status)).length
  const mtdSalesTotal = salesOrders.reduce((sum, o) => {
    const d = parseDate(o.order_date)
    if (!d || !isCurrentMonth(d, now)) return sum
    return sum + toNumber(o.total_amount)
  }, 0)
  const totalSalesRevenue = salesOrders.reduce((sum, o) => sum + toNumber(o.total_amount), 0)
  const recentSalesOrders = [...salesOrders]
    .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''))
    .slice(0, 8)

  const openPurchaseOrders = purchaseOrders.filter(isOpenPurchaseOrder).length
  const pendingPoApprovals = purchaseOrders.filter((p) => isPendingApproval(p.approval_status)).length
  const mtdPurchasingTotal = purchaseOrders.reduce((sum, p) => {
    const d = parseDate(p.order_date)
    if (!d || !isCurrentMonth(d, now)) return sum
    return sum + toNumber(p.grand_total)
  }, 0)
  const pendingPurchaseOrders = purchaseOrders
    .filter(
      (p) =>
        isPendingApproval(p.approval_status) ||
        p.status === 'Draft' ||
        p.status === 'Submitted',
    )
    .slice(0, 8)
  const activeSubcontractOrders = subcontractOrders.filter(isActiveSco).length

  const lowStockCount = stock.filter((s) => s.status === 'Low Stock').length
  const outOfStockCount = stock.filter((s) => s.status === 'Out of Stock').length
  const totalSkus = stock.length
  const inventoryValue = stock.reduce((sum, s) => {
    const price = toNumber(itemsById[s.item_id]?.unit_price)
    if (price > 0) return sum + price * toNumber(s.on_hand_quantity)
    return sum + toNumber(s.on_hand_quantity)
  }, 0)
  const pendingReceiving = movements.filter((m) => m.movement_type === 'Receipt').length
  const pendingShipment = stock.filter((s) => toNumber(s.allocated_quantity) > 0).length
  const reorderItems = stock
    .filter(
      (s) =>
        s.status === 'Low Stock' ||
        s.status === 'Out of Stock' ||
        toNumber(s.available_to_promise) <= toNumber(s.reorder_point),
    )
    .slice(0, 8)
  const recentMovements = [...movements]
    .sort((a, b) => (b.movement_date || '').localeCompare(a.movement_date || ''))
    .slice(0, 8)
  const shortageItems = stock.filter(
    (s) => s.status === 'Low Stock' || s.status === 'Out of Stock',
  )

  const arOutstanding = arInvoices
    .filter((inv) => isOutstanding(inv.status))
    .reduce((sum, inv) => sum + toNumber(inv.amount), 0)
  const apOutstanding = apBills
    .filter((bill) => isOutstanding(bill.status))
    .reduce((sum, bill) => sum + toNumber(bill.amount), 0)
  const overdueInvoices =
    arInvoices.filter(
      (inv) => isOutstanding(inv.status) && inv.due_date && inv.due_date < todayStr,
    ).length +
    apBills.filter(
      (bill) => isOutstanding(bill.status) && bill.due_date && bill.due_date < todayStr,
    ).length

  const pendingArApprovals = arInvoices.filter((inv) => isPendingApproval(inv.approval_status))
  const pendingApApprovals = apBills.filter((bill) => isPendingApproval(bill.approval_status))
  const recentPayments = [...cashTransactions]
    .sort((a, b) => (b.transaction_date || '').localeCompare(a.transaction_date || ''))
    .slice(0, 8)

  const cashIn = cashTransactions
    .filter((t) => t.type === 'Check Deposit')
    .reduce((sum, t) => sum + toNumber(t.amount), 0)
  const cashOut = cashTransactions
    .filter((t) => t.type === 'Check Issue')
    .reduce((sum, t) => sum + toNumber(t.amount), 0)

  const monthlyTrend = buildMonthlyTrend(salesOrders, purchaseOrders)
  const recentAuditLogs = [...auditLogs]
    .sort((a, b) => (b.changed_at || '').localeCompare(a.changed_at || ''))
    .slice(0, 10)
    .map((log) => ({
      id: log.id,
      table_name: log.table_name,
      table_label: log.table_label,
      record_id: String(log.record_id),
      record_label: log.record_label,
      action: log.action,
      action_label: log.action_label,
      user_id: log.user_id,
      user_name: log.user_name,
      user_email: log.user_email,
      changed_at: log.changed_at,
    }))

  return {
    salesOrders,
    purchaseOrders,
    subcontractOrders,
    stock,
    movements,
    arInvoices,
    apBills,
    cashTransactions,
    auditLogs: recentAuditLogs,
    itemsById,
    openSalesOrders,
    pendingSoApprovals,
    mtdSalesTotal,
    totalSalesRevenue,
    recentSalesOrders,
    openPurchaseOrders,
    pendingPoApprovals,
    mtdPurchasingTotal,
    pendingPurchaseOrders,
    activeSubcontractOrders,
    lowStockCount,
    outOfStockCount,
    totalSkus,
    inventoryValue,
    pendingReceiving,
    pendingShipment,
    reorderItems,
    recentMovements,
    shortageItems,
    arOutstanding,
    apOutstanding,
    overdueInvoices,
    monthlyMargin: mtdSalesTotal - mtdPurchasingTotal,
    pendingArApprovals,
    pendingApApprovals,
    recentPayments,
    cashIn,
    cashOut,
    cashNet: cashIn - cashOut,
    monthlyTrend,
    recentAuditLogs,
  }
}

export function useDashboardData(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  const results = useQueries({
    queries: [
      {
        queryKey: ['dashboard', 'salesOrders'],
        queryFn: () => salesOrderService.listSalesOrders(0, LIST_LIMIT),
        enabled,
      },
      {
        queryKey: ['dashboard', 'purchaseOrders'],
        queryFn: () => purchaseOrderService.listPurchaseOrders(0, LIST_LIMIT),
        enabled,
      },
      {
        queryKey: ['dashboard', 'subcontractOrders'],
        queryFn: () => subcontractOrderService.listSubcontractOrders(0, LIST_LIMIT),
        enabled,
      },
      {
        queryKey: ['dashboard', 'stock'],
        queryFn: () => inventoryService.listStock(),
        enabled,
      },
      {
        queryKey: ['dashboard', 'movements'],
        queryFn: () => inventoryService.listMovements(),
        enabled,
      },
      {
        queryKey: ['dashboard', 'arInvoices'],
        queryFn: () => arInvoiceService.listInvoices(0, LIST_LIMIT),
        enabled,
      },
      {
        queryKey: ['dashboard', 'apBills'],
        queryFn: () => apBillService.listBills(0, LIST_LIMIT),
        enabled,
      },
      {
        queryKey: ['dashboard', 'cashTransactions'],
        queryFn: () => cashTransactionService.listTransactions(0, LIST_LIMIT),
        enabled,
      },
      {
        queryKey: ['dashboard', 'auditLogs'],
        queryFn: () => auditLogService.listAuditLogs(0, 50),
        // Audit endpoint may be empty or restricted; do not fail the whole dashboard.
        retry: false,
        enabled,
      },
      {
        queryKey: ['dashboard', 'items'],
        queryFn: () => itemService.listItems(0, LIST_LIMIT),
        enabled,
      },
    ],
  })

  const [
    salesQ,
    purchaseQ,
    scoQ,
    stockQ,
    movementsQ,
    arQ,
    apQ,
    cashQ,
    auditQ,
    itemsQ,
  ] = results

  const isLoading = results.some((r) => r.isLoading)
  const isError = results.some(
    (r, i) => i !== 8 && r.isError, // index 8 = audit logs (optional)
  )
  const error = results.find((r, i) => i !== 8 && r.isError)?.error

  const data = useMemo(
    () =>
      aggregateDashboardData(
        salesQ.data ?? [],
        purchaseQ.data ?? [],
        scoQ.data ?? [],
        stockQ.data ?? [],
        movementsQ.data ?? [],
        arQ.data ?? [],
        apQ.data ?? [],
        cashQ.data ?? [],
        auditQ.data ?? [],
        itemsQ.data ?? [],
      ),
    [
      salesQ.data,
      purchaseQ.data,
      scoQ.data,
      stockQ.data,
      movementsQ.data,
      arQ.data,
      apQ.data,
      cashQ.data,
      auditQ.data,
      itemsQ.data,
    ],
  )

  return { data, isLoading, isError, error }
}

export function formatCurrency(amount: number, currencyCode?: string | null): string {
  return formatMoney(amount, currencyCode)
}

export function formatCurrencyPrecise(amount: number, currencyCode?: string | null): string {
  return formatMoney(amount, currencyCode, { precise: true })
}
