import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  PackageSearch,
} from 'lucide-react'
import type { DashboardAggregates, MetricDrillKey, QuickAction } from '../../types/dashboard'
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

type InventoryDashboardProps = {
  data: DashboardAggregates
  actions: QuickAction[]
  activeMetric: MetricDrillKey | null
  onMetricClick: (key: MetricDrillKey) => void
}

export default function InventoryDashboard({
  data,
  actions,
  activeMetric,
  onMetricClick,
}: InventoryDashboardProps) {
  return (
    <>
      <div style={metricsGridStyle}>
        <MetricCard
          label="Low Stock Alerts"
          value={data.lowStockCount + data.outOfStockCount}
          subtext={`${data.lowStockCount} low · ${data.outOfStockCount} out`}
          accent="amber"
          icon={AlertTriangle}
          active={activeMetric === 'low_stock'}
          onClick={() => onMetricClick('low_stock')}
        />
        <MetricCard
          label="Total SKUs"
          value={data.totalSkus}
          accent="blue"
          icon={Boxes}
          active={activeMetric === 'total_skus'}
          onClick={() => onMetricClick('total_skus')}
        />
        <MetricCard
          label="Items Pending Receiving"
          value={data.pendingReceiving}
          subtext="Receipt movements"
          accent="teal"
          icon={ArrowDownToLine}
          active={activeMetric === 'pending_receiving'}
          onClick={() => onMetricClick('pending_receiving')}
        />
        <MetricCard
          label="Items Pending Shipment"
          value={data.pendingShipment}
          subtext="SKUs with allocation"
          accent="red"
          icon={ArrowUpFromLine}
          active={activeMetric === 'pending_shipment'}
          onClick={() => onMetricClick('pending_shipment')}
        />
      </div>

      <QuickActions actions={actions} />

      <div style={twoColStyle}>
        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Stock Movement Log</h3>
          {data.recentMovements.length === 0 ? (
            <div style={emptyStateStyle}>No stock movements recorded.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <th style={directoryThStyle}>Date</th>
                    <th style={directoryThStyle}>Item</th>
                    <th style={directoryThStyle}>Type</th>
                    <th style={{ ...directoryThStyle, textAlign: 'right' }}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentMovements.map((m) => (
                    <tr key={m.movement_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>{m.movement_date}</td>
                      <td style={directoryTdStyle}>
                        <Link to={`/items/${m.item_id}`} style={linkStyle}>
                          {m.item_id}
                        </Link>
                      </td>
                      <td style={directoryTdStyle}>
                        <StatusBadge status={m.movement_type} />
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>{m.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Link to="/inventory/movements" style={{ ...linkStyle, fontSize: '0.875rem', fontWeight: 600 }}>
              View all movements →
            </Link>
          </div>
        </div>

        <div style={sectionStyle}>
          <h3 style={{ ...sectionTitleStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <PackageSearch size={16} color="#1565c0" />
            Reorder Recommendations
          </h3>
          {data.reorderItems.length === 0 ? (
            <div style={emptyStateStyle}>No reorder recommendations.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={directoryTableStyle}>
                <thead>
                  <tr style={directoryTheadRowStyle}>
                    <th style={directoryThStyle}>Item</th>
                    <th style={{ ...directoryThStyle, textAlign: 'right' }}>On Hand</th>
                    <th style={{ ...directoryThStyle, textAlign: 'right' }}>Reorder</th>
                    <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reorderItems.map((item) => (
                    <tr key={item.item_id} style={directoryTbodyRowStyle}>
                      <td style={directoryTdStyle}>
                        <Link to={`/items/${item.item_id}`} style={linkStyle}>
                          {item.item_id}
                        </Link>
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {item.on_hand_quantity}
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {item.reorder_point}
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
