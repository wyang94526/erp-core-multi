/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Vendor catalog mappings for a purchase item / raw material.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { itemService, vendorService } from '../api/services'

interface VendorItemMappingSectionProps {
  itemId: string
}

export function VendorItemMappingSection({ itemId }: VendorItemMappingSectionProps) {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    supplier_id: '',
    vendor_sku: '',
    unit_cost: '',
    minimum_order_qty: '1',
    lead_time_days: '0',
    is_primary_vendor: true,
  })

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ['itemVendors', itemId],
    queryFn: () => itemService.listItemVendors(itemId),
  })

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors', 0, 500],
    queryFn: () => vendorService.listVendors(0, 500),
  })

  const addMutation = useMutation({
    mutationFn: () =>
      itemService.addItemVendor(itemId, {
        supplier_id: form.supplier_id,
        item_id: itemId,
        vendor_sku: form.vendor_sku || null,
        unit_cost: form.unit_cost !== '' ? Number(form.unit_cost) : null,
        minimum_order_qty: Number(form.minimum_order_qty) || 1,
        lead_time_days: Number(form.lead_time_days) || 0,
        is_primary_vendor: form.is_primary_vendor,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itemVendors', itemId] })
      setShowForm(false)
      setForm({
        supplier_id: '',
        vendor_sku: '',
        unit_cost: '',
        minimum_order_qty: '1',
        lead_time_days: '0',
        is_primary_vendor: true,
      })
      setFormError('')
    },
    onError: (err: Error) => {
      setFormError(err.message || 'Failed to add vendor mapping')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (mappingId: number) => itemService.deleteItemVendor(itemId, mappingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itemVendors', itemId] })
    },
  })

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!form.supplier_id) {
      setFormError('Select a vendor')
      return
    }
    addMutation.mutate()
  }

  const mappedSupplierIds = new Set(mappings.map((m) => m.supplier_id))
  const availableVendors = vendors.filter((v) => !mappedSupplierIds.has(v.supplier_id))

  return (
    <div style={cardStyle}>
      <div style={headerRowStyle}>
        <h3 style={sectionHeadingStyle}>Vendor Mapping</h3>
        <button type="button" onClick={() => setShowForm((v) => !v)} style={addButtonStyle}>
          {showForm ? 'Cancel' : '+ Add Vendor'}
        </button>
      </div>
      <p style={hintStyle}>
        Link suppliers that sell this item (vendor SKU, unit cost, MOQ, lead time). Used when
        sourcing purchase-order lines and exploding subcontract kits.
      </p>

      {showForm && (
        <div style={{ marginBottom: '16px' }}>
          {formError && <div style={errorStyle}>{formError}</div>}
          <div style={gridStyle}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Vendor *</label>
              <select
                value={form.supplier_id}
                onChange={(e) => setForm((p) => ({ ...p, supplier_id: e.target.value }))}
                style={inputStyle}
              >
                <option value="">Select vendor</option>
                {availableVendors.map((v) => (
                  <option key={v.supplier_id} value={v.supplier_id}>
                    {v.company_name} ({v.supplier_id})
                  </option>
                ))}
              </select>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Vendor SKU</label>
              <input
                value={form.vendor_sku}
                onChange={(e) => setForm((p) => ({ ...p, vendor_sku: e.target.value }))}
                style={inputStyle}
                placeholder="Vendor catalog #"
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Unit Cost</label>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={form.unit_cost}
                onChange={(e) => setForm((p) => ({ ...p, unit_cost: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Minimum Order Qty</label>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={form.minimum_order_qty}
                onChange={(e) => setForm((p) => ({ ...p, minimum_order_qty: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Lead Time (days)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.lead_time_days}
                onChange={(e) => setForm((p) => ({ ...p, lead_time_days: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div style={{ ...fieldStyle, justifyContent: 'flex-end' }}>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.is_primary_vendor}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, is_primary_vendor: e.target.checked }))
                  }
                />
                Primary vendor
              </label>
            </div>
          </div>
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={addMutation.isPending}
            onClick={handleSubmit}
          >
            {addMutation.isPending ? 'Saving...' : 'Save Mapping'}
          </button>
        </div>
      )}

      {isLoading ? (
        <p style={hintStyle}>Loading vendor mappings...</p>
      ) : mappings.length === 0 ? (
        <p style={hintStyle}>No vendor mappings yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Vendor</th>
                <th style={thStyle}>Vendor SKU</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Unit Cost</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>MOQ</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Lead Days</th>
                <th style={thStyle}>Primary</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.mapping_id}>
                  <td style={tdStyle}>{m.supplier_name || m.supplier_id}</td>
                  <td style={tdStyle}>{m.vendor_sku || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {m.unit_cost != null ? Number(m.unit_cost).toFixed(4) : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{Number(m.minimum_order_qty)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{m.lead_time_days}</td>
                  <td style={tdStyle}>{m.is_primary_vendor ? 'Yes' : '—'}</td>
                  <td style={tdStyle}>
                    <button
                      type="button"
                      style={dangerButtonStyle}
                      onClick={() => {
                        if (confirm('Remove this vendor mapping?')) {
                          deleteMutation.mutate(m.mapping_id)
                        }
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
      )}
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '20px',
}

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '8px',
}

const sectionHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--text)',
}

const hintStyle: React.CSSProperties = {
  color: 'var(--muted, #666)',
  fontSize: '13px',
  marginBottom: '12px',
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '12px',
  marginBottom: '12px',
}

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px' }
const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text)' }
const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  background: 'var(--bg)',
  color: 'var(--text)',
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px',
  borderBottom: '1px solid var(--border)',
  fontSize: '12px',
  color: 'var(--muted, #666)',
}
const tdStyle: React.CSSProperties = {
  padding: '8px',
  borderBottom: '1px solid var(--border)',
  fontSize: '13px',
  color: 'var(--text)',
}

const addButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  background: 'var(--bg)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: '13px',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderRadius: '4px',
  background: 'var(--accent, #1976d2)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '13px',
}

const dangerButtonStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid #c62828',
  borderRadius: '4px',
  background: 'transparent',
  color: '#c62828',
  cursor: 'pointer',
  fontSize: '12px',
}

const errorStyle: React.CSSProperties = {
  color: '#c62828',
  marginBottom: '8px',
  fontSize: '13px',
}
