/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
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
import InvoiceDetail from './components/InvoiceDetail'
import BillDetail from './components/BillDetail'
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
import GoodsReceiptDetail from './components/GoodsReceiptDetail'
import GoodsReceiptList from './components/GoodsReceiptList'

import ChartOfAccounts from './components/ChartOfAccounts'
import PostingRules from './components/PostingRules'
import PaymentTerms from './components/PaymentTerms'
import ARInvoices from './components/ARInvoices'
import APBills from './components/APBills'
import SupplierInvoiceList from './components/SupplierInvoiceList'
import SupplierInvoiceForm from './components/SupplierInvoiceForm'
import CashManagement from './components/CashManagement'
import BankAccounts from './components/BankAccounts'
import BankAccountDetail from './components/BankAccountDetail'
import BankAccountForm from './components/BankAccountForm'
import BankTransferList from './components/BankTransferList'
import BankTransferForm from './components/BankTransferForm'
import BankTransferDetail from './components/BankTransferDetail'
import GeneralLedger from './components/GeneralLedger'
import { ManualJournalEntryPage } from './components/ManualJournalEntryPage'
import { MonthEndClosePage } from './components/MonthEndClosePage'
import { YearEndClosePage } from './components/YearEndClosePage'
import FinancialReports from './components/FinancialReports'
import FinancialReportViewer from './components/FinancialReportViewer'
import InventoryOverview from './components/InventoryOverview'
import StockMovements from './components/StockMovements'
import WarehousesBins from './components/WarehousesBins'
import AdminRbacPage from './components/AdminRbacPage'
import DataImportPreview from './components/DataImportPreview'
import Dashboard from './components/Dashboard'
import UserGuide from './components/help/UserGuide'
import WorkflowGuides from './components/help/WorkflowGuides'

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

function RedirectUserGuideArticle() {
  const { articleId } = useParams<{ articleId: string }>()
  return <RedirectPreserveSearch to={`/help/${articleId}`} />
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
        path: 'help',
        element: <UserGuide />,
      },
      {
        path: 'help/workflows',
        element: <WorkflowGuides />,
      },
      {
        path: 'help/:articleId',
        element: <UserGuide />,
      },
      {
        path: 'user-guide',
        element: <Navigate to="/help" replace />,
      },
      {
        path: 'user-guide/:articleId',
        element: <RedirectUserGuideArticle />,
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
        path: 'sales-invoices/:invoiceId',
        element: <InvoiceDetail />,
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
        path: 'goods-receipts',
        element: <GoodsReceiptList />,
      },
      {
        path: 'goods-receipts/:receiptId',
        element: <GoodsReceiptDetail />,
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
        path: 'payment-terms',
        element: <PaymentTerms />,
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
        path: 'posting-rules',
        element: <PostingRules />,
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
        path: 'supplier-invoices/:invoiceId/edit',
        element: <SupplierInvoiceForm />,
      },
      {
        path: 'supplier-invoices/:invoiceId',
        element: <BillDetail />,
      },
      {
        path: 'cash-management',
        element: <CashManagement />,
      },
      {
        path: 'cash-management/bank-accounts',
        element: <Navigate to="/bank-accounts" replace />,
      },
      {
        path: 'bank-accounts',
        element: <BankAccounts />,
      },
      {
        path: 'bank-accounts/new',
        element: <BankAccountForm />,
      },
      {
        path: 'bank-accounts/:id/edit',
        element: <BankAccountForm />,
      },
      {
        path: 'bank-accounts/:id',
        element: <BankAccountDetail />,
      },
      {
        path: 'bank-transfers',
        element: <BankTransferList />,
      },
      {
        path: 'bank-transfers/new',
        element: <BankTransferForm />,
      },
      {
        path: 'bank-transfers/:id/edit',
        element: <BankTransferForm />,
      },
      {
        path: 'bank-transfers/:id',
        element: <BankTransferDetail />,
      },
      {
        path: 'general-ledger',
        element: <GeneralLedger />,
      },
      {
        path: 'general-ledger/journals/new',
        element: <ManualJournalEntryPage />,
      },
      {
        path: 'general-ledger/journals/:id/edit',
        element: <ManualJournalEntryPage />,
      },
      {
        path: 'general-ledger/month-end-close',
        element: <MonthEndClosePage />,
      },
      {
        path: 'general-ledger/year-end-close',
        element: <YearEndClosePage />,
      },
      {
        path: 'financial-reports',
        element: <FinancialReports />,
      },
      {
        path: 'financial-reports/:reportType',
        element: <FinancialReportViewer />,
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
