/**
 * CustomerForm Component
 * Create / edit manufacturing customers with Bill-To, Ship-To, and certifications.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { customerService } from '../api/services'
import type { CustomerWrite, Location, TaxIdType } from '../types'
import { INCOTERM_OPTIONS, SHIPPING_METHOD_OPTIONS } from '../data/orderOptions'

type TabId = 'general' | 'billTo' | 'shipTo' | 'certs'

type LocationFormRow = {
  key: string
  location_id: string
  location_code: string
  location_name: string
  address_line1: string
  address_line2: string
  city: string
  state_province: string
  postal_code: string
  country: string
  contact_person: string
  contact_email: string
  contact_phone: string
  is_default: boolean
  tax_id: string
  shipping_instructions: string
}

type CertFormRow = {
  key: string
  id?: number
  certification_name: string
  certificate_number: string
  valid_until: string
}

const INDUSTRY_OPTIONS = ['Automotive', 'Electronics', 'Industrial', 'Aerospace', 'Medical', 'Energy', 'Other']
const FACILITY_OPTIONS = ['OEM', 'Tier-1', 'Tier-2', 'Contract Manufacturer', 'Aftermarket', 'Distributor']
const PAYMENT_OPTIONS = ['NET30', 'NET60', 'NET90', 'ADVANCE', 'Due on Receipt']
const CURRENCY_OPTIONS = ['USD', 'EUR', 'JPY', 'TWD', 'CNY']
const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'ON_HOLD', label: 'On hold' },
]
const CERT_NAME_OPTIONS = ['ISO 9001', 'IATF 16949', 'ISO 14001', 'ISO 45001', 'AS9100', 'ISO 13485']
const TAX_ID_TYPE_OPTIONS: TaxIdType[] = ['EIN', 'TIN', 'VAT', 'SSN', 'OTHER']
const TAX_ID_TYPE_LABELS: Record<string, string> = {
  EIN: 'EIN (Employer Identification Number)',
  TIN: 'TIN (Taxpayer Identification Number)',
  VAT: 'VAT (Value Added Tax)',
  SSN: 'SSN (Social Security Number)',
  OTHER: 'Other',
}
const TAX_ID_PLACEHOLDERS: Record<string, string> = {
  EIN: 'XX-XXXXXXX',
  TIN: 'XX-XXXXXXX or XXX-XX-XXXX',
  VAT: 'e.g. GB123456789',
  SSN: 'XXX-XX-XXXX',
  OTHER: 'Tax identification number',
}
const EIN_RE = /^\d{2}-\d{7}$/
const SSN_RE = /^\d{3}-\d{2}-\d{4}$/
const TIN_RE = /^(\d{2}-\d{7}|\d{3}-\d{2}-\d{4}|\d{9})$/

function digitsOnly(value: string) {
  return value.replace(/\D/g, '')
}

function formatEin(value: string) {
  const digits = digitsOnly(value).slice(0, 9)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}-${digits.slice(2)}`
}

function formatSsn(value: string) {
  const digits = digitsOnly(value).slice(0, 9)
  if (digits.length <= 3) return digits
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}

function formatTaxIdValue(type: string, value: string) {
  if (type === 'EIN') return formatEin(value)
  if (type === 'SSN') return formatSsn(value)
  if (type === 'VAT') return value.replace(/\s+/g, '').toUpperCase()
  return value
}

function taxIdMaxLength(type: string) {
  if (type === 'EIN') return 10
  if (type === 'SSN') return 11
  return 64
}

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emptyLocation(isDefault = false): LocationFormRow {
  return {
    key: newKey(),
    location_id: '',
    location_code: '',
    location_name: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state_province: '',
    postal_code: '',
    country: 'USA',
    contact_person: '',
    contact_email: '',
    contact_phone: '',
    is_default: isDefault,
    tax_id: '',
    shipping_instructions: '',
  }
}

function emptyCert(): CertFormRow {
  return {
    key: newKey(),
    certification_name: '',
    certificate_number: '',
    valid_until: '',
  }
}

function mapLocation(loc: Location, clearId = false): LocationFormRow {
  return {
    key: newKey(),
    location_id: clearId ? '' : loc.location_id || '',
    location_code: loc.location_code || '',
    location_name: loc.location_name || '',
    address_line1: loc.address_line1 || '',
    address_line2: loc.address_line2 || '',
    city: loc.city || '',
    state_province: loc.state_province || loc.state || '',
    postal_code: loc.postal_code || '',
    country: loc.country || 'USA',
    contact_person: loc.contact_person || loc.attention_to || '',
    contact_email: loc.contact_email || '',
    contact_phone: loc.contact_phone || '',
    is_default: Boolean(loc.is_default),
    tax_id: loc.tax_id || '',
    shipping_instructions: loc.shipping_instructions || '',
  }
}

function isFilledLocation(row: LocationFormRow) {
  return Boolean(
    row.location_name.trim() ||
      row.address_line1.trim() ||
      row.city.trim() ||
      row.postal_code.trim(),
  )
}

function toLocationPayload(row: LocationFormRow, locationType: 'BILL_TO' | 'SHIP_TO') {
  return {
    location_id: row.location_id.trim() || undefined,
    location_type: locationType,
    location_code: row.location_code.trim() || undefined,
    location_name: row.location_name.trim(),
    address_line1: row.address_line1.trim(),
    address_line2: row.address_line2.trim() || undefined,
    city: row.city.trim(),
    state_province: row.state_province.trim() || undefined,
    postal_code: row.postal_code.trim(),
    country: row.country.trim(),
    contact_person: row.contact_person.trim() || undefined,
    contact_email: row.contact_email.trim() || undefined,
    contact_phone: row.contact_phone.trim() || undefined,
    is_default: row.is_default,
    tax_id: row.tax_id.trim() || undefined,
    shipping_instructions: row.shipping_instructions.trim() || undefined,
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function CustomerForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = !!id

  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [formData, setFormData] = useState({
    customer_id: '',
    customer_number_ext: '',
    company_name: '',
    tax_id_type: '',
    tax_id: '',
    website: '',
    industry_type: '',
    facility_type: '',
    primary_contact_name: '',
    primary_email: '',
    primary_phone: '',
    currency: 'USD',
    credit_limit: '0.00',
    payment_terms: 'NET30',
    preferred_incoterms: '',
    preferred_shipping_method: '',
    tax_exempt: false,
    tax_exempt_certificate_id: '',
    status: 'ACTIVE',
  })
  const [billToRows, setBillToRows] = useState<LocationFormRow[]>([emptyLocation(true)])
  const [shipToRows, setShipToRows] = useState<LocationFormRow[]>([emptyLocation(true)])
  const [certRows, setCertRows] = useState<CertFormRow[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<string | null>(null)

  const {
    data: customer,
    isLoading: isLoadingCustomer,
    isError: isErrorLoadingCustomer,
  } = useQuery({
    queryKey: ['customers', id],
    queryFn: () => (id ? customerService.getCustomer(id) : Promise.resolve(null)),
    enabled: isEditMode,
  })

  useEffect(() => {
    if (!customer) return
    setFormData({
      customer_id: customer.customer_id,
      customer_number_ext: customer.customer_number_ext || '',
      company_name: customer.company_name,
      tax_id_type: customer.tax_id_type || '',
      tax_id: formatTaxIdValue(customer.tax_id_type || '', customer.tax_id || ''),
      website: customer.website || '',
      industry_type: customer.industry_type || '',
      facility_type: customer.facility_type || '',
      primary_contact_name: customer.primary_contact_name || '',
      primary_email: customer.primary_email || '',
      primary_phone: customer.primary_phone || '',
      currency: customer.currency || 'USD',
      credit_limit: String(customer.credit_limit ?? '0.00'),
      payment_terms: customer.payment_terms || 'NET30',
      preferred_incoterms: customer.preferred_incoterms || '',
      preferred_shipping_method: customer.preferred_shipping_method || '',
      tax_exempt: Boolean(customer.tax_exempt),
      tax_exempt_certificate_id: customer.tax_exempt_certificate_id || '',
      status: customer.status || 'ACTIVE',
    })

    const unique = new Map<string, Location>()
    const source =
      customer.locations && customer.locations.length > 0
        ? customer.locations
        : [...(customer.bill_to_locations || []), ...(customer.ship_to_locations || [])]
    source.forEach((loc) => unique.set(loc.location_id, loc))
    const all = Array.from(unique.values())

    const bills = all
      .filter((loc) => loc.location_type === 'BILL_TO' || loc.location_type === 'BOTH')
      .map((loc) => mapLocation(loc))
    const ships = all
      .filter((loc) => loc.location_type === 'SHIP_TO' || loc.location_type === 'BOTH')
      .map((loc) => mapLocation(loc, loc.location_type === 'BOTH'))

    setBillToRows(bills.length ? bills : [emptyLocation(true)])
    setShipToRows(ships.length ? ships : [emptyLocation(true)])
    setCertRows(
      (customer.certifications || []).map((cert) => ({
        key: newKey(),
        id: cert.id,
        certification_name: cert.certification_name || '',
        certificate_number: cert.certificate_number || '',
        valid_until: cert.valid_until || '',
      })),
    )
  }, [customer])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const createMutation = useMutation({
    mutationFn: (data: CustomerWrite) => customerService.createCustomer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['customerLocations'] })
      navigate('/customers', { state: { toast: 'Customer created successfully.' } })
    },
    onError: (error: Error) => {
      setErrors({ submit: error.message || 'Failed to create customer' })
      setToast(error.message || 'Failed to create customer')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: CustomerWrite) => customerService.updateCustomer(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['customerLocations'] })
      navigate('/customers', { state: { toast: 'Customer updated successfully.' } })
    },
    onError: (error: Error) => {
      setErrors({ submit: error.message || 'Failed to update customer' })
      setToast(error.message || 'Failed to update customer')
    },
  })

  const clearError = (name: string) => {
    if (!errors[name]) return
    setErrors((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
    clearError(name)
  }

  const updateLocation = (
    kind: 'bill' | 'ship',
    key: string,
    field: keyof LocationFormRow,
    value: string | boolean,
  ) => {
    const setter = kind === 'bill' ? setBillToRows : setShipToRows
    setter((rows) =>
      rows.map((row) => {
        if (row.key !== key) {
          if (field === 'is_default' && value === true) {
            return { ...row, is_default: false }
          }
          return row
        }
        return { ...row, [field]: value }
      }),
    )
    clearError(kind === 'bill' ? 'billTo' : 'shipTo')
  }

  const copyPrimaryBillTo = () => {
    const source = billToRows.find((row) => row.is_default) || billToRows.find(isFilledLocation) || billToRows[0]
    if (!source || !isFilledLocation(source)) {
      setErrors((prev) => ({ ...prev, shipTo: 'Add a Bill-To location first, then copy it.' }))
      setActiveTab('billTo')
      return
    }
    const copy: LocationFormRow = {
      ...source,
      key: newKey(),
      location_id: '',
      location_code: source.location_code ? `${source.location_code}-SHIP` : '',
      location_name: source.location_name ? `${source.location_name} (Ship-To)` : '',
      is_default: shipToRows.every((row) => !row.is_default),
      shipping_instructions: source.shipping_instructions,
    }
    setShipToRows((rows) => {
      const emptyIndex = rows.findIndex((row) => !isFilledLocation(row))
      if (emptyIndex >= 0) {
        const next = [...rows]
        next[emptyIndex] = { ...copy, is_default: rows[emptyIndex].is_default || copy.is_default }
        return next
      }
      return [...rows, copy]
    })
    setActiveTab('shipTo')
    setErrors((prev) => {
      const next = { ...prev }
      delete next.shipTo
      return next
    })
    setToast('Copied primary Bill-To into a Ship-To location.')
  }

  const validateForm = (): boolean => {
    const next: Record<string, string> = {}
    if (!formData.customer_id.trim()) next.customer_id = 'Customer ID is required'
    if (!formData.company_name.trim()) next.company_name = 'Company Name is required'
    if (formData.primary_email && !EMAIL_RE.test(formData.primary_email)) {
      next.primary_email = 'Enter a valid email address'
    }
    const taxId = formData.tax_id.trim()
    const taxIdType = formData.tax_id_type.trim()
    if (taxId && !taxIdType) {
      next.tax_id_type = 'Select a Tax ID Type'
    }
    if (taxId && taxIdType === 'EIN' && !EIN_RE.test(taxId)) {
      next.tax_id = 'EIN must match XX-XXXXXXX'
    }
    if (taxId && taxIdType === 'SSN' && !SSN_RE.test(taxId)) {
      next.tax_id = 'SSN must match XXX-XX-XXXX'
    }
    if (taxId && taxIdType === 'TIN' && !TIN_RE.test(taxId)) {
      next.tax_id = 'TIN must be 9 digits (EIN or SSN format)'
    }
    if (taxId && taxIdType === 'VAT' && taxId.replace(/[\s.-]/g, '').length < 5) {
      next.tax_id = 'Enter a valid VAT number'
    }
    if (formData.website && !/^https?:\/\/.+/i.test(formData.website) && formData.website.includes('.')) {
      // allow host-only websites; only reject obviously broken values
    }
    const credit = Number(formData.credit_limit)
    if (Number.isNaN(credit) || credit < 0) next.credit_limit = 'Credit limit must be 0 or greater'

    const filledBills = billToRows.filter(isFilledLocation)
    const filledShips = shipToRows.filter(isFilledLocation)
    if (filledBills.length === 0) next.billTo = 'Add at least one Bill-To location.'
    if (filledShips.length === 0) next.shipTo = 'Add at least one Ship-To location.'

    const requireLocation = (row: LocationFormRow, prefix: string, index: number) => {
      if (!row.location_name.trim()) next[`${prefix}.${index}.location_name`] = 'Location name is required'
      if (!row.address_line1.trim()) next[`${prefix}.${index}.address_line1`] = 'Address is required'
      if (!row.city.trim()) next[`${prefix}.${index}.city`] = 'City is required'
      if (!row.postal_code.trim()) next[`${prefix}.${index}.postal_code`] = 'Postal code is required'
      if (!row.country.trim()) next[`${prefix}.${index}.country`] = 'Country is required'
      if (row.contact_email && !EMAIL_RE.test(row.contact_email)) {
        next[`${prefix}.${index}.contact_email`] = 'Enter a valid email address'
      }
    }
    filledBills.forEach((row, index) => requireLocation(row, 'bill', billToRows.indexOf(row) >= 0 ? billToRows.indexOf(row) : index))
    filledShips.forEach((row) => requireLocation(row, 'ship', shipToRows.indexOf(row)))

    certRows.forEach((row, index) => {
      if ((row.certificate_number.trim() || row.valid_until) && !row.certification_name.trim()) {
        next[`cert.${index}.certification_name`] = 'Certification name is required'
      }
    })

    setErrors(next)
    if (next.customer_id || next.company_name || next.primary_email || next.credit_limit || next.tax_id || next.tax_id_type) {
      setActiveTab('general')
    } else if (Object.keys(next).some((key) => key.startsWith('bill') || key === 'billTo')) {
      setActiveTab('billTo')
    } else if (Object.keys(next).some((key) => key.startsWith('ship') || key === 'shipTo')) {
      setActiveTab('shipTo')
    } else if (Object.keys(next).some((key) => key.startsWith('cert'))) {
      setActiveTab('certs')
    }
    return Object.keys(next).length === 0
  }

  const buildPayload = (): CustomerWrite => ({
    customer_id: formData.customer_id.trim(),
    customer_number_ext: formData.customer_number_ext.trim() || undefined,
    company_name: formData.company_name.trim(),
    tax_id_type: formData.tax_id_type.trim() || undefined,
    tax_id: formData.tax_id.trim() || undefined,
    website: formData.website.trim() || undefined,
    industry_type: formData.industry_type || undefined,
    facility_type: formData.facility_type || undefined,
    primary_contact_name: formData.primary_contact_name.trim() || undefined,
    primary_email: formData.primary_email.trim() || undefined,
    primary_phone: formData.primary_phone.trim() || undefined,
    currency: formData.currency || 'USD',
    credit_limit: Number(formData.credit_limit || 0).toFixed(2),
    payment_terms: formData.payment_terms || undefined,
    preferred_incoterms: formData.preferred_incoterms || undefined,
    preferred_shipping_method: formData.preferred_shipping_method || undefined,
    tax_exempt: formData.tax_exempt,
    tax_exempt_certificate_id: formData.tax_exempt_certificate_id.trim() || undefined,
    status: formData.status,
    locations: [
      ...billToRows.filter(isFilledLocation).map((row) => toLocationPayload(row, 'BILL_TO')),
      ...shipToRows.filter(isFilledLocation).map((row) => toLocationPayload(row, 'SHIP_TO')),
    ],
    certifications: certRows
      .filter((row) => row.certification_name.trim())
      .map((row) => ({
        id: row.id,
        certification_name: row.certification_name.trim(),
        certificate_number: row.certificate_number.trim() || undefined,
        valid_until: row.valid_until || undefined,
      })),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return
    const payload = buildPayload()
    if (isEditMode) updateMutation.mutate(payload)
    else createMutation.mutate(payload)
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending
  const industryOptions = useMemo(
    () => uniqueOptions(INDUSTRY_OPTIONS, formData.industry_type),
    [formData.industry_type],
  )
  const facilityOptions = useMemo(
    () => uniqueOptions(FACILITY_OPTIONS, formData.facility_type),
    [formData.facility_type],
  )

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

  const tabs: Array<{ id: TabId; label: string; count?: number; hasError?: boolean }> = [
    { id: 'general', label: 'General & Commercial', hasError: Boolean(errors.customer_id || errors.company_name || errors.tax_id || errors.tax_id_type) },
    { id: 'billTo', label: 'Bill-To Locations', count: billToRows.filter(isFilledLocation).length, hasError: Boolean(errors.billTo) },
    { id: 'shipTo', label: 'Ship-To Locations', count: shipToRows.filter(isFilledLocation).length, hasError: Boolean(errors.shipTo) },
    { id: 'certs', label: 'Certifications', count: certRows.filter((row) => row.certification_name.trim()).length },
  ]

  return (
    <div style={containerStyle}>
      {toast && errors.submit && (
        <div style={errorToastStyle} role="alert">
          {toast}
        </div>
      )}
      {toast && !errors.submit && (
        <div style={successToastStyle} role="status">
          {toast}
        </div>
      )}
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>{isEditMode ? 'Edit Customer' : 'Create New Customer'}</h2>
          <p style={pageSubStyle}>Manufacturing customer master with Bill-To, Ship-To, and certifications</p>
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        <div style={tabListStyle} role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...tabButtonStyle,
                borderBottom: activeTab === tab.id ? '2px solid #1976d2' : '2px solid transparent',
                color: tab.hasError ? '#c62828' : activeTab === tab.id ? '#1565c0' : 'var(--text)',
              }}
            >
              {tab.label}
              {typeof tab.count === 'number' ? ` (${tab.count})` : ''}
            </button>
          ))}
        </div>

        {activeTab === 'general' && (
          <div style={cardStyle}>
            <h3 style={sectionHeadingStyle}>General & Commercial Info</h3>
            <div style={gridStyle}>
              <Field
                label="Customer ID *"
                name="customer_id"
                value={formData.customer_id}
                onChange={handleChange}
                disabled={isEditMode}
                error={errors.customer_id}
                placeholder="CUST-001"
              />
              <Field
                label="Company Name *"
                name="company_name"
                value={formData.company_name}
                onChange={handleChange}
                error={errors.company_name}
                placeholder="Company legal name"
              />
              <Field
                label="Customer Number Ext"
                name="customer_number_ext"
                value={formData.customer_number_ext}
                onChange={handleChange}
                placeholder="External / ERP number"
              />
              <TaxIdFields
                taxIdType={formData.tax_id_type}
                taxId={formData.tax_id}
                typeError={errors.tax_id_type}
                taxIdError={errors.tax_id}
                onTypeChange={(value) => {
                  setFormData((prev) => ({
                    ...prev,
                    tax_id_type: value,
                    tax_id: formatTaxIdValue(value, prev.tax_id),
                  }))
                  clearError('tax_id_type')
                  clearError('tax_id')
                }}
                onTaxIdChange={(value) => {
                  setFormData((prev) => ({
                    ...prev,
                    tax_id: formatTaxIdValue(prev.tax_id_type, value),
                  }))
                  clearError('tax_id')
                  clearError('tax_id_type')
                }}
              />
              <Field
                label="Website"
                name="website"
                value={formData.website}
                onChange={handleChange}
                placeholder="https://"
              />
              <SelectField
                label="Industry Type"
                name="industry_type"
                value={formData.industry_type}
                onChange={handleChange}
                options={industryOptions}
              />
              <SelectField
                label="Facility Type"
                name="facility_type"
                value={formData.facility_type}
                onChange={handleChange}
                options={facilityOptions}
              />
              <SelectField
                label="Currency"
                name="currency"
                value={formData.currency}
                onChange={handleChange}
                options={CURRENCY_OPTIONS}
                allowBlank={false}
              />
              <Field
                label="Credit Limit"
                name="credit_limit"
                value={formData.credit_limit}
                onChange={handleChange}
                error={errors.credit_limit}
                inputMode="decimal"
              />
              <SelectField
                label="Payment Terms"
                name="payment_terms"
                value={formData.payment_terms}
                onChange={handleChange}
                options={PAYMENT_OPTIONS}
              />
              <SelectField
                label="Preferred Incoterms"
                name="preferred_incoterms"
                value={formData.preferred_incoterms}
                onChange={handleChange}
                options={[...INCOTERM_OPTIONS]}
              />
              <SelectField
                label="Preferred Shipping Method"
                name="preferred_shipping_method"
                value={formData.preferred_shipping_method}
                onChange={handleChange}
                options={[...SHIPPING_METHOD_OPTIONS]}
              />
              <SelectField
                label="Status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                options={STATUS_OPTIONS.map((opt) => opt.value)}
                labels={Object.fromEntries(STATUS_OPTIONS.map((opt) => [opt.value, opt.label]))}
                allowBlank={false}
              />
              <Field
                label="Primary Contact"
                name="primary_contact_name"
                value={formData.primary_contact_name}
                onChange={handleChange}
              />
              <Field
                label="Primary Email"
                name="primary_email"
                value={formData.primary_email}
                onChange={handleChange}
                error={errors.primary_email}
              />
              <Field
                label="Primary Phone"
                name="primary_phone"
                value={formData.primary_phone}
                onChange={handleChange}
              />
            </div>
            <div style={{ ...fieldGroupStyle, marginTop: 16 }}>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  name="tax_exempt"
                  checked={formData.tax_exempt}
                  onChange={handleChange}
                />
                Tax exempt
              </label>
              {formData.tax_exempt && (
                <div style={{ marginTop: 10, maxWidth: 360 }}>
                  <Field
                    label="Tax Exempt Certificate ID"
                    name="tax_exempt_certificate_id"
                    value={formData.tax_exempt_certificate_id}
                    onChange={handleChange}
                    placeholder="Certificate / exemption ID"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'billTo' && (
          <LocationSection
            title="Bill-To Locations"
            hint="At least one billing address is required. Only one can be the default Bill-To."
            rows={billToRows}
            kind="bill"
            errors={errors}
            onChange={updateLocation}
            onAdd={() => setBillToRows((rows) => [...rows, emptyLocation(rows.every((row) => !row.is_default))])}
            onRemove={(key) =>
              setBillToRows((rows) => (rows.length <= 1 ? [emptyLocation(true)] : rows.filter((row) => row.key !== key)))
            }
            showTaxId
            showDockNotes={false}
            defaultLabel="Default Bill-To"
          />
        )}

        {activeTab === 'shipTo' && (
          <LocationSection
            title="Ship-To Locations"
            hint="Plant / receiving sites. At least one Ship-To is required."
            rows={shipToRows}
            kind="ship"
            errors={errors}
            onChange={updateLocation}
            onAdd={() => setShipToRows((rows) => [...rows, emptyLocation(rows.every((row) => !row.is_default))])}
            onRemove={(key) =>
              setShipToRows((rows) => (rows.length <= 1 ? [emptyLocation(true)] : rows.filter((row) => row.key !== key)))
            }
            showTaxId={false}
            showDockNotes
            defaultLabel="Default Ship-To"
            extraAction={
              <button type="button" onClick={copyPrimaryBillTo} style={secondaryButtonStyle}>
                Copy from Primary Bill-To
              </button>
            }
          />
        )}

        {activeTab === 'certs' && (
          <div style={cardStyle}>
            <div style={sectionHeaderRowStyle}>
              <h3 style={{ ...sectionHeadingStyle, margin: 0, border: 'none', padding: 0 }}>Certifications</h3>
              <button type="button" onClick={() => setCertRows((rows) => [...rows, emptyCert()])} style={secondaryButtonStyle}>
                + Add Certification
              </button>
            </div>
            {certRows.length === 0 && (
              <p style={hintStyle}>No certifications yet. Add ISO / IATF / customer-required certificates.</p>
            )}
            {certRows.map((row, index) => (
              <div key={row.key} style={certRowStyle}>
                <SelectField
                  label="Certification Name"
                  name={`cert-name-${row.key}`}
                  value={row.certification_name}
                  onChange={(e) =>
                    setCertRows((rows) =>
                      rows.map((item) =>
                        item.key === row.key ? { ...item, certification_name: e.target.value } : item,
                      ),
                    )
                  }
                  options={uniqueOptions(CERT_NAME_OPTIONS, row.certification_name)}
                  error={errors[`cert.${index}.certification_name`]}
                />
                <Field
                  label="Certificate Number"
                  name={`cert-no-${row.key}`}
                  value={row.certificate_number}
                  onChange={(e) =>
                    setCertRows((rows) =>
                      rows.map((item) =>
                        item.key === row.key ? { ...item, certificate_number: e.target.value } : item,
                      ),
                    )
                  }
                />
                <Field
                  label="Valid Until"
                  name={`cert-until-${row.key}`}
                  value={row.valid_until}
                  onChange={(e) =>
                    setCertRows((rows) =>
                      rows.map((item) =>
                        item.key === row.key ? { ...item, valid_until: e.target.value } : item,
                      ),
                    )
                  }
                  type="date"
                />
                <button
                  type="button"
                  onClick={() => setCertRows((rows) => rows.filter((item) => item.key !== row.key))}
                  style={{ ...dangerButtonStyle, alignSelf: 'end', marginBottom: 2 }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {errors.submit && (
          <div style={errorAlertStyle}>
            <span>⚠️ {errors.submit}</span>
          </div>
        )}
        {errors.billTo && activeTab !== 'billTo' && <div style={errorAlertStyle}>{errors.billTo}</div>}
        {errors.shipTo && activeTab !== 'shipTo' && <div style={errorAlertStyle}>{errors.shipTo}</div>}

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
          <button type="button" onClick={() => navigate('/customers')} style={secondaryButtonStyle}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

function uniqueOptions(options: string[], current?: string) {
  if (current && !options.includes(current)) return [current, ...options]
  return options
}

function TaxIdFields({
  taxIdType,
  taxId,
  typeError,
  taxIdError,
  onTypeChange,
  onTaxIdChange,
}: {
  taxIdType: string
  taxId: string
  typeError?: string
  taxIdError?: string
  onTypeChange: (value: string) => void
  onTaxIdChange: (value: string) => void
}) {
  const typeOptions = uniqueOptions(TAX_ID_TYPE_OPTIONS, taxIdType)
  return (
    <div style={taxIdRowStyle}>
      <SelectField
        label="Tax ID Type"
        name="tax_id_type"
        value={taxIdType}
        onChange={(e) => onTypeChange(e.target.value)}
        options={typeOptions}
        labels={TAX_ID_TYPE_LABELS}
        error={typeError}
      />
      <Field
        label="Tax ID"
        name="tax_id"
        value={taxId}
        onChange={(e) => onTaxIdChange(e.target.value)}
        error={taxIdError}
        placeholder={TAX_ID_PLACEHOLDERS[taxIdType] || 'VAT / EIN'}
        maxLength={taxIdMaxLength(taxIdType)}
        inputMode={taxIdType === 'VAT' || taxIdType === 'OTHER' || !taxIdType ? undefined : 'numeric'}
      />
    </div>
  )
}

function Field({
  label,
  name,
  value,
  onChange,
  error,
  placeholder,
  disabled,
  type = 'text',
  inputMode,
  maxLength,
}: {
  label: string
  name: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  error?: string
  placeholder?: string
  disabled?: boolean
  type?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  maxLength?: number
}) {
  return (
    <div style={fieldGroupStyle}>
      <label htmlFor={name} style={labelStyle}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        style={{
          ...inputStyle,
          backgroundColor: disabled ? 'var(--social-bg)' : 'var(--bg)',
          cursor: disabled ? 'not-allowed' : 'text',
          border: error ? '1px solid #f44336' : '1px solid var(--border)',
        }}
      />
      {error && <span style={errorTextStyle}>{error}</span>}
    </div>
  )
}

function SelectField({
  label,
  name,
  value,
  onChange,
  options,
  labels,
  allowBlank = true,
  error,
}: {
  label: string
  name: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  options: string[]
  labels?: Record<string, string>
  allowBlank?: boolean
  error?: string
}) {
  return (
    <div style={fieldGroupStyle}>
      <label htmlFor={name} style={labelStyle}>
        {label}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        style={{ ...inputStyle, border: error ? '1px solid #f44336' : '1px solid var(--border)' }}
      >
        {allowBlank && <option value="">Select…</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labels?.[opt] || opt}
          </option>
        ))}
      </select>
      {error && <span style={errorTextStyle}>{error}</span>}
    </div>
  )
}

function LocationSection({
  title,
  hint,
  rows,
  kind,
  errors,
  onChange,
  onAdd,
  onRemove,
  showTaxId,
  showDockNotes,
  defaultLabel,
  extraAction,
}: {
  title: string
  hint: string
  rows: LocationFormRow[]
  kind: 'bill' | 'ship'
  errors: Record<string, string>
  onChange: (kind: 'bill' | 'ship', key: string, field: keyof LocationFormRow, value: string | boolean) => void
  onAdd: () => void
  onRemove: (key: string) => void
  showTaxId: boolean
  showDockNotes: boolean
  defaultLabel: string
  extraAction?: React.ReactNode
}) {
  const sectionError = kind === 'bill' ? errors.billTo : errors.shipTo
  return (
    <div style={cardStyle}>
      <div style={sectionHeaderRowStyle}>
        <div>
          <h3 style={{ ...sectionHeadingStyle, margin: 0, border: 'none', padding: 0 }}>{title}</h3>
          <p style={hintStyle}>{hint}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {extraAction}
          <button type="button" onClick={onAdd} style={secondaryButtonStyle}>
            + Add Location
          </button>
        </div>
      </div>
      {sectionError && <div style={{ ...errorAlertStyle, marginBottom: 12 }}>{sectionError}</div>}
      {rows.map((row, index) => (
        <div key={row.key} style={locationCardStyle}>
          <div style={locationCardHeaderStyle}>
            <strong>
              {kind === 'bill' ? 'Billing site' : 'Plant / facility'} {index + 1}
            </strong>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={row.is_default}
                onChange={(e) => onChange(kind, row.key, 'is_default', e.target.checked)}
              />
              {defaultLabel}
            </label>
          </div>
          <div style={gridStyle}>
            <Field
              label={kind === 'bill' ? 'Location Name *' : 'Plant / Facility Name *'}
              name={`${row.key}-name`}
              value={row.location_name}
              onChange={(e) => onChange(kind, row.key, 'location_name', e.target.value)}
              error={errors[`${kind}.${index}.location_name`]}
            />
            <Field
              label="Location Code"
              name={`${row.key}-code`}
              value={row.location_code}
              onChange={(e) => onChange(kind, row.key, 'location_code', e.target.value)}
              placeholder={kind === 'bill' ? 'HQ-BILLING' : 'PLANT-01'}
            />
            <Field
              label="Address Line 1 *"
              name={`${row.key}-addr1`}
              value={row.address_line1}
              onChange={(e) => onChange(kind, row.key, 'address_line1', e.target.value)}
              error={errors[`${kind}.${index}.address_line1`]}
            />
            <Field
              label="Address Line 2"
              name={`${row.key}-addr2`}
              value={row.address_line2}
              onChange={(e) => onChange(kind, row.key, 'address_line2', e.target.value)}
            />
            <Field
              label="City *"
              name={`${row.key}-city`}
              value={row.city}
              onChange={(e) => onChange(kind, row.key, 'city', e.target.value)}
              error={errors[`${kind}.${index}.city`]}
            />
            <Field
              label="State / Province"
              name={`${row.key}-state`}
              value={row.state_province}
              onChange={(e) => onChange(kind, row.key, 'state_province', e.target.value)}
            />
            <Field
              label="Postal Code *"
              name={`${row.key}-postal`}
              value={row.postal_code}
              onChange={(e) => onChange(kind, row.key, 'postal_code', e.target.value)}
              error={errors[`${kind}.${index}.postal_code`]}
            />
            <Field
              label="Country *"
              name={`${row.key}-country`}
              value={row.country}
              onChange={(e) => onChange(kind, row.key, 'country', e.target.value)}
              error={errors[`${kind}.${index}.country`]}
            />
            <Field
              label={kind === 'bill' ? 'Billing Contact' : 'Receiving Contact'}
              name={`${row.key}-contact`}
              value={row.contact_person}
              onChange={(e) => onChange(kind, row.key, 'contact_person', e.target.value)}
            />
            <Field
              label="Contact Email"
              name={`${row.key}-email`}
              value={row.contact_email}
              onChange={(e) => onChange(kind, row.key, 'contact_email', e.target.value)}
              error={errors[`${kind}.${index}.contact_email`]}
            />
            <Field
              label="Contact Phone"
              name={`${row.key}-phone`}
              value={row.contact_phone}
              onChange={(e) => onChange(kind, row.key, 'contact_phone', e.target.value)}
            />
            {showTaxId && (
              <Field
                label="VAT / Tax ID"
                name={`${row.key}-tax`}
                value={row.tax_id}
                onChange={(e) => onChange(kind, row.key, 'tax_id', e.target.value)}
              />
            )}
          </div>
          {showDockNotes && (
            <div style={{ ...fieldGroupStyle, marginTop: 12 }}>
              <label htmlFor={`${row.key}-dock`} style={labelStyle}>
                Dock Notes / Shipping Instructions
              </label>
              <textarea
                id={`${row.key}-dock`}
                value={row.shipping_instructions}
                onChange={(e) => onChange(kind, row.key, 'shipping_instructions', e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
                placeholder="Receiving hours, dock number, appointment rules"
              />
            </div>
          )}
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <button type="button" onClick={() => onRemove(row.key)} style={dangerButtonStyle}>
              Remove location
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1080px',
  margin: '0 auto',
  textAlign: 'left',
}

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '16px',
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

const tabListStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
  marginBottom: 16,
  borderBottom: '1px solid var(--border)',
}

const tabButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '10px 14px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  fontFamily: 'inherit',
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

const sectionHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
  marginBottom: 16,
  flexWrap: 'wrap',
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '16px',
}

const taxIdRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(200px, 0.9fr) minmax(220px, 1.1fr)',
  gap: '16px',
  gridColumn: '1 / -1',
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
  fontWeight: 500,
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

const dangerButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  color: '#c62828',
  borderColor: '#ffcdd2',
  padding: '6px 12px',
  fontSize: 12,
}

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
}

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-h)',
}

const hintStyle: React.CSSProperties = {
  margin: '6px 0 0 0',
  fontSize: 13,
  color: 'var(--text)',
}

const locationCardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 14,
  backgroundColor: 'var(--social-bg)',
}

const locationCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  marginBottom: 12,
  flexWrap: 'wrap',
}

const certRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(180px, 1.2fr) minmax(160px, 1fr) minmax(140px, 0.8fr) auto',
  gap: 12,
  marginBottom: 12,
  alignItems: 'start',
}

const successToastStyle: React.CSSProperties = {
  marginBottom: 16,
  backgroundColor: '#e8f5e9',
  color: '#1b5e20',
  border: '1px solid #c8e6c9',
  borderRadius: 6,
  padding: '12px 16px',
  fontWeight: 600,
}

const errorToastStyle: React.CSSProperties = {
  marginBottom: 16,
  backgroundColor: '#ffebee',
  color: '#b71c1c',
  border: '1px solid #ffcdd2',
  borderRadius: 6,
  padding: '12px 16px',
  fontWeight: 600,
}

export default CustomerForm
