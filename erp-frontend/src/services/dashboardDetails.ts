import type {
  APBill,
  ARInvoice,
  CashTransaction,
  Customer,
  InventoryStockItem,
  PurchaseOrder,
  SalesOrder,
  StockMovement,
  SubcontractOrder,
  Supplier,
} from '../types'
import type {
  DashboardAggregates,
  MetricAccent,
  MetricDrillKey,
  RevenueDateFilter,
} from '../types/dashboard'

export const METRIC_ACCENT_HEX: Record<MetricAccent, string> = {
  blue: '#2196F3',
  green: '#43a047',
  amber: '#fb8c00',
  red: '#ef5350',
  teal: '#00897b',
  gray: '#78909c',
}

export type PendingApprovalDoc = {
  id: string
  module: 'sales-orders' | 'purchase-orders'
  kind: 'SO' | 'PO'
  title: string
  party: string
  amount: number
  date: string
  reason: string
  highValue: boolean
}

export type RevenueRow = {
  sales_order_id: string
  customer_id: string
  customer_name: string
  order_date: string
  amount: number
  status: string
  approval_status: string
  payment_status: string
}

export type InventoryValueRow = {
  item_id: string
  description: string
  on_hand: number
  unit_cost: number
  total_value: number
  warehouse: string
  reorder_point: number
  status: string
  needs_reorder: boolean
}

export type MetricDetailMeta = {
  key: MetricDrillKey
  title: string
  subtitle: string
  accent: MetricAccent
  summaryValue: string
}

export function getMetricMeta(
  key: MetricDrillKey,
  data: DashboardAggregates,
  formatCurrency: (n: number) => string,
): MetricDetailMeta {
  const map: Record<MetricDrillKey, MetricDetailMeta> = {
    total_revenue: {
      key,
      title: 'Total Revenue',
      subtitle: 'Itemized sales order revenue',
      accent: 'blue',
      summaryValue: formatCurrency(data.totalSalesRevenue),
    },
    pending_approvals: {
      key,
      title: 'Pending Approvals',
      subtitle: 'Documents awaiting manager sign-off',
      accent: 'amber',
      summaryValue: String(data.pendingSoApprovals + data.pendingPoApprovals),
    },
    inventory_value: {
      key,
      title: 'Inventory Value',
      subtitle: 'SKU-level valuation breakdown',
      accent: 'teal',
      summaryValue: formatCurrency(data.inventoryValue),
    },
    cash_flow: {
      key,
      title: 'Cash Flow',
      subtitle: 'Inflows, outflows, and receivables',
      accent: 'green',
      summaryValue: formatCurrency(data.cashNet),
    },
    open_sales_orders: {
      key,
      title: 'Open Sales Orders',
      subtitle: 'Status-filtered sales orders',
      accent: 'blue',
      summaryValue: String(data.openSalesOrders),
    },
    sales_pending_approvals: {
      key,
      title: 'Pending Sales Approvals',
      subtitle: 'Sales orders awaiting approval',
      accent: 'amber',
      summaryValue: String(data.pendingSoApprovals),
    },
    sales_mtd: {
      key,
      title: 'Sales Month-to-Date',
      subtitle: 'Orders dated this calendar month',
      accent: 'green',
      summaryValue: formatCurrency(data.mtdSalesTotal),
    },
    key_accounts: {
      key,
      title: 'Key Account Activity',
      subtitle: 'Customers with recent order activity',
      accent: 'teal',
      summaryValue: String(new Set(data.salesOrders.map((o) => o.customer_id)).size),
    },
    open_purchase_orders: {
      key,
      title: 'Open Purchase Orders',
      subtitle: 'Draft / submitted POs',
      accent: 'blue',
      summaryValue: String(data.openPurchaseOrders),
    },
    active_subcontract: {
      key,
      title: 'Active Subcontract Orders',
      subtitle: 'In-progress outside processing',
      accent: 'teal',
      summaryValue: String(data.activeSubcontractOrders),
    },
    pending_po_approvals: {
      key,
      title: 'Pending PO Approvals',
      subtitle: 'Purchase orders awaiting sign-off',
      accent: 'amber',
      summaryValue: String(data.pendingPoApprovals),
    },
    vendor_ontime: {
      key,
      title: 'Vendor Performance',
      subtitle: 'Approved vs non-void purchase orders',
      accent: 'green',
      summaryValue: 'On-time proxy',
    },
    low_stock: {
      key,
      title: 'Low Stock Alerts',
      subtitle: 'SKUs below reorder thresholds',
      accent: 'amber',
      summaryValue: String(data.lowStockCount + data.outOfStockCount),
    },
    total_skus: {
      key,
      title: 'Total SKUs',
      subtitle: 'Stock overview by item',
      accent: 'blue',
      summaryValue: String(data.totalSkus),
    },
    pending_receiving: {
      key,
      title: 'Items Pending Receiving',
      subtitle: 'Recent receipt movements',
      accent: 'teal',
      summaryValue: String(data.pendingReceiving),
    },
    pending_shipment: {
      key,
      title: 'Items Pending Shipment',
      subtitle: 'SKUs with open allocations',
      accent: 'red',
      summaryValue: String(data.pendingShipment),
    },
    ar_outstanding: {
      key,
      title: 'Accounts Receivable',
      subtitle: 'Unpaid and partial invoices',
      accent: 'blue',
      summaryValue: formatCurrency(data.arOutstanding),
    },
    ap_outstanding: {
      key,
      title: 'Accounts Payable',
      subtitle: 'Unpaid and partial bills',
      accent: 'teal',
      summaryValue: formatCurrency(data.apOutstanding),
    },
    overdue_invoices: {
      key,
      title: 'Overdue Invoices',
      subtitle: 'Past-due AR and AP documents',
      accent: 'red',
      summaryValue: String(data.overdueInvoices),
    },
    monthly_margin: {
      key,
      title: 'Monthly Margin',
      subtitle: 'MTD sales minus MTD purchasing',
      accent: 'green',
      summaryValue: formatCurrency(data.monthlyMargin),
    },
  }
  return map[key]
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function filterOrdersByRevenueDate(
  orders: SalesOrder[],
  filter: RevenueDateFilter,
  now = new Date(),
): SalesOrder[] {
  if (filter === 'all') return orders
  const y = now.getFullYear()
  const m = now.getMonth()

  return orders.filter((o) => {
    const d = parseDate(o.order_date)
    if (!d) return false
    if (filter === 'this_month') {
      return d.getFullYear() === y && d.getMonth() === m
    }
    if (filter === 'ytd') {
      return d.getFullYear() === y && d <= now
    }
    // last_quarter: previous full calendar quarter
    const currentQuarter = Math.floor(m / 3)
    const lastQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1
    const lastQuarterYear = currentQuarter === 0 ? y - 1 : y
    const start = new Date(lastQuarterYear, lastQuarter * 3, 1)
    const end = new Date(lastQuarterYear, lastQuarter * 3 + 3, 0, 23, 59, 59)
    return d >= start && d <= end
  })
}

export function buildRevenueRows(
  data: DashboardAggregates,
  customers: Customer[],
  filter: RevenueDateFilter = 'all',
): RevenueRow[] {
  const nameById = new Map(customers.map((c) => [c.customer_id, c.company_name]))
  const arBySo = new Map(data.arInvoices.map((inv) => [inv.sales_order_id, inv]))

  return filterOrdersByRevenueDate(data.salesOrders, filter)
    .slice()
    .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''))
    .map((o) => {
      const inv = arBySo.get(o.sales_order_id)
      return {
        sales_order_id: o.sales_order_id,
        customer_id: o.customer_id,
        customer_name: nameById.get(o.customer_id) || o.customer_id,
        order_date: o.order_date,
        amount: Number(o.total_amount) || 0,
        status: o.status,
        approval_status: o.approval_status || 'DRAFT',
        payment_status: inv?.status || 'No Invoice',
      }
    })
}

export function buildPendingApprovalDocs(data: DashboardAggregates): PendingApprovalDoc[] {
  const HIGH_VALUE = 10_000
  const sos: PendingApprovalDoc[] = data.salesOrders
    .filter((o) => (o.approval_status || '').toUpperCase() === 'PENDING_APPROVAL')
    .map((o) => {
      const amount = Number(o.total_amount) || 0
      const highValue = amount >= HIGH_VALUE
      return {
        id: o.sales_order_id,
        module: 'sales-orders' as const,
        kind: 'SO' as const,
        title: o.sales_order_id,
        party: o.customer_id,
        amount,
        date: o.order_date,
        reason: highValue ? 'High-value SO (≥ $10k) requiring manager sign-off' : 'Awaiting approval',
        highValue,
      }
    })

  const pos: PendingApprovalDoc[] = data.purchaseOrders
    .filter((p) => (p.approval_status || '').toUpperCase() === 'PENDING_APPROVAL')
    .map((p) => {
      const amount = Number(p.grand_total) || 0
      return {
        id: p.po_number,
        module: 'purchase-orders' as const,
        kind: 'PO' as const,
        title: p.po_number,
        party: p.supplier_name || p.supplier_id,
        amount,
        date: p.order_date,
        reason: 'Purchase order requiring manager sign-off',
        highValue: amount >= HIGH_VALUE,
      }
    })

  return [...sos, ...pos].sort((a, b) => b.amount - a.amount)
}

export function buildInventoryValueRows(data: DashboardAggregates): InventoryValueRow[] {
  return data.stock
    .map((s) => {
      const unit = Number(data.itemsById[s.item_id]?.unit_price) || 0
      const onHand = Number(s.on_hand_quantity) || 0
      const total = unit > 0 ? unit * onHand : onHand
      const needsReorder =
        s.status === 'Low Stock' ||
        s.status === 'Out of Stock' ||
        onHand <= Number(s.reorder_point || 0)
      return {
        item_id: s.item_id,
        description: s.description || '—',
        on_hand: onHand,
        unit_cost: unit,
        total_value: total,
        warehouse: `${s.primary_warehouse_code || '—'} / ${s.primary_bin_code || '—'}`,
        reorder_point: Number(s.reorder_point) || 0,
        status: s.status,
        needs_reorder: needsReorder,
      }
    })
    .sort((a, b) => b.total_value - a.total_value)
}

export function filterSalesByStatus(orders: SalesOrder[], status: string | 'ALL'): SalesOrder[] {
  if (status === 'ALL') return orders
  return orders.filter((o) => (o.status || '').toUpperCase() === status.toUpperCase())
}

export function filterPurchaseByStatus(
  orders: PurchaseOrder[],
  status: string | 'ALL',
): PurchaseOrder[] {
  if (status === 'ALL') return orders
  return orders.filter((o) => (o.status || '').toLowerCase() === status.toLowerCase())
}

export function activeSubcontracts(orders: SubcontractOrder[]): SubcontractOrder[] {
  return orders.filter((o) => {
    const s = (o.status || '').toUpperCase()
    return !['COMPLETED', 'CANCELLED'].includes(s)
  })
}

export function overdueAr(data: DashboardAggregates, today = new Date().toISOString().slice(0, 10)): ARInvoice[] {
  return data.arInvoices.filter(
    (inv) =>
      (inv.status === 'Unpaid' || inv.status === 'Partial') &&
      inv.due_date &&
      inv.due_date < today,
  )
}

export function overdueAp(data: DashboardAggregates, today = new Date().toISOString().slice(0, 10)): APBill[] {
  return data.apBills.filter(
    (bill) =>
      (bill.status === 'Unpaid' || bill.status === 'Partial') &&
      bill.due_date &&
      bill.due_date < today,
  )
}

export function upcomingApPayouts(data: DashboardAggregates, today = new Date().toISOString().slice(0, 10)): APBill[] {
  return data.apBills
    .filter(
      (bill) =>
        (bill.status === 'Unpaid' || bill.status === 'Partial') &&
        bill.due_date &&
        bill.due_date >= today,
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
}

export function allocatedStock(data: DashboardAggregates): InventoryStockItem[] {
  return data.stock.filter((s) => Number(s.allocated_quantity) > 0)
}

export function receiptMovements(data: DashboardAggregates): StockMovement[] {
  return data.movements
    .filter((m) => m.movement_type === 'Receipt')
    .sort((a, b) => (b.movement_date || '').localeCompare(a.movement_date || ''))
}

export function buildCustomerActivity(
  data: DashboardAggregates,
  customers: Customer[],
): Array<{ customer_id: string; customer_name: string; order_count: number; total: number }> {
  const nameById = new Map(customers.map((c) => [c.customer_id, c.company_name]))
  const map = new Map<string, { order_count: number; total: number }>()
  for (const o of data.salesOrders) {
    const cur = map.get(o.customer_id) || { order_count: 0, total: 0 }
    cur.order_count += 1
    cur.total += Number(o.total_amount) || 0
    map.set(o.customer_id, cur)
  }
  return [...map.entries()]
    .map(([customer_id, v]) => ({
      customer_id,
      customer_name: nameById.get(customer_id) || customer_id,
      ...v,
    }))
    .sort((a, b) => b.total - a.total)
}

export function exportRevenueCsv(rows: RevenueRow[]): void {
  const header = [
    'SO Number',
    'Customer',
    'Customer ID',
    'Date',
    'Amount',
    'Status',
    'Approval',
    'Payment Status',
  ]
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.sales_order_id,
        `"${r.customer_name.replace(/"/g, '""')}"`,
        r.customer_id,
        r.order_date,
        r.amount,
        r.status,
        r.approval_status,
        r.payment_status,
      ].join(','),
    ),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `grandtek-revenue-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function vendorName(vendors: Supplier[], supplierId: string, fallback?: string): string {
  return vendors.find((v) => v.supplier_id === supplierId)?.company_name || fallback || supplierId
}

export function recentCash(data: DashboardAggregates): CashTransaction[] {
  return [...data.cashTransactions].sort((a, b) =>
    (b.transaction_date || '').localeCompare(a.transaction_date || ''),
  )
}
