/**
 * SalesOrderForm Component
 * Form for creating and editing sales orders with dynamic line items
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { salesOrderService, customerService, itemService, locationService } from '../api/services'
import type { Customer, Item, Location } from '../types'
import { DocumentAttachmentsPanel } from './DocumentAttachmentsPanel'

interface LineItem {
  line_number: number
  item_id: string
  quantity_ordered: number
  unit_price: number
  tax_amount: number
  total_amount: number
}

export function SalesOrderForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = !!id

  const [formData, setFormData] = useState({
    sales_order_id: '',
    customer_id: '',
    bill_to_location_id: '',
    ship_to_location_id: '',
    customer_po_number: '',
    po_revision_number: 0,
    order_date: new Date().toISOString().split('T')[0],
    payment_terms: '',
    freight_terms: '',
    shipping_method: '',
    currency: 'USD',
    buyer_contact_name: '',
    buyer_contact_email: '',
    status: 'DRAFT',
    total_amount: 0,
  })

  const [lineItems, setLineItems] = useState<LineItem[]>([
    {
      line_number: 1,
      item_id: '',
      quantity_ordered: 1,
      unit_price: 0,
      tax_amount: 0,
      total_amount: 0,
    },
  ])

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customerService.listCustomers(0, 1000),
  })

  // Fetch products
  const { data: items = [] } = useQuery({
    queryKey: ['items'],
    queryFn: () => itemService.listItems(0, 1000),
  })

  // Locations for the selected customer
  const { data: customerLocations = [], isFetching: loadingLocations } = useQuery({
    queryKey: ['customerLocations', formData.customer_id],
    queryFn: () => locationService.listLocationsByCustomer(formData.customer_id),
    enabled: !!formData.customer_id,
  })

  const billToLocations = useMemo(
    () =>
      customerLocations.filter(
        (loc: Location) => loc.location_type === 'BILL_TO' || loc.location_type === 'BOTH'
      ),
    [customerLocations]
  )

  const shipToLocations = useMemo(
    () =>
      customerLocations.filter(
        (loc: Location) => loc.location_type === 'SHIP_TO' || loc.location_type === 'BOTH'
      ),
    [customerLocations]
  )

  const formatLocationLabel = (loc: Location) => {
    const name = loc.location_name || loc.location_id
    const city = [loc.city, loc.state].filter(Boolean).join(', ')
    return city ? `${name} — ${city}` : name
  }

  // Fetch sales order if in edit mode
  const {
    data: salesOrder,
    isLoading: isLoadingSalesOrder,
    isError: isErrorLoadingSalesOrder,
  } = useQuery({
    queryKey: ['salesOrders', id],
    queryFn: () => (id ? salesOrderService.getSalesOrder(id) : Promise.resolve(null)),
    enabled: isEditMode,
  })

  // Populate form when sales order data is loaded
  useEffect(() => {
    if (salesOrder) {
      setFormData({
        sales_order_id: salesOrder.sales_order_id,
        customer_id: salesOrder.customer_id,
        bill_to_location_id: salesOrder.bill_to_location_id,
        ship_to_location_id: salesOrder.ship_to_location_id,
        customer_po_number: salesOrder.customer_po_number,
        po_revision_number: salesOrder.po_revision_number,
        order_date: salesOrder.order_date,
        payment_terms: salesOrder.payment_terms || '',
        freight_terms: salesOrder.freight_terms || '',
        shipping_method: salesOrder.shipping_method || '',
        currency: salesOrder.currency,
        buyer_contact_name: salesOrder.buyer_contact_name || '',
        buyer_contact_email: salesOrder.buyer_contact_email || '',
        status: salesOrder.status,
        total_amount: Number(salesOrder.total_amount),
      })

      if (salesOrder.items && salesOrder.items.length > 0) {
        setLineItems(
          salesOrder.items.map((item) => ({
            line_number: item.line_number,
            item_id: item.item_id,
            quantity_ordered: item.quantity_ordered,
            unit_price: Number(item.unit_price),
            tax_amount: Number(item.tax_amount),
            total_amount: Number(item.total_amount),
          }))
        )
      }
    }
  }, [salesOrder])

  const emptyToNull = (v: string) => (v.trim() === '' ? null : v)

  // Create mutation — send only create-schema fields; omit empty optional emails
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      salesOrderService.createSalesOrder({
        sales_order_id: data.sales_order_id,
        customer_id: data.customer_id,
        bill_to_location_id: data.bill_to_location_id,
        ship_to_location_id: data.ship_to_location_id,
        customer_po_number: data.customer_po_number,
        po_revision_number: data.po_revision_number,
        order_date: data.order_date,
        payment_terms: emptyToNull(data.payment_terms) ?? undefined,
        freight_terms: emptyToNull(data.freight_terms) ?? undefined,
        shipping_method: emptyToNull(data.shipping_method) ?? undefined,
        currency: data.currency || 'USD',
        buyer_contact_name: emptyToNull(data.buyer_contact_name) ?? undefined,
        buyer_contact_email: emptyToNull(data.buyer_contact_email) ?? undefined,
        status: data.status,
        total_amount: data.total_amount,
        items: lineItems,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['salesOrders'] })
      navigate(`/orders/${created.sales_order_id}`)
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to create sales order',
      })
    },
  })

  // Update mutation — only send SalesOrderUpdate fields; empty emails → null
  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      salesOrderService.updateSalesOrder(id!, {
        bill_to_location_id: data.bill_to_location_id,
        ship_to_location_id: data.ship_to_location_id,
        customer_po_number: data.customer_po_number,
        po_revision_number: data.po_revision_number,
        payment_terms: emptyToNull(data.payment_terms),
        freight_terms: emptyToNull(data.freight_terms),
        shipping_method: emptyToNull(data.shipping_method),
        buyer_contact_name: emptyToNull(data.buyer_contact_name),
        buyer_contact_email: emptyToNull(data.buyer_contact_email),
        status: data.status,
        total_amount: data.total_amount,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesOrders'] })
      navigate(`/orders/${id}`)
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to update sales order',
      })
    },
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData((prev) => {
      const next = {
        ...prev,
        [name]: name === 'po_revision_number' ? parseInt(value) || 0 : value,
      }
      // Changing customer clears location picks (they belong to the prior customer)
      if (name === 'customer_id') {
        next.bill_to_location_id = ''
        next.ship_to_location_id = ''
      }
      return next
    })
    if (errors[name] || name === 'customer_id') {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[name]
        if (name === 'customer_id') {
          delete newErrors.bill_to_location_id
          delete newErrors.ship_to_location_id
        }
        return newErrors
      })
    }
  }

  const handleLineItemChange = (
    index: number,
    field: keyof LineItem,
    value: string | number
  ) => {
    const newItems = [...lineItems]
    const item = newItems[index]

    if (field === 'quantity_ordered' || field === 'unit_price' || field === 'tax_amount') {
      (item[field] as number) = Number(value)
    } else if (field === 'item_id') {
      (item[field] as string) = value as string
    } else if (field === 'line_number') {
      (item[field] as number) = Number(value)
    }

    // Recalculate total_amount
    item.total_amount = item.quantity_ordered * item.unit_price + item.tax_amount

    setLineItems(newItems)

    // Recalculate order total
    const newTotal = newItems.reduce((sum, li) => sum + li.total_amount, 0)
    setFormData((prev) => ({
      ...prev,
      total_amount: newTotal,
    }))
  }

  const addLineItem = () => {
    const newLineNumber = Math.max(...lineItems.map((li) => li.line_number), 0) + 1
    setLineItems([
      ...lineItems,
      {
        line_number: newLineNumber,
        item_id: '',
        quantity_ordered: 1,
        unit_price: 0,
        tax_amount: 0,
        total_amount: 0,
      },
    ])
  }

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      const newItems = lineItems.filter((_, i) => i !== index)
      setLineItems(newItems)

      // Recalculate order total
      const newTotal = newItems.reduce((sum, li) => sum + li.total_amount, 0)
      setFormData((prev) => ({
        ...prev,
        total_amount: newTotal,
      }))
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.sales_order_id.trim() && !isEditMode) {
      newErrors.sales_order_id = 'Sales Order ID is required'
    }
    if (!formData.customer_id.trim()) {
      newErrors.customer_id = 'Customer is required'
    }
    if (!formData.bill_to_location_id.trim()) {
      newErrors.bill_to_location_id = 'Bill To Location is required'
    }
    if (!formData.ship_to_location_id.trim()) {
      newErrors.ship_to_location_id = 'Ship To Location is required'
    }
    if (!formData.customer_po_number.trim()) {
      newErrors.customer_po_number = 'Customer PO Number is required'
    }
    if (!formData.order_date) {
      newErrors.order_date = 'Order Date is required'
    }

    if (lineItems.length === 0) {
      newErrors.items = 'At least one line item is required'
    } else {
      lineItems.forEach((item, index) => {
        if (!item.item_id.trim()) {
          newErrors[`item_${index}_product`] = 'Item is required'
        }
        if (item.quantity_ordered <= 0) {
          newErrors[`item_${index}_quantity`] = 'Quantity must be greater than 0'
        }
      })
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

  if (isEditMode && isLoadingSalesOrder) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading sales order...</p>
        </div>
      </div>
    )
  }

  if (isEditMode && isErrorLoadingSalesOrder) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error loading sales order</p>
          <button onClick={() => navigate('/sales-orders')} style={secondaryButtonStyle}>
            Back to Orders
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
          <h2 style={pageTitleStyle}>{isEditMode ? 'Edit Sales Order' : 'Create New Sales Order'}</h2>
          <p style={pageSubStyle}>Manage order header details, customer info and line items</p>
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        {/* Order Header Section */}
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Order Data</h3>
          <div style={gridStyle}>
            {!isEditMode && (
              <div style={fieldGroupStyle}>
                <label htmlFor="sales_order_id" style={labelStyle}>
                  Sales Order ID *
                </label>
                <input
                  type="text"
                  id="sales_order_id"
                  name="sales_order_id"
                  value={formData.sales_order_id}
                  onChange={handleChange}
                  style={{
                    ...inputStyle,
                    border: errors.sales_order_id ? '1px solid #f44336' : '1px solid var(--border)',
                  }}
                  placeholder="Enter sales order ID"
                />
                {errors.sales_order_id && <span style={errorTextStyle}>{errors.sales_order_id}</span>}
              </div>
            )}

            <div style={fieldGroupStyle}>
              <label htmlFor="customer_id" style={labelStyle}>
                Customer *
              </label>
              <select
                id="customer_id"
                name="customer_id"
                value={formData.customer_id}
                onChange={handleChange}
                style={{
                  ...inputStyle,
                  border: errors.customer_id ? '1px solid #f44336' : '1px solid var(--border)',
                }}
              >
                <option value="">Select a customer</option>
                {customers.map((customer: Customer) => (
                  <option key={customer.customer_id} value={customer.customer_id}>
                    {customer.company_name} ({customer.customer_id})
                  </option>
                ))}
              </select>
              {errors.customer_id && <span style={errorTextStyle}>{errors.customer_id}</span>}
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
              <label htmlFor="status" style={labelStyle}>
                Status
              </label>
              <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                style={inputStyle}
              >
                <option value="DRAFT">DRAFT</option>
                <option value="RECEIVED">RECEIVED</option>
                <option value="PENDING">PENDING</option>
                <option value="PROCESSING">PROCESSING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="SHIPPED">SHIPPED</option>
                <option value="DELIVERED">DELIVERED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="customer_po_number" style={labelStyle}>
                Customer PO Number *
              </label>
              <input
                type="text"
                id="customer_po_number"
                name="customer_po_number"
                value={formData.customer_po_number}
                onChange={handleChange}
                style={{
                  ...inputStyle,
                  border: errors.customer_po_number ? '1px solid #f44336' : '1px solid var(--border)',
                }}
                placeholder="Enter customer PO number"
              />
              {errors.customer_po_number && (
                <span style={errorTextStyle}>{errors.customer_po_number}</span>
              )}
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="po_revision_number" style={labelStyle}>
                PO Revision Number
              </label>
              <input
                type="number"
                id="po_revision_number"
                name="po_revision_number"
                value={formData.po_revision_number}
                onChange={handleChange}
                style={inputStyle}
                min="0"
              />
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="bill_to_location_id" style={labelStyle}>
                Bill To Location *
              </label>
              <select
                id="bill_to_location_id"
                name="bill_to_location_id"
                value={formData.bill_to_location_id}
                onChange={handleChange}
                disabled={!formData.customer_id || loadingLocations}
                style={{
                  ...inputStyle,
                  border: errors.bill_to_location_id ? '1px solid #f44336' : '1px solid var(--border)',
                }}
              >
                <option value="">
                  {!formData.customer_id
                    ? 'Select a customer first'
                    : loadingLocations
                    ? 'Loading locations...'
                    : billToLocations.length === 0
                    ? 'No bill-to locations for this customer'
                    : 'Select bill-to location'}
                </option>
                {billToLocations.map((loc: Location) => (
                  <option key={loc.location_id} value={loc.location_id}>
                    {formatLocationLabel(loc)}
                  </option>
                ))}
              </select>
              {errors.bill_to_location_id && (
                <span style={errorTextStyle}>{errors.bill_to_location_id}</span>
              )}
              {formData.customer_id && !loadingLocations && billToLocations.length === 0 && (
                <span style={errorTextStyle}>
                  Add a BILL_TO location for this customer before creating an order.
                </span>
              )}
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="ship_to_location_id" style={labelStyle}>
                Ship To Location *
              </label>
              <select
                id="ship_to_location_id"
                name="ship_to_location_id"
                value={formData.ship_to_location_id}
                onChange={handleChange}
                disabled={!formData.customer_id || loadingLocations}
                style={{
                  ...inputStyle,
                  border: errors.ship_to_location_id ? '1px solid #f44336' : '1px solid var(--border)',
                }}
              >
                <option value="">
                  {!formData.customer_id
                    ? 'Select a customer first'
                    : loadingLocations
                    ? 'Loading locations...'
                    : shipToLocations.length === 0
                    ? 'No ship-to locations for this customer'
                    : 'Select ship-to location'}
                </option>
                {shipToLocations.map((loc: Location) => (
                  <option key={loc.location_id} value={loc.location_id}>
                    {formatLocationLabel(loc)}
                  </option>
                ))}
              </select>
              {errors.ship_to_location_id && (
                <span style={errorTextStyle}>{errors.ship_to_location_id}</span>
              )}
              {formData.customer_id && !loadingLocations && shipToLocations.length === 0 && (
                <span style={errorTextStyle}>
                  Add a SHIP_TO location for this customer before creating an order.
                </span>
              )}
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="currency" style={labelStyle}>
                Currency
              </label>
              <input
                type="text"
                id="currency"
                name="currency"
                value={formData.currency}
                onChange={handleChange}
                style={inputStyle}
                maxLength={3}
              />
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="payment_terms" style={labelStyle}>
                Payment Terms
              </label>
              <input
                type="text"
                id="payment_terms"
                name="payment_terms"
                value={formData.payment_terms}
                onChange={handleChange}
                style={inputStyle}
                placeholder="e.g., Net 30"
              />
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="freight_terms" style={labelStyle}>
                Freight Terms
              </label>
              <input
                type="text"
                id="freight_terms"
                name="freight_terms"
                value={formData.freight_terms}
                onChange={handleChange}
                style={inputStyle}
                placeholder="e.g., FOB"
              />
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="shipping_method" style={labelStyle}>
                Shipping Method
              </label>
              <input
                type="text"
                id="shipping_method"
                name="shipping_method"
                value={formData.shipping_method}
                onChange={handleChange}
                style={inputStyle}
                placeholder="e.g., Ground"
              />
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="buyer_contact_name" style={labelStyle}>
                Buyer Contact Name
              </label>
              <input
                type="text"
                id="buyer_contact_name"
                name="buyer_contact_name"
                value={formData.buyer_contact_name}
                onChange={handleChange}
                style={inputStyle}
                placeholder="Enter buyer contact name"
              />
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="buyer_contact_email" style={labelStyle}>
                Buyer Contact Email
              </label>
              <input
                type="email"
                id="buyer_contact_email"
                name="buyer_contact_email"
                value={formData.buyer_contact_email}
                onChange={handleChange}
                style={inputStyle}
                placeholder="Enter buyer contact email"
              />
            </div>
          </div>
        </div>

        {/* Line Items Section */}
        <div style={cardStyle}>
          <div style={tableHeaderContainerStyle}>
            <h3 style={sectionHeadingStyleNoBorder}>Line Items</h3>
            <button
              type="button"
              onClick={addLineItem}
              style={addButtonStyle}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
            >
              + Add Line Item
            </button>
          </div>

          {errors.items && (
            <div style={errorAlertStyle}>
              <span>⚠️ {errors.items}</span>
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={{ ...thStyle, width: '60px' }}>Line #</th>
                  <th style={thStyle}>Item *</th>
                  <th style={{ ...thStyle, width: '120px', textAlign: 'right' }}>Quantity *</th>
                  <th style={{ ...thStyle, width: '130px', textAlign: 'right' }}>Unit Price</th>
                  <th style={{ ...thStyle, width: '120px', textAlign: 'right' }}>Tax Amount</th>
                  <th style={{ ...thStyle, width: '130px', textAlign: 'right' }}>Total Amount</th>
                  <th style={{ ...thStyle, width: '90px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, index) => (
                  <tr key={index} style={tbodyRowStyle}>
                    <td style={tdStyle}>{item.line_number}</td>
                    <td style={tdStyle}>
                      <select
                        value={item.item_id}
                        onChange={(e) =>
                          handleLineItemChange(index, 'item_id', e.target.value)
                        }
                        style={{
                          ...inputStyle,
                          width: '100%',
                          border: errors[`item_${index}_product`] ? '1px solid #f44336' : '1px solid var(--border)',
                        }}
                      >
                        <option value="">Select item</option>
                        {items.map((catalogItem: Item) => (
                          <option key={catalogItem.item_id} value={catalogItem.item_id}>
                            {catalogItem.description || catalogItem.item_id}
                          </option>
                        ))}
                      </select>
                      {errors[`item_${index}_product`] && (
                        <span style={errorTextStyle}>{errors[`item_${index}_product`]}</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="number"
                        value={item.quantity_ordered}
                        onChange={(e) =>
                          handleLineItemChange(index, 'quantity_ordered', e.target.value)
                        }
                        style={{
                          ...inputStyle,
                          width: '100%',
                          textAlign: 'right',
                          border: errors[`item_${index}_quantity`] ? '1px solid #f44336' : '1px solid var(--border)',
                        }}
                        min="1"
                      />
                      {errors[`item_${index}_quantity`] && (
                        <span style={errorTextStyle}>{errors[`item_${index}_quantity`]}</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) =>
                          handleLineItemChange(index, 'unit_price', e.target.value)
                        }
                        style={{ ...inputStyle, width: '100%', textAlign: 'right' }}
                        step="0.01"
                        min="0"
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <input
                        type="number"
                        value={item.tax_amount}
                        onChange={(e) =>
                          handleLineItemChange(index, 'tax_amount', e.target.value)
                        }
                        style={{ ...inputStyle, width: '100%', textAlign: 'right' }}
                        step="0.01"
                        min="0"
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', color: 'var(--text-h)' }}>
                      {item.total_amount.toFixed(2)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => removeLineItem(index)}
                        disabled={lineItems.length === 1}
                        style={{
                          ...removeButtonStyle,
                          backgroundColor: lineItems.length === 1 ? '#f5f5f5' : '#ffebee',
                          color: lineItems.length === 1 ? '#bbb' : '#c62828',
                          border: lineItems.length === 1 ? '1px solid #eee' : '1px solid #ffcdd2',
                          cursor: lineItems.length === 1 ? 'not-allowed' : 'pointer',
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

          <div style={orderTotalRowStyle}>
            <span style={orderTotalLabelStyle}>Order Total:</span>
            <span style={orderTotalValueStyle}>
              {formData.currency} {formData.total_amount.toFixed(2)}
            </span>
          </div>
        </div>

        {isEditMode && (
          <DocumentAttachmentsPanel documentType="SALES_ORDER" documentId={formData.sales_order_id} />
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
            {isSubmitting ? 'Saving...' : isEditMode ? 'Update Order' : 'Create Order'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/sales-orders')}
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
  maxWidth: '1200px',
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
  marginBottom: '16px',
  borderBottom: '2px solid var(--border)',
  paddingBottom: '8px',
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
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

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '14px',
}

const theadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
}

const thStyle: React.CSSProperties = {
  padding: '12px 8px',
  color: 'var(--text-h)',
  fontWeight: 'bold',
  textAlign: 'left',
  fontSize: '13px',
}

const tbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
  transition: 'background-color 0.2s',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 8px',
  verticalAlign: 'middle',
  color: 'var(--text)',
}

const removeButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '4px',
  fontSize: '12px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
}

const orderTotalRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: '10px',
  marginTop: '16px',
  paddingTop: '16px',
  borderTop: '2px solid var(--border)',
}

const orderTotalLabelStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
}

const orderTotalValueStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 'bold',
  color: 'var(--accent)',
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

export default SalesOrderForm
