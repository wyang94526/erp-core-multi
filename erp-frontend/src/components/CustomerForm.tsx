/**
 * CustomerForm Component
 * Form for creating and editing customers
 */

import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { customerService } from '../api/services'

export function CustomerForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = !!id

  const [formData, setFormData] = useState({
    customer_id: '',
    customer_number_ext: '',
    company_name: '',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fetch customer data if in edit mode
  const {
    data: customer,
    isLoading: isLoadingCustomer,
    isError: isErrorLoadingCustomer,
  } = useQuery({
    queryKey: ['customers', id],
    queryFn: () => (id ? customerService.getCustomer(id) : Promise.resolve(null)),
    enabled: isEditMode,
  })

  // Populate form when customer data is loaded
  useEffect(() => {
    if (customer) {
      setFormData({
        customer_id: customer.customer_id,
        customer_number_ext: customer.customer_number_ext || '',
        company_name: customer.company_name,
      })
    }
  }, [customer])

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      customerService.createCustomer({
        customer_id: data.customer_id,
        customer_number_ext: data.customer_number_ext || undefined,
        company_name: data.company_name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      navigate('/customers')
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to create customer',
      })
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      customerService.updateCustomer(id!, {
        customer_number_ext: data.customer_number_ext || undefined,
        company_name: data.company_name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      navigate('/customers')
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to update customer',
      })
    },
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
    // Clear error for this field
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

    if (!formData.customer_id.trim()) {
      newErrors.customer_id = 'Customer ID is required'
    }
    if (!formData.company_name.trim()) {
      newErrors.company_name = 'Company Name is required'
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

  if (isEditMode && isLoadingCustomer) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading customer...</p>
        </div>
      </div>
    )
  }

  if (isEditMode && isErrorLoadingCustomer) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error loading customer</p>
          <button onClick={() => navigate('/customers')} style={secondaryButtonStyle}>
            Back to Customers
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
          <h2 style={pageTitleStyle}>{isEditMode ? 'Edit Customer' : 'Create New Customer'}</h2>
          <p style={pageSubStyle}>Manage customer account information</p>
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Customer Information</h3>
          <div style={gridStyle}>
            {/* Customer ID Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="customer_id" style={labelStyle}>
                Customer ID *
              </label>
              <input
                type="text"
                id="customer_id"
                name="customer_id"
                value={formData.customer_id}
                onChange={handleChange}
                disabled={isEditMode}
                style={{
                  ...inputStyle,
                  backgroundColor: isEditMode ? 'var(--social-bg)' : 'var(--bg)',
                  cursor: isEditMode ? 'not-allowed' : 'text',
                  border: errors.customer_id ? '1px solid #f44336' : '1px solid var(--border)',
                }}
                placeholder="Enter customer ID"
              />
              {errors.customer_id && <span style={errorTextStyle}>{errors.customer_id}</span>}
            </div>

            {/* Company Name Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="company_name" style={labelStyle}>
                Company Name *
              </label>
              <input
                type="text"
                id="company_name"
                name="company_name"
                value={formData.company_name}
                onChange={handleChange}
                style={{
                  ...inputStyle,
                  border: errors.company_name ? '1px solid #f44336' : '1px solid var(--border)',
                }}
                placeholder="Enter company name"
              />
              {errors.company_name && <span style={errorTextStyle}>{errors.company_name}</span>}
            </div>

            {/* Customer Number Ext Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="customer_number_ext" style={labelStyle}>
                Customer Number Ext
              </label>
              <input
                type="text"
                id="customer_number_ext"
                name="customer_number_ext"
                value={formData.customer_number_ext}
                onChange={handleChange}
                style={inputStyle}
                placeholder="Enter customer number extension (optional)"
              />
              {errors.customer_number_ext && (
                <span style={errorTextStyle}>{errors.customer_number_ext}</span>
              )}
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
            {isSubmitting ? 'Saving...' : isEditMode ? 'Update Customer' : 'Create Customer'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/customers')}
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

export default CustomerForm
