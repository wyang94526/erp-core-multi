import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FileDown, Loader2 } from 'lucide-react';
import { usePurchaseOrderState } from '../hooks/usePurchaseOrderState';
import { purchaseOrderService, vendorService, approvalService, itemService } from '../api/services';
import type { Supplier, PurchaseOrder, Item } from '../types';
import { generatePurchaseOrderVendorPdf } from '../utils/generatePurchaseOrderPdf';
import { POHeader } from './POHeader';
import { POLineItemsTable } from './POLineItemsTable';
import { POSummaryCard } from './POSummaryCard';
import { POActionToolbar } from './POActionToolbar';
import { ApprovalPanel } from './ApprovalPanel';

function toApiItems(items: PurchaseOrder['items']) {
  return items
    .filter((item) => item.sku && item.sku.trim() && item.quantity > 0)
    .map(({ sku, quantity, unit_price, tax_rate, line_subtotal, line_tax, line_total }) => ({
      sku,
      quantity,
      unit_price,
      tax_rate,
      line_subtotal,
      line_tax,
      line_total,
    }));
}

function buildPayload(state: PurchaseOrder, status: PurchaseOrder['status']) {
  return {
    po_number: state.po_number,
    supplier_id: state.supplier_id,
    order_date: state.order_date || undefined,
    expected_delivery_date: state.expected_delivery_date || null,
    payment_terms: state.payment_terms || null,
    status,
    shipping_fee: state.shipping_fee,
    discount_type: state.discount_type,
    discount_value: state.discount_value,
    subtotal: state.subtotal,
    total_tax: state.total_tax,
    discount_amount: state.discount_amount,
    grand_total: state.grand_total,
    notes: state.notes || null,
    items: toApiItems(state.items),
  };
}

function generateNewPONumber() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
  const randomHex = Math.floor(1000 + Math.random() * 9000);
  return `PO-${dateStr}-${randomHex}`;
}

export function PurchaseOrderForm() {
  const navigate = useNavigate();
  const { id: poNumberParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isNew = !poNumberParam;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Item[]>([]);
  const [isReadOnly, setIsReadOnly] = useState(!isNew && searchParams.get('edit') !== '1');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(!isNew);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [isExisting, setIsExisting] = useState(!isNew);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const {
    state,
    setHeader,
    addRow,
    updateRow,
    updateRowFields,
    deleteRow,
    clearAllRows,
    updateSummary,
    setFullPO,
    resetForm,
  } = usePurchaseOrderState(isNew ? generateNewPONumber() : '');

  const withSupplierName = (po: PurchaseOrder, sups: Supplier[]) => {
    const nameById = Object.fromEntries(sups.map((s) => [s.supplier_id, s.company_name]));
    return {
      ...po,
      supplier_name: nameById[po.supplier_id] || po.supplier_name || po.supplier_id,
    };
  };

  const loadReferenceData = async () => {
    const [sups, purchaseItems, allProds] = await Promise.all([
      vendorService.listVendors(),
      itemService.listPurchaseItems(0, 1000).catch(() => [] as Item[]),
      itemService.listItems(0, 1000),
    ]);
    setSuppliers(sups);
    setProducts(purchaseItems.length > 0 ? purchaseItems : allProds);
    return sups;
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        setIsLoading(true);
        setErrors({});
        const sups = await loadReferenceData();
        if (cancelled) return;

        if (isNew) {
          resetForm(generateNewPONumber());
          setIsExisting(false);
          setIsReadOnly(false);
          setSuccessMessage('');
          return;
        }

        const po = await purchaseOrderService.getPurchaseOrder(poNumberParam!);
        if (cancelled) return;
        setFullPO(withSupplierName(po, sups));
        setIsExisting(true);
        setIsReadOnly(searchParams.get('edit') !== '1');
        setSuccessMessage('');
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load purchase order', err);
        setErrors({
          form: err instanceof Error ? err.message : 'Failed to load purchase order',
        });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
    // Intentionally keyed to route identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poNumberParam, isNew]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!state.po_number || !state.po_number.trim()) {
      newErrors.po_number = 'PO Number is required';
    }
    if (!state.supplier_id) {
      newErrors.supplier_id = 'Supplier/Vendor selection is required';
    }
    if (!state.order_date) {
      newErrors.order_date = 'Order date is required';
    }
    if (!state.expected_delivery_date) {
      newErrors.expected_delivery_date = 'Expected delivery date is required';
    } else if (
      state.order_date &&
      new Date(state.order_date) > new Date(state.expected_delivery_date)
    ) {
      newErrors.expected_delivery_date = 'Expected delivery date must be on or after Order Date';
    }

    if (state.items.length === 0) {
      newErrors.lineItems = 'At least one line item is required';
    } else {
      let validItemCount = 0;
      state.items.forEach((item) => {
        const itemErrors: string[] = [];
        if (!item.sku || !item.sku.trim()) {
          newErrors[`sku_${item.id}`] = 'Item / SKU is required';
          itemErrors.push('sku');
        }
        if (item.quantity <= 0) {
          newErrors[`qty_${item.id}`] = 'Quantity must be greater than 0';
          itemErrors.push('qty');
        }
        if (item.unit_price < 0) {
          newErrors[`price_${item.id}`] = 'Unit price cannot be negative';
          itemErrors.push('price');
        }
        if (itemErrors.length === 0) {
          validItemCount++;
        }
      });
      if (validItemCount === 0) {
        newErrors.lineItems = 'At least one fully valid line item is required';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const hasValidationError = useMemo(() => Object.keys(errors).length > 0, [errors]);

  const persistPO = async (status: PurchaseOrder['status']) => {
    const payload = buildPayload(state as PurchaseOrder, status);
    if (payload.items.length === 0 && status !== 'Draft') {
      throw new Error('At least one valid line item is required');
    }
    if (payload.items.length === 0) {
      throw new Error('Add at least one line item with SKU and quantity before saving');
    }

    if (isExisting) {
      const { po_number: _, ...updateData } = payload;
      return purchaseOrderService.updatePurchaseOrder(state.po_number, updateData);
    }
    return purchaseOrderService.createPurchaseOrder(payload);
  };

  const handleSaveDraft = async () => {
    setIsSubmitting(true);
    setSuccessMessage('');

    const draftErrors: Record<string, string> = {};
    if (!state.po_number || !state.po_number.trim()) {
      draftErrors.po_number = 'PO Number is required';
    }
    if (!state.supplier_id) {
      draftErrors.supplier_id = 'Vendor selection is required';
    }
    if (Object.keys(draftErrors).length > 0) {
      setErrors(draftErrors);
      setIsSubmitting(false);
      return;
    }

    try {
      const saved = await persistPO('Draft');
      setFullPO(withSupplierName(saved, suppliers));
      setIsExisting(true);
      setErrors({});
      setSuccessMessage(`Draft purchase order ${saved.po_number} saved successfully!`);
      setIsReadOnly(true);
      if (isNew) {
        navigate(`/purchase-orders/${saved.po_number}`, { replace: true });
      }
    } catch (err) {
      console.error(err);
      setErrors({
        form: err instanceof Error ? err.message : 'An error occurred while saving Draft PO',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitPO = async () => {
    setIsSubmitting(true);
    setSuccessMessage('');

    if (!validateForm()) {
      setIsSubmitting(false);
      return;
    }

    try {
      const saved = await persistPO('Draft');
      setIsExisting(true);
      await approvalService.submit('purchase-orders', saved.po_number);
      const refreshed = await purchaseOrderService.getPurchaseOrder(saved.po_number);
      setFullPO(withSupplierName(refreshed, suppliers));
      setErrors({});
      setSuccessMessage(
        `Purchase order ${saved.po_number} submitted for approval successfully!`
      );
      setIsReadOnly(true);
      if (isNew) {
        navigate(`/purchase-orders/${saved.po_number}`, { replace: true });
      }
    } catch (err) {
      console.error(err);
      setErrors({
        form: err instanceof Error ? err.message : 'An error occurred while submitting PO',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForm = () => {
    if (!window.confirm('Are you sure you want to reset the form? All unsaved work will be lost.')) {
      return;
    }
    if (isNew) {
      resetForm(generateNewPONumber());
      setIsReadOnly(false);
      setIsExisting(false);
      setErrors({});
      setSuccessMessage('');
      return;
    }
    // Reload from server for existing POs
    void (async () => {
      try {
        const po = await purchaseOrderService.getPurchaseOrder(poNumberParam!);
        setFullPO(withSupplierName(po, suppliers));
        setIsReadOnly(false);
        setErrors({});
        setSuccessMessage('');
      } catch (err) {
        setErrors({
          form: err instanceof Error ? err.message : 'Failed to reload purchase order',
        });
      }
    })();
  };

  const handleToggleMode = () => {
    setIsReadOnly((prev) => !prev);
  };

  const handleApprovalChange = async () => {
    try {
      const refreshed = await purchaseOrderService.getPurchaseOrder(state.po_number);
      setFullPO(withSupplierName(refreshed, suppliers));
    } catch (err) {
      console.error(err);
    }
  };

  const isApproved =
    (state.approval_status || '').toUpperCase() === 'APPROVED' ||
    state.status === 'Approved';

  const handleExportVendorPdf = async () => {
    setExportError(null);
    setExportingPdf(true);
    try {
      let poForPdf = state;
      if (!(poForPdf.supplier_name || '').trim() && poForPdf.supplier_id) {
        try {
          const supplier = await vendorService.getVendor(poForPdf.supplier_id);
          poForPdf = {
            ...poForPdf,
            supplier_name: supplier.company_name,
          };
        } catch {
          // Keep ID-only supplier info if lookup fails.
        }
      }

      const itemDescriptions = Object.fromEntries(
        products
          .filter((p) => p.item_id)
          .map((p) => [p.item_id, p.description || p.customer_part_number || '']),
      );

      generatePurchaseOrderVendorPdf({
        po: poForPdf,
        itemDescriptions,
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export vendor PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={emptyStateWrapperStyle}>
          <p>Loading purchase order...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>
            {isNew ? 'Create Purchase Order' : 'Purchase Order Details'}
          </h2>
          <p style={pageSubStyle}>
            {isNew
              ? 'Enter vendor, line items, and notes, then save draft or submit for approval'
              : `Viewing ${state.po_number}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/purchase-orders')}
          style={secondaryButtonStyle}
        >
          ← Back to Purchase Orders
        </button>
      </header>

      {successMessage && (
        <div style={successAlertStyle}>
          <span>🟢 {successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}
          >
            ×
          </button>
        </div>
      )}

      {errors.lineItems && (
        <div style={errorAlertStyle}>
          <span>⚠️ {errors.lineItems}</span>
        </div>
      )}
      {errors.form && (
        <div style={errorAlertStyle}>
          <span>⚠️ {errors.form}</span>
          {!isNew && (
            <button
              type="button"
              onClick={() => navigate('/purchase-orders')}
              style={{ ...secondaryButtonStyle, marginLeft: '12px' }}
            >
              Back to list
            </button>
          )}
        </div>
      )}

      {!errors.form && (
        <>
          <POActionToolbar
            isReadOnly={isReadOnly}
            onToggleMode={handleToggleMode}
            onSaveDraft={handleSaveDraft}
            onSubmit={handleSubmitPO}
            onReset={handleResetForm}
            isSubmitting={isSubmitting}
            hasValidationError={hasValidationError}
          />

          {isExisting && (
            <ApprovalPanel
              module="purchase-orders"
              documentId={state.po_number}
              approvalStatus={state.approval_status}
              currentApprovalStep={state.current_approval_step}
              onStatusChange={handleApprovalChange}
            />
          )}

          {isExisting && isApproved && (
            <div style={exportBarStyle}>
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-h)', marginBottom: 4 }}>
                  Vendor purchase attachment
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)' }}>
                  Download a printable PDF for the approved purchase order.
                </div>
                {exportError && (
                  <div style={{ marginTop: 8, color: '#c62828', fontSize: 13 }} role="alert">
                    {exportError}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleExportVendorPdf}
                disabled={exportingPdf}
                style={{
                  ...exportButtonStyle,
                  opacity: exportingPdf ? 0.75 : 1,
                  cursor: exportingPdf ? 'not-allowed' : 'pointer',
                }}
              >
                {exportingPdf ? (
                  <>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    Preparing PDF…
                  </>
                ) : (
                  <>
                    <FileDown size={16} />
                    Export Vendor PDF
                  </>
                )}
              </button>
            </div>
          )}

          <div style={documentAreaStyle}>
            <div style={headerSummaryRowStyle}>
              <div style={headerColumnStyle}>
                <POHeader
                  state={state}
                  setHeader={setHeader}
                  isReadOnly={isReadOnly}
                  suppliers={suppliers}
                  errors={errors}
                />
              </div>
              <div style={summaryColumnStyle}>
                <POSummaryCard
                  state={state}
                  updateSummary={updateSummary}
                  isReadOnly={isReadOnly}
                />
              </div>
            </div>

            <POLineItemsTable
              items={state.items}
              products={products}
              updateRow={updateRow}
              updateRowFields={updateRowFields}
              deleteRow={deleteRow}
              addRow={addRow}
              clearAllRows={clearAllRows}
              isReadOnly={isReadOnly}
              errors={errors}
            />

            <div style={notesCardStyle}>
              <label style={notesLabelStyle} htmlFor="po_notes">
                Order Notes & Internal Comments
              </label>
              {isReadOnly ? (
                <div style={readOnlyNotesValueStyle}>{state.notes || 'No notes provided.'}</div>
              ) : (
                <textarea
                  id="po_notes"
                  value={state.notes || ''}
                  onChange={(e) => setHeader('notes', e.target.value)}
                  placeholder="Enter special instructions or notes to supplier here..."
                  style={textareaStyle}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
};

const pageHeaderStyle: React.CSSProperties = {
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
};

const pageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
};

const pageSubStyle: React.CSSProperties = {
  margin: '4px 0 0 0',
  fontSize: '14px',
  color: 'var(--text)',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-h)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontFamily: 'inherit',
};

const successAlertStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  backgroundColor: '#e8f5e9',
  color: '#2e7d32',
  padding: '12px 16px',
  borderRadius: '6px',
  marginBottom: '16px',
  border: '1px solid #c8e6c9',
};

const errorAlertStyle: React.CSSProperties = {
  backgroundColor: '#ffebee',
  color: '#c62828',
  padding: '12px 16px',
  borderRadius: '6px',
  marginBottom: '16px',
  border: '1px solid #ffcdd2',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const documentAreaStyle: React.CSSProperties = {
  marginTop: '16px',
};

const headerSummaryRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '20px',
  alignItems: 'stretch',
  flexWrap: 'wrap',
  marginBottom: '4px',
};

const headerColumnStyle: React.CSSProperties = {
  flex: '1 1 520px',
  minWidth: 0,
};

const summaryColumnStyle: React.CSSProperties = {
  flex: '0 1 320px',
  minWidth: '260px',
};

const notesCardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '16px 20px',
  marginTop: '16px',
  boxShadow: 'var(--shadow)',
};

const exportBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  padding: '16px 18px',
  marginBottom: 16,
  borderRadius: 10,
  border: '1px solid rgba(147, 51, 234, 0.28)',
  background:
    'linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(255,255,255,0.95) 55%)',
  boxShadow: 'var(--shadow)',
};

const exportButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '11px 18px',
  backgroundColor: '#9333ea',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

const notesLabelStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: '8px',
  color: 'var(--text-h)',
  fontSize: '13px',
};

const readOnlyNotesValueStyle: React.CSSProperties = {
  color: 'var(--text)',
  fontSize: '13px',
  whiteSpace: 'pre-wrap',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '80px',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontFamily: 'inherit',
  fontSize: '13px',
};

const emptyStateWrapperStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
};

export default PurchaseOrderForm;
