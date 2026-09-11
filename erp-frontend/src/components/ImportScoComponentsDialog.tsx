import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { subcontractOrderService } from '../api/services'
import type { Item, PurchaseOrderItem, UnfulfilledScoComponent } from '../types'

type Props = {
  open: boolean
  scoNumber: string
  supplierId?: string
  excludePoNumber?: string
  products?: Item[]
  onClose: () => void
  onImport: (rows: PurchaseOrderItem[], replaceAll: boolean) => void
}

function toPrice(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function resolveImportPrice(line: UnfulfilledScoComponent, products: Item[]): number {
  const fromApi = toPrice(line.unit_cost)
  if (fromApi != null) return fromApi
  const catalog = products.find((item) => item.item_id === line.component_item_id)
  return toPrice(catalog?.unit_price) ?? 0
}

const generateId = () => `row-${Math.random().toString(36).substr(2, 9)}`

export function ImportScoComponentsDialog({
  open,
  scoNumber,
  supplierId,
  excludePoNumber,
  products = [],
  onClose,
  onImport,
}: Props) {
  const [qtyById, setQtyById] = useState<Record<number, number>>({})
  const [included, setIncluded] = useState<Record<number, boolean>>({})
  const [replaceAll, setReplaceAll] = useState(false)

  const { data: lines = [], isFetching, error } = useQuery({
    queryKey: ['unfulfilledScoComponents', scoNumber, supplierId, excludePoNumber],
    queryFn: () =>
      subcontractOrderService.listUnfulfilledComponents(scoNumber, {
        supplier_id: supplierId || undefined,
        exclude_po_number: excludePoNumber || undefined,
        include_fully_covered: true,
      }),
    enabled: open && Boolean(scoNumber),
  })

  useEffect(() => {
    if (!open) return
    const nextQty: Record<number, number> = {}
    const nextInc: Record<number, boolean> = {}
    for (const line of lines) {
      nextQty[line.sco_component_id] = line.quantity_remaining
      nextInc[line.sco_component_id] = line.quantity_remaining > 0
    }
    setQtyById(nextQty)
    setIncluded(nextInc)
  }, [open, lines])

  const selectedLines = useMemo(
    () => lines.filter((line) => included[line.sco_component_id]),
    [lines, included]
  )
  const overOrdered = selectedLines.some(
    (line) => (qtyById[line.sco_component_id] || 0) > line.quantity_remaining + 1e-9
  )
  const missingVendorPrice = selectedLines.some(
    (line) => resolveImportPrice(line, products) <= 0
  )

  if (!open) return null

  const handleImport = () => {
    const rows: PurchaseOrderItem[] = selectedLines
      .filter((line) => (qtyById[line.sco_component_id] || 0) > 0)
      .map((line) => ({
        id: generateId(),
        sku: line.component_item_id,
        description: line.description || '',
        uom: line.uom || 'Each',
        bom_header_id: null,
        sco_component_id: line.sco_component_id,
        quantity: qtyById[line.sco_component_id] || 0,
        unit_price: resolveImportPrice(line, products),
        tax_rate: 0,
        line_subtotal: 0,
        line_tax: 0,
        line_total: 0,
      }))
    if (rows.length === 0) return
    onImport(rows, replaceAll)
    onClose()
  }

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="import-sco-title">
      <div style={modalStyle}>
        <h3 id="import-sco-title" style={{ margin: '0 0 8px 0' }}>
          Import Subcontract Components
        </h3>
        <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--text)' }}>
          Remaining demand for {scoNumber}. Draft purchase orders count toward already ordered.
          You can change quantities before importing.
        </p>
        {isFetching && <p style={{ fontSize: 13 }}>Loading demand…</p>}
        {error && (
          <p style={{ color: '#c62828', fontSize: 13 }}>
            {error instanceof Error ? error.message : 'Failed to load component demand'}
          </p>
        )}
        <div style={{ overflowX: 'auto', maxHeight: 360 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}></th>
                <th style={thStyle}>Part</th>
                <th style={thStyle}>UOM</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Required</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Already ordered</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Remaining</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Order qty</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Unit cost</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <DemandRow
                  key={line.sco_component_id}
                  line={line}
                  included={Boolean(included[line.sco_component_id])}
                  qty={qtyById[line.sco_component_id] ?? line.quantity_remaining}
                  unitCost={
                    toPrice(line.unit_cost) ??
                    toPrice(
                      products.find((item) => item.item_id === line.component_item_id)?.unit_price
                    )
                  }
                  onToggle={(checked) =>
                    setIncluded((prev) => ({ ...prev, [line.sco_component_id]: checked }))
                  }
                  onQty={(value) =>
                    setQtyById((prev) => ({ ...prev, [line.sco_component_id]: value }))
                  }
                />
              ))}
              {!isFetching && lines.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 16, textAlign: 'center', color: '#666' }}>
                    No component demand on this subcontract order.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {overOrdered && (
          <p style={warnStyle}>
            One or more quantities exceed remaining demand. Import is allowed (split vendors / extra
            scrap), but please confirm this is intentional.
          </p>
        )}
        {missingVendorPrice && (
          <p style={warnStyle}>
            Some selected parts have no vendor unit cost. They will import at $0.00 — update price
            before submitting.
          </p>
        )}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={replaceAll}
            onChange={(e) => setReplaceAll(e.target.checked)}
          />
          Replace all existing line items
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={secondaryBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={selectedLines.length === 0}
            style={{
              ...primaryBtn,
              opacity: selectedLines.length === 0 ? 0.6 : 1,
              cursor: selectedLines.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Import selected
          </button>
        </div>
      </div>
    </div>
  )
}

function priceSourceLabel(source?: UnfulfilledScoComponent['price_source']) {
  switch (source) {
    case 'VENDOR_MAPPING':
      return 'Vendor'
    case 'PRIMARY_VENDOR':
      return 'Vendor catalog'
    case 'LAST_PO_VENDOR':
      return 'Last PO (this vendor)'
    case 'LAST_PO':
      return 'Last PO'
    case 'CATALOG':
      return 'Catalog'
    default:
      return 'No price'
  }
}

function DemandRow({
  line,
  included,
  qty,
  unitCost,
  onToggle,
  onQty,
}: {
  line: UnfulfilledScoComponent
  included: boolean
  qty: number
  unitCost: number | null
  onToggle: (checked: boolean) => void
  onQty: (value: number) => void
}) {
  const over = qty > line.quantity_remaining + 1e-9
  const displayCost = unitCost ?? toPrice(line.unit_cost)
  const source: UnfulfilledScoComponent['price_source'] =
    toPrice(line.unit_cost) != null
      ? line.price_source
      : unitCost != null
        ? 'CATALOG'
        : 'NONE'
  return (
    <tr>
      <td style={tdStyle}>
        <input
          type="checkbox"
          checked={included}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Include ${line.component_item_id}`}
        />
      </td>
      <td style={tdStyle}>
        <div style={{ fontWeight: 600 }}>{line.component_item_id}</div>
        <div style={{ fontSize: 11, color: '#666' }}>{line.description}</div>
      </td>
      <td style={tdStyle}>{line.uom || 'Each'}</td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtQty(line.quantity_required)}</td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        {fmtQty(line.quantity_already_ordered)}
        {line.quantity_on_draft_pos > 0 && (
          <div style={{ fontSize: 11, color: '#ef6c00' }}>
            incl. {fmtQty(line.quantity_on_draft_pos)} Draft
          </div>
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtQty(line.quantity_remaining)}</td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <input
          type="number"
          min="0"
          step="any"
          value={qty === 0 ? '' : qty}
          onChange={(e) => onQty(parseFloat(e.target.value) || 0)}
          style={{
            width: 88,
            textAlign: 'right',
            padding: '4px 6px',
            border: over ? '1px solid #ef6c00' : '1px solid var(--border)',
            borderRadius: 4,
          }}
        />
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        {displayCost == null ? '—' : `$${displayCost.toFixed(4)}`}
        <div style={{ fontSize: 10, color: '#888' }}>{priceSourceLabel(source)}</div>
      </td>
    </tr>
  )
}

function fmtQty(value: number) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 4 })
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
  padding: 16,
}

const modalStyle: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text-h)',
  borderRadius: 10,
  padding: 20,
  width: 'min(960px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 6px',
  borderBottom: '1px solid var(--border)',
  fontSize: 12,
}

const tdStyle: React.CSSProperties = {
  padding: '8px 6px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
}

const warnStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '8px 10px',
  background: '#fff8e1',
  color: '#ef6c00',
  borderRadius: 6,
  fontSize: 13,
}

const secondaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: 'none',
  background: '#1976d2',
  color: '#fff',
  fontWeight: 700,
  fontFamily: 'inherit',
}
