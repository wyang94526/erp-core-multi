import React from 'react';
import type { Item, PurchaseOrderItem } from '../types';

interface POLineItemsTableProps {
  items: PurchaseOrderItem[];
  products: Item[];
  updateRow: (id: string, field: keyof PurchaseOrderItem, value: any) => void;
  updateRowFields: (id: string, fields: Partial<PurchaseOrderItem>) => void;
  deleteRow: (id: string) => void;
  addRow: () => void;
  clearAllRows: () => void;
  isReadOnly: boolean;
  errors: Record<string, string>;
}

export function POLineItemsTable({
  items,
  products,
  updateRow,
  updateRowFields,
  deleteRow,
  addRow,
  clearAllRows,
  isReadOnly,
  errors,
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

  const handleItemSelect = (rowId: string, catalogItemId: string) => {
    const product = products.find((p) => p.item_id === catalogItemId);
    const fields: Partial<PurchaseOrderItem> = { sku: catalogItemId };
    if (product && product.unit_price != null) {
      fields.unit_price = Number(product.unit_price);
    }
    updateRowFields(rowId, fields);
  };

  return (
    <div style={containerStyle}>
      <div style={tableHeaderContainerStyle}>
        <h3 style={sectionHeadingStyle}>Line Items</h3>
        {!isReadOnly && (
          <div style={tableActionGroupStyle}>
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
              <th style={thStyle}>Item / SKU *</th>
              <th style={{ ...thStyle, width: '120px', textAlign: 'right' }}>Quantity *</th>
              <th style={{ ...thStyle, width: '140px', textAlign: 'right' }}>Unit Price ($) *</th>
              <th style={{ ...thStyle, width: '120px', textAlign: 'right' }}>Tax Rate (%)</th>
              <th style={{ ...thStyle, width: '140px', textAlign: 'right' }}>Line Subtotal</th>
              {!isReadOnly && <th style={{ ...thStyle, width: '80px', textAlign: 'center' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const rowHasError = errors[`item_${item.id}`] || errors[`sku_${item.id}`] || errors[`qty_${item.id}`] || errors[`price_${item.id}`];
              const knownSku = products.some((p) => p.item_id === item.sku);
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

                  {/* Item / SKU dropdown */}
                  <td style={tdStyle}>
                    {isReadOnly ? (
                      <div style={readOnlyCellText}>{resolveItemLabel(item.sku)}</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <select
                          aria-label={`Item / SKU for row ${index + 1}`}
                          value={item.sku || ''}
                          onChange={(e) => handleItemSelect(item.id, e.target.value)}
                          style={{
                            ...inputStyle,
                            width: '100%',
                            border: errors[`sku_${item.id}`] ? '1px solid #f44336' : '1px solid var(--border)',
                          }}
                        >
                          <option value="">Select item / SKU</option>
                          {!knownSku && item.sku ? (
                            <option value={item.sku}>{item.sku} (not in catalog)</option>
                          ) : null}
                          {products.map((product) => (
                            <option key={product.item_id} value={product.item_id}>
                              {productLabel(product)}
                            </option>
                          ))}
                        </select>
                        {errors[`sku_${item.id}`] && (
                          <span style={errorTextStyle}>{errors[`sku_${item.id}`]}</span>
                        )}
                      </div>
                    )}
                  </td>

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
                          min="0.01"
                          step="any"
                          value={item.quantity === 0 ? '' : item.quantity}
                          onChange={(e) => updateRow(item.id, 'quantity', e.target.value)}
                          placeholder="0"
                          style={{
                            ...inputStyle,
                            textAlign: 'right',
                            width: '100px',
                            border: errors[`qty_${item.id}`] ? '1px solid #f44336' : '1px solid var(--border)',
                          }}
                        />
                        {errors[`qty_${item.id}`] && (
                          <span style={errorTextStyle}>{errors[`qty_${item.id}`]}</span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Unit Price */}
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {isReadOnly ? (
                      <div style={{ ...readOnlyCellText, textAlign: 'right', justifyContent: 'flex-end' }}>
                        {formatCurrency(item.unit_price)}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <input
                          type="number"
                          aria-label={`Unit price for item ${index + 1}`}
                          min="0"
                          step="0.01"
                          value={item.unit_price === 0 ? '' : item.unit_price}
                          onChange={(e) => updateRow(item.id, 'unit_price', e.target.value)}
                          placeholder="0.00"
                          style={{
                            ...inputStyle,
                            textAlign: 'right',
                            width: '120px',
                            border: errors[`price_${item.id}`] ? '1px solid #f44336' : '1px solid var(--border)',
                          }}
                        />
                        {errors[`price_${item.id}`] && (
                          <span style={errorTextStyle}>{errors[`price_${item.id}`]}</span>
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
