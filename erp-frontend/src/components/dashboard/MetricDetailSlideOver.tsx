/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Download,
  Expand,
  Shrink,
  X,
} from 'lucide-react'
import { cashReferenceHref, cashReferenceLabel } from '../../utils/cashReference'
import { useAuth } from '../../context/AuthContext'
import { formatCurrency, formatCurrencyPrecise } from '../../hooks/useDashboardData'
import { useDrillDownActions } from '../../hooks/useDrillDownActions'
import { RecordCashPaymentDialog } from '../RecordCashPaymentDialog'
import {
  activeSubcontracts,
  allocatedStock,
  buildCustomerActivity,
  buildInventoryValueRows,
  buildPendingApprovalDocs,
  buildRevenueRows,
  exportRevenueCsv,
  filterPurchaseByStatus,
  filterSalesByStatus,
  getMetricMeta,
  METRIC_ACCENT_HEX,
  overdueAp,
  overdueAr,
  receiptMovements,
  recentCash,
  upcomingApPayouts,
  type InventoryValueRow,
  type PendingApprovalDoc,
  type RevenueRow,
} from '../../services/dashboardDetails'
import type { ApprovalHistory, Customer, SalesOrder, Supplier } from '../../types'
import type {
  DashboardAggregates,
  MetricDrillKey,
  RevenueDateFilter,
} from '../../types/dashboard'
import ApprovalActionModal from '../ApprovalActionModal'
import InteractiveTransactionTable from './InteractiveTransactionTable'
import StatusBadge from './StatusBadge'
import {
  isSalesOrderEditable,
  salesOrderEditPath,
  SALES_ORDER_LOCKED_EDIT_MESSAGE,
} from '../../utils/salesOrders'
import {
  directoryTableStyle,
  directoryTbodyRowStyle,
  directoryTdStyle,
  directoryThStyle,
  directoryTheadRowStyle,
  emptyStateStyle,
  linkStyle,
  primaryButtonStyle,
} from './dashboardStyles'

type DrawerTab = 'summary' | 'audit' | 'quick_edit'

type MetricDetailSlideOverProps = {
  open: boolean
  metricKey: MetricDrillKey | null
  data: DashboardAggregates
  customers: Customer[]
  vendors: Supplier[]
  onClose: () => void
}

const SO_STATUSES = ['ALL', 'DRAFT', 'RECEIVED', 'APPROVED', 'SHIPPED', 'PENDING', 'PROCESSING']
const PO_STATUSES = ['ALL', 'Draft', 'Submitted', 'Approved', 'Void']

export default function MetricDetailSlideOver({
  open,
  metricKey,
  data,
  customers,
  vendors,
  onClose,
}: MetricDetailSlideOverProps) {
  const titleId = useId()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const actions = useDrillDownActions()

  const [wide, setWide] = useState(false)
  const [tab, setTab] = useState<DrawerTab>('summary')
  const [revenueFilter, setRevenueFilter] = useState<RevenueDateFilter>('all')
  const [soStatus, setSoStatus] = useState('ALL')
  const [poStatus, setPoStatus] = useState('ALL')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailCache, setDetailCache] = useState<Record<string, SalesOrder>>({})
  const [auditCache, setAuditCache] = useState<Record<string, ApprovalHistory[]>>({})
  const [quickEditNotes, setQuickEditNotes] = useState('')
  const [payRequest, setPayRequest] = useState<{ kind: 'AR' | 'AP'; id: string; amount?: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (actions.confirm) return
        if (expandedId) {
          setExpandedId(null)
          return
        }
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, expandedId, actions.confirm])

  useEffect(() => {
    if (!open) return
    setTab('summary')
    setWide(false)
    setRevenueFilter('all')
    setSoStatus('ALL')
    setPoStatus('ALL')
    setSelectedIds(new Set())
    setExpandedId(null)
    setQuickEditNotes('')
    setPayRequest(null)
    actions.setActionError(null)
    actions.setActionNotice(null)
    actions.setConfirm(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, metricKey])

  const meta = useMemo(
    () => (metricKey ? getMetricMeta(metricKey, data, formatCurrency) : null),
    [metricKey, data],
  )

  const ensureSoDetail = async (id: string) => {
    if (detailCache[id]) return detailCache[id]
    const so = await actions.loadSalesOrderDetail(id)
    setDetailCache((prev) => ({ ...prev, [id]: so }))
    return so
  }

  const ensureAudit = async (module: string, id: string) => {
    const key = `${module}:${id}`
    if (auditCache[key]) return auditCache[key]
    try {
      const hist = await actions.loadApprovalHistory(module, id)
      setAuditCache((prev) => ({ ...prev, [key]: hist }))
      return hist
    } catch {
      setAuditCache((prev) => ({ ...prev, [key]: [] }))
      return []
    }
  }

  if (!open || !metricKey || !meta) return null

  const accent = METRIC_ACCENT_HEX[meta.accent]

  const canApproveModule = (module: string) => {
    if (module === 'sales-orders') return hasPermission('sales_order:approve')
    if (module === 'purchase-orders') return hasPermission('po:approve')
    return false
  }

  const revenueRows =
    metricKey === 'sales_mtd'
      ? buildRevenueRows(data, customers, 'this_month')
      : buildRevenueRows(data, customers, revenueFilter)

  const pendingDocs = buildPendingApprovalDocs(data).filter((d) => {
    if (metricKey === 'sales_pending_approvals') return d.kind === 'SO'
    if (metricKey === 'pending_po_approvals') return d.kind === 'PO'
    return true
  })

  const inventoryRows = buildInventoryValueRows(data).filter((r) =>
    metricKey === 'low_stock' ? r.needs_reorder : true,
  )

  const selectedPending = pendingDocs.filter((d) => selectedIds.has(d.id))

  const bulkBar =
    selectedIds.size > 0 ? (
      <div style={bulkBarStyle}>
        <span style={{ fontWeight: 600, color: 'var(--text-h)' }}>
          {selectedIds.size} selected
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(metricKey === 'total_revenue' || metricKey === 'sales_mtd') && (
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={() =>
                exportRevenueCsv(revenueRows.filter((r) => selectedIds.has(r.sales_order_id)))
              }
            >
              <Download size={14} /> Bulk Export CSV
            </button>
          )}
          {(metricKey === 'pending_approvals' ||
            metricKey === 'sales_pending_approvals' ||
            metricKey === 'pending_po_approvals') && (
            <button
              type="button"
              style={{ ...primaryButtonStyle, backgroundColor: '#2e7d32' }}
              onClick={() => {
                if (!window.confirm(`Bulk approve ${selectedPending.length} document(s)?`)) return
                void actions.bulkApprove(
                  selectedPending.map((d) => ({ module: d.module, id: d.id })),
                )
                setSelectedIds(new Set())
              }}
            >
              Bulk Approve
            </button>
          )}
          <button
            type="button"
            style={{ ...primaryButtonStyle, backgroundColor: '#78909c' }}
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </button>
        </div>
      </div>
    ) : null

  const renderSummary = () => {
    if (metricKey === 'total_revenue' || metricKey === 'sales_mtd') {
      return (
        <RevenueInteractivePanel
          rows={revenueRows}
          filter={metricKey === 'sales_mtd' ? 'this_month' : revenueFilter}
          onFilterChange={setRevenueFilter}
          showFilters={metricKey === 'total_revenue'}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          expandedId={expandedId}
          onExpandedChange={(id) => {
            setExpandedId(id)
            if (id) void ensureSoDetail(id)
          }}
          detailCache={detailCache}
          data={data}
          busyIds={actions.busyIds}
          onMarkPaid={(invoiceId) => {
            const inv = data.arInvoices.find((i) => i.invoice_id === invoiceId)
            setPayRequest({ kind: 'AR', id: invoiceId, amount: inv?.amount })
          }}
          onOpenOrder={(id) => {
            navigate(`/orders/${id}`)
            onClose()
          }}
          onSendReminder={(row) => void actions.sendReminder(row.sales_order_id, row.customer_name)}
        />
      )
    }

    if (
      metricKey === 'pending_approvals' ||
      metricKey === 'sales_pending_approvals' ||
      metricKey === 'pending_po_approvals'
    ) {
      return (
        <ApprovalsInteractivePanel
          docs={pendingDocs}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          expandedId={expandedId}
          onExpandedChange={(id) => {
            setExpandedId(id)
            const doc = pendingDocs.find((d) => d.id === id)
            if (doc) void ensureAudit(doc.module, doc.id)
          }}
          auditCache={auditCache}
          busyIds={actions.busyIds}
          canApprove={canApproveModule}
          onApprove={(module, id) => actions.setConfirm({ mode: 'approve', module, id })}
          onReject={(module, id) => actions.setConfirm({ mode: 'reject', module, id })}
          onRequestEdit={(doc) => {
            if (doc.kind === 'SO') {
              window.alert(SALES_ORDER_LOCKED_EDIT_MESSAGE)
              navigate(`/orders/${doc.id}`)
            } else {
              navigate(`/purchase-orders/${doc.id}`)
            }
            onClose()
          }}
        />
      )
    }

    if (
      metricKey === 'inventory_value' ||
      metricKey === 'total_skus' ||
      metricKey === 'low_stock'
    ) {
      return (
        <InventoryInteractivePanel
          rows={inventoryRows}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          expandedId={expandedId}
          onExpandedChange={setExpandedId}
          busyIds={actions.busyIds}
          onAdjust={(id) => void actions.adjustStock(id)}
          onReorder={() => {
            navigate('/purchase-orders/new')
            onClose()
          }}
          onViewLogs={() => {
            navigate('/inventory/movements')
            onClose()
          }}
        />
      )
    }

    if (
      metricKey === 'cash_flow' ||
      metricKey === 'ar_outstanding' ||
      metricKey === 'ap_outstanding' ||
      metricKey === 'overdue_invoices' ||
      metricKey === 'monthly_margin'
    ) {
      return (
        <CashFinanceInteractivePanel
          metricKey={metricKey}
          data={data}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          expandedId={expandedId}
          onExpandedChange={setExpandedId}
          busyIds={actions.busyIds}
          onRecordAr={(id, amount) => setPayRequest({ kind: 'AR', id, amount })}
          onRecordAp={(id, amount) => setPayRequest({ kind: 'AP', id, amount })}
          onRemind={(id, party) => void actions.sendReminder(id, party)}
        />
      )
    }

    if (metricKey === 'open_sales_orders') {
      return (
        <SalesOrdersInteractivePanel
          orders={filterSalesByStatus(data.salesOrders, soStatus)}
          status={soStatus}
          onStatusChange={setSoStatus}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          expandedId={expandedId}
          onExpandedChange={(id) => {
            setExpandedId(id)
            if (id) void ensureSoDetail(id)
          }}
          detailCache={detailCache}
          busyIds={actions.busyIds}
          canApprove={canApproveModule('sales-orders')}
          onApprove={(id) =>
            actions.setConfirm({ mode: 'approve', module: 'sales-orders', id })
          }
          onReject={(id) =>
            actions.setConfirm({ mode: 'reject', module: 'sales-orders', id })
          }
        />
      )
    }

    if (metricKey === 'key_accounts') {
      return <KeyAccountsPanel rows={buildCustomerActivity(data, customers)} />
    }

    if (metricKey === 'open_purchase_orders' || metricKey === 'vendor_ontime') {
      return (
        <PurchaseOrdersPanel
          orders={
            metricKey === 'vendor_ontime'
              ? data.purchaseOrders.filter((p) => p.status !== 'Void')
              : filterPurchaseByStatus(data.purchaseOrders, poStatus)
          }
          status={poStatus}
          onStatusChange={setPoStatus}
          showStatusFilter={metricKey === 'open_purchase_orders'}
          vendors={vendors}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          expandedId={expandedId}
          onExpandedChange={setExpandedId}
          canApprove={canApproveModule('purchase-orders')}
          busyIds={actions.busyIds}
          onApprove={(id) =>
            actions.setConfirm({ mode: 'approve', module: 'purchase-orders', id })
          }
          onReject={(id) =>
            actions.setConfirm({ mode: 'reject', module: 'purchase-orders', id })
          }
        />
      )
    }

    if (metricKey === 'active_subcontract') {
      return <SubcontractPanel orders={activeSubcontracts(data.subcontractOrders)} />
    }
    if (metricKey === 'pending_receiving') {
      return <MovementsPanel movements={receiptMovements(data)} />
    }
    if (metricKey === 'pending_shipment') {
      return <AllocatedPanel items={allocatedStock(data)} />
    }
    return <div style={emptyStateStyle}>No interactive detail for this metric.</div>
  }

  const renderAudit = () => {
    if (!expandedId) {
      return (
        <div style={emptyStateStyle}>
          Expand a row in Summary, then open Audit Trail to load its approval history.
          {data.recentAuditLogs.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: '0 0 8px', color: 'var(--text-h)' }}>Recent system activity</h4>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)', fontSize: '0.85rem' }}>
                {data.recentAuditLogs.slice(0, 8).map((log) => (
                  <li key={log.id}>
                    {log.changed_at ? new Date(log.changed_at).toLocaleString() : '—'} ·{' '}
                    {log.table_name} · {log.action}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )
    }

    const pending = pendingDocs.find((d) => d.id === expandedId)
    const module = pending?.module || 'sales-orders'
    const hist = auditCache[`${module}:${expandedId}`] || []

    if (hist.length === 0) {
      return (
        <div style={emptyStateStyle}>
          No approval history for <strong>{expandedId}</strong> yet.
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={() => void ensureAudit(module, expandedId)}
            >
              Refresh history
            </button>
          </div>
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h4 style={{ margin: 0, color: 'var(--text-h)' }}>Audit trail · {expandedId}</h4>
        {hist.map((h) => (
          <div
            key={h.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              background: 'var(--bg)',
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--text-h)' }}>{h.action}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text)', marginTop: 4 }}>
              {h.created_at ? new Date(h.created_at).toLocaleString() : '—'}
              {h.actor_name || h.actor_user_id ? ` · ${h.actor_name || h.actor_user_id}` : ''}
            </div>
            {h.comments ? (
              <div style={{ fontSize: '0.85rem', marginTop: 6 }}>{h.comments}</div>
            ) : null}
          </div>
        ))}
      </div>
    )
  }

  const renderQuickEdit = () => {
    if (!expandedId) {
      return (
        <div style={emptyStateStyle}>
          Select/expand a transaction in Summary to enable Quick Edit.
        </div>
      )
    }

    const pending = pendingDocs.find((d) => d.id === expandedId)
    const revenue = revenueRows.find((r) => r.sales_order_id === expandedId)
    const inv = inventoryRows.find((r) => r.item_id === expandedId)

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 480 }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text)' }}>Selected document</div>
          <div style={{ fontWeight: 700, color: 'var(--text-h)', fontSize: '1.05rem' }}>
            {expandedId}
          </div>
        </div>

        {pending ? (
          <>
            <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.9rem' }}>
              Update approval workflow for this {pending.kind}. Changes apply immediately with
              optimistic UI, then sync to the API.
            </p>
            <label style={labelStyle}>
              Notes / comments
              <textarea
                value={quickEditNotes}
                onChange={(e) => setQuickEditNotes(e.target.value)}
                rows={3}
                style={textareaStyle}
                placeholder="Optional notes for the approval action…"
              />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canApproveModule(pending.module) ? (
                <>
                  <button
                    type="button"
                    style={{ ...primaryButtonStyle, backgroundColor: '#2e7d32' }}
                    disabled={actions.busyIds.has(pending.id)}
                    onClick={() =>
                      actions.setConfirm({
                        mode: 'approve',
                        module: pending.module,
                        id: pending.id,
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    style={{ ...primaryButtonStyle, backgroundColor: '#c62828' }}
                    disabled={actions.busyIds.has(pending.id)}
                    onClick={() =>
                      actions.setConfirm({
                        mode: 'reject',
                        module: pending.module,
                        id: pending.id,
                      })
                    }
                  >
                    Reject
                  </button>
                </>
              ) : null}
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => {
                  if (pending.kind === 'SO') {
                    window.alert(SALES_ORDER_LOCKED_EDIT_MESSAGE)
                    navigate(`/orders/${pending.id}`)
                  } else {
                    navigate(`/purchase-orders/${pending.id}`)
                  }
                  onClose()
                }}
              >
                Open full editor
              </button>
            </div>
          </>
        ) : null}

        {revenue ? (
          <>
            <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.9rem' }}>
              Payment status: <StatusBadge status={revenue.payment_status} />
            </p>
            {revenue.payment_status === 'Unpaid' || revenue.payment_status === 'Partial' ? (
              <button
                type="button"
                style={{ ...primaryButtonStyle, backgroundColor: '#2e7d32' }}
                disabled={actions.busyIds.has(
                  data.arInvoices.find((i) => i.sales_order_id === revenue.sales_order_id)
                    ?.invoice_id || '',
                )}
                onClick={() => {
                  const inv = data.arInvoices.find(
                    (i) => i.sales_order_id === revenue.sales_order_id,
                  )
                  if (inv?.invoice_id) setPayRequest({ kind: 'AR', id: inv.invoice_id, amount: inv.amount })
                  else actions.setActionError('No AR invoice exists for this sales order yet.')
                }}
              >
                Mark invoice Paid
              </button>
            ) : (
              <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
                No unpaid invoice action available for this order.
              </div>
            )}
            <Link to={`/orders/${revenue.sales_order_id}`} style={linkStyle} onClick={onClose}>
              Open sales order →
            </Link>
          </>
        ) : null}

        {inv ? (
          <>
            <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.9rem' }}>
              On hand {inv.on_hand} · Reorder point {inv.reorder_point}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={primaryButtonStyle}
                disabled={actions.busyIds.has(inv.item_id)}
                onClick={() => void actions.adjustStock(inv.item_id)}
              >
                Adjust stock
              </button>
              <button
                type="button"
                style={{ ...primaryButtonStyle, backgroundColor: '#00897b' }}
                onClick={() => {
                  navigate('/purchase-orders/new')
                  onClose()
                }}
              >
                Reorder (Create PO)
              </button>
            </div>
          </>
        ) : null}

        {!pending && !revenue && !inv ? (
          <div style={emptyStateStyle}>
            Quick Edit supports approvals, revenue/payment, and inventory rows for the expanded
            document.
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <div style={backdropStyle} onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          ...panelStyle,
          width: wide ? 'min(920px, 100vw)' : 'min(560px, 100vw)',
          transition: 'width 180ms ease',
        }}
      >
        <header
          style={{
            ...headerStyle,
            background: `linear-gradient(135deg, ${accent}22 0%, ${accent}08 55%, var(--bg) 100%)`,
            borderBottom: `1px solid ${accent}44`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: accent, letterSpacing: '0.04em' }}>
              KPI DRILL-DOWN
            </div>
            <h2 id={titleId} style={{ margin: '4px 0 0', fontSize: '1.25rem', color: 'var(--text-h)' }}>
              {meta.title}
            </h2>
            <p style={{ margin: '6px 0 0', color: 'var(--text)', fontSize: '0.875rem' }}>
              {meta.subtitle}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ textAlign: 'right', marginRight: 4 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text)' }}>Summary</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: accent }}>
                {meta.summaryValue}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setWide((v) => !v)}
              aria-label={wide ? 'Collapse drawer width' : 'Expand drawer width'}
              title={wide ? 'Narrow panel' : 'Widen panel'}
              style={iconBtnStyle}
            >
              {wide ? <Shrink size={16} /> : <Expand size={16} />}
            </button>
            <button type="button" onClick={onClose} aria-label="Close details" style={iconBtnStyle}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div style={tabsRowStyle} role="tablist" aria-label="Drill-down views">
          {(
            [
              ['summary', 'Summary Table'],
              ['audit', 'Audit Trail'],
              ['quick_edit', 'Quick Edit'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              style={tabStyle(tab === key, accent)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={bodyStyle}>
          {actions.actionError ? (
            <div style={{ color: '#c62828', marginBottom: 12, fontSize: '0.875rem' }}>
              {actions.actionError}
            </div>
          ) : null}
          {actions.actionNotice ? (
            <div style={{ color: '#2e7d32', marginBottom: 12, fontSize: '0.875rem' }}>
              {actions.actionNotice}
            </div>
          ) : null}

          {tab === 'summary' ? (
            <>
              {bulkBar}
              {renderSummary()}
            </>
          ) : null}
          {tab === 'audit' ? renderAudit() : null}
          {tab === 'quick_edit' ? renderQuickEdit() : null}
        </div>
      </aside>

      <ApprovalActionModal
        mode={actions.confirm?.mode || 'approve'}
        open={Boolean(actions.confirm)}
        busy={Boolean(actions.confirm && actions.busyIds.has(actions.confirm.id))}
        onClose={() => actions.setConfirm(null)}
        onConfirm={(comments) => {
          const notes = quickEditNotes.trim()
          void actions.runConfirmedApproval(comments || notes)
        }}
      />
      <RecordCashPaymentDialog
        open={Boolean(payRequest)}
        title={payRequest?.kind === 'AP' ? `Pay ${payRequest.id}` : `Receive payment for ${payRequest?.id || ''}`}
        subtitle={
          payRequest?.kind === 'AP'
            ? 'Choose the bank account and payment instrument for this disbursement.'
            : 'Choose the bank account and payment instrument for this deposit.'
        }
        amount={payRequest?.amount}
        confirmLabel={payRequest?.kind === 'AP' ? 'Make Payment' : 'Receive Payment'}
        submitting={Boolean(payRequest && actions.busyIds.has(payRequest.id))}
        onCancel={() => setPayRequest(null)}
        onConfirm={async (choice) => {
          if (!payRequest) return
          if (payRequest.kind === 'AP') {
            await actions.recordApPayment(payRequest.id, choice)
          } else {
            await actions.recordArPayment(payRequest.id, choice)
          }
          setPayRequest(null)
        }}
      />
    </>
  )
}

/* ─── Interactive panels ─────────────────────────────────────────── */

function RevenueInteractivePanel({
  rows,
  filter,
  onFilterChange,
  showFilters,
  selectedIds,
  onSelectionChange,
  expandedId,
  onExpandedChange,
  detailCache,
  data,
  busyIds,
  onMarkPaid,
  onOpenOrder,
  onSendReminder,
}: {
  rows: RevenueRow[]
  filter: RevenueDateFilter
  onFilterChange: (f: RevenueDateFilter) => void
  showFilters: boolean
  selectedIds: Set<string>
  onSelectionChange: (s: Set<string>) => void
  expandedId: string | null
  onExpandedChange: (id: string | null) => void
  detailCache: Record<string, SalesOrder>
  data: DashboardAggregates
  busyIds: Set<string>
  onMarkPaid: (invoiceId: string) => void
  onOpenOrder: (id: string) => void
  onSendReminder: (row: RevenueRow) => void
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return (
    <section>
      <div style={toolbarStyle}>
        {showFilters ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(
              [
                ['all', 'All'],
                ['this_month', 'This Month'],
                ['last_quarter', 'Last Quarter'],
                ['ytd', 'YTD'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onFilterChange(key)}
                style={chipStyle(filter === key)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>Showing this month</div>
        )}
        <button
          type="button"
          style={{ ...primaryButtonStyle, backgroundColor: '#1565c0' }}
          onClick={() => exportRevenueCsv(rows)}
        >
          <Download size={16} /> Export CSV
        </button>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text)', marginTop: 0 }}>
        {rows.length} orders · {formatCurrencyPrecise(total)} · click a row to expand line items
      </p>
      <InteractiveTransactionTable
        rows={rows}
        getRowId={(r) => r.sales_order_id}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        expandedId={expandedId}
        onExpandedChange={onExpandedChange}
        busyIds={busyIds}
        columns={[
          {
            key: 'so',
            header: 'SO #',
            render: (r) => <span style={{ fontWeight: 600, color: '#1565c0' }}>{r.sales_order_id}</span>,
          },
          { key: 'customer', header: 'Customer', render: (r) => r.customer_name },
          { key: 'date', header: 'Date', render: (r) => r.order_date },
          {
            key: 'amount',
            header: 'Amount',
            align: 'right',
            render: (r) => formatCurrencyPrecise(r.amount),
          },
          {
            key: 'pay',
            header: 'Payment',
            align: 'center',
            render: (r) => <StatusBadge status={r.payment_status} />,
          },
        ]}
        getPrimaryActions={(r) => {
          const inv = data.arInvoices.find((i) => i.sales_order_id === r.sales_order_id)
          const unpaid = inv && (inv.status === 'Unpaid' || inv.status === 'Partial')
          return unpaid
            ? [
                {
                  id: 'pay',
                  label: 'Mark Paid',
                  variant: 'success',
                  loading: busyIds.has(inv.invoice_id),
                  onClick: () => onMarkPaid(inv.invoice_id),
                },
              ]
            : []
        }}
        getMenuActions={(r) => [
          { id: 'open', label: 'Open order', onClick: () => onOpenOrder(r.sales_order_id) },
          { id: 'remind', label: 'Send reminder', onClick: () => onSendReminder(r) },
          {
            id: 'ar',
            label: 'View AR invoices',
            onClick: () => {
              window.location.assign('/accounts-receivable')
            },
          },
        ]}
        renderExpanded={(r) => {
          const detail = detailCache[r.sales_order_id]
          const inv = data.arInvoices.find((i) => i.sales_order_id === r.sales_order_id)
          return (
            <div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
                <MetaChip label="Status" value={<StatusBadge status={r.status} />} />
                <MetaChip label="Approval" value={<StatusBadge status={r.approval_status} />} />
                <MetaChip
                  label="Invoice"
                  value={inv ? <StatusBadge status={inv.status} /> : 'None'}
                />
              </div>
              {!detail ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>Loading line items…</div>
              ) : detail.items?.length ? (
                <table style={{ ...directoryTableStyle, fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={directoryTheadRowStyle}>
                      <th style={directoryThStyle}>Item</th>
                      <th style={{ ...directoryThStyle, textAlign: 'right' }}>Qty</th>
                      <th style={{ ...directoryThStyle, textAlign: 'right' }}>Unit</th>
                      <th style={{ ...directoryThStyle, textAlign: 'right' }}>Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.so_item_id} style={directoryTbodyRowStyle}>
                        <td style={directoryTdStyle}>{item.item_id}</td>
                        <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                          {item.quantity_ordered}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                          {formatCurrencyPrecise(Number(item.unit_price) || 0)}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                          {formatCurrencyPrecise(Number(item.total_amount) || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={emptyStateStyle}>No line items on this order.</div>
              )}
            </div>
          )
        }}
      />
    </section>
  )
}

function ApprovalsInteractivePanel({
  docs,
  selectedIds,
  onSelectionChange,
  expandedId,
  onExpandedChange,
  auditCache,
  busyIds,
  canApprove,
  onApprove,
  onReject,
  onRequestEdit,
}: {
  docs: PendingApprovalDoc[]
  selectedIds: Set<string>
  onSelectionChange: (s: Set<string>) => void
  expandedId: string | null
  onExpandedChange: (id: string | null) => void
  auditCache: Record<string, ApprovalHistory[]>
  busyIds: Set<string>
  canApprove: (module: string) => boolean
  onApprove: (module: string, id: string) => void
  onReject: (module: string, id: string) => void
  onRequestEdit: (doc: PendingApprovalDoc) => void
}) {
  return (
    <InteractiveTransactionTable
      rows={docs}
      getRowId={(d) => d.id}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      expandedId={expandedId}
      onExpandedChange={onExpandedChange}
      busyIds={busyIds}
      emptyMessage="No documents are pending approval."
      columns={[
        {
          key: 'doc',
          header: 'Document',
          render: (d) => (
            <span>
              <StatusBadge status={d.kind} />{' '}
              <strong style={{ color: '#1565c0' }}>{d.title}</strong>
              {d.highValue ? (
                <span style={{ marginLeft: 6, fontSize: '0.7rem', color: '#e65100', fontWeight: 700 }}>
                  ≥$10k
                </span>
              ) : null}
            </span>
          ),
        },
        { key: 'party', header: 'Party', render: (d) => d.party },
        { key: 'date', header: 'Date', render: (d) => d.date },
        {
          key: 'amount',
          header: 'Amount',
          align: 'right',
          render: (d) => formatCurrencyPrecise(d.amount),
        },
      ]}
      getPrimaryActions={(d) =>
        canApprove(d.module)
          ? [
              {
                id: 'approve',
                label: 'Approve',
                variant: 'success',
                loading: busyIds.has(d.id),
                onClick: () => onApprove(d.module, d.id),
              },
              {
                id: 'reject',
                label: 'Reject',
                variant: 'danger',
                loading: busyIds.has(d.id),
                onClick: () => onReject(d.module, d.id),
              },
            ]
          : []
      }
      getMenuActions={(d) => [
        { id: 'edit', label: 'Request Edit', onClick: () => onRequestEdit(d) },
        {
          id: 'open',
          label: 'Open document',
          onClick: () => {
            window.location.assign(
              d.kind === 'SO' ? `/orders/${d.id}` : `/purchase-orders/${d.id}`,
            )
          },
        },
      ]}
      renderExpanded={(d) => {
        const hist = auditCache[`${d.module}:${d.id}`] || []
        return (
          <div>
            <div style={{ fontSize: '0.85rem', color: '#e65100', marginBottom: 8 }}>{d.reason}</div>
            {hist.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
                Approval history will appear after workflow steps run.
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.85rem' }}>
                {hist.map((h) => (
                  <li key={h.id}>
                    {h.action} · {h.created_at ? new Date(h.created_at).toLocaleString() : '—'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      }}
    />
  )
}

function InventoryInteractivePanel({
  rows,
  selectedIds,
  onSelectionChange,
  expandedId,
  onExpandedChange,
  busyIds,
  onAdjust,
  onReorder,
  onViewLogs,
}: {
  rows: InventoryValueRow[]
  selectedIds: Set<string>
  onSelectionChange: (s: Set<string>) => void
  expandedId: string | null
  onExpandedChange: (id: string | null) => void
  busyIds: Set<string>
  onAdjust: (id: string) => void
  onReorder: () => void
  onViewLogs: () => void
}) {
  return (
    <section>
      <div style={{ ...toolbarStyle, marginBottom: 12 }}>
        <button type="button" style={primaryButtonStyle} onClick={onReorder}>
          Create PO for Low Stock
        </button>
        <button
          type="button"
          style={{ ...primaryButtonStyle, backgroundColor: '#00897b' }}
          onClick={onViewLogs}
        >
          View Batch Logs
        </button>
      </div>
      <InteractiveTransactionTable
        rows={rows}
        getRowId={(r) => r.item_id}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        expandedId={expandedId}
        onExpandedChange={onExpandedChange}
        busyIds={busyIds}
        columns={[
          {
            key: 'item',
            header: 'Item',
            render: (r) => (
              <div>
                <div style={{ fontWeight: 600, color: '#1565c0' }}>{r.item_id}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text)' }}>{r.description}</div>
              </div>
            ),
          },
          { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.on_hand },
          {
            key: 'cost',
            header: 'Unit Cost',
            align: 'right',
            render: (r) => (r.unit_cost > 0 ? formatCurrencyPrecise(r.unit_cost) : '—'),
          },
          {
            key: 'value',
            header: 'Value',
            align: 'right',
            render: (r) => formatCurrencyPrecise(r.total_value),
          },
          {
            key: 'status',
            header: 'Status',
            align: 'center',
            render: (r) => <StatusBadge status={r.status} />,
          },
        ]}
        getPrimaryActions={(r) => [
          {
            id: 'adjust',
            label: 'Adjust Stock',
            variant: 'primary',
            loading: busyIds.has(r.item_id),
            onClick: () => onAdjust(r.item_id),
          },
        ]}
        getMenuActions={(r) => [
          { id: 'reorder', label: 'Reorder (Create PO)', onClick: onReorder },
          { id: 'logs', label: 'View batch logs', onClick: onViewLogs },
          {
            id: 'item',
            label: 'Open item',
            onClick: () => window.location.assign(`/items/${r.item_id}`),
          },
        ]}
        renderExpanded={(r) => (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.85rem' }}>
            <MetaChip label="Warehouse" value={r.warehouse} />
            <MetaChip label="Reorder point" value={String(r.reorder_point)} />
            <MetaChip
              label="Flag"
              value={r.needs_reorder ? <StatusBadge status="Low Stock" /> : 'OK'}
            />
          </div>
        )}
      />
    </section>
  )
}

function CashFinanceInteractivePanel({
  metricKey,
  data,
  selectedIds,
  onSelectionChange,
  expandedId,
  onExpandedChange,
  busyIds,
  onRecordAr,
  onRecordAp,
  onRemind,
}: {
  metricKey: MetricDrillKey
  data: DashboardAggregates
  selectedIds: Set<string>
  onSelectionChange: (s: Set<string>) => void
  expandedId: string | null
  onExpandedChange: (id: string | null) => void
  busyIds: Set<string>
  onRecordAr: (id: string, amount?: number) => void
  onRecordAp: (id: string, amount?: number) => void
  onRemind: (id: string, party: string) => void
}) {
  type MoneyRow = {
    id: string
    kind: 'AR' | 'AP'
    party: string
    due: string
    amount: number
    status: string
  }

  const arRows: MoneyRow[] = data.arInvoices
    .filter((i) => i.status === 'Unpaid' || i.status === 'Partial')
    .map((i) => ({
      id: i.invoice_id,
      kind: 'AR',
      party: i.customer_id,
      due: i.due_date,
      amount: Number(i.amount) || 0,
      status: i.status,
    }))

  const apRows: MoneyRow[] = (
    metricKey === 'cash_flow' ? upcomingApPayouts(data) : data.apBills.filter((b) => b.status !== 'Paid')
  ).map((b) => ({
    id: b.bill_id,
    kind: 'AP',
    party: b.vendor_id,
    due: b.due_date,
    amount: Number(b.amount) || 0,
    status: b.status,
  }))

  const overdueRows: MoneyRow[] = [
    ...overdueAr(data).map((i) => ({
      id: i.invoice_id,
      kind: 'AR' as const,
      party: i.customer_id,
      due: i.due_date,
      amount: Number(i.amount) || 0,
      status: 'Overdue',
    })),
    ...overdueAp(data).map((b) => ({
      id: b.bill_id,
      kind: 'AP' as const,
      party: b.vendor_id,
      due: b.due_date,
      amount: Number(b.amount) || 0,
      status: 'Overdue',
    })),
  ]

  const tableRows =
    metricKey === 'ap_outstanding'
      ? apRows
      : metricKey === 'overdue_invoices'
        ? overdueRows
        : metricKey === 'ar_outstanding'
          ? arRows
          : [...arRows, ...apRows]

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(metricKey === 'cash_flow' || metricKey === 'monthly_margin') && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
          }}
        >
          <SummaryTile label="Inflows" value={formatCurrency(data.cashIn)} color="#2e7d32" />
          <SummaryTile label="Outflows" value={formatCurrency(data.cashOut)} color="#c62828" />
          <SummaryTile label="Net Cash" value={formatCurrency(data.cashNet)} color="#1565c0" />
          <SummaryTile label="AR" value={formatCurrency(data.arOutstanding)} color="#00897b" />
          <SummaryTile label="AP" value={formatCurrency(data.apOutstanding)} color="#fb8c00" />
        </div>
      )}

      <InteractiveTransactionTable
        rows={tableRows}
        getRowId={(r) => r.id}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        expandedId={expandedId}
        onExpandedChange={onExpandedChange}
        busyIds={busyIds}
        columns={[
          {
            key: 'doc',
            header: 'Document',
            render: (r) => (
              <span>
                <StatusBadge status={r.kind} /> <strong>{r.id}</strong>
              </span>
            ),
          },
          { key: 'party', header: 'Party', render: (r) => r.party },
          { key: 'due', header: 'Due', render: (r) => r.due },
          {
            key: 'status',
            header: 'Status',
            align: 'center',
            render: (r) => <StatusBadge status={r.status} />,
          },
          {
            key: 'amount',
            header: 'Amount',
            align: 'right',
            render: (r) => formatCurrencyPrecise(r.amount),
          },
        ]}
        getPrimaryActions={(r) => {
          if (r.kind === 'AR' && r.status !== 'Paid') {
            return [
              {
                id: 'pay',
                label: 'Record Payment',
                variant: 'success',
                loading: busyIds.has(r.id),
                onClick: () => onRecordAr(r.id, r.amount),
              },
            ]
          }
          if (r.kind === 'AP' && r.status !== 'Paid') {
            return [
              {
                id: 'pay',
                label: 'Record Payment',
                variant: 'success',
                loading: busyIds.has(r.id),
                onClick: () => onRecordAp(r.id, r.amount),
              },
            ]
          }
          return []
        }}
        getMenuActions={(r) => [
          {
            id: 'remind',
            label: 'Send Reminder',
            onClick: () => onRemind(r.id, r.party),
          },
          {
            id: 'open',
            label: r.kind === 'AR' ? 'Open AR' : 'Open AP',
            onClick: () =>
              window.location.assign(r.kind === 'AR' ? '/accounts-receivable' : '/accounts-payable'),
          },
        ]}
        renderExpanded={(r) => (
          <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
            {r.kind} document for {r.party}. Due {r.due}. Use Record Payment to post cash and mark
            paid without leaving the dashboard.
          </div>
        )}
      />

      {metricKey === 'cash_flow' ? (
        <div>
          <h4 style={{ margin: '0 0 8px', color: 'var(--text-h)' }}>Recent cash transactions</h4>
          <SimpleCashTable rows={recentCash(data).slice(0, 8)} />
        </div>
      ) : null}
    </section>
  )
}

function SalesOrdersInteractivePanel({
  orders,
  status,
  onStatusChange,
  selectedIds,
  onSelectionChange,
  expandedId,
  onExpandedChange,
  detailCache,
  busyIds,
  canApprove,
  onApprove,
  onReject,
}: {
  orders: SalesOrder[]
  status: string
  onStatusChange: (s: string) => void
  selectedIds: Set<string>
  onSelectionChange: (s: Set<string>) => void
  expandedId: string | null
  onExpandedChange: (id: string | null) => void
  detailCache: Record<string, SalesOrder>
  busyIds: Set<string>
  canApprove: boolean
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  return (
    <section>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {SO_STATUSES.map((s) => (
          <button key={s} type="button" style={chipStyle(status === s)} onClick={() => onStatusChange(s)}>
            {s}
          </button>
        ))}
      </div>
      <InteractiveTransactionTable
        rows={orders}
        getRowId={(o) => o.sales_order_id}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        expandedId={expandedId}
        onExpandedChange={onExpandedChange}
        busyIds={busyIds}
        columns={[
          {
            key: 'id',
            header: 'Order',
            render: (o) => <strong style={{ color: '#1565c0' }}>{o.sales_order_id}</strong>,
          },
          { key: 'customer', header: 'Customer', render: (o) => o.customer_id },
          { key: 'date', header: 'Date', render: (o) => o.order_date },
          {
            key: 'status',
            header: 'Status',
            align: 'center',
            render: (o) => <StatusBadge status={o.status} />,
          },
          {
            key: 'amount',
            header: 'Amount',
            align: 'right',
            render: (o) => formatCurrencyPrecise(Number(o.total_amount) || 0),
          },
        ]}
        getPrimaryActions={(o) =>
          canApprove && (o.approval_status || '').toUpperCase() === 'PENDING_APPROVAL'
            ? [
                {
                  id: 'approve',
                  label: 'Approve',
                  variant: 'success',
                  loading: busyIds.has(o.sales_order_id),
                  onClick: () => onApprove(o.sales_order_id),
                },
                {
                  id: 'reject',
                  label: 'Reject',
                  variant: 'danger',
                  onClick: () => onReject(o.sales_order_id),
                },
              ]
            : []
        }
        getMenuActions={(o) => [
          {
            id: 'open',
            label: 'Open / preview',
            onClick: () => window.location.assign(`/orders/${o.sales_order_id}`),
          },
          {
            id: 'edit',
            label: 'Edit',
            onClick: () => {
              if (isSalesOrderEditable(o)) {
                window.location.assign(salesOrderEditPath(o.sales_order_id))
                return
              }
              window.alert(SALES_ORDER_LOCKED_EDIT_MESSAGE)
            },
          },
        ]}
        renderExpanded={(o) => {
          const detail = detailCache[o.sales_order_id] || o
          return (
            <div>
              <div style={{ marginBottom: 8 }}>
                <StatusBadge status={o.approval_status || 'DRAFT'} />
              </div>
              {(detail.items || []).length === 0 ? (
                <div style={emptyStateStyle}>No line items.</div>
              ) : (
                <table style={{ ...directoryTableStyle, fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={directoryTheadRowStyle}>
                      <th style={directoryThStyle}>Item</th>
                      <th style={{ ...directoryThStyle, textAlign: 'right' }}>Qty</th>
                      <th style={{ ...directoryThStyle, textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.items || []).map((item) => (
                      <tr key={item.so_item_id} style={directoryTbodyRowStyle}>
                        <td style={directoryTdStyle}>{item.item_id}</td>
                        <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                          {item.quantity_ordered}
                        </td>
                        <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                          {formatCurrencyPrecise(Number(item.total_amount) || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        }}
      />
    </section>
  )
}

function PurchaseOrdersPanel({
  orders,
  status,
  onStatusChange,
  showStatusFilter,
  vendors,
  selectedIds,
  onSelectionChange,
  expandedId,
  onExpandedChange,
  canApprove,
  busyIds,
  onApprove,
  onReject,
}: {
  orders: DashboardAggregates['purchaseOrders']
  status: string
  onStatusChange: (s: string) => void
  showStatusFilter: boolean
  vendors: Supplier[]
  selectedIds: Set<string>
  onSelectionChange: (s: Set<string>) => void
  expandedId: string | null
  onExpandedChange: (id: string | null) => void
  canApprove: boolean
  busyIds: Set<string>
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  return (
    <section>
      {showStatusFilter ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {PO_STATUSES.map((s) => (
            <button key={s} type="button" style={chipStyle(status === s)} onClick={() => onStatusChange(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <InteractiveTransactionTable
        rows={orders}
        getRowId={(p) => p.po_number}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        expandedId={expandedId}
        onExpandedChange={onExpandedChange}
        busyIds={busyIds}
        columns={[
          {
            key: 'po',
            header: 'PO',
            render: (p) => <strong style={{ color: '#1565c0' }}>{p.po_number}</strong>,
          },
          {
            key: 'vendor',
            header: 'Vendor',
            render: (p) =>
              p.supplier_name ||
              vendors.find((v) => v.supplier_id === p.supplier_id)?.company_name ||
              p.supplier_id,
          },
          {
            key: 'status',
            header: 'Status',
            align: 'center',
            render: (p) => <StatusBadge status={p.status} />,
          },
          {
            key: 'total',
            header: 'Total',
            align: 'right',
            render: (p) => formatCurrencyPrecise(Number(p.grand_total) || 0),
          },
        ]}
        getPrimaryActions={(p) =>
          canApprove && (p.approval_status || '').toUpperCase() === 'PENDING_APPROVAL'
            ? [
                {
                  id: 'approve',
                  label: 'Approve',
                  variant: 'success',
                  loading: busyIds.has(p.po_number),
                  onClick: () => onApprove(p.po_number),
                },
                {
                  id: 'reject',
                  label: 'Reject',
                  variant: 'danger',
                  onClick: () => onReject(p.po_number),
                },
              ]
            : []
        }
        getMenuActions={(p) => [
          {
            id: 'open',
            label: 'Open PO',
            onClick: () => window.location.assign(`/purchase-orders/${p.po_number}`),
          },
        ]}
        renderExpanded={(p) => (
          <div style={{ fontSize: '0.85rem' }}>
            {p.items?.length || 0} line(s) · Approval:{' '}
            <StatusBadge status={p.approval_status || p.status} />
          </div>
        )}
      />
    </section>
  )
}

function KeyAccountsPanel({
  rows,
}: {
  rows: ReturnType<typeof buildCustomerActivity>
}) {
  if (rows.length === 0) return <div style={emptyStateStyle}>No customer activity.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={directoryTableStyle}>
        <thead>
          <tr style={directoryTheadRowStyle}>
            <th style={directoryThStyle}>Customer</th>
            <th style={{ ...directoryThStyle, textAlign: 'right' }}>Orders</th>
            <th style={{ ...directoryThStyle, textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customer_id} style={directoryTbodyRowStyle}>
              <td style={directoryTdStyle}>
                <Link to="/customers" style={linkStyle}>
                  {r.customer_name}
                </Link>
              </td>
              <td style={{ ...directoryTdStyle, textAlign: 'right' }}>{r.order_count}</td>
              <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                {formatCurrencyPrecise(r.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SubcontractPanel({ orders }: { orders: DashboardAggregates['subcontractOrders'] }) {
  if (orders.length === 0) return <div style={emptyStateStyle}>No active subcontract orders.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={directoryTableStyle}>
        <thead>
          <tr style={directoryTheadRowStyle}>
            <th style={directoryThStyle}>SCO</th>
            <th style={directoryThStyle}>Item</th>
            <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
            <th style={{ ...directoryThStyle, textAlign: 'right' }}>Qty</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.sco_number} style={directoryTbodyRowStyle}>
              <td style={directoryTdStyle}>
                <Link to={`/subcontract-orders/${o.sco_number}`} style={linkStyle}>
                  {o.sco_number}
                </Link>
              </td>
              <td style={directoryTdStyle}>{o.item_id}</td>
              <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                <StatusBadge status={o.status} />
              </td>
              <td style={{ ...directoryTdStyle, textAlign: 'right' }}>{o.quantity_ordered}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MovementsPanel({ movements }: { movements: DashboardAggregates['movements'] }) {
  if (movements.length === 0) return <div style={emptyStateStyle}>No receipt movements.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={directoryTableStyle}>
        <thead>
          <tr style={directoryTheadRowStyle}>
            <th style={directoryThStyle}>Date</th>
            <th style={directoryThStyle}>Item</th>
            <th style={{ ...directoryThStyle, textAlign: 'right' }}>Qty</th>
            <th style={directoryThStyle}>Reference</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.movement_id} style={directoryTbodyRowStyle}>
              <td style={directoryTdStyle}>{m.movement_date}</td>
              <td style={directoryTdStyle}>
                <Link to={`/items/${m.item_id}`} style={linkStyle}>
                  {m.item_id}
                </Link>
              </td>
              <td style={{ ...directoryTdStyle, textAlign: 'right' }}>{m.quantity}</td>
              <td style={directoryTdStyle}>{m.reference || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AllocatedPanel({ items }: { items: DashboardAggregates['stock'] }) {
  if (items.length === 0) {
    return <div style={emptyStateStyle}>No allocated inventory pending shipment.</div>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={directoryTableStyle}>
        <thead>
          <tr style={directoryTheadRowStyle}>
            <th style={directoryThStyle}>Item</th>
            <th style={{ ...directoryThStyle, textAlign: 'right' }}>Allocated</th>
            <th style={{ ...directoryThStyle, textAlign: 'right' }}>On Hand</th>
            <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.item_id} style={directoryTbodyRowStyle}>
              <td style={directoryTdStyle}>
                <Link to={`/items/${s.item_id}`} style={linkStyle}>
                  {s.item_id}
                </Link>
              </td>
              <td style={{ ...directoryTdStyle, textAlign: 'right' }}>{s.allocated_quantity}</td>
              <td style={{ ...directoryTdStyle, textAlign: 'right' }}>{s.on_hand_quantity}</td>
              <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                <StatusBadge status={s.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SimpleCashTable({ rows }: { rows: DashboardAggregates['cashTransactions'] }) {
  if (rows.length === 0) return <div style={emptyStateStyle}>No cash transactions.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={directoryTableStyle}>
        <thead>
          <tr style={directoryTheadRowStyle}>
            <th style={directoryThStyle}>Date</th>
            <th style={directoryThStyle}>Type</th>
            <th style={directoryThStyle}>Reference</th>
            <th style={{ ...directoryThStyle, textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const href = cashReferenceHref(t)
            return (
            <tr key={t.transaction_id} style={directoryTbodyRowStyle}>
              <td style={directoryTdStyle}>
                {t.transaction_date ? new Date(t.transaction_date).toLocaleDateString() : '—'}
              </td>
              <td style={directoryTdStyle}>{t.type_label || t.type}</td>
              <td style={directoryTdStyle}>
                {href ? (
                  <Link to={href} style={linkStyle} title={cashReferenceLabel(t)}>
                    {t.reference_id}
                  </Link>
                ) : (
                  t.reference_id
                )}
              </td>
              <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                {formatCurrencyPrecise(Number(t.amount) || 0)}
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MetaChip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 10px',
        background: 'var(--bg)',
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: '0.7rem', color: 'var(--text)' }}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 600, color: 'var(--text-h)' }}>{value}</div>
    </div>
  )
}

function SummaryTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        padding: '12px 14px',
        background: 'var(--bg)',
      }}
    >
      <div style={{ fontSize: '0.75rem', color: 'var(--text)' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-h)', marginTop: 4 }}>
        {value}
      </div>
    </div>
  )
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(8, 6, 13, 0.35)',
  zIndex: 1200,
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  height: '100vh',
  background: 'var(--bg)',
  zIndex: 1201,
  boxShadow: '-8px 0 28px rgba(0,0,0,0.18)',
  display: 'flex',
  flexDirection: 'column',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  padding: '18px 20px',
}

const tabsRowStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '0 16px',
  borderBottom: '1px solid var(--divider)',
  background: 'var(--bg)',
}

const bodyStyle: CSSProperties = {
  padding: '16px 20px 28px',
  overflowY: 'auto',
  flex: 1,
}

const iconBtnStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  borderRadius: 8,
  width: 36,
  height: 36,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: 'var(--text-h)',
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 12,
}

const bulkBarStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 12,
  padding: '10px 12px',
  borderRadius: 8,
  background: '#e3f2fd',
  border: '1px solid #90caf9',
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: '0.85rem',
  fontWeight: 600,
  color: 'var(--text-h)',
}

const textareaStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 10,
  fontSize: '0.875rem',
  fontFamily: 'inherit',
  resize: 'vertical',
}

function tabStyle(active: boolean, accent: string): CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
    color: active ? accent : 'var(--text)',
    fontWeight: 700,
    fontSize: '0.85rem',
    padding: '12px 14px',
    cursor: 'pointer',
  }
}

function chipStyle(active: boolean): CSSProperties {
  return {
    border: `1px solid ${active ? '#1976d2' : 'var(--border)'}`,
    background: active ? '#e3f2fd' : 'var(--bg)',
    color: active ? '#1565c0' : 'var(--text-h)',
    borderRadius: 999,
    padding: '6px 12px',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer',
  }
}
