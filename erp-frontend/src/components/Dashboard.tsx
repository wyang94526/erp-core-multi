/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getDisplayRoleName,
  getQuickActions,
  getUrgentSummary,
  resolveDashboardRole,
} from '../config/dashboardRoles'
import { getMetricDestination } from '../config/metricRoutes'
import { useDashboardData } from '../hooks/useDashboardData'
import type { MetricDrillKey } from '../types/dashboard'
import GreetingBanner from './dashboard/GreetingBanner'
import ExecutiveDashboard from './dashboard/ExecutiveDashboard'
import SalesDashboard from './dashboard/SalesDashboard'
import PurchasingDashboard from './dashboard/PurchasingDashboard'
import InventoryDashboard from './dashboard/InventoryDashboard'
import FinanceDashboard from './dashboard/FinanceDashboard'
import WelcomeOnboarding from './dashboard/WelcomeOnboarding'
import {
  containerStyle,
  emptyStateStyle,
  pageHeaderStyle,
  pageSubStyle,
  pageTitleStyle,
} from './dashboard/dashboardStyles'

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const view = resolveDashboardRole(user)
  const { data, isLoading, isError, error } = useDashboardData({ enabled: view !== 'onboarding' })

  const roleName = getDisplayRoleName(user, view)
  const actions = getQuickActions(view)
  const urgent = getUrgentSummary(view, data)

  const openMetric = (key: MetricDrillKey) => {
    navigate(getMetricDestination(key))
  }

  if (view === 'onboarding') {
    return <WelcomeOnboarding fullName={user?.full_name || 'User'} />
  }

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateStyle}>Loading dashboard…</div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={{ ...emptyStateStyle, color: '#c62828' }}>
          <p>Error loading dashboard data.</p>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={pageTitleStyle}>Dashboard</h2>
          <p style={pageSubStyle}>
            Personalized {roleName} overview for Grand-Tek Technology USA
          </p>
        </div>
      </header>

      <GreetingBanner
        fullName={user?.full_name || 'User'}
        roleName={roleName}
        urgent={urgent}
      />

      {view === 'executive' && (
        <ExecutiveDashboard
          data={data}
          actions={actions}
          activeMetric={null}
          onMetricClick={openMetric}
        />
      )}
      {view === 'sales' && (
        <SalesDashboard
          data={data}
          actions={actions}
          activeMetric={null}
          onMetricClick={openMetric}
        />
      )}
      {view === 'purchasing' && (
        <PurchasingDashboard
          data={data}
          actions={actions}
          activeMetric={null}
          onMetricClick={openMetric}
        />
      )}
      {view === 'inventory' && (
        <InventoryDashboard
          data={data}
          actions={actions}
          activeMetric={null}
          onMetricClick={openMetric}
        />
      )}
      {view === 'finance' && (
        <FinanceDashboard
          data={data}
          actions={actions}
          activeMetric={null}
          onMetricClick={openMetric}
        />
      )}
    </div>
  )
}
