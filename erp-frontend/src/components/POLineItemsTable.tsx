import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Item, ItemBOMHeader, PurchaseOrderItem } from '../types';
import { itemBomService, itemService } from '../api/services';
import ItemLookup from './ItemLookup';
import { ImportScoComponentsDialog } from './ImportScoComponentsDialog';
import { isAmountOnlyLine, isStockItemType } from '../utils/itemTypes';

interface POLineItemsTableProps {
  items: PurchaseOrderItem[];
  products: Item[];
  poType?: 'MATERIAL' | 'SUBCONTRACT';
  updateRow: (id: string, field: keyof PurchaseOrderItem, value: any) => void;
  updateRowFields: (id: string, fields: Partial<PurchaseOrderItem>) => void;
  deleteRow: (id: string) => void;
  addRow: () => void;
  clearAllRows: () => void;
  isReadOnly: boolean;
  errors: Record<string, string>;
  scoNumber?: string | null;
  supplierId?: string;
  excludePoNumber?: string;
  onImportComponents?: (rows: PurchaseOrderItem[], replaceAll: boolean) => void;
}

function BomHeaderSelect({
  itemId,
  value,
  disabled,
  onChange,
}: {
  itemId: string;
  value?: number | null;
  disabled: boolean;
  onChange: (headerId: number | null) => void;
}) {
  const { data: headers = [], isLoading } = useQuery({
    queryKey: ['bom-headers', itemId],
    queryFn: () => itemBomService.listHeaders(itemId),
    enabled: Boolean(itemId),
  });

  if (!itemId) {
    return <span style={{ fontSize: 12, color: 'var(--text)' }}>Select an item first</span>;
  }
  if (disabled) {
    const selected = headers.find((header) => header.bom_header_id === value);
    return (
      <div style={readOnlyCellText}>
        {selected ? `v${selected.version_no} (${selected.status})` : value ? `#${value}` : '—'}
      </div>
    );
  }
  return (
    <select
      aria-label="BOM version"
      value={value ?? ''}
      disabled={isLoading}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      style={inputStyle}
    >
      <option value="">{isLoading ? 'Loading BOM…' : 'Select BOM version'}</option>
      {headers.map((header: ItemBOMHeader) => (
        <option key={header.bom_header_id} value={header.bom_header_id}>
          v{header.version_no} — {header.status}
        </option>
      ))}
    </select>
  );
}

export function POLineItemsTable({
  items,
  products,
  poType = 'MATERIAL',
  updateRow,
  updateRowFields,
  deleteRow,
  addRow,
  clearAllRows,
  isReadOnly,
  errors,
  scoNumber,
  supplierId,
  excludePoNumber,
  onImportComponents,
}: POLineItemsTableProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const productLabel = (product: Item) => {
    const desc = product.description || product.customer_part_number || product.item_id;
    return `${product.item_id} — ${desc}`;
  };

  const resolveItemLabel = (sku: string) => {
    const product = products.find((p) => p.item_id === sku);
    return product ? productLabel(product) : sku || 'N/A';
  };

  const isSubcontract = poType === 'SUBCONTRACT';
  const canImportComponents = poType === 'MATERIAL' && Boolean(scoNumber) && !isReadOnly;
  const [importOpen, setImportOpen] = useState(false);

  const handleItemSelect = (rowId: string, catalog: Item | null) => {
    const fields: Partial<PurchaseOrderItem> = {
      sku: catalog?.item_id || '',
      description: catalog?.description || '',
      uom: catalog?.uom || '',
      item_type: catalog?.item_type || 'INVENTORY',
      bom_header_id: null,
      sco_component_id: null,
    };
    if (catalog && !isStockItemType(catalog.item_type)) {
      fields.quantity = 0;
    }
    if (catalog?.unit_price != null && Number(catalog.unit_price) > 0) {
      fields.unit_price = Number(catalog.unit_price);
      if (!isStockItemType(catalog.item_type)) {
        fields.line_subtotal = Number(catalog.unit_price);
      }
    }
    updateRowFields(rowId, fields);
    if (catalog?.item_id) {
      void itemService.listItemVendors(catalog.item_id).then((mappings) => {
        const forVendor = supplierId
          ? mappings.find((row) => row.supplier_id === supplierId && Number(row.unit_cost) > 0)
          : undefined;
        const priced =
          forVendor ||
          mappings.find((row) => row.is_primary_vendor && Number(row.unit_cost) > 0) ||
          mappings.find((row) => Number(row.unit_cost) > 0);
        const cost = Number(priced?.unit_cost);
        if (Number.isFinite(cost) && cost > 0) {
          const fields: Partial<PurchaseOrderItem> = { unit_price: cost }
          if (!isStockItemType(catalog?.item_type)) {
            fields.line_subtotal = cost
          }
          updateRowFields(rowId, fields)
        }
      }).catch(() => undefined);
    }
    if (isSubcontract && catalog?.item_id) {
      void itemBomService.listHeaders(catalog.item_id).then((headers) => {
        const active = headers.find((header) => String(header.status).toLowerCase() === 'active') || headers[0];
        if (active) {
          updateRowFields(rowId, { bom_header_id: active.bom_header_id });
        }
      }).catch(() => undefined);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={tableHeaderContainerStyle}>
        <h3 style={sectionHeadingStyle}>Line Items</h3>
        {!isReadOnly && (
          <div style={tableActionGroupStyle}>
            {poType === 'MATERIAL' && (
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                disabled={!canImportComponents}
                title={
                  scoNumber
                    ? 'Import remaining subcontract components'
                    : 'Link a subcontract order to import components'
                }
                style={{
                  ...addButtonStyle,
                  backgroundColor: canImportComponents ? '#2e7d32' : '#9e9e9e',
                  cursor: canImportComponents ? 'pointer' : 'not-allowed',
                }}
              >
                Import Subcontract Components
              </button>
            )}
            <button
              type="button"
              onClick={clearAllRows}
              style={clearButtonStyle}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fce4ec')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Clear All
            </button>
            <button
              type="button"
              onClick={addRow}
              style={addButtonStyle}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1565c0')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1976d2')}
            >
              + Add Item Row
            </button>
          </div>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr style={theadRowStyle}>
              <th style={{ ...thStyle, width: '40px' }}>#</th>
              <th style={thStyle}>{isSubcontract ? 'Assembly / Part No. *' : 'Item / Part No. *'}</th>
              {isSubcontract && <th style={{ ...thStyle, width: '180px' }}>BOM Version</th>}
              {!isSubcontract && <th style={{ ...thStyle, width: '80px' }}>UOM</th>}
              <th style={{ ...thStyle, width: '120px', textAlign: 'right' }}>Quantity *</th>
              <th style={{ ...thStyle, width: '140px', textAlign: 'right' }}>Unit Price ($) *</th>
              <th style={{ ...thStyle, width: '120px', textAlign: 'right' }}>Tax Rate (%)</th>
              <th style={{ ...thStyle, width: '140px', textAlign: 'right' }}>Line Subtotal</th>
              {!isReadOnly && <th style={{ ...thStyle, width: '80px', textAlign: 'center' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const catalog = products.find((p) => p.item_id === item.sku)
              const itemType = item.item_type || catalog?.item_type
              const amountOnly = isAmountOnlyLine(itemType, item.quantity, item.sku)
              const rowHasError = errors[`item_${item.id}`] || errors[`sku_${item.id}`] || errors[`qty_${item.id}`] || errors[`price_${item.id}`] || errors[`amount_${item.id}`];
              return (
                <tr
                  key={item.id}
                  style={{
                    ...tbodyRowStyle,
                    backgroundColor: rowHasError ? '#fff8f8' : index % 2 === 0 ? 'var(--bg)' : 'var(--social-bg)',
                  }}
                >
                  {/* Row Number */}
                  <td style={tdStyle}>{index + 1}</td>

                  {/* Item / SKU lookup */}
                  <td style={tdStyle}>
                    {isReadOnly ? (
                      <div style={readOnlyCellText}>{resolveItemLabel(item.sku)}</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <ItemLookup
                          items={products}
                          value={item.sku || ''}
                          catalog={isSubcontract ? 'assembly' : 'all'}
                          error={Boolean(errors[`sku_${item.id}`])}
                          ariaLabel={`${isSubcontract ? 'Assembly' : 'Item'} part number for row ${index + 1}`}
                          placeholder="Search by part number or description"
                          onSelect={(catalog) => handleItemSelect(item.id, catalog)}
                        />
                        {errors[`sku_${item.id}`] && (
                          <span style={errorTextStyle}>{errors[`sku_${item.id}`]}</span>
                        )}
                        {item.description ? (
                          <span style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{item.description}</span>
                        ) : null}
                      </div>
                    )}
                  </td>
                  {isSubcontract && (
                    <td style={tdStyle}>
                      <BomHeaderSelect
                        itemId={item.sku}
                        value={item.bom_header_id}
                        disabled={isReadOnly}
                        onChange={(headerId) => updateRow(item.id, 'bom_header_id', headerId)}
                      />
                    </td>
                  )}

                  {!isSubcontract && (
                    <td style={tdStyle}>
                      <div style={readOnlyCellText}>{item.uom || products.find((p) => p.item_id === item.sku)?.uom || '—'}</div>
                    </td>
                  )}

                  {/* Quantity */}
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {isReadOnly ? (
                      <div style={{ ...readOnlyCellText, textAlign: 'right', justifyContent: 'flex-end' }}>
                        {item.quantity}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <input
                          type="number"
                          aria-label={`Quantity for item ${index + 1}`}
                          min="0"
                          step="any"
                          value={item.quantity === 0 ? '0' : item.quantity}
                          onChange={(e) => updateRow(item.id, 'quantity', e.target.value)}
                          placeholder={amountOnly ? '0' : '0'}
                          style={{
                            ...inputStyle,
                            textAlign: 'right',
                            width: '100px',
                            border: errors[`qty_${item.id}`] ? '1px solid #f44336' : '1px solid var(--border)',
                          }}
                        />
                        {amountOnly ? (
                          <span style={{ fontSize: '11px', color: '#666', marginTop: 4 }}>Qty 0 uses amount</span>
                        ) : null}
                        {errors[`qty_${item.id}`] && (
                          <span style={errorTextStyle}>{errors[`qty_${item.id}`]}</span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Unit Price / Amount */}
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {isReadOnly ? (
                      <div style={{ ...readOnlyCellText, textAlign: 'right', justifyContent: 'flex-end' }}>
                        {formatCurrency(item.unit_price || item.line_subtotal)}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <input
                          type="number"
                          aria-label={amountOnly ? `Amount for item ${index + 1}` : `Unit price for item ${index + 1}`}
                          min="0"
                          step="0.01"
                          value={
                            amountOnly
                              ? (item.unit_price || item.line_subtotal || 0) === 0
                                ? ''
                                : item.unit_price || item.line_subtotal
                              : item.unit_price === 0
                                ? ''
                                : item.unit_price
                          }
                          onChange={(e) => {
                            if (amountOnly) {
                              updateRowFields(item.id, {
                                unit_price: e.target.value,
                                line_subtotal: e.target.value,
                              })
                            } else {
                              updateRow(item.id, 'unit_price', e.target.value)
                            }
                          }}
                          placeholder="0.00"
                          style={{
                            ...inputStyle,
                            textAlign: 'right',
                            width: '120px',
                            border:
                              errors[`price_${item.id}`] || errors[`amount_${item.id}`]
                                ? '1px solid #f44336'
                                : '1px solid var(--border)',
                          }}
                        />
                        {amountOnly ? (
                          <span style={{ fontSize: '11px', color: '#666', marginTop: 4 }}>Amount ($)</span>
                        ) : null}
                        {(errors[`price_${item.id}`] || errors[`amount_${item.id}`]) && (
                          <span style={errorTextStyle}>{errors[`price_${item.id}`] || errors[`amount_${item.id}`]}</span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Tax Rate */}
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {isReadOnly ? (
                      <div style={{ ...readOnlyCellText, textAlign: 'right', justifyContent: 'flex-end' }}>
                        {item.tax_rate}%
                      </div>
                    ) : (
                      <input
                        type="number"
                        aria-label={`Tax rate for item ${index + 1}`}
                        min="0"
                        max="100"
                        step="0.1"
                        value={item.tax_rate === 0 ? '' : item.tax_rate}
                        onChange={(e) => updateRow(item.id, 'tax_rate', e.target.value)}
                        placeholder="0.0"
                        style={{ ...inputStyle, textAlign: 'right', width: '90px' }}
                      />
                    )}
                  </td>

                  {/* Line Subtotal */}
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>
                    <div style={{ color: 'var(--text-h)', fontSize: '14px', paddingRight: '8px' }}>
                      {formatCurrency(item.line_subtotal)}
                      {item.line_tax > 0 && (
                        <div style={{ fontSize: '11px', color: '#666', fontWeight: 'normal' }}>
                          + {formatCurrency(item.line_tax)} Tax
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Actions (Delete) */}
                  {!isReadOnly && (
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => deleteRow(item.id)}
                        style={deleteButtonStyle}
                        title="Delete this row"
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#c62828')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#e53935')}
                      >
                        🗑
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!isReadOnly && items.length === 0 && (
        <div style={emptyStateStyle}>
          No items added. Click "+ Add Item Row" to add a purchase line item.
        </div>
      )}

      {onImportComponents && (
        <ImportScoComponentsDialog
          open={importOpen}
          scoNumber={scoNumber || ''}
          supplierId={supplierId}
          excludePoNumber={excludePoNumber}
          products={products}
          onClose={() => setImportOpen(false)}
          onImport={onImportComponents}
        />
      )}
    </div>
  );
}

// Styling definitions
const containerStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
  textAlign: 'left',
};

const tableHeaderContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
  borderBottom: '2px solid var(--border)',
  paddingBottom: '8px',
};

const sectionHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
};

const tableActionGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
};

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
};

const clearButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: 'transparent',
  color: '#d32f2f',
  border: '1px solid #d32f2f',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s, color 0.2s',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '14px',
};

const theadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
};

const thStyle: React.CSSProperties = {
  padding: '12px 8px',
  color: 'var(--text-h)',
  fontWeight: 'bold',
  textAlign: 'left',
  fontSize: '13px',
};

const tbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
  transition: 'background-color 0.2s',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 8px',
  verticalAlign: 'middle',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  fontSize: '13px',
  color: 'var(--text-h)',
  backgroundColor: 'var(--bg)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const readOnlyCellText: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--text-h)',
  padding: '8px 0',
  display: 'flex',
  alignItems: 'center',
};

const deleteButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#e53935',
  fontSize: '18px',
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: '4px',
  transition: 'color 0.2s',
};

const emptyStateStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontSize: '14px',
  border: '1px dashed var(--border)',
  borderRadius: '6px',
  marginTop: '10px',
};

const errorTextStyle: React.CSSProperties = {
  color: '#f44336',
  fontSize: '11px',
  marginTop: '2px',
  fontWeight: '500',
  textAlign: 'left',
};
