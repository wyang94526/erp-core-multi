/**
 * VendorForm Component
 * Create / edit material suppliers and subcontractors
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { chartOfAccountsService, inventoryService, vendorService, workCenterService } from '../api/services'
import type { SupplierWrite, VendorPaymentMethod, VendorQcStatus, VendorType } from '../types'

const PAYMENT_TERMS_OPTIONS = ['Due on Receipt', 'Net 15', 'Net 30', 'Net 60', 'Net 90']
const VENDOR_TYPE_OPTIONS: Array<{ value: VendorType; label: string }> = [
  { value: 'material', label: 'Material supplier' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'both', label: 'Material & subcontractor' },
  { value: 'service', label: 'Service' },
]
const PAYMENT_METHOD_OPTIONS: Array<{ value: VendorPaymentMethod; label: string }> = [
  { value: 'wire', label: 'Wire' },
  { value: 'ach', label: 'ACH' },
  { value: 'check', label: 'Check' },
  { value: 'credit_card', label: 'Credit card' },
]
const QC_STATUS_OPTIONS: Array<{ value: VendorQcStatus; label: string }> = [
  { value: 'approved', label: 'Approved' },
  { value: 'probation', label: 'Probation' },
  { value: 'blocked', label: 'Blocked' },
]
const CURRENCY_OPTIONS = ['USD', 'EUR', 'JPY', 'TWD', 'CNY']
const INCOTERM_OPTIONS = ['FOB', 'EXW', 'DDP', 'CIF', 'FCA', 'CPT']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type VendorFormData = {
  supplier_id: string
  company_name: string
  vendor_number_ext: string
  vendor_type: VendorType
  tax_id: string
  status: string
  qc_status: VendorQcStatus
  contact_name: string
  contact_email: string
  phone_number: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  postal_code: string
  country: string
  payment_terms: string
  payment_method: VendorPaymentMethod | ''
  currency: string
  ap_account_id: string
  incoterms: string
  lead_time_days: string
  work_center_id: string
  consignment_stock_loc_id: string
  standard_scrap_rate: string
  iso_certified: boolean
  notes: string
}

const EMPTY_FORM: VendorFormData = {
  supplier_id: '',
  company_name: '',
  vendor_number_ext: '',
  vendor_type: 'material',
  tax_id: '',
  status: 'Active',
  qc_status: 'approved',
  contact_name: '',
  contact_email: '',
  phone_number: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
  payment_terms: 'Net 30',
  payment_method: '',
  currency: 'USD',
  ap_account_id: '',
  incoterms: '',
  lead_time_days: '0',
  work_center_id: '',
  consignment_stock_loc_id: '',
  standard_scrap_rate: '0.00',
  iso_certified: false,
  notes: '',
}

function blankToUndef(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function VendorForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = !!id

  const [formData, setFormData] = useState<VendorFormData>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const { data: vendor, isLoading: isLoadingVendor, isError: isErrorLoadingVendor } = useQuery({
    queryKey: ['vendors', id],
    queryFn: () => (id ? vendorService.getVendor(id) : Promise.resolve(null)),
    enabled: isEditMode,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => chartOfAccountsService.listAccounts(0, 500),
  })
  const { data: workCenters = [] } = useQuery({
    queryKey: ['workCenters'],
    queryFn: () => workCenterService.listWorkCenters(0, 200),
  })
  const { data: bins = [] } = useQuery({
    queryKey: ['inventoryBins'],
    queryFn: () => inventoryService.listBins(),
  })

  useEffect(() => {
    if (!vendor) return
    setFormData({
      supplier_id: vendor.supplier_id,
      company_name: vendor.company_name,
      vendor_number_ext: vendor.vendor_number_ext || '',
      vendor_type: (vendor.vendor_type as VendorType) || 'material',
      tax_id: vendor.tax_id || '',
      status: vendor.status || 'Active',
      qc_status: (vendor.qc_status as VendorQcStatus) || 'approved',
      contact_name: vendor.contact_name || '',
      contact_email: vendor.contact_email || '',
      phone_number: vendor.phone_number || '',
      address_line1: vendor.address_line1 || '',
      address_line2: vendor.address_line2 || '',
      city: vendor.city || '',
      state: vendor.state || '',
      postal_code: vendor.postal_code || '',
      country: vendor.country || '',
      payment_terms: vendor.payment_terms || 'Net 30',
      payment_method: (vendor.payment_method as VendorPaymentMethod) || '',
      currency: vendor.currency || 'USD',
      ap_account_id: vendor.ap_account_id || '',
      incoterms: vendor.incoterms || '',
      lead_time_days: String(vendor.lead_time_days ?? 0),
      work_center_id: vendor.work_center_id || '',
      consignment_stock_loc_id: vendor.consignment_stock_loc_id || '',
      standard_scrap_rate: String(vendor.standard_scrap_rate ?? '0.00'),
      iso_certified: Boolean(vendor.iso_certified),
      notes: vendor.notes || '',
    })
  }, [vendor])

  const showSubcontracting =
    formData.vendor_type === 'subcontractor' || formData.vendor_type === 'both'

  const apAccounts = useMemo(() => {
    const liability = accounts.filter((acct) => acct.account_type === 'Liability')
    const source = liability.length > 0 ? liability : accounts
    if (formData.ap_account_id && !source.some((acct) => acct.id === formData.ap_account_id)) {
      const selected = accounts.find((acct) => acct.id === formData.ap_account_id)
      return selected ? [selected, ...source] : source
    }
    return source
  }, [accounts, formData.ap_account_id])

  const buildPayload = (data: VendorFormData): SupplierWrite => ({
    supplier_id: data.supplier_id.trim(),
    company_name: data.company_name.trim(),
    vendor_number_ext: blankToUndef(data.vendor_number_ext) || null,
    vendor_type: data.vendor_type,
    tax_id: blankToUndef(data.tax_id) || null,
    status: data.status,
    qc_status: data.qc_status,
    contact_name: blankToUndef(data.contact_name) || null,
    contact_email: blankToUndef(data.contact_email) || null,
    phone_number: blankToUndef(data.phone_number) || null,
    address_line1: blankToUndef(data.address_line1) || null,
    address_line2: blankToUndef(data.address_line2) || null,
    city: blankToUndef(data.city) || null,
    state: blankToUndef(data.state) || null,
    postal_code: blankToUndef(data.postal_code) || null,
    country: blankToUndef(data.country) || null,
    payment_terms: blankToUndef(data.payment_terms) || null,
    payment_method: data.payment_method || null,
    currency: data.currency || 'USD',
    ap_account_id: blankToUndef(data.ap_account_id) || null,
    incoterms: blankToUndef(data.incoterms) || null,
    lead_time_days: Number(data.lead_time_days || 0),
    work_center_id: showSubcontracting ? blankToUndef(data.work_center_id) || null : null,
    consignment_stock_loc_id: showSubcontracting
      ? blankToUndef(data.consignment_stock_loc_id) || null
      : null,
    standard_scrap_rate: Number(data.standard_scrap_rate || 0).toFixed(2),
    iso_certified: showSubcontracting ? data.iso_certified : false,
    notes: blankToUndef(data.notes) || null,
  })

  const createMutation = useMutation({
    mutationFn: (data: VendorFormData) => vendorService.createVendor(buildPayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      navigate('/vendors')
    },
    onError: (error: Error) => {
      setErrors({ submit: error.message || 'Failed to create vendor' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: VendorFormData) => vendorService.updateVendor(id!, buildPayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      navigate('/vendors')
    },
    onError: (error: Error) => {
      setErrors({ submit: error.message || 'Failed to update vendor' })
    },
  })

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  const validateForm = (): boolean => {
    const next: Record<string, string> = {}
    if (!formData.supplier_id.trim()) next.supplier_id = 'Vendor ID is required'
    if (!formData.company_name.trim()) next.company_name = 'Company Name is required'
    if (formData.contact_email && !EMAIL_RE.test(formData.contact_email)) {
      next.contact_email = 'Please enter a valid email address'
    }
    const lead = Number(formData.lead_time_days)
    if (!Number.isFinite(lead) || lead < 0) next.lead_time_days = 'Lead time must be 0 or greater'
    const scrap = Number(formData.standard_scrap_rate)
    if (!Number.isFinite(scrap) || scrap < 0 || scrap > 100) {
      next.standard_scrap_rate = 'Scrap rate must be between 0 and 100'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return
    if (isEditMode) updateMutation.mutate(formData)
    else createMutation.mutate(formData)
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
          <p style={pageSubStyle}>Material suppliers and subcontractors for purchasing and outside processing</p>
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        <Section title="Basic Info">
          <Field label="Vendor ID *" name="supplier_id" value={formData.supplier_id} onChange={handleChange} error={errors.supplier_id} disabled={isEditMode} placeholder="e.g. SUP-006" />
          <Field label="Company Name *" name="company_name" value={formData.company_name} onChange={handleChange} error={errors.company_name} />
          <Field label="Vendor Number Ext" name="vendor_number_ext" value={formData.vendor_number_ext} onChange={handleChange} />
          <SelectField label="Vendor Type" name="vendor_type" value={formData.vendor_type} onChange={handleChange} options={VENDOR_TYPE_OPTIONS} />
          <Field label="Tax ID / VAT" name="tax_id" value={formData.tax_id} onChange={handleChange} placeholder="Uniform Invoice / VAT number" />
          <SelectField
            label="Status"
            name="status"
            value={formData.status}
            onChange={handleChange}
            options={[
              { value: 'Active', label: 'Active' },
              { value: 'Inactive', label: 'Inactive' },
            ]}
          />
          <SelectField label="QC Status" name="qc_status" value={formData.qc_status} onChange={handleChange} options={QC_STATUS_OPTIONS} />
        </Section>

        <Section title="Contact & Address">
          <Field label="Contact Name" name="contact_name" value={formData.contact_name} onChange={handleChange} />
          <Field label="Contact Email" name="contact_email" value={formData.contact_email} onChange={handleChange} error={errors.contact_email} />
          <Field label="Phone Number" name="phone_number" value={formData.phone_number} onChange={handleChange} />
          <Field label="Address Line 1" name="address_line1" value={formData.address_line1} onChange={handleChange} />
          <Field label="Address Line 2" name="address_line2" value={formData.address_line2} onChange={handleChange} />
          <Field label="City" name="city" value={formData.city} onChange={handleChange} />
          <Field label="State" name="state" value={formData.state} onChange={handleChange} />
          <Field label="Postal Code" name="postal_code" value={formData.postal_code} onChange={handleChange} />
          <Field label="Country" name="country" value={formData.country} onChange={handleChange} />
        </Section>

        <Section title="Commercial & Payment Terms">
          <SelectField
            label="Payment Terms"
            name="payment_terms"
            value={formData.payment_terms}
            onChange={handleChange}
            options={PAYMENT_TERMS_OPTIONS.map((term) => ({ value: term, label: term }))}
          />
          <SelectField
            label="Payment Method"
            name="payment_method"
            value={formData.payment_method}
            onChange={handleChange}
            options={PAYMENT_METHOD_OPTIONS}
            allowBlank
          />
          <SelectField
            label="Currency"
            name="currency"
            value={formData.currency}
            onChange={handleChange}
            options={CURRENCY_OPTIONS.map((code) => ({ value: code, label: code }))}
          />
          <div style={fieldGroupStyle}>
            <label htmlFor="ap_account_id" style={labelStyle}>AP Account</label>
            <select id="ap_account_id" name="ap_account_id" value={formData.ap_account_id} onChange={handleChange} style={inputStyle}>
              <option value="">Select AP GL account…</option>
              {apAccounts.map((acct) => (
                <option key={acct.id} value={acct.id}>
                  {acct.account_code} — {acct.account_name}
                </option>
              ))}
            </select>
          </div>
          <SelectField
            label="Incoterms"
            name="incoterms"
            value={formData.incoterms}
            onChange={handleChange}
            options={INCOTERM_OPTIONS.map((code) => ({ value: code, label: code }))}
            allowBlank
          />
          <Field
            label="Lead Time (days)"
            name="lead_time_days"
            value={formData.lead_time_days}
            onChange={handleChange}
            error={errors.lead_time_days}
            inputMode="numeric"
          />
        </Section>

        {showSubcontracting && (
          <Section title="Subcontracting & Manufacturing">
            <div style={fieldGroupStyle}>
              <label htmlFor="work_center_id" style={labelStyle}>Work Center</label>
              <select id="work_center_id" name="work_center_id" value={formData.work_center_id} onChange={handleChange} style={inputStyle}>
                <option value="">None</option>
                {workCenters.filter((wc) => wc.is_active !== false).map((wc) => (
                  <option key={wc.work_center_id} value={wc.work_center_id}>
                    {wc.name} ({wc.work_center_id})
                  </option>
                ))}
              </select>
            </div>
            <div style={fieldGroupStyle}>
              <label htmlFor="consignment_stock_loc_id" style={labelStyle}>Consignment Stock Location</label>
              <select
                id="consignment_stock_loc_id"
                name="consignment_stock_loc_id"
                value={formData.consignment_stock_loc_id}
                onChange={handleChange}
                style={inputStyle}
              >
                <option value="">None</option>
                {bins.filter((bin) => bin.is_active !== false).map((bin) => (
                  <option key={bin.bin_id} value={bin.bin_id}>
                    {(bin.warehouse_code || bin.warehouse_id) + ' / ' + bin.bin_code}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Standard Scrap Rate (%)"
              name="standard_scrap_rate"
              value={formData.standard_scrap_rate}
              onChange={handleChange}
              error={errors.standard_scrap_rate}
              inputMode="decimal"
            />
            <div style={{ ...fieldGroupStyle, justifyContent: 'center' }}>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  name="iso_certified"
                  checked={formData.iso_certified}
                  onChange={handleChange}
                />
                ISO certified
              </label>
            </div>
          </Section>
        )}

        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Notes</h3>
          <textarea
            id="notes"
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 96, width: '100%' }}
            placeholder="Quality notes, audit comments, special handling"
          />
        </div>

        {errors.submit && (
          <div style={errorAlertStyle}>
            <span>⚠️ {errors.submit}</span>
          </div>
        )}

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
          <button type="button" onClick={() => navigate('/vendors')} style={secondaryButtonStyle}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={cardStyle}>
      <h3 style={sectionHeadingStyle}>{title}</h3>
      <div style={gridStyle}>{children}</div>
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
  inputMode,
}: {
  label: string
  name: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  error?: string
  placeholder?: string
  disabled?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
}) {
  return (
    <div style={fieldGroupStyle}>
      <label htmlFor={name} style={labelStyle}>{label}</label>
      <input
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={inputMode}
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
  allowBlank = false,
}: {
  label: string
  name: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  options: Array<{ value: string; label: string }>
  allowBlank?: boolean
}) {
  return (
    <div style={fieldGroupStyle}>
      <label htmlFor={name} style={labelStyle}>{label}</label>
      <select id={name} name={name} value={value} onChange={onChange} style={inputStyle}>
        {allowBlank && <option value="">Select…</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '960px',
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

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-h)',
  minHeight: 42,
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
