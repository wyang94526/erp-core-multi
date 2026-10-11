/**
 * @author: Wendy Yang
 * @date: 2026-10-02
 *
 * Company Profile — letterhead used on Sales / Purchase / Subcontract order PDFs.
 */

import { useEffect, useState, type CSSProperties, type ChangeEvent, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Loader2, Save, Trash2 } from 'lucide-react'
import { getStoredCompanyId } from '../api/client'
import { companyProfileService } from '../api/services'
import { useAuth } from '../context/AuthContext'
import { companyNameKey, companyProfileKey, useCompanyProfile } from '../hooks/useCompanyProfile'
import type { CompanyAddress, CompanyProfile } from '../types'
import { emptyCompanyAddress } from '../utils/pdfLetterhead'
import { PageHeader } from './PageHeader'
import { dangerButtonStyle, headerButtonStyle, primaryButtonStyle } from '../utils/documentPageStyles'

const ADDRESS_FIELDS: Array<{ key: keyof CompanyAddress; label: string }> = [
  { key: 'location_name', label: 'Location name' },
  { key: 'attention_to', label: 'Attention' },
  { key: 'address_line1', label: 'Address line 1' },
  { key: 'address_line2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State / province' },
  { key: 'postal_code', label: 'Postal code' },
  { key: 'country', label: 'Country' },
  { key: 'contact_person', label: 'Location contact' },
  { key: 'contact_email', label: 'Location email' },
  { key: 'contact_phone', label: 'Location phone' },
]

function addressFrom(profile: CompanyProfile | undefined, key: 'bill_to' | 'ship_to'): CompanyAddress {
  return { ...emptyCompanyAddress(), ...(profile?.[key] || {}) }
}

export function CompanyProfilePage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('admin:manage')
  const queryClient = useQueryClient()
  const profileQuery = useCompanyProfile()
  const profile = profileQuery.data

  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [billTo, setBillTo] = useState<CompanyAddress>(emptyCompanyAddress())
  const [shipTo, setShipTo] = useState<CompanyAddress>(emptyCompanyAddress())
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    setContactName(profile.contact_name || '')
    setContactEmail(profile.contact_email || '')
    setContactPhone(profile.contact_phone || '')
    setBillTo(addressFrom(profile, 'bill_to'))
    setShipTo(addressFrom(profile, 'ship_to'))
  }, [profile])

  useEffect(() => {
    if (!profile?.has_logo) {
      setLogoPreview(null)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    companyProfileService
      .getLogoBlob()
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setLogoPreview(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setLogoPreview(null)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [profile?.has_logo, profile?.updated_at])

  const saveMutation = useMutation({
    mutationFn: () =>
      companyProfileService.update({
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
        bill_to: billTo,
        ship_to: shipTo,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(companyProfileKey(getStoredCompanyId()), next)
      queryClient.setQueryData(companyNameKey(getStoredCompanyId()), {
        company_name: next.company_name,
        country: next.country,
        base_currency: next.base_currency,
      })
      setSuccess('Company profile saved. New Sales, Purchase, and Subcontract order PDFs will use this letterhead.')
      setError(null)
    },
    onError: (err) => {
      setSuccess(null)
      setError(err instanceof Error ? err.message : 'Failed to save company profile')
    },
  })

  const logoMutation = useMutation({
    mutationFn: (file: File) => companyProfileService.uploadLogo(file),
    onSuccess: (next) => {
      queryClient.setQueryData(companyProfileKey(getStoredCompanyId()), next)
      setSuccess('Logo uploaded. It will appear on Sales, Purchase, and Subcontract order PDFs.')
      setError(null)
    },
    onError: (err) => {
      setSuccess(null)
      setError(err instanceof Error ? err.message : 'Failed to upload logo')
    },
  })

  const removeLogoMutation = useMutation({
    mutationFn: () => companyProfileService.removeLogo(),
    onSuccess: (next) => {
      queryClient.setQueryData(companyProfileKey(getStoredCompanyId()), next)
      setLogoPreview(null)
      setSuccess('Company logo removed.')
      setError(null)
    },
    onError: (err) => {
      setSuccess(null)
      setError(err instanceof Error ? err.message : 'Failed to remove logo')
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!canManage || saveMutation.isPending) return
    saveMutation.mutate()
  }

  const onLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    logoMutation.mutate(file)
  }

  const setAddress =
    (which: 'bill' | 'ship') => (key: keyof CompanyAddress, value: string) => {
      const setter = which === 'bill' ? setBillTo : setShipTo
      setter((prev) => ({ ...prev, [key]: value }))
    }

  return (
    <div style={pageStyle}>
      <PageHeader
        title="Company Profile"
        subtitle="Letterhead for the active company. The name, country, and base currency follow that company. Contact, logo, and addresses are maintained here."
      >
        {canManage ? (
          <button type="submit" form="company-profile-form" style={primaryButtonStyle} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={15} />}
            {saveMutation.isPending ? 'Saving…' : 'Save Profile'}
          </button>
        ) : null}
      </PageHeader>

      {error ? (
        <div style={errorBox} role="alert">
          {error}
        </div>
      ) : null}
      {success ? (
        <div style={successBox} role="status">
          {success}
        </div>
      ) : null}
      {profileQuery.isError ? (
        <div style={errorBox} role="alert">
          {profileQuery.error instanceof Error ? profileQuery.error.message : 'Failed to load company profile'}
        </div>
      ) : null}

      <form id="company-profile-form" onSubmit={onSubmit}>
        <section style={cardStyle}>
          <h2 style={sectionTitle}>Logo</h2>
          <p style={hintStyle}>PNG or JPEG, 2 MB or smaller. The image is stored in the system and attached to each order PDF header.</p>
          <div style={logoRow}>
            <div style={logoFrame}>
              {logoPreview ? (
                <img src={logoPreview} alt="Company logo" style={logoImg} />
              ) : (
                <span style={{ color: '#9e9e9e', fontSize: 13 }}>No logo</span>
              )}
            </div>
            {canManage ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label style={headerButtonStyle}>
                  <ImagePlus size={15} />
                  {logoMutation.isPending ? 'Uploading…' : 'Upload logo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    hidden
                    disabled={logoMutation.isPending}
                    onChange={onLogoChange}
                  />
                </label>
                {profile?.has_logo ? (
                  <button
                    type="button"
                    style={dangerButtonStyle}
                    disabled={removeLogoMutation.isPending}
                    onClick={() => removeLogoMutation.mutate()}
                  >
                    <Trash2 size={15} />
                    Remove
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {profile?.logo_original_filename ? (
            <p style={{ ...hintStyle, marginBottom: 0 }}>Current file: {profile.logo_original_filename}</p>
          ) : null}
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitle}>Company contact</h2>
          <p style={hintStyle}>Printed in the PDF header next to the logo.</p>
          <div style={twoCol}>
            <label style={fieldLabel}>
              Company name
              <input style={inputStyle} value={profile?.company_name || ''} readOnly />
            </label>
            <label style={fieldLabel}>
              Country
              <input style={inputStyle} value={profile?.country || ''} readOnly />
            </label>
            <label style={fieldLabel}>
              Base currency
              <input style={inputStyle} value={profile?.base_currency || ''} readOnly />
            </label>
          </div>
          <p style={hintStyle}>Change the name, country, or base currency on Companies. This letterhead uses the company selected in the header.</p>
          <div style={twoCol}>
            <label style={fieldLabel}>
              Contact
              <input
                style={inputStyle}
                value={contactName}
                disabled={!canManage}
                onChange={(e) => setContactName(e.target.value)}
              />
            </label>
            <label style={fieldLabel}>
              Email
              <input
                type="email"
                style={inputStyle}
                value={contactEmail}
                disabled={!canManage}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </label>
            <label style={fieldLabel}>
              Phone
              <input
                style={inputStyle}
                value={contactPhone}
                disabled={!canManage}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </label>
          </div>
        </section>

        <div style={addressGrid}>
          <AddressCard title="Bill To" address={billTo} disabled={!canManage} onChange={setAddress('bill')} />
          <AddressCard title="Ship To" address={shipTo} disabled={!canManage} onChange={setAddress('ship')} />
        </div>
      </form>

      {!canManage ? <p style={hintStyle}>View only. Updating the letterhead requires admin:manage.</p> : null}
    </div>
  )
}

function AddressCard({
  title,
  address,
  disabled,
  onChange,
}: {
  title: string
  address: CompanyAddress
  disabled: boolean
  onChange: (key: keyof CompanyAddress, value: string) => void
}) {
  return (
    <section style={cardStyle}>
      <h2 style={sectionTitle}>{title}</h2>
      <p style={hintStyle}>Printed on Purchase Order and Subcontract Order PDFs. Sales Order PDFs use the customer bill-to / ship-to locations.</p>
      {ADDRESS_FIELDS.map((field) => (
        <label key={field.key} style={fieldLabel}>
          {field.label}
          <input
            style={inputStyle}
            value={address[field.key] || ''}
            disabled={disabled}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        </label>
      ))}
    </section>
  )
}

const pageStyle: CSSProperties = { padding: 24 }
const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  marginBottom: 16,
}
const sectionTitle: CSSProperties = { margin: '0 0 4px', fontSize: 16, fontWeight: 700 }
const hintStyle: CSSProperties = { margin: '0 0 16px', fontSize: 13, color: '#616161', lineHeight: 1.5 }
const fieldLabel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  fontWeight: 700,
  color: '#424242',
  marginBottom: 12,
}
const inputStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #cfd8dc',
  borderRadius: 6,
  fontSize: 14,
  fontFamily: 'inherit',
}
const twoCol: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
}
const addressGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 16,
}
const logoRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }
const logoFrame: CSSProperties = {
  width: 160,
  height: 72,
  border: '1px dashed #cfd8dc',
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  background: '#fafafa',
}
const logoImg: CSSProperties = { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
const errorBox: CSSProperties = {
  marginBottom: 12,
  padding: '10px 12px',
  background: '#ffebee',
  color: '#c62828',
  borderRadius: 6,
}
const successBox: CSSProperties = {
  marginBottom: 12,
  padding: '10px 12px',
  background: '#e8f5e9',
  color: '#2e7d32',
  borderRadius: 6,
}

export default CompanyProfilePage
