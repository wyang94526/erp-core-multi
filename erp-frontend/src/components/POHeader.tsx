import React, { useState, useEffect, useRef } from 'react';
import type { Supplier } from '../types';
import type { POFormState } from '../hooks/usePurchaseOrderState';

interface POHeaderProps {
  state: POFormState;
  setHeader: (field: string, value: any) => void;
  isReadOnly: boolean;
  suppliers: Supplier[];
  errors: Record<string, string>;
}

export function POHeader({ state, setHeader, isReadOnly, suppliers, errors }: POHeaderProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync search term with state.supplier_id/supplier_name on load or when state changes
  useEffect(() => {
    if (state.supplier_id) {
      const matched = suppliers.find((s) => s.supplier_id === state.supplier_id);
      setSearchTerm(matched ? matched.company_name : '');
    } else {
      setSearchTerm('');
    }
  }, [state.supplier_id, suppliers]);

  // Handle click outside to close autocomplete dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
        // Reset search term to match actual selected supplier
        const matched = suppliers.find((s) => s.supplier_id === state.supplier_id);
        setSearchTerm(matched ? matched.company_name : '');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [state.supplier_id, suppliers]);

  const filteredSuppliers = suppliers.filter(
    (s) =>
      s.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.supplier_id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSupplierSelect = (supplier: Supplier) => {
    setHeader('supplier_id', supplier.supplier_id);
    setHeader('supplier_name', supplier.company_name);
    setSearchTerm(supplier.company_name);
    setShowDropdown(false);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setShowDropdown(true);
    // If input is completely cleared, clear the selection
    if (!e.target.value) {
      setHeader('supplier_id', '');
      setHeader('supplier_name', '');
    }
  };

  // Payment terms options
  const PAYMENT_TERMS_OPTIONS = [
    'Due on Receipt',
    'Net 15',
    'Net 30',
    'Net 60',
    'Net 90',
  ];

  // Status option badges colors
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Draft':
        return { bg: '#e0e0e0', text: '#333' };
      case 'Submitted':
        return { bg: '#e3f2fd', text: '#0d47a1' };
      case 'Approved':
        return { bg: '#e8f5e9', text: '#1b5e20' };
      case 'Void':
        return { bg: '#ffebee', text: '#b71c1c' };
      default:
        return { bg: '#f5f5f5', text: '#666' };
    }
  };

  const statusColors = getStatusColor(state.status);

  return (
    <div style={containerStyle}>
      <h3 style={sectionHeadingStyle}>PO Header Information</h3>
      <div style={gridStyle}>
        {/* PO Number */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="po_number">PO Number *</label>
          {isReadOnly ? (
            <div style={readOnlyValueStyle}>{state.po_number || 'N/A'}</div>
          ) : (
            <input
              id="po_number"
              type="text"
              value={state.po_number}
              onChange={(e) => setHeader('po_number', e.target.value)}
              placeholder="e.g. PO-2026-0001"
              style={{
                ...inputStyle,
                border: errors.po_number ? '1px solid #f44336' : '1px solid var(--border)',
              }}
            />
          )}
          {errors.po_number && <span style={errorTextStyle}>{errors.po_number}</span>}
        </div>

        {/* Vendor Selection (Searchable Dropdown / Autocomplete) */}
        <div style={fieldGroupStyle} ref={dropdownRef}>
          <label style={labelStyle}>Vendor / Supplier *</label>
          {isReadOnly ? (
            <div style={readOnlyValueStyle}>
              {state.supplier_name ? `${state.supplier_name} (${state.supplier_id})` : 'N/A'}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Type to search suppliers..."
                value={searchTerm}
                onChange={handleSearchChange}
                onFocus={() => setShowDropdown(true)}
                style={{
                  ...inputStyle,
                  width: '100%',
                  border: errors.supplier_id ? '1px solid #f44336' : '1px solid var(--border)',
                }}
              />
              {showDropdown && (
                <div style={dropdownListStyle}>
                  {filteredSuppliers.length > 0 ? (
                    filteredSuppliers.map((supplier) => (
                      <div
                        key={supplier.supplier_id}
                        onClick={() => handleSupplierSelect(supplier)}
                        style={dropdownItemStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <div style={{ fontWeight: 'bold' }}>{supplier.company_name}</div>
                        <div style={{ fontSize: '11px', color: '#666' }}>{supplier.supplier_id}</div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '10px', color: '#666', fontSize: '13px', textAlign: 'center' }}>
                      No suppliers found
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {errors.supplier_id && <span style={errorTextStyle}>{errors.supplier_id}</span>}
        </div>

        {/* Order Date */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="order_date">Order Date *</label>
          {isReadOnly ? (
            <div style={readOnlyValueStyle}>{state.order_date || 'N/A'}</div>
          ) : (
            <input
              id="order_date"
              type="date"
              value={state.order_date}
              onChange={(e) => setHeader('order_date', e.target.value)}
              style={{
                ...inputStyle,
                border: errors.order_date ? '1px solid #f44336' : '1px solid var(--border)',
              }}
            />
          )}
          {errors.order_date && <span style={errorTextStyle}>{errors.order_date}</span>}
        </div>

        {/* Expected Delivery Date */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="expected_delivery_date">Expected Delivery Date *</label>
          {isReadOnly ? (
            <div style={readOnlyValueStyle}>{state.expected_delivery_date || 'N/A'}</div>
          ) : (
            <input
              id="expected_delivery_date"
              type="date"
              value={state.expected_delivery_date}
              onChange={(e) => setHeader('expected_delivery_date', e.target.value)}
              style={{
                ...inputStyle,
                border: errors.expected_delivery_date ? '1px solid #f44336' : '1px solid var(--border)',
              }}
            />
          )}
          {errors.expected_delivery_date && (
            <span style={errorTextStyle}>{errors.expected_delivery_date}</span>
          )}
        </div>

        {/* Payment Terms */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="payment_terms">Payment Terms</label>
          {isReadOnly ? (
            <div style={readOnlyValueStyle}>{state.payment_terms || 'N/A'}</div>
          ) : (
            <select
              id="payment_terms"
              value={state.payment_terms}
              onChange={(e) => setHeader('payment_terms', e.target.value)}
              style={inputStyle}
            >
              {PAYMENT_TERMS_OPTIONS.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Status Badge */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>PO Status</label>
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                fontSize: '13px',
                fontWeight: 'bold',
                backgroundColor: statusColors.bg,
                color: statusColors.text,
                display: 'inline-block',
                border: `1px solid ${statusColors.text}33`,
              }}
            >
              {state.status}
            </span>
            {!isReadOnly && (
              <select
                aria-label="Change status"
                value={state.status}
                onChange={(e) => setHeader('status', e.target.value)}
                style={{
                  ...inputStyle,
                  padding: '4px 8px',
                  fontSize: '12px',
                  display: 'inline-block',
                  width: 'auto',
                }}
              >
                <option value="Draft">Draft</option>
                <option value="Submitted">Submitted</option>
                <option value="Approved">Approved</option>
                <option value="Void">Void</option>
              </select>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Visual Styles Matching ERP standard
const containerStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  marginBottom: '20px',
  boxShadow: 'var(--shadow)',
  textAlign: 'left',
  height: '100%',
  boxSizing: 'border-box',
};

const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  borderBottom: '2px solid var(--border)',
  paddingBottom: '8px',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '20px',
};

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
};

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  marginBottom: '6px',
};

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
};

const readOnlyValueStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: '6px',
  backgroundColor: 'var(--social-bg)',
  border: '1px solid var(--border)',
  fontSize: '14px',
  color: 'var(--text-h)',
  minHeight: '41px',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
};

const dropdownListStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  zIndex: 1000,
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
  maxHeight: '200px',
  overflowY: 'auto',
  marginTop: '4px',
};

const dropdownItemStyle: React.CSSProperties = {
  padding: '10px 12px',
  cursor: 'pointer',
  borderBottom: '1px solid var(--border)',
  fontSize: '13px',
  color: 'var(--text-h)',
};

const errorTextStyle: React.CSSProperties = {
  color: '#f44336',
  fontSize: '12px',
  marginTop: '4px',
  fontWeight: '500',
};
