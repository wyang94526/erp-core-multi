/**
 * SubcontractOrderForm Component
 * Form for creating a new Subcontract Order (SCO).
 * The backend automatically populates required component quantities from
 * the selected finished product's Bill of Materials (BOM), scaled by the
 * order quantity, so this form only needs to capture the header fields.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { subcontractOrderService, vendorService, itemService, itemBomService } from '../api/services'
import type { Supplier, Item } from '../types'

export function SubcontractOrderForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState({
    sco_number: '',
    supplier_id: '',
    product_id: '',
    quantity_ordered: 1,
    order_date: new Date().toISOString().split('T')[0],
    expected_return_date: '',
    notes: '',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fetch suppliers/vendors
  const { data: suppliers = [] } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => vendorService.listVendors(0, 1000),
  })

  // Fetch products (finished goods that could be subcontracted)
  const { data: products = [] } = useQuery({
    queryKey: ['items'],
    queryFn: () => itemService.listItems(0, 1000),
  })

  // Fetch BOM preview for the selected product so the user can see what will be required
  const { data: bomComponents = [] } = useQuery({
    queryKey: ['productBom', formData.product_id],
    queryFn: () => itemBomService.listBomComponents(formData.product_id),
    enabled: !!formData.product_id,
  })

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      subcontractOrderService.createSubcontractOrder({
        sco_number: data.sco_number,
        supplier_id: data.supplier_id,
        product_id: data.product_id,
        quantity_ordered: Number(data.quantity_ordered),
        order_date: data.order_date || undefined,
        expected_return_date: data.expected_return_date || undefined,
        notes: data.notes || undefined,
      }),
    onSuccess: (sco) => {
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
      navigate(`/subcontract-orders/${sco.sco_number}`)
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to create subcontract order',
      })
    },
  })

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'quantity_ordered' ? Number(value) : value,
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

    if (!formData.sco_number.trim()) {
      newErrors.sco_number = 'SCO Number is required'
    }
    if (!formData.supplier_id.trim()) {
      newErrors.supplier_id = 'Supplier is required'
    }
    if (!formData.product_id.trim()) {
      newErrors.product_id = 'Item is required'
    }
    if (!formData.quantity_ordered || formData.quantity_ordered <= 0) {
      newErrors.quantity_ordered = 'Quantity must be greater than 0'
    }
    if (!formData.order_date) {
      newErrors.order_date = 'Order Date is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    createMutation.mutate(formData)
  }

  const isSubmitting = createMutation.isPending

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Create New Subcontract Order</h2>
          <p style={pageSubStyle}>
            Send a finished product out for outside processing. Component requirements are
            automatically calculated from the product's Bill of Materials.
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Order Data</h3>
          <div style={gridStyle}>
            <div style={fieldGroupStyle}>
              <label htmlFor="sco_number" style={labelStyle}>
                SCO Number *
              </label>
              <input
                type="text"
                id="sco_number"
                name="sco_number"
                value={formData.sco_number}
                onChange={handleChange}
                style={{
                  ...inputStyle,
                  border: errors.sco_number ? '1px solid #f44336' : '1px solid var(--border)',
                }}
                placeholder="e.g. SCO-0001"
              />
              {errors.sco_number && <span style={errorTextStyle}>{errors.sco_number}</span>}
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="supplier_id" style={labelStyle}>
                Supplier (Subcontractor) *
              </label>
              <select
                id="supplier_id"
                name="supplier_id"
                value={formData.supplier_id}
                onChange={handleChange}
                style={{
                  ...inputStyle,
                  border: errors.supplier_id ? '1px solid #f44336' : '1px solid var(--border)',
                }}
              >
                <option value="">Select a supplier</option>
                {suppliers.map((supplier: Supplier) => (
                  <option key={supplier.supplier_id} value={supplier.supplier_id}>
                    {supplier.company_name} ({supplier.supplier_id})
                  </option>
                ))}
              </select>
              {errors.supplier_id && <span style={errorTextStyle}>{errors.supplier_id}</span>}
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="product_id" style={labelStyle}>
                Finished Item *
              </label>
              <select
                id="product_id"
                name="product_id"
                value={formData.product_id}
                onChange={handleChange}
                style={{
                  ...inputStyle,
                  border: errors.product_id ? '1px solid #f44336' : '1px solid var(--border)',
                }}
              >
                <option value="">Select a product</option>
                {products.map((catalogItem: Item) => (
                  <option key={catalogItem.item_id} value={catalogItem.item_id}>
                    {catalogItem.description || catalogItem.item_id} ({catalogItem.item_id})
                  </option>
                ))}
              </select>
              {errors.product_id && <span style={errorTextStyle}>{errors.product_id}</span>}
              {formData.product_id && bomComponents.length === 0 && (
                <span style={warningTextStyle}>
                  ⚠️ This product has no Bill of Materials defined. You must add BOM components
                  before you can create a subcontract order for it.
                </span>
              )}
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="quantity_ordered" style={labelStyle}>
                Quantity Ordered *
              </label>
              <input
                type="number"
                id="quantity_ordered"
                name="quantity_ordered"
                value={formData.quantity_ordered}
                onChange={handleChange}
                min="1"
                style={{
                  ...inputStyle,
                  border: errors.quantity_ordered ? '1px solid #f44336' : '1px solid var(--border)',
                }}
              />
              {errors.quantity_ordered && <span style={errorTextStyle}>{errors.quantity_ordered}</span>}
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="order_date" style={labelStyle}>
                Order Date *
              </label>
              <input
                type="date"
                id="order_date"
                name="order_date"
                value={formData.order_date}
                onChange={handleChange}
                style={{
                  ...inputStyle,
                  border: errors.order_date ? '1px solid #f44336' : '1px solid var(--border)',
                }}
              />
              {errors.order_date && <span style={errorTextStyle}>{errors.order_date}</span>}
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="expected_return_date" style={labelStyle}>
                Expected Return Date
              </label>
              <input
                type="date"
                id="expected_return_date"
                name="expected_return_date"
                value={formData.expected_return_date}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>

            <div style={{ ...fieldGroupStyle, gridColumn: '1 / -1' }}>
              <label htmlFor="notes" style={labelStyle}>
                Notes
              </label>
              <textarea
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
                placeholder="Optional notes about this subcontract order"
              />
            </div>
          </div>
        </div>

        {/* BOM Preview */}
        {formData.product_id && bomComponents.length > 0 && (
          <div style={cardStyle}>
            <h3 style={sectionHeadingStyle}>Bill of Materials Preview</h3>
            <p style={{ ...pageSubStyle, marginBottom: '12px' }}>
              The following components will be required, scaled by the order quantity above:
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadRowStyle}>
                    <th style={thStyle}>Component Item ID</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Qty Per Unit</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Total Required</th>
                  </tr>
                </thead>
                <tbody>
                  {bomComponents.map((bc) => (
                    <tr key={bc.bom_id} style={tbodyRowStyle}>
                      <td style={tdStyle}>{bc.component_product_id}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{Number(bc.quantity_per)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>
                        {(Number(bc.quantity_per) * Number(formData.quantity_ordered || 0)).toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
            {isSubmitting ? 'Creating...' : 'Create Subcontract Order'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/subcontract-orders')}
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

const warningTextStyle: React.CSSProperties = {
  color: '#e65100',
  fontSize: '12px',
  marginTop: '6px',
  fontWeight: '500',
  display: 'block',
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
  padding: '10px 8px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const tbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 8px',
  color: 'var(--text)',
  verticalAlign: 'middle',
}

export default SubcontractOrderForm
