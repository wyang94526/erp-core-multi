/**
 * ItemForm Component
 * Form for creating and editing items
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { itemService, itemBomService } from '../api/services'
import type { ProductBOMComponent } from '../types'
import { VendorItemMappingSection } from './VendorItemMappingSection'

const UOM_OPTIONS = ['Each', 'Box', 'Case', 'Pallet', 'Kg', 'Lb', 'Meter', 'Foot', 'Liter', 'Gallon']

const BOM_ITEM_TYPE_OPTIONS = ['Material', 'Labor', 'Outside Service'] as const

// Predefined Labor / Outside Service codes. These aren't real catalog Products,
// so they're validated against this fixed list on the backend rather than a
// foreign key to the products table. Each code has a fixed UOM.
const LABOR_SERVICE_CODES: Record<string, { label: string; uom: string }> = {
  'LABOR-ASSY': { label: 'Assembly Labor', uom: 'Hours' },
  'LABOR-INSP': { label: 'Inspection Labor', uom: 'Hours' },
  'LABOR-PACK': { label: 'Packaging Labor', uom: 'Hours' },
  'LABOR-SETUP': { label: 'Setup Labor', uom: 'Hours' },
  'SVC-ANODIZE': { label: 'Anodizing Service', uom: 'Lot' },
  'SVC-PLATING': { label: 'Plating Service', uom: 'Lot' },
  'SVC-PAINT': { label: 'Painting Service', uom: 'Lot' },
  'SVC-HEATTREAT': { label: 'Heat Treat Service', uom: 'Lot' },
}

// Local row shape used purely for rendering/editing in the UI.
// `bomId` is set once the row has been persisted to the backend (undefined = new/unsaved row).
interface BomComponentRow {
  id: string // temporary/local UUID for React keys
  bomId?: number // backend bom_id once persisted
  itemType: (typeof BOM_ITEM_TYPE_OPTIONS)[number]
  componentPartNumber: string // used when itemType === 'Material' (component_product_id)
  componentCode: string // used when itemType is 'Labor' or 'Outside Service' (component_code)
  description: string
  quantity: string
  uom: string
  scrapFactor: string
  yieldLossPercentage: string
  isSaving?: boolean
}


function makeLocalId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `bom-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function makeEmptyBomRow(): BomComponentRow {
  return {
    id: makeLocalId(),
    itemType: 'Material',
    componentPartNumber: '',
    componentCode: '',
    description: '',
    quantity: '1',
    uom: 'Each',
    scrapFactor: '0',
    yieldLossPercentage: '0',
  }
}


export function ItemForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditMode = !!id

  const [formData, setFormData] = useState({
    item_id: '',
    customer_part_number: '',
    description: '',
    uom: 'Each',
    unit_price: '',
    is_outside_processed: false,
    is_purchase_item: false,
    is_subcontract_assembly: false,
    is_raw_material: false,
  })

  // Bill of Materials component rows for this product
  const [bomComponents, setBomComponents] = useState<BomComponentRow[]>([])
  const [bomError, setBomError] = useState<string>('')

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fetch product data if in edit mode
  const {
    data: item,
    isLoading: isLoadingProduct,
    isError: isErrorLoadingProduct,
  } = useQuery({
    queryKey: ['items', id],
    queryFn: () => (id ? itemService.getItem(id) : Promise.resolve(null)),
    enabled: isEditMode,
  })

  // Fetch the full product catalog to populate the Component Part Number dropdown.
  // Outside-processed (3rd-party assembly / finished goods) products are excluded
  // since BOM components should be raw materials / sub-components, not finished goods.
  const { data: allItems = [] } = useQuery({
    queryKey: ['items', 'all-for-bom-dropdown'],
    queryFn: () => itemService.listItems(0, 500),
  })

  const componentOptions = useMemo(
    () =>
      allItems.filter(
        (p) => p.item_id !== formData.item_id && !p.is_outside_processed
      ),
    [allItems, formData.item_id]
  )

  // Fetch existing BOM components for this product when editing
  const { data: existingBomComponents } = useQuery({
    queryKey: ['itemBom', id],
    queryFn: () => (id ? itemBomService.listBomComponents(id) : Promise.resolve([])),
    enabled: isEditMode,
  })

  // Populate form when product data is loaded
  useEffect(() => {
    if (item) {
      setFormData({
        item_id: item.item_id,
        customer_part_number: item.customer_part_number,
        description: item.description || '',
        uom: item.uom || 'Each',
        unit_price:
          item.unit_price !== null && item.unit_price !== undefined
            ? String(item.unit_price)
            : '',
        is_outside_processed: Boolean(
          item.is_outside_processed || item.is_subcontract_assembly
        ),
        is_purchase_item: Boolean(item.is_purchase_item),
        is_subcontract_assembly: Boolean(
          item.is_subcontract_assembly || item.is_outside_processed
        ),
        is_raw_material: Boolean(item.is_raw_material),
      })
    }
  }, [item])

  // Populate BOM rows from backend once loaded, mapping backend fields -> UI row shape.
  // We look up each component's description/uom from the product catalog.
  useEffect(() => {
    if (existingBomComponents && allItems.length > 0) {
      const rows: BomComponentRow[] = existingBomComponents.map((bom: ProductBOMComponent) => {
        const itemType = (bom.item_type as BomComponentRow['itemType']) || 'Material'
        if (itemType === 'Material') {
          const componentItem = allItems.find((p) => p.item_id === bom.component_product_id)
          return {
            id: makeLocalId(),
            bomId: bom.bom_id,
            itemType,
            componentPartNumber: bom.component_product_id || '',
            componentCode: '',
            description: componentItem?.description || '',
            quantity: String(bom.quantity_per),
            uom: componentItem?.uom || 'Each',
            scrapFactor: String(bom.scrap_factor ?? 0),
            yieldLossPercentage: String(bom.yield_loss_percentage ?? 0),
          }
        }
        const codeInfo = bom.component_code ? LABOR_SERVICE_CODES[bom.component_code] : undefined
        return {
          id: makeLocalId(),
          bomId: bom.bom_id,
          itemType,
          componentPartNumber: '',
          componentCode: bom.component_code || '',
          description: codeInfo?.label || '',
          quantity: String(bom.quantity_per),
          uom: codeInfo?.uom || 'Each',
          scrapFactor: String(bom.scrap_factor ?? 0),
          yieldLossPercentage: String(bom.yield_loss_percentage ?? 0),
        }
      })
      setBomComponents(rows)
    }
  }, [existingBomComponents, allItems])


  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      itemService.createItem({
        item_id: data.item_id,
        customer_part_number: data.customer_part_number,
        description: data.description || undefined,
        uom: data.uom || undefined,
        unit_price: data.unit_price !== '' ? Number(data.unit_price) : undefined,
        is_outside_processed: data.is_outside_processed || data.is_subcontract_assembly,
        is_purchase_item: data.is_purchase_item,
        is_subcontract_assembly: data.is_subcontract_assembly || data.is_outside_processed,
        is_raw_material: data.is_raw_material,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
      navigate('/items')
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to create item',
      })
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      itemService.updateItem(id!, {
        customer_part_number: data.customer_part_number,
        description: data.description || undefined,
        uom: data.uom || undefined,
        unit_price: data.unit_price !== '' ? Number(data.unit_price) : undefined,
        is_outside_processed: data.is_outside_processed || data.is_subcontract_assembly,
        is_purchase_item: data.is_purchase_item,
        is_subcontract_assembly: data.is_subcontract_assembly || data.is_outside_processed,
        is_raw_material: data.is_raw_material,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
      navigate('/items')
    },
    onError: (error: any) => {
      setErrors({
        submit: error.message || 'Failed to update item',
      })
    },
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    setFormData((prev) => {
      const next = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value,
      }
      // Keep legacy outside-processed flag in sync with subcontract assembly
      if (name === 'is_subcontract_assembly' && type === 'checkbox') {
        next.is_outside_processed = checked
      }
      if (name === 'is_outside_processed' && type === 'checkbox') {
        next.is_subcontract_assembly = checked
      }
      return next
    })
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
  }

  // ==========================================
  // BOM HANDLERS
  // (Each row is persisted to the backend immediately via dedicated REST calls,
  // rather than waiting for the main "Update Product" submit.)
  // ==========================================

  const handleAddBomComponent = () => {
    setBomComponents((prev) => [...prev, makeEmptyBomRow()])
  }

  const handleRemoveBomComponent = async (rowId: string) => {
    const row = bomComponents.find((r) => r.id === rowId)
    setBomError('')

    // If the row was never saved to the backend, just remove it locally.
    if (!row?.bomId) {
      setBomComponents((prev) => prev.filter((r) => r.id !== rowId))
      return
    }

    if (!isEditMode || !id) {
      setBomComponents((prev) => prev.filter((r) => r.id !== rowId))
      return
    }

    try {
      await itemBomService.deleteBomComponent(id, row.bomId)
      setBomComponents((prev) => prev.filter((r) => r.id !== rowId))
      queryClient.invalidateQueries({ queryKey: ['itemBom', id] })
    } catch (err: any) {
      setBomError(err?.message || 'Failed to remove BOM component')
    }
  }

  const handleBomFieldChange = (
    rowId: string,
    field: keyof Omit<BomComponentRow, 'id' | 'bomId' | 'isSaving'>,
    value: string
  ) => {
    setBomComponents((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row

        // When the component part number changes, auto-fill description & uom
        // from the selected product's catalog record.
        if (field === 'componentPartNumber') {
          const selected = allItems.find((p) => p.item_id === value)
          return {
            ...row,
            componentPartNumber: value,
            description: selected?.description || '',
            uom: selected?.uom || row.uom,
          }
        }

        // When a Labor/Outside Service code is selected, auto-fill description & uom
        // from the predefined code list.
        if (field === 'componentCode') {
          const codeInfo = LABOR_SERVICE_CODES[value]
          return {
            ...row,
            componentCode: value,
            description: codeInfo?.label || '',
            uom: codeInfo?.uom || row.uom,
          }
        }

        // When itemType changes, reset the component reference fields since
        // Material uses componentPartNumber while Labor/Outside Service use componentCode.
        if (field === 'itemType') {
          return {
            ...row,
            itemType: value as BomComponentRow['itemType'],
            componentPartNumber: '',
            componentCode: '',
            description: '',
            uom: 'Each',
          }
        }

        return { ...row, [field]: value }
      })
    )
  }

  // Persist a single BOM row to the backend (create or update depending on whether
  // it already has a bomId). Triggered onBlur of quantity, and immediately
  // when a part number / code is first selected.
  const persistBomRow = async (rowId: string) => {
    if (!isEditMode || !id) return

    const row = bomComponents.find((r) => r.id === rowId)
    if (!row) return

    const isMaterial = row.itemType === 'Material'
    const hasReference = isMaterial ? !!row.componentPartNumber : !!row.componentCode
    if (!hasReference || !row.quantity) return

    setBomError('')
    setBomComponents((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, isSaving: true } : r))
    )

    try {
      const basePayload = isMaterial
        ? { component_product_id: row.componentPartNumber, component_code: null }
        : { component_code: row.componentCode, component_product_id: null }

      if (row.bomId) {
        const updated = await itemBomService.updateBomComponent(id, row.bomId, {
          ...basePayload,
          quantity_per: Number(row.quantity),
          item_type: row.itemType,
          scrap_factor: Number(row.scrapFactor) || 0,
          yield_loss_percentage: Number(row.yieldLossPercentage) || 0,
        })
        setBomComponents((prev) =>
          prev.map((r) =>
            r.id === rowId ? { ...r, bomId: updated.bom_id, isSaving: false } : r
          )
        )
      } else {
        const created = await itemBomService.addBomComponent(id, {
          ...basePayload,
          quantity_per: Number(row.quantity),
          item_type: row.itemType,
          scrap_factor: Number(row.scrapFactor) || 0,
          yield_loss_percentage: Number(row.yieldLossPercentage) || 0,
        })
        setBomComponents((prev) =>
          prev.map((r) =>
            r.id === rowId ? { ...r, bomId: created.bom_id, isSaving: false } : r
          )
        )
      }
      queryClient.invalidateQueries({ queryKey: ['itemBom', id] })
    } catch (err: any) {
      setBomError(err?.message || 'Failed to save BOM component')
      setBomComponents((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, isSaving: false } : r))
      )
    }
  }

  const handleComponentPartNumberSelect = (rowId: string, value: string) => {
    handleBomFieldChange(rowId, 'componentPartNumber', value)
    // Persist right away once a real part is selected (new row -> POST)
    if (value) {
      // Use a microtask delay so state update above has been applied first
      setTimeout(() => persistBomRow(rowId), 0)
    }
  }

  const handleComponentCodeSelect = (rowId: string, value: string) => {
    handleBomFieldChange(rowId, 'componentCode', value)
    if (value) {
      setTimeout(() => persistBomRow(rowId), 0)
    }
  }


  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.item_id.trim()) {
      newErrors.item_id = 'Item ID is required'
    }
    if (!formData.customer_part_number.trim()) {
      newErrors.customer_part_number = 'Customer Part Number is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    // Bundle main product fields + outside-processed flag + BOM components
    // into a single payload ready to be dispatched to the backend API.
    // (Note: BOM rows are already persisted individually via dedicated REST
    // calls as they're added/edited/removed above; this payload is kept for
    // logging/traceability and for the create-mode flow.)
    const payload = {
      ...formData,
      is_outside_processed: formData.is_outside_processed,
      bomComponents: bomComponents.map(({ id: _id, isSaving: _isSaving, ...rest }) => rest),
    }

    // eslint-disable-next-line no-console
    console.log('Submitting product payload:', payload)

    if (isEditMode) {
      updateMutation.mutate(formData)
    } else {
      createMutation.mutate(formData)
    }
  }

  if (isEditMode && isLoadingProduct) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading item...</p>
        </div>
      </div>
    )
  }

  if (isEditMode && isErrorLoadingProduct) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, color: '#c62828' }}>
          <p>Error loading product</p>
          <button onClick={() => navigate('/items')} style={secondaryButtonStyle}>
            Back to Items
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
          <h2 style={pageTitleStyle}>{isEditMode ? 'Edit Item' : 'Create New Item'}</h2>
          <p style={pageSubStyle}>Manage product catalog information</p>
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        <div style={cardStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '16px',
              borderBottom: '2px solid var(--border)',
              paddingBottom: '8px',
            }}
          >
            <h3 style={{ ...sectionHeadingStyle, margin: 0, border: 'none', padding: 0 }}>
              Item Information
            </h3>

            {/* Conditional link to related Subcontract Orders when this item
                is flagged as Outside Processed / 3rd Party Assembly */}
            {formData.is_outside_processed && (
              <Link
                to={`/subcontract-orders?itemId=${encodeURIComponent(formData.item_id)}`}
                style={subcontractLinkStyle}
              >
                🔗 View Related Subcontract Orders
              </Link>
            )}
          </div>

          <div style={gridStyle}>
            {/* Item ID Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="item_id" style={labelStyle}>
                Item ID *
              </label>
              <input
                type="text"
                id="item_id"
                name="item_id"
                value={formData.item_id}
                onChange={handleChange}
                disabled={isEditMode}
                style={{
                  ...inputStyle,
                  backgroundColor: isEditMode ? 'var(--social-bg)' : 'var(--bg)',
                  cursor: isEditMode ? 'not-allowed' : 'text',
                  border: errors.item_id ? '1px solid #f44336' : '1px solid var(--border)',
                }}
                placeholder="e.g. PROD-001"
              />
              {errors.item_id && <span style={errorTextStyle}>{errors.item_id}</span>}
            </div>

            {/* Customer Part Number Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="customer_part_number" style={labelStyle}>
                Customer Part Number *
              </label>
              <input
                type="text"
                id="customer_part_number"
                name="customer_part_number"
                value={formData.customer_part_number}
                onChange={handleChange}
                style={{
                  ...inputStyle,
                  border: errors.customer_part_number ? '1px solid #f44336' : '1px solid var(--border)',
                }}
                placeholder="Enter customer part number"
              />
              {errors.customer_part_number && (
                <span style={errorTextStyle}>{errors.customer_part_number}</span>
              )}
            </div>

            {/* UOM Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="uom" style={labelStyle}>
                Unit of Measure (UOM)
              </label>
              <select
                id="uom"
                name="uom"
                value={formData.uom}
                onChange={handleChange}
                style={inputStyle}
              >
                {UOM_OPTIONS.map((uom) => (
                  <option key={uom} value={uom}>
                    {uom}
                  </option>
                ))}
              </select>
            </div>

            {/* Unit Price Field */}
            <div style={fieldGroupStyle}>
              <label htmlFor="unit_price" style={labelStyle}>
                Unit Price
              </label>
              <input
                type="number"
                id="unit_price"
                name="unit_price"
                value={formData.unit_price}
                onChange={handleChange}
                min="0"
                step="0.01"
                style={inputStyle}
                placeholder="Enter unit price (optional)"
              />
              {errors.unit_price && <span style={errorTextStyle}>{errors.unit_price}</span>}
            </div>

            {/* Item classification flags — stacked, left-aligned */}
            <div
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                textAlign: 'left',
                gap: '10px',
              }}
            >
              <span style={{ ...labelStyle, marginBottom: 0 }}>Item Classification</span>
              <label
                htmlFor="is_purchase_item"
                style={{
                  ...labelStyle,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: '8px',
                  cursor: 'pointer',
                  marginBottom: 0,
                  fontWeight: 500,
                }}
              >
                <input
                  type="checkbox"
                  id="is_purchase_item"
                  name="is_purchase_item"
                  checked={formData.is_purchase_item}
                  onChange={handleChange}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                />
                Is Purchase Item
              </label>
              <label
                htmlFor="is_raw_material"
                style={{
                  ...labelStyle,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: '8px',
                  cursor: 'pointer',
                  marginBottom: 0,
                  fontWeight: 500,
                }}
              >
                <input
                  type="checkbox"
                  id="is_raw_material"
                  name="is_raw_material"
                  checked={formData.is_raw_material}
                  onChange={handleChange}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                />
                Is Raw Material
              </label>
              <label
                htmlFor="is_subcontract_assembly"
                style={{
                  ...labelStyle,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: '8px',
                  cursor: 'pointer',
                  marginBottom: 0,
                  fontWeight: 500,
                }}
              >
                <input
                  type="checkbox"
                  id="is_subcontract_assembly"
                  name="is_subcontract_assembly"
                  checked={formData.is_subcontract_assembly}
                  onChange={handleChange}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                />
                Is Subcontract Assembly
              </label>
              <label
                htmlFor="is_outside_processed"
                style={{
                  ...labelStyle,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: '8px',
                  cursor: 'pointer',
                  marginBottom: 0,
                  fontWeight: 500,
                }}
              >
                <input
                  type="checkbox"
                  id="is_outside_processed"
                  name="is_outside_processed"
                  checked={formData.is_outside_processed}
                  onChange={handleChange}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                />
                Outside Processed (3rd Party Assembly)
              </label>
            </div>

            {/* Description Field - full width */}
            <div style={{ ...fieldGroupStyle, gridColumn: '1 / -1' }}>
              <label htmlFor="description" style={labelStyle}>
                Description
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }}
                placeholder="Enter item description (optional)"
              />
            </div>
          </div>
        </div>

        {isEditMode && id && <VendorItemMappingSection itemId={id} />}

        {/* ==========================================
            BILL OF MATERIALS (BOM) / SUBCONTRACT KIT
            ========================================== */}
        <div style={cardStyle}>
          <h3 style={sectionHeadingStyle}>
            {formData.is_subcontract_assembly
              ? 'Subcontract BOM / Assembly Kit'
              : 'Bill of Materials (BOM)'}
          </h3>
          {formData.is_subcontract_assembly && (
            <p style={bomEmptyTextStyle}>
              Assign raw materials/components and quantities required per assembly unit.
              Scrap factor and yield loss increase issued quantities for subcontract orders.
            </p>
          )}

          {!isEditMode && (
            <p style={bomEmptyTextStyle}>
              Save this item first (click "Create Item") before adding Bill of Materials
              components.
            </p>
          )}

          {bomError && (
            <div style={{ ...errorAlertStyle, marginBottom: '16px' }}>
              <span>⚠️ {bomError}</span>
            </div>
          )}

          {isEditMode && bomComponents.length === 0 ? (
            <p style={bomEmptyTextStyle}>
              No BOM components added yet. Click "Add Component" below to define materials, labor,
              or outside services required to build this item.
            </p>
          ) : null}

          {isEditMode && bomComponents.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={bomTableStyle}>
                <thead>
                  <tr style={bomTheadRowStyle}>
                    <th style={bomThStyle}>Item Type</th>
                    <th style={bomThStyle}>Component Part Number</th>
                    <th style={bomThStyle}>Description</th>
                    <th style={{ ...bomThStyle, textAlign: 'right' }}>Quantity</th>
                    <th style={{ ...bomThStyle, textAlign: 'right' }}>Scrap Factor</th>
                    <th style={{ ...bomThStyle, textAlign: 'right' }}>Yield Loss %</th>
                    <th style={bomThStyle}>UOM</th>
                    <th style={{ ...bomThStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bomComponents.map((row) => (
                    <tr key={row.id} style={bomTbodyRowStyle}>
                      <td style={bomTdStyle}>
                        <select
                          value={row.itemType}
                          onChange={(e) => handleBomFieldChange(row.id, 'itemType', e.target.value)}
                          onBlur={() => persistBomRow(row.id)}
                          style={{ ...inputStyle, padding: '8px 10px', minWidth: '130px' }}
                        >
                          {BOM_ITEM_TYPE_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={bomTdStyle}>
                        {row.itemType === 'Material' ? (
                          <select
                            value={row.componentPartNumber}
                            onChange={(e) => handleComponentPartNumberSelect(row.id, e.target.value)}
                            style={{ ...inputStyle, padding: '8px 10px', minWidth: '200px' }}
                          >
                            <option value="">-- Select a Part --</option>
                            {componentOptions.map((p) => (
                              <option key={p.item_id} value={p.item_id}>
                                {p.item_id} — {p.description || 'No description'}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select
                            value={row.componentCode}
                            onChange={(e) => handleComponentCodeSelect(row.id, e.target.value)}
                            style={{ ...inputStyle, padding: '8px 10px', minWidth: '200px' }}
                          >
                            <option value="">-- Select a Code --</option>
                            {Object.entries(LABOR_SERVICE_CODES).map(([code, info]) => (
                              <option key={code} value={code}>
                                {code} — {info.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>

                      <td style={bomTdStyle}>
                        <input
                          type="text"
                          value={row.description}
                          readOnly
                          style={{
                            ...inputStyle,
                            padding: '8px 10px',
                            minWidth: '180px',
                            backgroundColor: 'var(--social-bg)',
                            cursor: 'not-allowed',
                          }}
                          placeholder="Auto-filled from selected part"
                        />
                      </td>
                      <td style={{ ...bomTdStyle, textAlign: 'right' }}>
                        <input
                          type="number"
                          value={row.quantity}
                          onChange={(e) => handleBomFieldChange(row.id, 'quantity', e.target.value)}
                          onBlur={() => persistBomRow(row.id)}
                          min="0"
                          step="0.01"
                          style={{ ...inputStyle, padding: '8px 10px', width: '90px', textAlign: 'right' }}
                          placeholder="0"
                        />
                      </td>
                      <td style={{ ...bomTdStyle, textAlign: 'right' }}>
                        <input
                          type="number"
                          value={row.scrapFactor}
                          onChange={(e) =>
                            handleBomFieldChange(row.id, 'scrapFactor', e.target.value)
                          }
                          onBlur={() => persistBomRow(row.id)}
                          min="0"
                          step="0.0001"
                          disabled={row.itemType !== 'Material'}
                          style={{ ...inputStyle, padding: '8px 10px', width: '90px', textAlign: 'right' }}
                          title="Extra qty factor (e.g. 0.05 = 5% scrap)"
                        />
                      </td>
                      <td style={{ ...bomTdStyle, textAlign: 'right' }}>
                        <input
                          type="number"
                          value={row.yieldLossPercentage}
                          onChange={(e) =>
                            handleBomFieldChange(row.id, 'yieldLossPercentage', e.target.value)
                          }
                          onBlur={() => persistBomRow(row.id)}
                          min="0"
                          max="100"
                          step="0.01"
                          disabled={row.itemType !== 'Material'}
                          style={{ ...inputStyle, padding: '8px 10px', width: '90px', textAlign: 'right' }}
                        />
                      </td>
                      <td style={bomTdStyle}>
                        <input
                          type="text"
                          value={row.uom}
                          readOnly
                          style={{
                            ...inputStyle,
                            padding: '8px 10px',
                            width: '90px',
                            backgroundColor: 'var(--social-bg)',
                            cursor: 'not-allowed',
                          }}
                        />
                      </td>
                      <td style={{ ...bomTdStyle, textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleRemoveBomComponent(row.id)}
                          style={removeButtonStyle}
                          title="Remove component"
                          disabled={row.isSaving}
                        >
                          {row.isSaving ? 'Saving...' : '🗑 Remove'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            onClick={handleAddBomComponent}
            style={addComponentButtonStyle}
            disabled={!isEditMode}
          >
            + Add Component
          </button>
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
            {isSubmitting ? 'Saving...' : isEditMode ? 'Update Item' : 'Create Item'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/items')}
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

const subcontractLinkStyle: React.CSSProperties = {
  padding: '8px 14px',
  backgroundColor: '#e3f2fd',
  color: '#1565c0',
  border: '1px solid #bbdefb',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 'bold',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

// ---- BOM section styles ----

const bomEmptyTextStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--text)',
  fontStyle: 'italic',
  margin: '0 0 16px 0',
}

const bomTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
  marginBottom: '16px',
}

const bomTheadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
}

const bomThStyle: React.CSSProperties = {
  padding: '10px 8px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  whiteSpace: 'nowrap',
}

const bomTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
}

const bomTdStyle: React.CSSProperties = {
  padding: '8px',
  verticalAlign: 'middle',
}

const removeButtonStyle: React.CSSProperties = {
  padding: '6px 10px',
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
}

const addComponentButtonStyle: React.CSSProperties = {
  padding: '10px 16px',
  backgroundColor: 'transparent',
  color: '#1976d2',
  border: '1px dashed #1976d2',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 'bold',
  fontFamily: 'inherit',
}

export default ItemForm
