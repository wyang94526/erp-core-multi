import { Link, Outlet } from 'react-router-dom'
import './App.css'

function App() {
  return (
    <div className="app-container">
      <header style={{ padding: '20px', backgroundColor: '#f5f5f5', borderBottom: '1px solid #ddd', textAlign: 'center' }}>
        <h1>ERP System</h1>

        <nav style={{ marginTop: '15px', display: 'flex', gap: '20px' }}>
          <Link
            to="/"
            style={{
              textDecoration: 'none',
              color: '#2196F3',
              fontWeight: 'bold',
              fontSize: '16px',
              padding: '8px 12px',
              borderRadius: '4px',
              transition: 'background-color 0.3s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e3f2fd')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Sales Orders
          </Link>
          <Link
            to="/purchase-orders"
            style={{
              textDecoration: 'none',
              color: '#2196F3',
              fontWeight: 'bold',
              fontSize: '16px',
              padding: '8px 12px',
              borderRadius: '4px',
              transition: 'background-color 0.3s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e3f2fd')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Purchase Orders
          </Link>
          <Link
            to="/vendors"
            style={{
              textDecoration: 'none',
              color: '#2196F3',
              fontWeight: 'bold',
              fontSize: '16px',
              padding: '8px 12px',
              borderRadius: '4px',
              transition: 'background-color 0.3s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e3f2fd')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Vendors
          </Link>
          <Link
            to="/products"
            style={{
              textDecoration: 'none',
              color: '#2196F3',
              fontWeight: 'bold',
              fontSize: '16px',
              padding: '8px 12px',
              borderRadius: '4px',
              transition: 'background-color 0.3s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e3f2fd')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Products
          </Link>
          <Link
            to="/customers"
            style={{
              textDecoration: 'none',

              color: '#2196F3',
              fontWeight: 'bold',
              fontSize: '16px',
              padding: '8px 12px',
              borderRadius: '4px',
              transition: 'background-color 0.3s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e3f2fd')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Customers
          </Link>
          <Link
            to="/subcontract-orders"
            style={{
              textDecoration: 'none',
              color: '#2196F3',
              fontWeight: 'bold',
              fontSize: '16px',
              padding: '8px 12px',
              borderRadius: '4px',
              transition: 'background-color 0.3s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e3f2fd')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Subcontract Orders
          </Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}

export default App
