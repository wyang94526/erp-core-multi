/**
 * Router Configuration
 * Defines all routes for the ERP application using React Router v8
 */

import { createBrowserRouter } from 'react-router-dom'
import App from './App'
import SalesOrderList from './components/SalesOrderList'
import SalesOrderDetail from './components/SalesOrderDetail'
import SalesOrderForm from './components/SalesOrderForm'
import CustomerList from './components/CustomerList'
import CustomerForm from './components/CustomerForm'
import PurchaseOrderForm from './components/PurchaseOrderForm'
import VendorList from './components/VendorList'
import VendorForm from './components/VendorForm'
import ProductList from './components/ProductList'
import ProductForm from './components/ProductForm'
import ProductDetail from './components/ProductDetail'

import SubcontractOrderList from './components/SubcontractOrderList'
import SubcontractOrderForm from './components/SubcontractOrderForm'
import SubcontractOrderDetail from './components/SubcontractOrderDetail'


export const router = createBrowserRouter([

  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <SalesOrderList />,
      },
      {
        path: 'purchase-orders',
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
        path: 'products',
        element: <ProductList />,
      },
      {
        path: 'products/new',
        element: <ProductForm />,
      },
      {
        path: 'products/:id',
        element: <ProductDetail />,
      },
      {
        path: 'products/:id/edit',
        element: <ProductForm />,
      },

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
    ],


  },
])

export default router
