/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { Link, useNavigate } from 'react-router-dom'
import {
  ClipboardList,
  FilePlus2,
  Hourglass,
  TrendingUp,
  Users,
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
  primaryButtonStyle,
  sectionStyle,
  sectionTitleStyle,
} from './dashboardStyles'

type SalesDashboardProps = {
  data: DashboardAggregates
  actions: QuickAction[]
  activeMetric: MetricDrillKey | null
  onMetricClick: (key: MetricDrillKey) => void
}

export default function SalesDashboard({
  data,
  actions,
  activeMetric,
  onMetricClick,
}: SalesDashboardProps) {
  const navigate = useNavigate()
  const uniqueCustomers = new Set(data.salesOrders.map((o) => o.customer_id)).size

  return (
    <>
      <div style={metricsGridStyle}>
        <MetricCard
          label="Open Sales Orders"
          value={data.openSalesOrders}
          accent="blue"
          icon={ClipboardList}
          active={activeMetric === 'open_sales_orders'}
          onClick={() => onMetricClick('open_sales_orders')}
        />
        <MetricCard
          label="Pending Approvals"
          value={data.pendingSoApprovals}
          accent="amber"
          icon={Hourglass}
          active={activeMetric === 'sales_pending_approvals'}
          onClick={() => onMetricClick('sales_pending_approvals')}
        />
        <MetricCard
          label="Sales MTD"
          value={formatCurrencyPrecise(data.mtdSalesTotal)}
          accent="green"
          icon={TrendingUp}
          active={activeMetric === 'sales_mtd'}
          onClick={() => onMetricClick('sales_mtd')}
        />
        <MetricCard
          label="Key Account Activity"
          value={uniqueCustomers}
          subtext="Distinct customers with orders"
          accent="teal"
          icon={Users}
          active={activeMetric === 'key_accounts'}
          onClick={() => onMetricClick('key_accounts')}
        />
      </div>

      <QuickActions actions={actions} />

      <div style={sectionStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          <h3 style={{ ...sectionTitleStyle, margin: 0 }}>Recent Sales Orders</h3>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => navigate('/orders/new')}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#1565c0'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#1976d2'
            }}
          >
            <FilePlus2 size={16} />
            Create Order
          </button>
        </div>

        {data.recentSalesOrders.length === 0 ? (
          <div style={emptyStateStyle}>No sales orders found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <th style={directoryThStyle}>Order</th>
                  <th style={directoryThStyle}>Customer</th>
                  <th style={directoryThStyle}>Date</th>
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                  <th style={{ ...directoryThStyle, textAlign: 'center' }}>Approval</th>
                  <th style={{ ...directoryThStyle, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSalesOrders.map((order) => (
                  <tr key={order.sales_order_id} style={directoryTbodyRowStyle}>
                    <td style={directoryTdStyle}>
                      <Link to={`/orders/${order.sales_order_id}`} style={linkStyle}>
                        {order.sales_order_id}
                      </Link>
                    </td>
                    <td style={directoryTdStyle}>{order.customer_id}</td>
                    <td style={directoryTdStyle}>{order.order_date}</td>
                    <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                      <StatusBadge status={order.status} />
                    </td>
                    <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                      <StatusBadge status={order.approval_status || 'DRAFT'} />
                    </td>
                    <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                      {formatCurrencyPrecise(Number(order.total_amount) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
