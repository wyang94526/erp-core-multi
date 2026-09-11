import React from 'react';
import type { POFormState } from '../hooks/usePurchaseOrderState';
import { includesVendorFreight } from '../data/orderOptions';

interface POSummaryCardProps {
  state: POFormState;
  updateSummary: (field: 'shipping_fee' | 'discount_type' | 'discount_value', value: any) => void;
  isReadOnly: boolean;
}

export function POSummaryCard({ state, updateSummary, isReadOnly }: POSummaryCardProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const vendorFreight = includesVendorFreight(state.freight_terms);
  const shippingLabel = vendorFreight ? 'Shipping & Handling:' : 'Estimated 3rd-Party Freight:';

  return (
    <div style={containerStyle}>
      <h3 style={sectionHeadingStyle}>Order Summary</h3>

      <div style={totalsListStyle}>
        <div style={rowStyle}>
          <span style={labelStyle}>Line Subtotal (Excl. Tax):</span>
          <span style={valueStyle}>{formatCurrency(state.subtotal)}</span>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Total Tax:</span>
          <span style={valueStyle}>{formatCurrency(state.total_tax)}</span>
        </div>

        <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
          <span style={labelStyle}>{shippingLabel}</span>
          {isReadOnly ? (
            <span style={valueStyle}>{formatCurrency(state.shipping_fee)}</span>
          ) : (
            <div style={inputContainerStyle}>
              <span style={prefixStyle}>$</span>
              <input
                type="number"
                aria-label={vendorFreight ? 'Shipping & Handling Fee' : 'Estimated 3rd-Party Freight'}
                min="0"
                step="0.01"
                value={state.shipping_fee === 0 ? '' : state.shipping_fee}
                onChange={(e) => updateSummary('shipping_fee', e.target.value)}
                placeholder="0.00"
                style={numberInputStyle}
              />
            </div>
          )}
        </div>
        {vendorFreight ? (
          <div style={hintStyle}>Billed by this vendor on their invoice.</div>
        ) : (
          <div style={badgeStyle}>
            Paid directly to 3PL / Carrier — Excluded from Vendor Invoice Total
          </div>
        )}

        <div style={rowStyle}>
          <span style={labelStyle}>Discount Option:</span>
          {isReadOnly ? (
            <span style={valueStyle}>
              {state.discount_value > 0
                ? state.discount_type === 'percentage'
                  ? `${state.discount_value}%`
                  : formatCurrency(state.discount_value)
                : 'None'}
            </span>
          ) : (
            <div style={discountControlsStyle}>
              <select
                aria-label="Discount Type"
                value={state.discount_type}
                onChange={(e) => updateSummary('discount_type', e.target.value)}
                style={selectStyle}
              >
                <option value="percentage">Percent (%)</option>
                <option value="fixed">Fixed ($)</option>
              </select>
              <input
                type="number"
                aria-label="Discount Value"
                min="0"
                step="any"
                value={state.discount_value === 0 ? '' : state.discount_value}
                onChange={(e) => updateSummary('discount_value', e.target.value)}
                placeholder="0"
                style={{ ...numberInputStyle, width: '80px' }}
              />
            </div>
          )}
        </div>

        {state.discount_amount > 0 && (
          <div style={{ ...rowStyle, color: '#2e7d32' }}>
            <span style={{ ...labelStyle, color: '#2e7d32' }}>Discount Saved:</span>
            <span style={{ fontWeight: 'bold' }}>-{formatCurrency(state.discount_amount)}</span>
          </div>
        )}

        <div style={grandTotalRowStyle}>
          <span>{vendorFreight ? 'Grand Total:' : 'Vendor Invoice Total:'}</span>
          <span style={grandTotalValueStyle}>{formatCurrency(state.grand_total)}</span>
        </div>
      </div>
    </div>
  );
}

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

const totalsListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '14px',
  color: 'var(--text)',
};

const labelStyle: React.CSSProperties = {
  fontWeight: '500',
};

const valueStyle: React.CSSProperties = {
  color: 'var(--text-h)',
  fontWeight: '600',
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text)',
  marginTop: -6,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#e65100',
  background: '#fff3e0',
  border: '1px solid #ffe0b2',
  borderRadius: 6,
  padding: '6px 8px',
  marginTop: -4,
};

const inputContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '4px 8px',
  backgroundColor: 'var(--bg)',
};

const prefixStyle: React.CSSProperties = {
  marginRight: '4px',
  color: 'var(--text)',
  fontSize: '13px',
};

const numberInputStyle: React.CSSProperties = {
  border: 'none',
  outline: 'none',
  textAlign: 'right',
  width: '100px',
  fontSize: '13px',
  color: 'var(--text-h)',
  backgroundColor: 'transparent',
  fontFamily: 'inherit',
};

const discountControlsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
};

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  fontSize: '12px',
  color: 'var(--text-h)',
  backgroundColor: 'var(--bg)',
  fontFamily: 'inherit',
};

const grandTotalRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  borderTop: '2px solid var(--border)',
  paddingTop: '16px',
  marginTop: '8px',
};

const grandTotalValueStyle: React.CSSProperties = {
  fontSize: '22px',
  color: 'var(--accent)',
};
