/**
 * ProductForm Component
 * Form for creating and editing products
 */

import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { productService } from '../api/services'

const UOM_OPTIONS = ['Each', 'Box', 'Case', 'Pallet', 'Kg', 'Lb', 'Meter', 'Foot', 'Liter', 'Gallon']

export function ProductForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = !!id

  const [formData, setFormData] = useState({
    product_id: '',
    customer_part_number: '',
    description: '',
    uom: 'Each',
    unit_price: '',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fetch product data if in edit mode
  const {
    data: product,
    isLoading: isLoadingProduct,
    isError: isErrorLoadingProduct,
  } = useQuery({
    queryKey: ['products', id],
    queryFn: () => (id ? productService.getProduct(id) : Promise.resolve(null)),
    enabled: isEditMode,
  })

  // Populate form when product data is loaded
  useEffect(() => {
    if (product) {
      setFormData({
        product_id: product.product_id,
        customer_part_number: product.customer_part_number,
        description: product.description || '',
        uom: product.uom || 'Each',
        unit_price:
          product.unit_price !== null && product.unit_price !== undefined
            ? String(product.unit_price)
            : '',
      })
    }
  }, [product])


  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      productService.createProduct({
        product_id: data.product_id,
        customer_part_number: data.customer_part_number,
        description: data.description || undefined,
        uom: data.uom || undefined,
        unit_price: data.unit_price !== '' ? Number(data.unit_price) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      navigate('/products')
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to create product',
      })
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      productService.updateProduct(id!, {
        customer_part_number: data.customer_part_number,
        description: data.description || undefined,
        uom: data.uom || undefined,
        unit_price: data.unit_price !== '' ? Number(data.unit_price) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      navigate('/products')
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to update product',
      })
    },
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.product_id.trim()) {
      newErrors.product_id = 'Product ID is required'
    }
    if (!formData.customer_part_number.trim()) {
      newErrors.customer_part_number = 'Customer Part Number is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    if (isEditMode) {
      updateMutation.mutate(formData)
    } else {
      createMutation.mutate(formData)
    }
  }

  if (isEditMode && isLoadingProduct) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading product...</p>
        </div>
      </div>
    )
  }

  if (isEditMode && isErrorLoadingProduct) {
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

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>{isEditMode ? 'Edit Product' : 'Create New Product'}</h2>
          <p style={pageSubStyle}>Manage product catalog information</p>
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Product Information</h3>
          <div style={gridStyle}>
            {/* Product ID Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="product_id" style={labelStyle}>
                Product ID *
              </label>
              <input
                type="text"
                id="product_id"
                name="product_id"
                value={formData.product_id}
                onChange={handleChange}
                disabled={isEditMode}
                style={{
                  ...inputStyle,
                  backgroundColor: isEditMode ? 'var(--social-bg)' : 'var(--bg)',
                  cursor: isEditMode ? 'not-allowed' : 'text',
                  border: errors.product_id ? '1px solid #f44336' : '1px solid var(--border)',
                }}
                placeholder="e.g. PROD-001"
              />
              {errors.product_id && <span style={errorTextStyle}>{errors.product_id}</span>}
            </div>

            {/* Customer Part Number Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="customer_part_number" style={labelStyle}>
                Customer Part Number *
              </label>
              <input
                type="text"
                id="customer_part_number"
                name="customer_part_number"
                value={formData.customer_part_number}
                onChange={handleChange}
                style={{
                  ...inputStyle,
                  border: errors.customer_part_number ? '1px solid #f44336' : '1px solid var(--border)',
                }}
                placeholder="Enter customer part number"
              />
              {errors.customer_part_number && (
                <span style={errorTextStyle}>{errors.customer_part_number}</span>
              )}
            </div>

            {/* UOM Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="uom" style={labelStyle}>
                Unit of Measure (UOM)
              </label>
              <select
                id="uom"
                name="uom"
                value={formData.uom}
                onChange={handleChange}
                style={inputStyle}
              >
                {UOM_OPTIONS.map((uom) => (
                  <option key={uom} value={uom}>
                    {uom}
                  </option>
                ))}
              </select>
            </div>

            {/* Unit Price Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="unit_price" style={labelStyle}>
                Unit Price
              </label>
              <input
                type="number"
                id="unit_price"
                name="unit_price"
                value={formData.unit_price}
                onChange={handleChange}
                min="0"
                step="0.01"
                style={inputStyle}
                placeholder="Enter unit price (optional)"
              />
              {errors.unit_price && <span style={errorTextStyle}>{errors.unit_price}</span>}
            </div>

            {/* Description Field - full width */}
            <div style={{ ...fieldGroupStyle, gridColumn: '1 / -1' }}>
              <label htmlFor="description" style={labelStyle}>
                Description
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }}
                placeholder="Enter product description (optional)"
              />
            </div>
          </div>
        </div>

        {/* Submit Error */}
        {errors.submit && (
          <div style={errorAlertStyle}>
            <span>⚠️ {errors.submit}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...primaryButtonStyle,
              backgroundColor: isSubmitting ? '#90caf9' : '#1976d2',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Saving...' : isEditMode ? 'Update Product' : 'Create Product'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/products')}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ==========================================
// STYLES
// ==========================================

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '800px',
  margin: '0 auto',
  textAlign: 'left',
}

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
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

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
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
  marginBottom: '6px',
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

const errorTextStyle: React.CSSProperties = {
  color: '#f44336',
  fontSize: '12px',
  marginTop: '4px',
  fontWeight: '500',
}

const errorAlertStyle: React.CSSProperties = {
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: '6px',
  padding: '12px 20px',
  marginBottom: '20px',
  fontSize: '14px',
  fontWeight: 'bold',
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

export default ProductForm
