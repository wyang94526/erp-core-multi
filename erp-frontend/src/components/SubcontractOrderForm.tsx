/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * Create a Subcontract Order from one Sales Order (many finished-good lines)
 * or as a standalone single-assembly document.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { itemService, subcontractOrderService, vendorService } from '../api/services'
import type { Item, SalesOrderSubcontractLine, SubcontractCharge, Supplier } from '../types'
import { PageHeader } from './PageHeader'
import SalesOrderLookup from './SalesOrderLookup'
import ScoCostSheet from './ScoCostSheet'
import { defaultCostSheet } from '../utils/scoCostSheet'

type DraftLine = {
  key: string
  so_item_id?: number
  line_number?: number
  item_id: string
  item_description?: string | null
  quantity_ordered: number
  quantity_remaining?: number
  bom_header_id?: number | null
  has_active_bom?: boolean
  charges: SubcontractCharge[]
}

export function SubcontractOrderForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()

  const [formData, setFormData] = useState({
    sco_number: '',
    supplier_id: '',
    sales_order_id: searchParams.get('sales_order_id') || '',
    standalone: false,
    item_id: '',
    quantity_ordered: 1,
    order_date: new Date().toISOString().split('T')[0],
    expected_return_date: '',
    notes: '',
  })
  const [selectedKeys, setSelectedKeys] = useState<string[]>(
    searchParams.getAll('so_item_id').map((id) => `so-${id}`),
  )
  const [draftLines, setDraftLines] = useState<Record<string, DraftLine>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const clearError = (name: string) => {
    setErrors((prev) => {
      if (!prev[name]) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  const { data: suppliers = [] } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => vendorService.listVendors(0, 1000),
  })
  const subcontractors = useMemo(
    () =>
      suppliers.filter((supplier: Supplier) => {
        const type = (supplier.vendor_type || 'material').toLowerCase()
        return type === 'subcontractor' || type === 'both'
      }),
    [suppliers],
  )

  const { data: catalogItems = [] } = useQuery({
    queryKey: ['items'],
    queryFn: () => itemService.listItems(0, 1000),
    enabled: formData.standalone,
  })

  const {
    data: soAvailability,
    isLoading: soLinesLoading,
    isError: soLinesError,
    error: soLinesErr,
  } = useQuery({
    queryKey: ['scoSalesOrderLines', formData.sales_order_id],
    queryFn: () => subcontractOrderService.listSalesOrderLines(formData.sales_order_id),
    enabled: !!formData.sales_order_id && !formData.standalone,
  })
  const soLines = soAvailability?.lines ?? []
  const soCreateBlocked = Boolean(
    formData.sales_order_id && !formData.standalone && soAvailability && !soAvailability.can_create,
  )
  const soBlockMessage = soAvailability?.message || ''

  useEffect(() => {
    if (formData.standalone || !soLines.length) return
    setDraftLines((prev) => {
      const next = { ...prev }
      soLines.forEach((line) => {
        const key = `so-${line.so_item_id}`
        if (!next[key]) {
          next[key] = toDraft(line)
        }
      })
      return next
    })
  }, [soLines, formData.standalone])

  const activeDrafts = useMemo(() => {
    if (formData.standalone) {
      if (!formData.item_id) return []
      return [
        {
          key: 'standalone',
          item_id: formData.item_id,
          quantity_ordered: Number(formData.quantity_ordered || 1),
          charges: draftLines.standalone?.charges || defaultCostSheet(),
        } as DraftLine,
      ]
    }
    return selectedKeys.map((key) => draftLines[key]).filter(Boolean)
  }, [formData, selectedKeys, draftLines])

  const previewQuery = useQuery({
    queryKey: [
      'scoPreview',
      formData.sales_order_id,
      activeDrafts.map((line) => [
        line.item_id,
        line.quantity_ordered,
        line.bom_header_id,
        line.charges,
      ]),
    ],
    queryFn: () =>
      subcontractOrderService.previewComponents({
        sales_order_id: formData.standalone ? undefined : formData.sales_order_id || undefined,
        lines: activeDrafts.map((line) => ({
          so_item_id: line.so_item_id,
          item_id: line.item_id,
          quantity_ordered: line.quantity_ordered,
          bom_header_id: line.bom_header_id || undefined,
          charges: line.charges,
        })),
      }),
    enabled: activeDrafts.length > 0 && activeDrafts.every((line) => line.item_id && line.quantity_ordered > 0),
  })

  const createMutation = useMutation({
    mutationFn: () => {
      const lines = activeDrafts.map((line) => {
        const preview = previewQuery.data?.lines.find(
          (row) => row.item_id === line.item_id && row.so_item_id === line.so_item_id,
        )
        return {
          so_item_id: line.so_item_id,
          item_id: line.item_id,
          quantity_ordered: Number(line.quantity_ordered),
          bom_header_id: line.bom_header_id || preview?.bom_header_id_resolved || undefined,
          charges: (line.charges || defaultCostSheet()).map((charge, index) => ({
            line_no: charge.line_no || index + 1,
            name: charge.name,
            detail_explanation: charge.detail_explanation || undefined,
            labor_minutes: charge.is_margin ? null : charge.labor_minutes ?? null,
            sf_rate: charge.is_margin ? null : charge.sf_rate ?? null,
            cost_per_unit: charge.cost_per_unit ?? 0,
            margin_percent: charge.is_margin ? charge.margin_percent ?? 0 : null,
            is_margin: !!charge.is_margin,
          })),
        }
      })
      return subcontractOrderService.createSubcontractOrder({
        supplier_id: formData.supplier_id,
        sales_order_id: formData.standalone ? undefined : formData.sales_order_id || undefined,
        item_id: formData.standalone ? formData.item_id : undefined,
        quantity_ordered: formData.standalone ? Number(formData.quantity_ordered) : undefined,
        order_date: formData.order_date || undefined,
        expected_return_date: formData.expected_return_date || undefined,
        notes: formData.notes || undefined,
        lines,
      })
    },
    onSuccess: (sco) => {
      queryClient.invalidateQueries({ queryKey: ['subcontractOrders'] })
      navigate(`/subcontract-orders/${sco.sco_number}`)
    },
    onError: (error: any) => {
      setErrors({ submit: error.message || 'Failed to create subcontract order' })
    },
  })

  const toggleLine = (line: SalesOrderSubcontractLine) => {
    const key = `so-${line.so_item_id}`
    setSelectedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((item) => item !== key)
      updateDraft(key, toDraft(line))
      clearError('lines')
      return [...prev, key]
    })
  }

  const updateDraft = (key: string, patch: Partial<DraftLine>) => {
    setDraftLines((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { key, item_id: '', quantity_ordered: 1, charges: defaultCostSheet() }), ...patch, key },
    }))
  }

  const validateForm = (): boolean => {
    const next: Record<string, string> = {}
    if (!formData.supplier_id.trim()) next.supplier_id = 'Supplier is required'
    if (!formData.order_date) next.order_date = 'Order Date is required'
    if (formData.standalone) {
      if (!formData.item_id) next.item_id = 'Item is required'
      if (!formData.quantity_ordered || formData.quantity_ordered <= 0) next.quantity_ordered = 'Quantity must be greater than 0'
    } else {
      if (!formData.sales_order_id) next.sales_order_id = 'Sales Order is required'
      else if (soCreateBlocked) next.sales_order_id = soBlockMessage
      else if (!activeDrafts.length) next.lines = 'Select at least one sales order line'
      activeDrafts.forEach((line) => {
        if (line.quantity_remaining != null && line.quantity_ordered > line.quantity_remaining) {
          next.lines = `${line.item_id} qty exceeds remaining ${line.quantity_remaining}`
        }
      })
    }
    if (previewQuery.data && !previewQuery.data.can_create) {
      const blocking = previewQuery.data.warnings
        .filter((warning) => warning.code !== 'INSUFFICIENT_STOCK')
        .map((warning) => warning.message)
        .filter(Boolean)
        .join(' ')
      if (blocking) next.preview = blocking
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleCreate = () => {
    if (!validateForm()) return
    createMutation.mutate()
  }

  return (
    <div style={containerStyle}>
      <PageHeader
        title="Create New Subcontract Order"
        subtitle="Link a customer sales order, select finished-good lines, review exploded material kits, and enter vendor labor / shipping / admin charges per line."
      />

      {soCreateBlocked ? (
        <div role="alert" style={{ ...warningAlertStyle, fontWeight: 600 }}>
          {soBlockMessage}
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          handleCreate()
        }}
      >
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>Order Data</h3>
          <div style={gridStyle}>
            <Field label="SCO Number">
              <div style={{ ...inputStyle, backgroundColor: 'var(--bg-muted, #f5f5f5)' }}>
                Assigned on save (UP23-YYMMXXXX)
              </div>
            </Field>
            <Field label="Supplier (Subcontractor) *" error={errors.supplier_id}>
              <select
                value={formData.supplier_id}
                onChange={(event) => {
                  setFormData((prev) => ({ ...prev, supplier_id: event.target.value }))
                  if (event.target.value.trim()) clearError('supplier_id')
                }}
                style={inputStyle}
              >
                <option value="">Select a supplier</option>
                {subcontractors.map((supplier: Supplier) => (
                  <option key={supplier.supplier_id} value={supplier.supplier_id}>
                    {supplier.company_name} ({supplier.supplier_id})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Order Date *" error={errors.order_date}>
              <input
                type="date"
                value={formData.order_date}
                onChange={(event) => {
                  setFormData((prev) => ({ ...prev, order_date: event.target.value }))
                  if (event.target.value) clearError('order_date')
                }}
                style={inputStyle}
              />
            </Field>
            <Field label="Expected Return Date">
              <input
                type="date"
                value={formData.expected_return_date}
                onChange={(event) => setFormData((prev) => ({ ...prev, expected_return_date: event.target.value }))}
                style={inputStyle}
              />
            </Field>
            <div style={{ ...fieldGroupStyle, gridColumn: '1 / -1' }}>
              <label style={labelStyle}>
                <input
                  type="checkbox"
                  checked={formData.standalone}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      standalone: event.target.checked,
                      sales_order_id: event.target.checked ? '' : prev.sales_order_id,
                    }))
                  }
                />{' '}
                Create without Sales Order
              </label>
            </div>
            {!formData.standalone && (
              <div style={{ ...fieldGroupStyle, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Customer Sales Order *</label>
                <SalesOrderLookup
                  value={formData.sales_order_id}
                  error={!!errors.sales_order_id}
                  onSelect={(order) => {
                    setFormData((prev) => ({ ...prev, sales_order_id: order?.sales_order_id || '' }))
                    setSelectedKeys([])
                    if (order?.sales_order_id) clearError('sales_order_id')
                  }}
                />
                <span style={{ fontSize: 12, color: 'var(--muted, #666)', marginTop: 6 }}>
                  Only approved sales orders are listed.
                </span>
                {errors.sales_order_id && <span style={errorTextStyle}>{errors.sales_order_id}</span>}
              </div>
            )}
            {formData.standalone && (
              <>
                <Field label="Finished Item *" error={errors.item_id}>
                  <select
                    value={formData.item_id}
                    onChange={(event) => setFormData((prev) => ({ ...prev, item_id: event.target.value }))}
                    style={inputStyle}
                  >
                    <option value="">Select a product</option>
                    {catalogItems.map((item: Item) => (
                      <option key={item.item_id} value={item.item_id}>
                        {item.description || item.item_id} ({item.item_id})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Quantity Ordered *" error={errors.quantity_ordered}>
                  <input
                    type="number"
                    min={1}
                    value={formData.quantity_ordered}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, quantity_ordered: Number(event.target.value) }))
                    }
                    style={inputStyle}
                  />
                </Field>
              </>
            )}
            <div style={{ ...fieldGroupStyle, gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notes</label>
              <textarea
                value={formData.notes}
                onChange={(event) => setFormData((prev) => ({ ...prev, notes: event.target.value }))}
                style={{ ...inputStyle, minHeight: 80 }}
              />
            </div>
          </div>
        </div>

        {!formData.standalone && formData.sales_order_id && (
          <div style={cardStyle}>
            <h3 style={sectionHeadingStyle}>Sales Order Lines</h3>
            {soCreateBlocked ? (
              <div role="alert" style={warningAlertStyle}>
                {soBlockMessage}
              </div>
            ) : soLinesLoading ? (
              <p style={{ color: 'var(--text)', margin: 0 }}>Loading sales order lines…</p>
            ) : soLinesError ? (
              <div role="alert" style={errorAlertStyle}>
                {soLinesErr instanceof Error
                  ? soLinesErr.message
                  : 'Failed to load sales order lines'}
              </div>
            ) : soLines.length === 0 ? (
              <p style={{ color: 'var(--text)', margin: 0 }}>
                No line items were found on this sales order.
              </p>
            ) : (
              <>
                {errors.lines && <span style={errorTextStyle}>{errors.lines}</span>}
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle} />
                      <th style={thStyle}>Line</th>
                      <th style={thStyle}>Item</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Ordered</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Already on SCOs</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Remaining</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Qty this SCO</th>
                      <th style={thStyle}>BOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {soLines.map((line) => {
                      const key = `so-${line.so_item_id}`
                      const checked = selectedKeys.includes(key)
                      const draft = draftLines[key]
                      const disabled = line.quantity_remaining <= 0 || !line.has_active_bom
                      return (
                        <tr key={line.so_item_id}>
                          <td style={tdStyle}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleLine(line)}
                            />
                          </td>
                          <td style={tdStyle}>{line.line_number}</td>
                          <td style={tdStyle}>
                            {line.item_id}
                            <div style={{ fontSize: 12, color: 'var(--text)' }}>{line.item_description}</div>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{line.quantity_ordered}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{line.quantity_subcontracted}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{line.quantity_remaining}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            <input
                              type="number"
                              min={1}
                              max={line.quantity_remaining}
                              disabled={!checked}
                              value={draft?.quantity_ordered ?? line.quantity_remaining}
                              onChange={(event) =>
                                updateDraft(key, { ...toDraft(line), quantity_ordered: Number(event.target.value) })
                              }
                              style={{ ...inputStyle, width: 90, textAlign: 'right' }}
                            />
                          </td>
                          <td style={tdStyle}>
                            {line.has_active_bom ? `v${line.active_bom_version_no}` : 'No Material BOM'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {activeDrafts.map((line) => {
          const preview = previewQuery.data?.lines.find(
            (row) => row.item_id === line.item_id && row.so_item_id === line.so_item_id,
          )
          return (
            <div key={line.key} style={cardStyle}>
              <h3 style={sectionHeadingStyle}>
                {line.item_id}
                {line.line_number ? ` · SO line ${line.line_number}` : ''} · qty {line.quantity_ordered}
              </h3>
              <h4 style={{ margin: '0 0 8px', color: 'var(--text-h)' }}>Vendor cost sheet</h4>
              <ScoCostSheet
                quantity={line.quantity_ordered}
                charges={line.charges}
                onChange={(charges) => updateDraft(line.key, { charges })}
              />
              <h4 style={{ margin: '20px 0 8px', color: 'var(--text-h)' }}>Material kit</h4>
              {preview?.components?.length ? (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>SKU</th>
                      <th style={thStyle}>Description</th>
                      <th style={thStyle}>UOM</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Required</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>On hand</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Available to Promise</th>
                      <th style={thStyle}>Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.components.map((component) => {
                      const short = Number(component.stock_shortfall || 0) > 0
                      return (
                      <tr key={component.component_item_id}>
                        <td style={tdStyle}>{component.component_item_id}</td>
                        <td style={tdStyle}>{component.description || '—'}</td>
                        <td style={tdStyle}>{component.uom || 'Each'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{Number(component.quantity_required).toFixed(4)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{component.on_hand_quantity}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {component.available_to_promise ?? '—'}
                        </td>
                        <td style={{ ...tdStyle, color: short ? '#e65100' : '#2e7d32', fontWeight: 600 }}>
                          {short ? `Short ${Number(component.stock_shortfall).toFixed(4)}` : 'OK'}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: 'var(--text)' }}>
                  {previewQuery.isFetching
                    ? 'Calculating kit…'
                    : 'No material kit. A Material BOM is required so components can be issued after approval, then finished goods can be received.'}
                </p>
              )}
            </div>
          )
        })}

        {previewQuery.data?.consolidated_components?.length ? (
          <div style={cardStyle}>
            <h3 style={sectionHeadingStyle}>Consolidated materials to send</h3>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total required</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Available to Promise</th>
                </tr>
              </thead>
              <tbody>
                {previewQuery.data.consolidated_components.map((component) => (
                  <tr key={component.component_item_id}>
                    <td style={tdStyle}>{component.component_item_id}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{Number(component.quantity_required).toFixed(4)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{component.available_to_promise ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {(() => {
          const stockWarnings = (previewQuery.data?.warnings || []).filter(
            (warning) => warning.code === 'INSUFFICIENT_STOCK',
          )
          const blockingWarnings = (previewQuery.data?.warnings || []).filter(
            (warning) => warning.code !== 'INSUFFICIENT_STOCK',
          )
          return (
            <>
              {stockWarnings.length > 0 && (
                <div style={warningAlertStyle}>
                  {`${stockWarnings.length} component${stockWarnings.length === 1 ? '' : 's'} are short of available stock. You can still create the subcontract order; issue the kit after approval.`}
                </div>
              )}
              {blockingWarnings.length > 0 && (
                <div style={errorAlertStyle}>
                  {blockingWarnings.map((warning) => (
                    <div key={`${warning.code}-${warning.message}`}>{warning.message}</div>
                  ))}
                </div>
              )}
            </>
          )
        })()}
        {(errors.submit || errors.preview || errors.sco_number || errors.supplier_id || errors.sales_order_id || errors.lines || errors.item_id) && (
          <div style={errorAlertStyle}>
            {errors.submit ||
              errors.preview ||
              [errors.sco_number, errors.supplier_id, errors.sales_order_id, errors.lines, errors.item_id]
                .filter(Boolean)
                .join(' · ')}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <span
            title={soCreateBlocked ? soBlockMessage : 'Create Subcontract Order'}
            style={{
              display: 'inline-block',
              cursor: createMutation.isPending || soCreateBlocked ? 'not-allowed' : 'pointer',
            }}
          >
            <button
              type="button"
              disabled={createMutation.isPending || soCreateBlocked}
              onClick={handleCreate}
              aria-disabled={createMutation.isPending || soCreateBlocked}
              aria-label={
                soCreateBlocked
                  ? `Create Subcontract Order. ${soBlockMessage}`
                  : 'Create Subcontract Order'
              }
              style={{
                ...primaryButtonStyle,
                opacity: createMutation.isPending || soCreateBlocked ? 0.7 : 1,
                backgroundColor: soCreateBlocked ? '#9e9e9e' : '#1976d2',
                cursor: soCreateBlocked || createMutation.isPending ? 'not-allowed' : 'pointer',
                pointerEvents: soCreateBlocked || createMutation.isPending ? 'none' : 'auto',
              }}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Subcontract Order'}
            </button>
          </span>
          <button type="button" onClick={() => navigate('/subcontract-orders')} style={secondaryButtonStyle}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

function toDraft(line: SalesOrderSubcontractLine): DraftLine {
  return {
    key: `so-${line.so_item_id}`,
    so_item_id: line.so_item_id,
    line_number: line.line_number,
    item_id: line.item_id,
    item_description: line.item_description,
    quantity_ordered: line.quantity_remaining || line.quantity_ordered,
    quantity_remaining: line.quantity_remaining,
    bom_header_id: line.active_bom_header_id,
    has_active_bom: line.has_active_bom,
    charges: defaultCostSheet(),
  }
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div style={fieldGroupStyle}>
      <label style={labelStyle}>{label}</label>
      {children}
      {error && <span style={errorTextStyle}>{error}</span>}
    </div>
  )
}

const containerStyle: React.CSSProperties = { padding: 24, maxWidth: 1100, margin: '0 auto', textAlign: 'left' }
const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
  boxShadow: 'var(--shadow)',
}
const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 18,
  fontWeight: 'bold',
  color: 'var(--text-h)',

}
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }
const fieldGroupStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column' }
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 'bold', color: 'var(--text-h)', marginBottom: 6 }
const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  fontSize: 14,
  color: 'var(--text-h)',
  backgroundColor: 'var(--bg)',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
const errorTextStyle: React.CSSProperties = { color: '#f44336', fontSize: 12, marginTop: 4 }
const errorAlertStyle: React.CSSProperties = {
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: 6,
  padding: '12px 20px',
  marginBottom: 20,
  fontSize: 14,
}
const warningAlertStyle: React.CSSProperties = {
  backgroundColor: '#fff8e1',
  color: '#e65100',
  border: '1px solid #ffe082',
  borderRadius: 6,
  padding: '12px 20px',
  marginBottom: 20,
  fontSize: 14,
}
const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 'bold',
}
const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  backgroundColor: 'transparent',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 'bold',
}
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const thStyle: React.CSSProperties = { padding: '8px 6px', textAlign: 'left', }
const tdStyle: React.CSSProperties = { padding: '8px 6px', borderBottom: '1px solid var(--divider)', verticalAlign: 'middle' }

export default SubcontractOrderForm
