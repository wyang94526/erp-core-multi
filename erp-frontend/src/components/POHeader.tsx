import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { EligibleMaterialPoSco, SubcontractOrder, Supplier } from '../types';
import type { POFormState } from '../hooks/usePurchaseOrderState';
import {
  FREIGHT_PAYMENT_TERMS_OPTIONS,
  INCOTERM_OPTIONS,
  PO_TYPE_OPTIONS,
  requiresCarrierAccount,
  withCurrentOption,
} from '../data/orderOptions';
import { paymentTermsService, subcontractOrderService } from '../api/services';
import { SubcontractOrderLookup } from './SubcontractOrderLookup';
import { findPaymentTerm, paymentTermLabel } from '../utils/paymentTerms';

interface POHeaderProps {
  state: POFormState;
  setHeader: (field: string, value: any) => void;
  isReadOnly: boolean;
  suppliers: Supplier[];
  subcontractOrders?: SubcontractOrder[];
  errors: Record<string, string>;
  hasImportedLines?: boolean;
  onClearImportedLines?: () => void;
}

export function POHeader({
  state,
  setHeader,
  isReadOnly,
  suppliers,
  subcontractOrders = [],
  errors,
  hasImportedLines = false,
  onClearImportedLines,
}: POHeaderProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [purchaseForSco, setPurchaseForSco] = useState(Boolean(state.sco_number));
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.sco_number) setPurchaseForSco(true);
  }, [state.sco_number]);
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
    if (!state.incoterms && supplier.incoterms) {
      setHeader('incoterms', supplier.incoterms);
    }
    if (supplier.payment_term_id || supplier.payment_terms) {
      setHeader('payment_term_id', supplier.payment_term_id || '');
      setHeader('payment_terms', supplier.payment_terms || '');
    }
    setSearchTerm(supplier.company_name);
    setShowDropdown(false);
  };

  const confirmScoChange = (nextSco: string) => {
    if (hasImportedLines && state.sco_number && nextSco !== state.sco_number) {
      const ok = window.confirm(
        'Changing the linked subcontract order will remove imported component lines. Continue?'
      );
      if (!ok) return false;
      onClearImportedLines?.();
    }
    return true;
  };

  const handleMaterialScoSelect = (sco: EligibleMaterialPoSco | null) => {
    const next = sco?.sco_number || '';
    if (!confirmScoChange(next)) return;
    setHeader('sco_number', next);
    if (!next) setPurchaseForSco(false);
  };

  const handleScoSelect = (scoNumber: string) => {
    if (!confirmScoChange(scoNumber)) return;
    setHeader('sco_number', scoNumber);
    if (!scoNumber) {
      setHeader('bom_header_id', null);
      return;
    }
    const sco = subcontractOrders.find((row) => row.sco_number === scoNumber);
    if (!sco) return;
    if (!state.supplier_id) {
      setHeader('supplier_id', sco.supplier_id);
      const matched = suppliers.find((s) => s.supplier_id === sco.supplier_id);
      if (matched) setHeader('supplier_name', matched.company_name);
    }
    setHeader('bom_header_id', sco.bom_header_id ?? null);
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
  const { data: paymentTerms = [] } = useQuery({
    queryKey: ['paymentTerms'],
    queryFn: () => paymentTermsService.list(),
  });

  useEffect(() => {
    if (paymentTerms.length === 0) return;
    if (state.payment_term_id && paymentTerms.some((term) => term.id === state.payment_term_id)) {
      return;
    }
    const matched = findPaymentTerm(paymentTerms, state.payment_term_id, state.payment_terms);
    if (matched && matched.id !== state.payment_term_id) {
      setHeader('payment_term_id', matched.id);
      setHeader('payment_terms', matched.code);
    }
  }, [paymentTerms, state.payment_term_id, state.payment_terms, setHeader]);

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
  const showCarrier = requiresCarrierAccount(state.freight_terms);
  const { data: linkedSco } = useQuery({
    queryKey: ['po-linked-sco', state.sco_number],
    queryFn: () => subcontractOrderService.getSubcontractOrder(state.sco_number!),
    enabled: Boolean(state.sco_number) && (state.po_type || 'MATERIAL') === 'MATERIAL',
  });
  const linkedSubcontractor =
    linkedSco &&
    (suppliers.find((s) => s.supplier_id === linkedSco.supplier_id)?.company_name ||
      linkedSco.supplier_id);

  return (
    <div style={containerStyle}>
      <h3 style={sectionHeadingStyle}>PO Header Information</h3>
      <div style={gridStyle}>
        {/* PO Number */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="po_number">PO Number</label>
          <div style={readOnlyValueStyle}>
            {state.po_number || 'Assigned on save (PU62-YYMMXXXX)'}
          </div>
          {errors.po_number && <span style={errorTextStyle}>{errors.po_number}</span>}
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="po_type">PO Type *</label>
          {isReadOnly ? (
            <div style={readOnlyValueStyle}>
              {PO_TYPE_OPTIONS.find((opt) => opt.value === state.po_type)?.label || state.po_type || 'Material PO'}
            </div>
          ) : (
            <select
              id="po_type"
              value={state.po_type || 'MATERIAL'}
              onChange={(e) => setHeader('po_type', e.target.value)}
              style={inputStyle}
            >
              {PO_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {(state.po_type || 'MATERIAL') === 'MATERIAL' && (
          <div style={{ ...fieldGroupStyle, gridColumn: '1 / -1' }}>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={purchaseForSco}
                disabled={isReadOnly}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (!checked && state.sco_number) {
                    if (!confirmScoChange('')) return;
                    setHeader('sco_number', '');
                  }
                  setPurchaseForSco(checked);
                }}
              />
              Purchase for Subcontract Order (外發加工單)
            </label>
            {purchaseForSco && (
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle} htmlFor="material_sco_number">
                  Linked Subcontract Order
                </label>
                {isReadOnly ? (
                  <LinkedSubcontractOrderValue scoNumber={state.sco_number} />
                ) : (
                  <SubcontractOrderLookup
                    value={state.sco_number || ''}
                    onSelect={handleMaterialScoSelect}
                    error={Boolean(errors.sco_number)}
                  />
                )}
                {errors.sco_number && <span style={errorTextStyle}>{errors.sco_number}</span>}
                {state.sco_number && linkedSco && (
                  <div style={metaCardStyle}>
                    <div>
                      <span style={metaLabel}>Subcontractor</span>
                      <div>{linkedSubcontractor}</div>
                    </div>
                    <div>
                      <span style={metaLabel}>Target FG SKU</span>
                      <div>
                        {linkedSco.item_id}
                        {linkedSco.lines?.[0]?.item_id && linkedSco.lines.length > 1
                          ? ` (+${linkedSco.lines.length - 1} more)`
                          : ''}
                      </div>
                    </div>
                    <div>
                      <span style={metaLabel}>Target return date</span>
                      <div>{linkedSco.expected_return_date || '—'}</div>
                    </div>
                    <div>
                      <span style={metaLabel}>Status</span>
                      <div>{linkedSco.status}</div>
                    </div>
                  </div>
                )}
                <span style={{ fontSize: 12, color: 'var(--text)', marginTop: 6 }}>
                  Vendor on this PO is the material supplier, not the subcontractor.{' '}
                  <Link to="/subcontract-orders/new" style={{ color: 'var(--accent)' }}>
                    Create 外發加工單
                  </Link>
                </span>
              </div>
            )}
          </div>
        )}

        {state.po_type === 'SUBCONTRACT' && (
          <div style={fieldGroupStyle}>
            <label style={labelStyle} htmlFor="sco_number">Linked Subcontract Order (外發加工單)</label>
            {isReadOnly ? (
              <LinkedSubcontractOrderValue scoNumber={state.sco_number} />
            ) : (
              <select
                id="sco_number"
                value={state.sco_number || ''}
                onChange={(e) => handleScoSelect(e.target.value)}
                style={inputStyle}
              >
                <option value="">None — purchasing outside processing only</option>
                {state.sco_number &&
                !subcontractOrders.some((sco) => sco.sco_number === state.sco_number) ? (
                  <option value={state.sco_number}>{state.sco_number}</option>
                ) : null}
                {subcontractOrders.map((sco) => (
                  <option key={sco.sco_number} value={sco.sco_number}>
                    {sco.sco_number} — {sco.item_id} (qty {sco.quantity_ordered})
                  </option>
                ))}
              </select>
            )}
            <span style={{ fontSize: 12, color: 'var(--text)', marginTop: 6 }}>
              Material issue and FG receipt stay on the subcontract order.{' '}
              <Link to="/subcontract-orders/new" style={{ color: 'var(--accent)' }}>
                Create 外發加工單
              </Link>
            </span>
          </div>
        )}

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
            <div style={readOnlyValueStyle}>
              {paymentTerms.find((term) => term.id === state.payment_term_id)
                ? paymentTermLabel(paymentTerms.find((term) => term.id === state.payment_term_id)!)
                : state.payment_terms || 'N/A'}
            </div>
          ) : (
            <select
              id="payment_terms"
              value={state.payment_term_id || ''}
              onChange={(e) => {
                const selectedId = e.target.value;
                const term = paymentTerms.find((row) => row.id === selectedId);
                setHeader('payment_term_id', selectedId);
                setHeader('payment_terms', term?.code || '');
              }}
              style={inputStyle}
            >
              <option value="">Select payment terms</option>
              {paymentTerms.map((term) => (
                <option key={term.id} value={term.id}>
                  {paymentTermLabel(term)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="incoterms">Incoterms</label>
          {isReadOnly ? (
            <div style={readOnlyValueStyle}>{state.incoterms || '—'}</div>
          ) : (
            <select
              id="incoterms"
              value={state.incoterms || ''}
              onChange={(e) => setHeader('incoterms', e.target.value)}
              style={inputStyle}
            >
              <option value="">Select incoterms</option>
              {withCurrentOption(INCOTERM_OPTIONS, state.incoterms).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="freight_terms">Freight Payment Terms</label>
          {isReadOnly ? (
            <div style={readOnlyValueStyle}>
              {FREIGHT_PAYMENT_TERMS_OPTIONS.find((opt) => opt.value === state.freight_terms)?.label ||
                state.freight_terms ||
                'Prepaid by Vendor & Added to PO'}
            </div>
          ) : (
            <select
              id="freight_terms"
              value={state.freight_terms || 'PREPAID_ON_PO'}
              onChange={(e) => setHeader('freight_terms', e.target.value)}
              style={inputStyle}
            >
              {FREIGHT_PAYMENT_TERMS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
          <span style={{ fontSize: 12, color: 'var(--text)', marginTop: 6 }}>
            {FREIGHT_PAYMENT_TERMS_OPTIONS.find((opt) => opt.value === (state.freight_terms || 'PREPAID_ON_PO'))
              ?.hint}
          </span>
        </div>

        {showCarrier && (
          <div style={fieldGroupStyle}>
            <label style={labelStyle} htmlFor="carrier_account">Carrier / 3PL Account #</label>
            {isReadOnly ? (
              <div style={readOnlyValueStyle}>{state.carrier_account || '—'}</div>
            ) : (
              <input
                id="carrier_account"
                type="text"
                value={state.carrier_account || ''}
                onChange={(e) => setHeader('carrier_account', e.target.value)}
                placeholder="Account billed by the carrier / 3PL"
                style={{
                  ...inputStyle,
                  border: errors.carrier_account ? '1px solid #f44336' : '1px solid var(--border)',
                }}
              />
            )}
            {errors.carrier_account && <span style={errorTextStyle}>{errors.carrier_account}</span>}
          </div>
        )}

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
            {!isReadOnly &&
              !['APPROVED', 'PENDING_APPROVAL', 'SUBMITTED'].includes(
                String(state.approval_status || '').toUpperCase(),
              ) &&
              state.status !== 'Approved' &&
              state.status !== 'Submitted' && (
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

function LinkedSubcontractOrderValue({ scoNumber }: { scoNumber?: string | null }) {
  const value = (scoNumber || '').trim();
  if (!value) {
    return <div style={readOnlyValueStyle}>Not linked</div>;
  }
  return (
    <div style={readOnlyValueStyle}>
      <Link
        to={`/subcontract-orders/${encodeURIComponent(value)}`}
        style={scoLinkStyle}
        title={`Open subcontract order ${value}`}
      >
        {value}
      </Link>
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

const scoLinkStyle: React.CSSProperties = {
  color: 'var(--accent)',
  fontWeight: 600,
  textDecoration: 'underline',
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

const metaCardStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 12,
  marginTop: 10,
  padding: 12,
  borderRadius: 8,
  backgroundColor: 'var(--social-bg)',
  border: '1px solid var(--border)',
  fontSize: 13,
};

const metaLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text)',
  marginBottom: 2,
  fontWeight: 600,
};
