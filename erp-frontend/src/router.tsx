/**
 * Router Configuration
 * Defines all routes for the ERP application using React Router v8
 */

import { createBrowserRouter, Navigate, useLocation, useParams } from 'react-router-dom'
import App from './App'
import RequireAuth from './components/RequireAuth'
import LoginPage from './components/LoginPage'
import RegisterPage from './components/RegisterPage'
import ChangePasswordPage from './components/ChangePasswordPage'
import ResetPasswordPage from './components/ResetPasswordPage'
import SalesOrderList from './components/SalesOrderList'
import SalesOrderDetail from './components/SalesOrderDetail'
import SalesOrderForm from './components/SalesOrderForm'
import ItemFulfillmentList from './components/ItemFulfillmentList'
import ItemFulfillmentForm from './components/ItemFulfillmentForm'
import SalesInvoiceList from './components/SalesInvoiceList'
import SalesInvoiceForm from './components/SalesInvoiceForm'
import CustomerList from './components/CustomerList'
import CustomerForm from './components/CustomerForm'
import PurchaseOrderList from './components/PurchaseOrderList'
import PurchaseOrderForm from './components/PurchaseOrderForm'
import VendorList from './components/VendorList'
import VendorForm from './components/VendorForm'
import ItemList from './components/ItemList'
import ItemForm from './components/ItemForm'
import ItemDetail from './components/ItemDetail'

import SubcontractOrderList from './components/SubcontractOrderList'
import SubcontractOrderForm from './components/SubcontractOrderForm'
import SubcontractOrderDetail from './components/SubcontractOrderDetail'

import ChartOfAccounts from './components/ChartOfAccounts'
import ARInvoices from './components/ARInvoices'
import APBills from './components/APBills'
import SupplierInvoiceList from './components/SupplierInvoiceList'
import SupplierInvoiceForm from './components/SupplierInvoiceForm'
import CashManagement from './components/CashManagement'
import GeneralLedger from './components/GeneralLedger'
import InventoryOverview from './components/InventoryOverview'
import StockMovements from './components/StockMovements'
import WarehousesBins from './components/WarehousesBins'
import AdminRbacPage from './components/AdminRbacPage'
import DataImportPreview from './components/DataImportPreview'
import Dashboard from './components/Dashboard'

/** Legacy /products/:id → /items/:id */
function RedirectProductToItem({ edit = false }: { edit?: boolean }) {
  const { id } = useParams<{ id: string }>()
  const to = edit ? `/items/${id}/edit` : `/items/${id}`
  return <Navigate to={to} replace />
}

/** Preserve query string when renaming frontend paths */
function RedirectPreserveSearch({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/register',
    element: <RegisterPage />,
  },
  {
    path: '/change-password',
    element: <ChangePasswordPage />,
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <App />
      </RequireAuth>
    ),
    children: [
      {
        index: true,
        element: <Dashboard />,
      },
      {
        path: 'sales-orders',
        element: <SalesOrderList />,
      },
      {
        path: 'sales-orders/:id',
        element: <SalesOrderDetail />,
      },
      {
        path: 'sales-orders/:id/fulfill',
        element: <ItemFulfillmentForm />,
      },
      {
        path: 'sales-orders/:id/invoice',
        element: <SalesInvoiceForm />,
      },
      {
        path: 'fulfillments',
        element: <ItemFulfillmentList />,
      },
      {
        path: 'sales-invoices',
        element: <SalesInvoiceList />,
      },
      {
        path: 'purchase-orders',
        element: <PurchaseOrderList />,
      },
      {
        path: 'purchase-orders/new',
        element: <PurchaseOrderForm />,
      },
      {
        path: 'purchase-orders/:id',
        element: <PurchaseOrderForm />,
      },
      {
        path: 'orders/new',
        element: <SalesOrderForm />,
      },
      {
        path: 'orders/:id',
        element: <SalesOrderDetail />,
      },
      {
        path: 'orders/:id/fulfill',
        element: <ItemFulfillmentForm />,
      },
      {
        path: 'orders/:id/invoice',
        element: <SalesInvoiceForm />,
      },
      {
        path: 'orders/:id/edit',
        element: <SalesOrderForm />,
      },
      {
        path: 'customers',
        element: <CustomerList />,
      },
      {
        path: 'customers/new',
        element: <CustomerForm />,
      },
      {
        path: 'customers/:id/edit',
        element: <CustomerForm />,
      },
      {
        path: 'vendors',
        element: <VendorList />,
      },
      {
        path: 'vendors/new',
        element: <VendorForm />,
      },
      {
        path: 'vendors/:id/edit',
        element: <VendorForm />,
      },
      {
        path: 'items',
        element: <ItemList />,
      },
      {
        path: 'items/new',
        element: <ItemForm />,
      },
      {
        path: 'items/:id',
        element: <ItemDetail />,
      },
      {
        path: 'items/:id/edit',
        element: <ItemForm />,
      },
      // Legacy Product routes → Items
      { path: 'products', element: <Navigate to="/items" replace /> },
      { path: 'products/new', element: <Navigate to="/items/new" replace /> },
      { path: 'products/:id', element: <RedirectProductToItem /> },
      { path: 'products/:id/edit', element: <RedirectProductToItem edit /> },

      {
        path: 'subcontract-orders',
        element: <SubcontractOrderList />,
      },
      {
        path: 'subcontract-orders/new',
        element: <SubcontractOrderForm />,
      },
      {
        path: 'subcontract-orders/:id',
        element: <SubcontractOrderDetail />,
      },

      {
        path: 'inventory',
        element: <InventoryOverview />,
      },
      {
        path: 'inventory/movements',
        element: <StockMovements />,
      },
      {
        path: 'inventory/warehouses',
        element: <WarehousesBins />,
      },

      {
        path: 'chart-of-accounts',
        element: <ChartOfAccounts />,
      },
      {
        path: 'accounts-receivable',
        element: <ARInvoices />,
      },
      {
        path: 'accounts-payable',
        element: <APBills />,
      },
      {
        path: 'supplier-invoices',
        element: <SupplierInvoiceList />,
      },
      {
        path: 'supplier-invoices/new',
        element: <SupplierInvoiceForm />,
      },
      {
        path: 'cash-management',
        element: <CashManagement />,
      },
      {
        path: 'general-ledger',
        element: <GeneralLedger />,
      },
      // Legacy finance path redirects (preserve filters / deep links)
      {
        path: 'ar-invoices',
        element: <RedirectPreserveSearch to="/accounts-receivable" />,
      },
      {
        path: 'ap-bills',
        element: <RedirectPreserveSearch to="/accounts-payable" />,
      },
      {
        path: 'vendor-invoices',
        element: <RedirectPreserveSearch to="/supplier-invoices" />,
      },
      {
        path: 'vendor-invoices/new',
        element: <RedirectPreserveSearch to="/supplier-invoices/new" />,
      },
      {
        path: 'admin/rbac',
        element: <AdminRbacPage />,
      },
      {
        path: 'admin/data-import',
        element: <DataImportPreview />,
      },
    ],
  },
])

export default router
