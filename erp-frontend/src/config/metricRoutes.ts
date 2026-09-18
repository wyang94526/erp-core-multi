/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { MetricDrillKey } from '../types/dashboard'

/**
 * Maps dashboard KPI cards to full list pages with query filters.
 * Prefer real pages over side-panel drill-downs for a cleaner UX.
 */
export function getMetricDestination(key: MetricDrillKey): string {
  switch (key) {
    case 'total_revenue':
      return '/sales-orders?date=all&from=dashboard&metric=total_revenue'
    case 'sales_mtd':
      return '/sales-orders?date=this_month&from=dashboard&metric=sales_mtd'
    case 'open_sales_orders':
      return '/sales-orders?view=open&from=dashboard&metric=open_sales_orders'
    case 'sales_pending_approvals':
    case 'pending_approvals':
      return '/sales-orders?approval=PENDING_APPROVAL&from=dashboard&metric=pending_approvals'
    case 'key_accounts':
      return '/sales-orders?from=dashboard&metric=key_accounts'
    case 'open_purchase_orders':
      return '/purchase-orders?status=open&from=dashboard&metric=open_purchase_orders'
    case 'pending_po_approvals':
      return '/purchase-orders?approval=PENDING_APPROVAL&from=dashboard&metric=pending_po_approvals'
    case 'vendor_ontime':
      return '/purchase-orders?status=Approved&from=dashboard&metric=vendor_ontime'
    case 'active_subcontract':
      return '/subcontract-orders?view=active&from=dashboard&metric=active_subcontract'
    case 'inventory_value':
      return '/inventory?from=dashboard&metric=inventory_value'
    case 'total_skus':
      return '/inventory?from=dashboard&metric=total_skus'
    case 'low_stock':
      return '/inventory?status=Low+Stock&from=dashboard&metric=low_stock'
    case 'pending_receiving':
      return '/inventory/movements?type=Receipt&from=dashboard&metric=pending_receiving'
    case 'pending_shipment':
      return '/inventory?view=allocated&from=dashboard&metric=pending_shipment'
    case 'ar_outstanding':
      return '/accounts-receivable?status=Unpaid&from=dashboard&metric=ar_outstanding'
    case 'overdue_invoices':
      return '/accounts-receivable?due=overdue&from=dashboard&metric=overdue_invoices'
    case 'ap_outstanding':
      return '/accounts-payable?status=Unpaid&from=dashboard&metric=ap_outstanding'
    case 'cash_flow':
      return '/cash-management?from=dashboard&metric=cash_flow'
    case 'monthly_margin':
      return '/sales-orders?date=this_month&from=dashboard&metric=monthly_margin'
    default:
      return '/sales-orders?from=dashboard'
  }
}

export const METRIC_PAGE_TITLES: Partial<Record<MetricDrillKey, string>> = {
  total_revenue: 'Total Revenue — all sales orders',
  sales_mtd: 'Sales month-to-date',
  open_sales_orders: 'Open sales orders',
  sales_pending_approvals: 'Sales orders pending approval',
  pending_approvals: 'Documents pending approval',
  key_accounts: 'Orders by key accounts',
  monthly_margin: 'MTD sales (margin context)',
  open_purchase_orders: 'Open purchase orders',
  pending_po_approvals: 'Purchase orders pending approval',
  vendor_ontime: 'Approved purchase orders (on-time proxy)',
  active_subcontract: 'Active subcontract orders',
  inventory_value: 'Inventory value — stock on hand',
  total_skus: 'All SKUs in stock',
  low_stock: 'Low stock alerts',
  pending_receiving: 'Receipt stock movements',
  pending_shipment: 'Items with open allocations',
  ar_outstanding: 'Outstanding AR invoices',
  overdue_invoices: 'Overdue AR invoices',
  ap_outstanding: 'Outstanding AP bills',
  cash_flow: 'Cash inflows and outflows',
}
