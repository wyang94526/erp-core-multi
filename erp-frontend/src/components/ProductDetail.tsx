/**
 * ProductDetail Component
 * Displays full details of a product and provides a UI for managing its
 * Bill of Materials (BOM) — the raw-material components required to build
 * this product, used when creating Subcontract Orders (outside processing).
 */

import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { productService, productBomService } from '../api/services'
import type { Product } from '../types'

export function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [showAddForm, setShowAddForm] = useState(false)
  const [newComponent, setNewComponent] = useState({
    component_product_id: '',
    quantity_per: '',
  })
  const [formError, setFormError] = useState('')

  if (!id) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error: No product ID provided</p>
        </div>
      </div>
    )
  }

  const {
    data: product,
    isLoading: isLoadingProduct,
    isError: isErrorProduct,
  } = useQuery({
    queryKey: ['products', id],
    queryFn: () => productService.getProduct(id),
  })

  const {
    data: bomComponents = [],
    isLoading: isLoadingBom,
  } = useQuery({
    queryKey: ['productBom', id],
    queryFn: () => productBomService.listBomComponents(id),
  })

  // Fetch all products so the user can pick a component from a dropdown
  const { data: allProducts = [] } = useQuery({
    queryKey: ['products', 0, 1000],
    queryFn: () => productService.listProducts(0, 1000),
  })

  const addMutation = useMutation({
    mutationFn: (data: { component_product_id: string; quantity_per: number }) =>
      productBomService.addBomComponent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBom', id] })
      setShowAddForm(false)
      setNewComponent({ component_product_id: '', quantity_per: '' })
      setFormError('')
    },
    onError: (error: any) => {
      setFormError(error.message || 'Failed to add BOM component')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (bomId: number) => productBomService.deleteBomComponent(id, bomId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBom', id] })
    },
  })

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    if (!newComponent.component_product_id.trim()) {
      setFormError('Please select a component product')
      return
    }
    if (!newComponent.quantity_per || Number(newComponent.quantity_per) <= 0) {
      setFormError('Quantity per must be greater than 0')
      return
    }
    if (newComponent.component_product_id === id) {
      setFormError('A product cannot be a component of itself')
      return
    }

    addMutation.mutate({
      component_product_id: newComponent.component_product_id,
      quantity_per: Number(newComponent.quantity_per),
    })
  }

  if (isLoadingProduct || isLoadingBom) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading product...</p>
        </div>
      </div>
    )
  }

  if (isErrorProduct || !product) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error loading product</p>
          <button onClick={() => navigate('/products')} style={secondaryButtonStyle}>
            Back to Products
          </button>
        </div>
      </div>
    )
  }

  // Products available to add as a component (excludes the current product itself
  // and any already on the BOM)
  const existingComponentIds = new Set(bomComponents.map((c) => c.component_product_id))
  const availableComponents = allProducts.filter(
    (p: Product) => p.product_id !== id && !existingComponentIds.has(p.product_id)
  )

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Product Details</h2>
          <p style={pageSubStyle}>Viewing {product.product_id}</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => navigate(`/products/${product.product_id}/edit`)} style={secondaryButtonStyle}>
            Edit Product
          </button>
          <button onClick={() => navigate('/products')} style={secondaryButtonStyle}>
            Back to Products
          </button>
        </div>
      </header>

      {/* Product Info */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Product Information</h3>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Product ID</label>
            <p style={valueStyle}>{product.product_id}</p>
          </div>
          <div>
            <label style={labelStyle}>Customer Part Number</label>
            <p style={valueStyle}>{product.customer_part_number}</p>
          </div>
          <div>
            <label style={labelStyle}>UOM</label>
            <p style={valueStyle}>{product.uom}</p>
          </div>
          <div>
            <label style={labelStyle}>Unit Price</label>
            <p style={valueStyle}>{formatCurrency(product.unit_price)}</p>
          </div>
          <div>
            <label style={labelStyle}>On-Hand Quantity</label>
            <p style={valueStyle}>{product.on_hand_quantity ?? 0}</p>
          </div>
          <div>
            <label style={labelStyle}>WIP Quantity (at Subcontractor)</label>
            <p style={valueStyle}>{product.wip_quantity ?? 0}</p>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Description</label>
            <p style={valueStyle}>{product.description || '-'}</p>
          </div>
        </div>
      </div>

      {/* Bill of Materials */}
      <div style={cardStyle}>
        <div style={tableHeaderContainerStyle}>
          <h3 style={sectionHeadingStyleNoBorder}>Bill of Materials (BOM)</h3>
          <button type="button" onClick={() => setShowAddForm((v) => !v)} style={addButtonStyle}>
            {showAddForm ? 'Cancel' : '+ Add Component'}
          </button>
        </div>
        <p style={{ ...pageSubStyle, marginBottom: '16px' }}>
          Raw materials/components required to build one unit of this product. Used to
          automatically calculate requirements when creating a Subcontract Order.
        </p>

        {showAddForm && (
          <form onSubmit={handleAddSubmit} style={{ marginBottom: '20px' }}>
            <div style={gridStyle}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Component Product *</label>
                <select
                  value={newComponent.component_product_id}
                  onChange={(e) =>
                    setNewComponent((prev) => ({ ...prev, component_product_id: e.target.value }))
                  }
                  style={inputStyle}
                >
                  <option value="">Select a component product</option>
                  {availableComponents.map((p: Product) => (
                    <option key={p.product_id} value={p.product_id}>
                      {p.description || p.product_id} ({p.product_id})
                    </option>
                  ))}
                </select>
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Quantity Per Unit *</label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={newComponent.quantity_per}
                  onChange={(e) => setNewComponent((prev) => ({ ...prev, quantity_per: e.target.value }))}
                  style={inputStyle}
                  placeholder="e.g. 2"
                />
              </div>
            </div>

            {formError && (
              <div style={{ ...errorAlertStyle, marginTop: '16px' }}>
                <span>⚠️ {formError}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button
                type="submit"
                disabled={addMutation.isPending}
                style={{
                  ...primaryButtonStyle,
                  backgroundColor: addMutation.isPending ? '#90caf9' : '#1976d2',
                  cursor: addMutation.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {addMutation.isPending ? 'Adding...' : 'Add Component'}
              </button>
            </div>
          </form>
        )}

        {bomComponents.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Component Product ID</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Quantity Per Unit</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bomComponents.map((bc) => (
                  <tr key={bc.bom_id} style={tbodyRowStyle}>
                    <td style={tdStyle}>{bc.component_product_id}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{Number(bc.quantity_per)}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button
                        onClick={() => deleteMutation.mutate(bc.bom_id)}
                        disabled={deleteMutation.isPending}
                        style={{
                          ...directoryActionButtonStyle,
                          backgroundColor: '#ffebee',
                          color: '#c62828',
                          border: '1px solid #ffcdd2',
                          cursor: deleteMutation.isPending ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: 'var(--text)', fontStyle: 'italic' }}>
            No BOM components defined yet. Add components above to enable this product for
            subcontract orders.
          </p>
        )}
      </div>
    </div>
  )
}

// ==========================================
// HELPER FUNCTIONS & STYLES
// ==========================================

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1000px',
  margin: '0 auto',
  textAlign: 'left',
}

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
}

const pageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const pageSubStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  fontSize: '14px',
  color: 'var(--text)',
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
}

const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  borderBottom: '2px solid var(--border)',
  paddingBottom: '8px',
}

const sectionHeadingStyleNoBorder: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const tableHeaderContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '8px',
}

const addButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
  fontFamily: 'inherit',
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '20px',
}

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
}

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  marginBottom: '4px',
  display: 'block',
}

const valueStyle: React.CSSProperties = {
  color: 'var(--text)',
  margin: 0,
  fontSize: '14px',
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '14px',
  color: 'var(--text-h)',
  backgroundColor: 'var(--bg)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const errorAlertStyle: React.CSSProperties = {
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: '6px',
  padding: '12px 20px',
  fontSize: '14px',
  fontWeight: 'bold',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
}

const theadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
}

const thStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const tbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
}

const directoryActionButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '11px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
  fontFamily: 'inherit',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

export default ProductDetail
