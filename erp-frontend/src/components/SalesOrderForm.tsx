/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * SalesOrderForm Component
 * Form for creating and editing sales orders with dynamic line items
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { salesOrderService, customerService, itemService, locationService, paymentTermsService } from '../api/services'
import type { Customer, Item, Location } from '../types'
import { PageHeader } from './PageHeader'
import { DocumentAttachmentsPanel } from './DocumentAttachmentsPanel'
import ItemLookup from './ItemLookup'
import {
  INCOTERM_OPTIONS,
  SHIPPING_METHOD_OPTIONS,
  withCurrentOption,
} from '../data/orderOptions'
import { paymentTermLabel } from '../utils/paymentTerms'
import { isAmountOnlyLine, isStockItemType } from '../utils/itemTypes'
import { isSalesOrderEditable, SALES_ORDER_LOCKED_EDIT_MESSAGE } from '../utils/salesOrders'

interface LineItem {
  line_number: number
  item_id: string
  customer_part_number: string
  quantity_ordered: number
  unit_price: number
  tax_amount: number
  total_amount: number
}

const CUSTOMER_DERIVED_FIELDS = [
  'bill_to_location_id',
  'ship_to_location_id',
  'payment_terms',
  'freight_terms',
  'shipping_method',
] as const

type CustomerDerivedField = (typeof CUSTOMER_DERIVED_FIELDS)[number]
type HeaderDirtyState = Record<CustomerDerivedField, boolean>

const EMPTY_HEADER_DIRTY: HeaderDirtyState = {
  bill_to_location_id: false,
  ship_to_location_id: false,
  payment_terms: false,
  freight_terms: false,
  shipping_method: false,
}

function roundMoney(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor
}

function calcLineTotal(
  quantity: number,
  unitPrice: number,
  taxAmount: number,
  amountOnly = false,
  amount = 0,
): number {
  if (amountOnly) {
    const base = Number(amount) > 0 ? Number(amount) : Number(unitPrice)
    return roundMoney(base + Number(taxAmount))
  }
  return roundMoney(Number(quantity) * Number(unitPrice) + Number(taxAmount))
}

function sumOrderTotal(items: LineItem[]): number {
  return roundMoney(items.reduce((sum, item) => sum + Number(item.total_amount || 0), 0))
}

function pickDefaultLocation(locations: Location[]): Location | undefined {
  return locations.find((loc) => loc.is_default) || locations[0]
}

function commercialDefaultsFromCustomer(customer: Customer | null | undefined) {
  return {
    payment_terms: (customer?.payment_terms || '').trim(),
    payment_term_id: customer?.payment_term_id || '',
    freight_terms: (customer?.preferred_incoterms || '').trim(),
    shipping_method: (customer?.preferred_shipping_method || '').trim(),
  }
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
    customer_revision_date: '',
    payment_terms: '',
    payment_term_id: '',
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
      customer_part_number: '',
      quantity_ordered: 1,
      unit_price: 0,
      tax_amount: 0,
      total_amount: 0,
    },
  ])

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [headerDirty, setHeaderDirty] = useState<HeaderDirtyState>(EMPTY_HEADER_DIRTY)
  const headerDirtyRef = useRef(headerDirty)
  headerDirtyRef.current = headerDirty
  const pendingCustomerDefaultsRef = useRef<{
    applyLocations: boolean
    overwriteTerms: boolean
  } | null>(null)

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customerService.listCustomers(0, 1000),
  })

  const { data: selectedCustomer, isFetched: selectedCustomerFetched } = useQuery({
    queryKey: ['customers', formData.customer_id],
    queryFn: () => customerService.getCustomer(formData.customer_id),
    enabled: !!formData.customer_id,
  })

  // Fetch products
  const { data: items = [] } = useQuery({
    queryKey: ['items'],
    queryFn: () => itemService.listItems(0, 1000),
  })

  const { data: paymentTerms = [] } = useQuery({
    queryKey: ['paymentTerms'],
    queryFn: () => paymentTermsService.list(),
  })

  // Locations for the selected customer
  const { data: customerLocations = [], isPending: locationsPending, isFetching: loadingLocations } = useQuery({
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
    const city = [loc.city, loc.state_province || loc.state].filter(Boolean).join(', ')
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
        customer_revision_date: salesOrder.customer_revision_date
          ? String(salesOrder.customer_revision_date).slice(0, 10)
          : '',
        payment_terms: salesOrder.payment_terms || '',
        payment_term_id: salesOrder.payment_term_id || '',
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
            customer_part_number: item.customer_part_number || '',
            quantity_ordered: item.quantity_ordered,
            unit_price: Number(item.unit_price),
            tax_amount: Number(item.tax_amount),
            total_amount: Number(item.total_amount),
          }))
        )
      }
      pendingCustomerDefaultsRef.current = null
      setHeaderDirty(EMPTY_HEADER_DIRTY)
    }
  }, [salesOrder])

  const emptyToNull = (v: string) => (v.trim() === '' ? null : v)

  // Create mutation — send only create-schema fields; omit empty optional emails
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      salesOrderService.createSalesOrder({
        customer_id: data.customer_id,
        bill_to_location_id: data.bill_to_location_id,
        ship_to_location_id: data.ship_to_location_id,
        customer_po_number: data.customer_po_number,
        po_revision_number: data.po_revision_number,
        order_date: data.order_date,
        customer_revision_date: emptyToNull(data.customer_revision_date),
        payment_terms: emptyToNull(data.payment_terms) ?? undefined,
        payment_term_id: emptyToNull(data.payment_term_id) ?? undefined,
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
        customer_revision_date: emptyToNull(data.customer_revision_date),
        payment_terms: emptyToNull(data.payment_terms),
        payment_term_id: emptyToNull(data.payment_term_id),
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
    if (name === 'customer_id') {
      handleCustomerChange(value)
      return
    }

    setFormData((prev) => ({
      ...prev,
      [name]: name === 'po_revision_number' ? parseInt(value) || 0 : value,
    }))

    if ((CUSTOMER_DERIVED_FIELDS as readonly string[]).includes(name)) {
      setHeaderDirty((prev) => ({ ...prev, [name]: true }))
    }

    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
  }

  const handleCustomerChange = (customerId: string) => {
    const previousCustomerId = formData.customer_id
    const dirty = headerDirty
    const termsDirty = dirty.payment_terms || dirty.freight_terms || dirty.shipping_method
    const hasTermValues = Boolean(
      formData.payment_terms || formData.freight_terms || formData.shipping_method
    )

    if (!customerId) {
      pendingCustomerDefaultsRef.current = null
      setFormData((prev) => ({
        ...prev,
        customer_id: '',
        bill_to_location_id: '',
        ship_to_location_id: '',
        payment_terms: '',
        payment_term_id: '',
        freight_terms: '',
        shipping_method: '',
      }))
      setHeaderDirty(EMPTY_HEADER_DIRTY)
      setErrors((prev) => {
        const next = { ...prev }
        delete next.customer_id
        delete next.bill_to_location_id
        delete next.ship_to_location_id
        return next
      })
      return
    }

    let overwriteTerms = true
    if (previousCustomerId && previousCustomerId !== customerId && termsDirty && hasTermValues) {
      overwriteTerms = window.confirm(
        'Customer changed. Replace Payment Terms, Freight Terms / Incoterms, and Shipping Method with this customer\'s defaults? Locations will always update to the new customer.'
      )
    }

    const listed = customers.find((c: Customer) => c.customer_id === customerId)
    const defaults = commercialDefaultsFromCustomer(listed)

    setFormData((prev) => ({
      ...prev,
      customer_id: customerId,
      bill_to_location_id: '',
      ship_to_location_id: '',
      payment_terms: overwriteTerms || !dirty.payment_terms ? defaults.payment_terms : prev.payment_terms,
      payment_term_id: overwriteTerms || !dirty.payment_terms ? defaults.payment_term_id : prev.payment_term_id,
      freight_terms: overwriteTerms || !dirty.freight_terms ? defaults.freight_terms : prev.freight_terms,
      shipping_method:
        overwriteTerms || !dirty.shipping_method ? defaults.shipping_method : prev.shipping_method,
    }))

    setHeaderDirty((prev) => ({
      ...prev,
      bill_to_location_id: false,
      ship_to_location_id: false,
      payment_terms: overwriteTerms ? false : prev.payment_terms,
      freight_terms: overwriteTerms ? false : prev.freight_terms,
      shipping_method: overwriteTerms ? false : prev.shipping_method,
    }))

    pendingCustomerDefaultsRef.current = {
      applyLocations: true,
      overwriteTerms,
    }

    setErrors((prev) => {
      const next = { ...prev }
      delete next.customer_id
      delete next.bill_to_location_id
      delete next.ship_to_location_id
      return next
    })
  }

  useEffect(() => {
    const pending = pendingCustomerDefaultsRef.current
    if (!pending || !formData.customer_id) return
    if (pending.applyLocations && locationsPending) return
    if (!selectedCustomerFetched) return

    const listed = customers.find((c: Customer) => c.customer_id === formData.customer_id)
    const customer =
      selectedCustomer?.customer_id === formData.customer_id ? selectedCustomer : listed
    const defaults = commercialDefaultsFromCustomer(customer)
    const defaultBill = pickDefaultLocation(billToLocations)
    const defaultShip = pickDefaultLocation(shipToLocations)
    const dirty = headerDirtyRef.current

    setFormData((prev) => {
      if (prev.customer_id !== formData.customer_id) return prev
      const next = { ...prev }
      if (pending.applyLocations) {
        next.bill_to_location_id = defaultBill?.location_id || ''
        next.ship_to_location_id = defaultShip?.location_id || ''
      }
      if (pending.overwriteTerms || !dirty.payment_terms) {
        next.payment_terms = defaults.payment_terms
        next.payment_term_id = defaults.payment_term_id
      }
      if (pending.overwriteTerms || !dirty.freight_terms) {
        next.freight_terms = defaults.freight_terms
      }
      if (pending.overwriteTerms || !dirty.shipping_method) {
        next.shipping_method = defaults.shipping_method
      }
      return next
    })

    pendingCustomerDefaultsRef.current = null
  }, [
    formData.customer_id,
    selectedCustomer,
    selectedCustomerFetched,
    customers,
    locationsPending,
    billToLocations,
    shipToLocations,
  ])

  const handleLineItemChange = (
    index: number,
    field: keyof LineItem,
    value: string | number
  ) => {
    const newItems = lineItems.map((row, i) => {
      if (i !== index) return row
      const item = { ...row }
      if (field === 'quantity_ordered' || field === 'unit_price' || field === 'tax_amount' || field === 'total_amount') {
        item[field] = Number(value)
      } else if (field === 'item_id' || field === 'customer_part_number') {
        item[field] = value as string
      } else if (field === 'line_number') {
        item.line_number = Number(value)
      }
      const catalog = items.find((p) => p.item_id === item.item_id)
      const amountOnly = isAmountOnlyLine(catalog?.item_type, item.quantity_ordered, item.item_id)
      if (field !== 'total_amount' || !amountOnly) {
        item.total_amount = calcLineTotal(
          item.quantity_ordered,
          item.unit_price,
          item.tax_amount,
          amountOnly,
          item.total_amount,
        )
      }
      return item
    })

    setLineItems(newItems)
    setFormData((prev) => ({
      ...prev,
      total_amount: sumOrderTotal(newItems),
    }))
  }

  const selectCatalogItem = (index: number, catalog: Item | null) => {
    const newItems = lineItems.map((row, i) => {
      if (i !== index) return row
      const item = { ...row }
      item.item_id = catalog?.item_id || ''
      item.customer_part_number = catalog?.customer_part_number || ''
      item.unit_price = catalog?.unit_price != null ? Number(catalog.unit_price) : 0
      if (catalog && !isStockItemType(catalog.item_type)) {
        item.quantity_ordered = 0
      }
      const amountOnly = isAmountOnlyLine(catalog?.item_type, item.quantity_ordered, item.item_id)
      item.total_amount = calcLineTotal(
        item.quantity_ordered,
        item.unit_price,
        item.tax_amount,
        amountOnly,
        item.unit_price,
      )
      return item
    })
    setLineItems(newItems)
    setFormData((prev) => ({ ...prev, total_amount: sumOrderTotal(newItems) }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[`item_${index}_product`]
      return next
    })
  }

  const addLineItem = () => {
    const newLineNumber = Math.max(...lineItems.map((li) => li.line_number), 0) + 1
    setLineItems([
      ...lineItems,
      {
        line_number: newLineNumber,
        item_id: '',
        customer_part_number: '',
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
      setFormData((prev) => ({
        ...prev,
        total_amount: sumOrderTotal(newItems),
      }))
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

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
        if (item.quantity_ordered < 0) {
          newErrors[`item_${index}_quantity`] = 'Quantity cannot be negative'
        } else if (isStockItemType(items.find((p) => p.item_id === item.item_id)?.item_type) && item.quantity_ordered <= 0) {
          newErrors[`item_${index}_quantity`] = 'Quantity must be greater than 0'
        } else if (
          !isStockItemType(items.find((p) => p.item_id === item.item_id)?.item_type) &&
          item.quantity_ordered === 0 &&
          item.total_amount <= 0
        ) {
          newErrors[`item_${index}_amount`] = 'Enter an amount for this non-inventory line'
        }
      })
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (isEditMode && salesOrder && !isSalesOrderEditable(salesOrder)) {
      setErrors({ submit: SALES_ORDER_LOCKED_EDIT_MESSAGE })
      return
    }

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

  if (isEditMode && salesOrder && !isSalesOrderEditable(salesOrder)) {
    return (
      <div style={containerStyle}>
        <PageHeader title="Edit Sales Order" subtitle={salesOrder.sales_order_id} />
        <div style={lockWarningStyle} role="alert">
          {SALES_ORDER_LOCKED_EDIT_MESSAGE}
        </div>
        <button
          type="button"
          onClick={() => navigate(`/orders/${salesOrder.sales_order_id}`)}
          style={secondaryButtonStyle}
        >
          Back to Order
        </button>
      </div>
    )
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  return (
    <div style={containerStyle}>
      <PageHeader
        title={isEditMode ? 'Edit Sales Order' : 'Create New Sales Order'}
        subtitle="Manage order header details, customer info and line items"
      />

      <form onSubmit={handleSubmit}>
        {/* Order Header Section */}
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Order Data</h3>
          <div style={gridStyle}>
            {!isEditMode && (
              <div style={fieldGroupStyle}>
                <label htmlFor="sales_order_id" style={labelStyle}>
                  Sales Order ID
                </label>
                <div id="sales_order_id" style={{ ...inputStyle, backgroundColor: 'var(--bg-muted, #f5f5f5)', color: 'var(--text)' }}>
                  Assigned on save (PU61-YYMMXXXX)
                </div>
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
              <label htmlFor="customer_revision_date" style={labelStyle}>
                Customer Revision Date
              </label>
              <input
                type="date"
                id="customer_revision_date"
                name="customer_revision_date"
                value={formData.customer_revision_date}
                onChange={handleChange}
                style={inputStyle}
              />
              <span style={{ fontSize: 12, color: 'var(--text)', marginTop: 4 }}>
                Date the customer last revised their PO (not the internal order date).
              </span>
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
              <select
                id="payment_terms"
                name="payment_term_id"
                value={formData.payment_term_id}
                onChange={(e) => {
                  const selectedId = e.target.value
                  const term = paymentTerms.find((row) => row.id === selectedId)
                  setFormData((prev) => ({
                    ...prev,
                    payment_term_id: selectedId,
                    payment_terms: term?.code || '',
                  }))
                  setHeaderDirty((prev) => ({ ...prev, payment_terms: true }))
                }}
                style={inputStyle}
              >
                <option value="">Select payment terms</option>
                {paymentTerms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {paymentTermLabel(term)}
                  </option>
                ))}
              </select>
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="freight_terms" style={labelStyle}>
                Freight Terms / Incoterms
              </label>
              <select
                id="freight_terms"
                name="freight_terms"
                value={formData.freight_terms}
                onChange={handleChange}
                style={inputStyle}
              >
                <option value="">Select Incoterm</option>
                {withCurrentOption(INCOTERM_OPTIONS, formData.freight_terms).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>

            <div style={fieldGroupStyle}>
              <label htmlFor="shipping_method" style={labelStyle}>
                Shipping Method
              </label>
              <select
                id="shipping_method"
                name="shipping_method"
                value={formData.shipping_method}
                onChange={handleChange}
                style={inputStyle}
              >
                <option value="">Select shipping method</option>
                {withCurrentOption(SHIPPING_METHOD_OPTIONS, formData.shipping_method).map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
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
                  <th style={{ ...thStyle, minWidth: '260px' }}>Internal Part No. *</th>
                  <th style={{ ...thStyle, width: '180px' }}>Customer P/N</th>
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
                    <td style={{ ...tdStyle, minWidth: '260px', overflow: 'visible' }}>
                      <ItemLookup
                        items={items}
                        value={item.item_id}
                        error={Boolean(errors[`item_${index}_product`])}
                        ariaLabel={`Internal part number for line ${item.line_number}`}
                        placeholder="Type to search or click ▼"
                        onSelect={(catalog) => selectCatalogItem(index, catalog)}
                      />
                      {errors[`item_${index}_product`] && (
                        <span style={errorTextStyle}>{errors[`item_${index}_product`]}</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={item.customer_part_number}
                        onChange={(e) =>
                          handleLineItemChange(index, 'customer_part_number', e.target.value)
                        }
                        style={inputStyle}
                        placeholder="Customer P/N"
                      />
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
                        min="0"
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
                        title="Defaulted from the item catalog; you can override the unit price"
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
                      {isAmountOnlyLine(items.find((p) => p.item_id === item.item_id)?.item_type, item.quantity_ordered, item.item_id) ? (
                        <input
                          type="number"
                          value={item.total_amount}
                          onChange={(e) => handleLineItemChange(index, 'total_amount', e.target.value)}
                          style={{
                            ...inputStyle,
                            width: '100%',
                            textAlign: 'right',
                            fontWeight: 'bold',
                            border: errors[`item_${index}_amount`] ? '1px solid #f44336' : '1px solid var(--border)',
                          }}
                          step="0.01"
                          min="0"
                        />
                      ) : (
                        item.total_amount.toFixed(2)
                      )}
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

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
}

const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',

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
  backgroundColor: 'var(--social-bg)',
}

const thStyle: React.CSSProperties = {
  padding: '12px 8px',
  color: 'var(--text-h)',
  fontWeight: 'bold',
  textAlign: 'left',
  fontSize: '13px',
}

const tbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--divider)',
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
  borderTop: '2px solid var(--divider)',
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

const lockWarningStyle: React.CSSProperties = {
  marginBottom: 16,
  backgroundColor: '#fff8e1',
  color: '#e65100',
  border: '1px solid #ffe082',
  borderRadius: 6,
  padding: '12px 16px',
  fontSize: 14,
  fontWeight: 600,
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

export default SalesOrderForm
