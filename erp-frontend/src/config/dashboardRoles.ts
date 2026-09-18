/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import {
  CheckSquare,
  ClipboardList,
  PackagePlus,
  Settings,
  ShoppingCart,
  Users,
  FilePlus2,
  Warehouse,
  Landmark,
  Boxes,
  FileBarChart,
} from 'lucide-react'
import type { CurrentUser } from '../types'
import type { DashboardAggregates, DashboardRole, DashboardUrgentSummary, QuickAction } from '../types/dashboard'

export const ROLE_UNASSIGNED = 'ROLE-UNASSIGNED'

const ROLE_PRIORITY: Array<{ roleIds: string[]; view: DashboardRole }> = [
  { roleIds: ['ROLE-ADMIN'], view: 'executive' },
  { roleIds: ['ROLE-FIN-APPR'], view: 'finance' },
  { roleIds: ['ROLE-SALES-MGR', 'ROLE-SALES-REP'], view: 'sales' },
  { roleIds: ['ROLE-PURCH-MGR', 'ROLE-PURCH-AGENT'], view: 'purchasing' },
  { roleIds: ['ROLE-SCO-SUP'], view: 'inventory' },
]

export const DASHBOARD_ROLE_LABELS: Record<DashboardRole, string> = {
  onboarding: 'Unassigned',
  executive: 'Admin',
  sales: 'Sales',
  purchasing: 'Purchasing',
  inventory: 'Inventory',
  finance: 'Finance',
}

export function isUnassignedUser(user: CurrentUser | null): boolean {
  if (!user) return true
  const roles = user.roles || []
  const functional = roles.filter((r) => r.role_id !== ROLE_UNASSIGNED)
  if (functional.length > 0) return false
  if (user.role_id && user.role_id !== ROLE_UNASSIGNED) return false
  return true
}

export function resolveDashboardRole(user: CurrentUser | null): DashboardRole {
  if (!user || isUnassignedUser(user)) return 'onboarding'

  const owned = new Set((user.roles || []).map((r) => r.role_id))
  if (user.role_id) owned.add(user.role_id)
  owned.delete(ROLE_UNASSIGNED)

  for (const entry of ROLE_PRIORITY) {
    if (entry.roleIds.some((id) => owned.has(id))) {
      return entry.view
    }
  }
  return 'onboarding'
}

export function getDisplayRoleName(user: CurrentUser | null, view: DashboardRole): string {
  if (!user) return DASHBOARD_ROLE_LABELS[view]
  const names = (user.roles || [])
    .filter((r) => r.role_id !== ROLE_UNASSIGNED || view === 'onboarding')
    .map((r) => r.role_name)
    .filter(Boolean)
  if (names.length > 0) return names[0]
  if (user.role_name && user.role_id !== ROLE_UNASSIGNED) return user.role_name
  return DASHBOARD_ROLE_LABELS[view]
}

export function getQuickActions(view: DashboardRole): QuickAction[] {
  switch (view) {
    case 'onboarding':
      return []
    case 'executive':
      return [
        { id: 'approve-sos', label: 'Approve High-Value SOs', to: '/sales-orders', icon: CheckSquare },
        { id: 'settings', label: 'System Settings', to: '/admin/rbac', icon: Settings },
        { id: 'users', label: 'User Management', to: '/admin/rbac', icon: Users },
      ]
    case 'sales':
      return [
        { id: 'create-so', label: 'Create Order', to: '/orders/new', icon: FilePlus2 },
        { id: 'view-sos', label: 'Sales Orders', to: '/sales-orders', icon: ClipboardList },
        { id: 'customers', label: 'Customers', to: '/customers', icon: Users },
      ]
    case 'purchasing':
      return [
        { id: 'create-po', label: 'Create PO', to: '/purchase-orders/new', icon: ShoppingCart },
        { id: 'view-pos', label: 'Purchase Orders', to: '/purchase-orders', icon: ClipboardList },
        { id: 'scos', label: 'Subcontract Orders', to: '/subcontract-orders', icon: PackagePlus },
      ]
    case 'inventory':
      return [
        { id: 'stock', label: 'Stock Overview', to: '/inventory', icon: Warehouse },
        { id: 'movements', label: 'Stock Movements', to: '/inventory/movements', icon: Boxes },
        { id: 'warehouses', label: 'Warehouses', to: '/inventory/warehouses', icon: Warehouse },
      ]
    case 'finance':
      return [
        { id: 'ar', label: 'AR Aging & Collections', to: '/accounts-receivable', icon: Landmark },
        { id: 'ap', label: 'AP Aging & Payments', to: '/accounts-payable', icon: ClipboardList },
        { id: 'cash', label: 'Cash Management', to: '/cash-management', icon: Landmark },
        { id: 'reports', label: 'Financial Reports', to: '/financial-reports', icon: FileBarChart },
        { id: 'sales-invoices', label: 'Sales Invoices', to: '/sales-invoices', icon: ClipboardList },
        { id: 'supplier-invoices', label: 'Supplier Invoices', to: '/supplier-invoices', icon: ClipboardList },
      ]
  }
}

export function getUrgentSummary(
  view: DashboardRole,
  data: DashboardAggregates,
): DashboardUrgentSummary {
  switch (view) {
    case 'onboarding':
      return {
        count: 0,
        message:
          'Your account is ready. An administrator will assign your role before you can access ERP modules.',
      }
    case 'executive': {
      const count = data.pendingSoApprovals + data.pendingPoApprovals
      return {
        count,
        message:
          count > 0
            ? `You have ${data.pendingSoApprovals} Sales Orders and ${data.pendingPoApprovals} Purchase Orders awaiting approval.`
            : 'No documents are awaiting approval right now.',
      }
    }
    case 'sales':
      return {
        count: data.pendingSoApprovals,
        message:
          data.pendingSoApprovals > 0
            ? `You have ${data.pendingSoApprovals} Sales Orders awaiting approval.`
            : 'No sales orders are awaiting approval.',
      }
    case 'purchasing':
      return {
        count: data.pendingPoApprovals + data.shortageItems.length,
        message:
          data.pendingPoApprovals > 0
            ? `You have ${data.pendingPoApprovals} Purchase Orders awaiting approval.`
            : data.shortageItems.length > 0
              ? `You have ${data.shortageItems.length} material shortage alerts.`
              : 'No purchasing actions are pending.',
      }
    case 'inventory':
      return {
        count: data.lowStockCount + data.outOfStockCount,
        message:
          data.lowStockCount + data.outOfStockCount > 0
            ? `You have ${data.lowStockCount} low-stock and ${data.outOfStockCount} out-of-stock SKUs.`
            : 'Inventory levels look healthy.',
      }
    case 'finance':
      return {
        count: data.overdueInvoices + data.pendingArApprovals.length + data.pendingApApprovals.length,
        message:
          data.overdueInvoices > 0
            ? `You have ${data.overdueInvoices} overdue invoices requiring attention.`
            : data.pendingArApprovals.length + data.pendingApApprovals.length > 0
              ? `You have ${data.pendingArApprovals.length + data.pendingApApprovals.length} invoices/bills pending approval.`
              : 'No finance items are overdue or pending approval.',
      }
  }
}
