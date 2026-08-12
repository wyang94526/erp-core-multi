import { Link } from 'react-router-dom'
import {
  BadgeDollarSign,
  ClipboardCheck,
  Package,
  Wallet,
} from 'lucide-react'
import type { DashboardAggregates, MetricDrillKey, QuickAction } from '../../types/dashboard'
import { formatCurrency } from '../../hooks/useDashboardData'
import MetricCard from './MetricCard'
import QuickActions from './QuickActions'
import TrendChart from './TrendChart'
import {
  directoryTableStyle,
  directoryTbodyRowStyle,
  directoryTdStyle,
  directoryThStyle,
  directoryTheadRowStyle,
  emptyStateStyle,
  metricsGridStyle,
  sectionStyle,
  sectionTitleStyle,
  twoColStyle,
} from './dashboardStyles'

type ExecutiveDashboardProps = {
  data: DashboardAggregates
  actions: QuickAction[]
  activeMetric: MetricDrillKey | null
  onMetricClick: (key: MetricDrillKey) => void
}

export default function ExecutiveDashboard({
  data,
  actions,
  activeMetric,
  onMetricClick,
}: ExecutiveDashboardProps) {
  return (
    <>
      <div style={metricsGridStyle}>
        <MetricCard
          label="Total Revenue"
          value={formatCurrency(data.totalSalesRevenue)}
          subtext="All sales orders"
          accent="blue"
          icon={BadgeDollarSign}
          active={activeMetric === 'total_revenue'}
          onClick={() => onMetricClick('total_revenue')}
        />
        <MetricCard
          label="Pending Approvals"
          value={data.pendingSoApprovals + data.pendingPoApprovals}
          subtext={`${data.pendingSoApprovals} SO · ${data.pendingPoApprovals} PO`}
          accent="amber"
          icon={ClipboardCheck}
          active={activeMetric === 'pending_approvals'}
          onClick={() => onMetricClick('pending_approvals')}
        />
        <MetricCard
          label="Inventory Value"
          value={formatCurrency(data.inventoryValue)}
          subtext={`${data.totalSkus} SKUs on hand`}
          accent="teal"
          icon={Package}
          active={activeMetric === 'inventory_value'}
          onClick={() => onMetricClick('inventory_value')}
        />
        <MetricCard
          label="Cash Flow"
          value={formatCurrency(data.cashNet)}
          subtext={`In ${formatCurrency(data.cashIn)} · Out ${formatCurrency(data.cashOut)}`}
          accent="green"
          icon={Wallet}
          active={activeMetric === 'cash_flow'}
          onClick={() => onMetricClick('cash_flow')}
        />
      </div>

      <div style={twoColStyle}>
        <TrendChart data={data.monthlyTrend} />
        <QuickActions actions={actions} />
      </div>

      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>System Activity / Audit Log</h3>
        {data.recentAuditLogs.length === 0 ? (
          <div style={emptyStateStyle}>No recent audit activity.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={directoryTableStyle}>
              <thead>
                <tr style={directoryTheadRowStyle}>
                  <th style={directoryThStyle}>When</th>
                  <th style={directoryThStyle}>Table</th>
                  <th style={directoryThStyle}>Action</th>
                  <th style={directoryThStyle}>Record</th>
                  <th style={directoryThStyle}>User</th>
                </tr>
              </thead>
              <tbody>
                {data.recentAuditLogs.map((log) => (
                  <tr key={log.id} style={directoryTbodyRowStyle}>
                    <td style={directoryTdStyle}>
                      {log.changed_at ? new Date(log.changed_at).toLocaleString() : '—'}
                    </td>
                    <td style={directoryTdStyle}>{log.table_name}</td>
                    <td style={directoryTdStyle}>{log.action}</td>
                    <td style={directoryTdStyle}>
                      <code style={{ fontSize: '0.8rem' }}>{log.record_id.slice(0, 8)}…</code>
                    </td>
                    <td style={directoryTdStyle}>
                      {log.user_id ? `${log.user_id.slice(0, 8)}…` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Link to="/sales-orders" style={{ color: '#1565c0', fontSize: '0.875rem', fontWeight: 600 }}>
            Review sales orders →
          </Link>
        </div>
      </div>
    </>
  )
}
