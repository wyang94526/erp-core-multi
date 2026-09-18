/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ClipboardCheck,
  Factory,
  ShoppingCart,
  Truck,
} from 'lucide-react'
import type { DashboardAggregates, MetricDrillKey, QuickAction } from '../../types/dashboard'
import { formatCurrencyPrecise } from '../../hooks/useDashboardData'
import MetricCard from './MetricCard'
import QuickActions from './QuickActions'
import StatusBadge from './StatusBadge'
import {
  directoryTableStyle,
  directoryTbodyRowStyle,
  directoryTdStyle,
  directoryThStyle,
  directoryTheadRowStyle,
  emptyStateStyle,
  linkStyle,
  metricsGridStyle,
  sectionStyle,
  sectionTitleStyle,
  twoColStyle,
} from './dashboardStyles'

type PurchasingDashboardProps = {
  data: DashboardAggregates
  actions: QuickAction[]
  activeMetric: MetricDrillKey | null
  onMetricClick: (key: MetricDrillKey) => void
}

function vendorOnTimeRate(data: DashboardAggregates): string {
  const approved = data.purchaseOrders.filter((p) => p.status === 'Approved').length
  const total = data.purchaseOrders.filter((p) => p.status !== 'Void').length
  if (total === 0) return '—'
  // Proxy: share of non-void POs that reached Approved (no delivery timestamps in list API)
  return `${Math.round((approved / total) * 100)}%`
}

export default function PurchasingDashboard({
  data,
  actions,
  activeMetric,
  onMetricClick,
}: PurchasingDashboardProps) {
  return (
    <>
      <div style={metricsGridStyle}>
        <MetricCard
          label="Open Purchase Orders"
          value={data.openPurchaseOrders}
          accent="blue"
          icon={ShoppingCart}
          active={activeMetric === 'open_purchase_orders'}
          onClick={() => onMetricClick('open_purchase_orders')}
        />
        <MetricCard
          label="Active Subcontract Orders"
          value={data.activeSubcontractOrders}
          accent="teal"
          icon={Factory}
          active={activeMetric === 'active_subcontract'}
          onClick={() => onMetricClick('active_subcontract')}
        />
        <MetricCard
          label="Pending PO Approvals"
          value={data.pendingPoApprovals}
          accent="amber"
          icon={ClipboardCheck}
          active={activeMetric === 'pending_po_approvals'}
          onClick={() => onMetricClick('pending_po_approvals')}
        />
        <MetricCard
          label="Vendor On-Time (proxy)"
          value={vendorOnTimeRate(data)}
          subtext="Approved / non-void POs"
          accent="green"
          icon={Truck}
          active={activeMetric === 'vendor_ontime'}
          onClick={() => onMetricClick('vendor_ontime')}
        />
      </div>

      <QuickActions actions={actions} />

      <div style={twoColStyle}>
        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Pending POs Requiring Action</h3>
          {data.pendingPurchaseOrders.length === 0 ? (
            <div style={emptyStateStyle}>No purchase orders require action.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <th style={directoryThStyle}>PO</th>
                    <th style={directoryThStyle}>Vendor</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                    <th style={{ ...directoryThStyle, textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pendingPurchaseOrders.map((po) => (
                    <tr key={po.po_number} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>
                        <Link to={`/purchase-orders/${po.po_number}`} style={linkStyle}>
                          {po.po_number}
                        </Link>
                      </td>
                      <td style={directoryTdStyle}>{po.supplier_name || po.supplier_id}</td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <StatusBadge status={po.approval_status || po.status} />
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {formatCurrencyPrecise(Number(po.grand_total) || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={sectionStyle}>
          <h3 style={{ ...sectionTitleStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} color="#e65100" />
            Material Shortage Alerts
          </h3>
          {data.shortageItems.length === 0 ? (
            <div style={emptyStateStyle}>No material shortages.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <th style={directoryThStyle}>Item</th>
                    <th style={{ ...directoryThStyle, textAlign: 'right' }}>ATP</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shortageItems.slice(0, 8).map((item) => (
                    <tr key={item.item_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>
                        <Link to={`/items/${item.item_id}`} style={linkStyle}>
                          {item.item_id}
                        </Link>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text)' }}>
                          {item.description || '—'}
                        </div>
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {item.available_to_promise}
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <StatusBadge status={item.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
