/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { LucideIcon } from 'lucide-react'
import type {
  APBill,
  ARInvoice,
  CashTransaction,
  InventoryStockItem,
  PurchaseOrder,
  SalesOrder,
  StockMovement,
  SubcontractOrder,
} from './index'

export type DashboardRole =
  | 'onboarding'
  | 'executive'
  | 'sales'
  | 'purchasing'
  | 'inventory'
  | 'finance'

export type MetricAccent = 'blue' | 'green' | 'amber' | 'red' | 'teal' | 'gray'

/** Stable keys for KPI card drill-downs */
export type MetricDrillKey =
  | 'total_revenue'
  | 'pending_approvals'
  | 'inventory_value'
  | 'cash_flow'
  | 'open_sales_orders'
  | 'sales_pending_approvals'
  | 'sales_mtd'
  | 'key_accounts'
  | 'open_purchase_orders'
  | 'active_subcontract'
  | 'pending_po_approvals'
  | 'vendor_ontime'
  | 'low_stock'
  | 'total_skus'
  | 'pending_receiving'
  | 'pending_shipment'
  | 'ar_outstanding'
  | 'ap_outstanding'
  | 'overdue_invoices'
  | 'monthly_margin'

export type RevenueDateFilter = 'all' | 'this_month' | 'last_quarter' | 'ytd'

export interface MetricCardModel {
  id: MetricDrillKey | string
  label: string
  value: string | number
  subtext?: string
  accent?: MetricAccent
  icon: LucideIcon
}

export interface QuickAction {
  id: string
  label: string
  to: string
  icon: LucideIcon
}

export interface MonthlyTrendPoint {
  month: string
  label: string
  salesTotal: number
  purchasingTotal: number
}

export interface AuditLogEntry {
  id: number
  table_name: string
  table_label?: string | null
  record_id: string
  record_label?: string | null
  action: string
  action_label?: string | null
  user_id: string | null
  user_name?: string | null
  user_email?: string | null
  changed_at: string
}

export interface DashboardUrgentSummary {
  count: number
  message: string
}

export interface DashboardAggregates {
  salesOrders: SalesOrder[]
  purchaseOrders: PurchaseOrder[]
  subcontractOrders: SubcontractOrder[]
  stock: InventoryStockItem[]
  movements: StockMovement[]
  arInvoices: ARInvoice[]
  apBills: APBill[]
  cashTransactions: CashTransaction[]
  auditLogs: AuditLogEntry[]
  itemsById: Record<string, { unit_price?: number | null }>

  openSalesOrders: number
  pendingSoApprovals: number
  mtdSalesTotal: number
  totalSalesRevenue: number
  recentSalesOrders: SalesOrder[]

  openPurchaseOrders: number
  pendingPoApprovals: number
  mtdPurchasingTotal: number
  pendingPurchaseOrders: PurchaseOrder[]
  activeSubcontractOrders: number

  lowStockCount: number
  outOfStockCount: number
  totalSkus: number
  inventoryValue: number
  pendingReceiving: number
  pendingShipment: number
  reorderItems: InventoryStockItem[]
  recentMovements: StockMovement[]
  shortageItems: InventoryStockItem[]

  arOutstanding: number
  apOutstanding: number
  overdueInvoices: number
  monthlyMargin: number
  pendingArApprovals: ARInvoice[]
  pendingApApprovals: APBill[]
  recentPayments: CashTransaction[]

  cashIn: number
  cashOut: number
  cashNet: number

  monthlyTrend: MonthlyTrendPoint[]
  recentAuditLogs: AuditLogEntry[]
}
