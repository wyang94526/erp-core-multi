/**
 * VendorForm Component
 * Form for creating and editing vendors/suppliers
 */

import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { vendorService } from '../api/services'

const PAYMENT_TERMS_OPTIONS = ['Due on Receipt', 'Net 15', 'Net 30', 'Net 60', 'Net 90']

export function VendorForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = !!id

  const [formData, setFormData] = useState({
    supplier_id: '',
    company_name: '',
    contact_name: '',
    contact_email: '',
    phone_number: '',
    address_line1: '',
    city: '',
    state: '',
    postal_code: '',
    country: '',
    vendor_number_ext: '',
    payment_terms: 'Net 30',
    status: 'Active',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fetch vendor data if in edit mode
  const {
    data: vendor,
    isLoading: isLoadingVendor,
    isError: isErrorLoadingVendor,
  } = useQuery({
    queryKey: ['vendors', id],
    queryFn: () => (id ? vendorService.getVendor(id) : Promise.resolve(null)),
    enabled: isEditMode,
  })

  // Populate form when vendor data is loaded
  useEffect(() => {
    if (vendor) {
      setFormData({
        supplier_id: vendor.supplier_id,
        company_name: vendor.company_name,
        contact_name: vendor.contact_name || '',
        contact_email: vendor.contact_email || '',
        phone_number: vendor.phone_number || '',
        address_line1: vendor.address_line1 || '',
        city: vendor.city || '',
        state: vendor.state || '',
        postal_code: vendor.postal_code || '',
        country: vendor.country || '',
        vendor_number_ext: vendor.vendor_number_ext || '',
        payment_terms: vendor.payment_terms || 'Net 30',
        status: vendor.status || 'Active',
      })
    }
  }, [vendor])

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      vendorService.createVendor({
        supplier_id: data.supplier_id,
        company_name: data.company_name,
        contact_name: data.contact_name || undefined,
        contact_email: data.contact_email || undefined,
        phone_number: data.phone_number || undefined,
        address_line1: data.address_line1 || undefined,
        city: data.city || undefined,
        state: data.state || undefined,
        postal_code: data.postal_code || undefined,
        country: data.country || undefined,
        vendor_number_ext: data.vendor_number_ext || undefined,
        payment_terms: data.payment_terms || undefined,
        status: data.status || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      navigate('/vendors')
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to create vendor',
      })
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      vendorService.updateVendor(id!, {
        company_name: data.company_name,
        contact_name: data.contact_name || undefined,
        contact_email: data.contact_email || undefined,
        phone_number: data.phone_number || undefined,
        address_line1: data.address_line1 || undefined,
        city: data.city || undefined,
        state: data.state || undefined,
        postal_code: data.postal_code || undefined,
        country: data.country || undefined,
        vendor_number_ext: data.vendor_number_ext || undefined,
        payment_terms: data.payment_terms || undefined,
        status: data.status || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      navigate('/vendors')
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to update vendor',
      })
    },
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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

    if (!formData.supplier_id.trim()) {
      newErrors.supplier_id = 'Vendor ID is required'
    }
    if (!formData.company_name.trim()) {
      newErrors.company_name = 'Company Name is required'
    }
    if (formData.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contact_email)) {
      newErrors.contact_email = 'Please enter a valid email address'
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

  if (isEditMode && isLoadingVendor) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading vendor...</p>
        </div>
      </div>
    )
  }

  if (isEditMode && isErrorLoadingVendor) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error loading vendor</p>
          <button onClick={() => navigate('/vendors')} style={secondaryButtonStyle}>
            Back to Vendors
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
          <h2 style={pageTitleStyle}>{isEditMode ? 'Edit Vendor' : 'Create New Vendor'}</h2>
          <p style={pageSubStyle}>Manage vendor / supplier account information</p>
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Vendor Information</h3>
          <div style={gridStyle}>
            {/* Vendor ID */}
            <div style={fieldGroupStyle}>
              <label htmlFor="supplier_id" style={labelStyle}>
                Vendor ID *
              </label>
              <input
                type="text"
                id="supplier_id"
                name="supplier_id"
                value={formData.supplier_id}
                onChange={handleChange}
                disabled={isEditMode}
                style={{
                  ...inputStyle,
                  backgroundColor: isEditMode ? 'var(--social-bg)' : 'var(--bg)',
                  cursor: isEditMode ? 'not-allowed' : 'text',
                  border: errors.supplier_id ? '1px solid #f44336' : '1px solid var(--border)',
                }}
                placeholder="e.g. SUP-006"
              />
              {errors.supplier_id && <span style={errorTextStyle}>{errors.supplier_id}</span>}
            </div>

            {/* Company Name */}
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

            {/* Vendor Number Ext */}
            <div style={fieldGroupStyle}>
              <label htmlFor="vendor_number_ext" style={labelStyle}>
                Vendor Number (External)
              </label>
              <input
                type="text"
                id="vendor_number_ext"
                name="vendor_number_ext"
                value={formData.vendor_number_ext}
                onChange={handleChange}
                style={inputStyle}
                placeholder="Optional external reference number"
              />
            </div>

            {/* Contact Name */}
            <div style={fieldGroupStyle}>
              <label htmlFor="contact_name" style={labelStyle}>
                Contact Name
              </label>
              <input
                type="text"
                id="contact_name"
                name="contact_name"
                value={formData.contact_name}
                onChange={handleChange}
                style={inputStyle}
                placeholder="Optional"
              />
            </div>

            {/* Contact Email */}
            <div style={fieldGroupStyle}>
              <label htmlFor="contact_email" style={labelStyle}>
                Contact Email
              </label>
              <input
                type="email"
                id="contact_email"
                name="contact_email"
                value={formData.contact_email}
                onChange={handleChange}
                style={{
                  ...inputStyle,
                  border: errors.contact_email ? '1px solid #f44336' : '1px solid var(--border)',
                }}
                placeholder="Optional"
              />
              {errors.contact_email && <span style={errorTextStyle}>{errors.contact_email}</span>}
            </div>

            {/* Phone Number */}
            <div style={fieldGroupStyle}>
              <label htmlFor="phone_number" style={labelStyle}>
                Phone Number
              </label>
              <input
                type="text"
                id="phone_number"
                name="phone_number"
                value={formData.phone_number}
                onChange={handleChange}
                style={inputStyle}
                placeholder="Optional"
              />
            </div>

            {/* Address Line 1 */}
            <div style={fieldGroupStyle}>
              <label htmlFor="address_line1" style={labelStyle}>
                Address
              </label>
              <input
                type="text"
                id="address_line1"
                name="address_line1"
                value={formData.address_line1}
                onChange={handleChange}
                style={inputStyle}
                placeholder="Street Address (optional)"
              />
            </div>

            {/* City */}
            <div style={fieldGroupStyle}>
              <label htmlFor="city" style={labelStyle}>City</label>
              <input
                type="text"
                id="city"
                name="city"
                value={formData.city}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>

            {/* State */}
            <div style={fieldGroupStyle}>
              <label htmlFor="state" style={labelStyle}>State</label>
              <input
                type="text"
                id="state"
                name="state"
                value={formData.state}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>

            {/* Postal Code */}
            <div style={fieldGroupStyle}>
              <label htmlFor="postal_code" style={labelStyle}>Postal Code</label>
              <input
                type="text"
                id="postal_code"
                name="postal_code"
                value={formData.postal_code}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>

            {/* Country */}
            <div style={fieldGroupStyle}>
              <label htmlFor="country" style={labelStyle}>Country</label>
              <input
                type="text"
                id="country"
                name="country"
                value={formData.country}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>

            {/* Payment Terms */}
            <div style={fieldGroupStyle}>
              <label htmlFor="payment_terms" style={labelStyle}>Payment Terms</label>
              <select
                id="payment_terms"
                name="payment_terms"
                value={formData.payment_terms}
                onChange={handleChange}
                style={inputStyle}
              >
                {PAYMENT_TERMS_OPTIONS.map((term) => (
                  <option key={term} value={term}>
                    {term}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div style={fieldGroupStyle}>
              <label htmlFor="status" style={labelStyle}>Status</label>
              <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                style={inputStyle}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
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
            {isSubmitting ? 'Saving...' : isEditMode ? 'Update Vendor' : 'Create Vendor'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/vendors')}
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
  maxWidth: '900px',
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

export default VendorForm
