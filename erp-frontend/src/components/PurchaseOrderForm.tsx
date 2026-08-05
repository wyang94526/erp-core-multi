import React, { useState, useEffect, useMemo, useTransition } from 'react';
import { usePurchaseOrderState } from '../hooks/usePurchaseOrderState';
import { purchaseOrderService, vendorService, approvalService, itemService } from '../api/services';
import type { Supplier, PurchaseOrder, Item } from '../types';
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

export function PurchaseOrderForm() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Item[]>([]);
  const [savedPOs, setSavedPOs] = useState<PurchaseOrder[]>([]);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [isExisting, setIsExisting] = useState(false);
  const [, startTransition] = useTransition();

  const generateNewPONumber = () => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const randomHex = Math.floor(1000 + Math.random() * 9000);
    return `PO-${dateStr}-${randomHex}`;
  };

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
  } = usePurchaseOrderState(generateNewPONumber());

  const withSupplierNames = (pos: PurchaseOrder[], sups: Supplier[]) => {
    const nameById = Object.fromEntries(sups.map((s) => [s.supplier_id, s.company_name]));
    return pos.map((po) => ({
      ...po,
      supplier_name: nameById[po.supplier_id] || po.supplier_id,
    }));
  };

  const reloadData = async () => {
    try {
      const [sups, pos, purchaseItems, allProds] = await Promise.all([
        vendorService.listVendors(),
        purchaseOrderService.listPurchaseOrders(),
        itemService.listPurchaseItems(0, 1000).catch(() => [] as Item[]),
        itemService.listItems(0, 1000),
      ]);
      setSuppliers(sups);
      setSavedPOs(withSupplierNames(pos, sups));
      // Prefer purchase-flagged items; fall back to full catalog if none flagged yet
      setProducts(purchaseItems.length > 0 ? purchaseItems : allProds);
    } catch (err) {
      console.error('Failed to load PO initial data', err);
      setErrors({
        form: err instanceof Error ? err.message : 'Failed to load purchase orders',
      });
    }
  };

  useEffect(() => {
    reloadData();
  }, []);

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
    // Draft create still needs ≥1 item for backend schema
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
      setFullPO({
        ...saved,
        supplier_name:
          suppliers.find((s) => s.supplier_id === saved.supplier_id)?.company_name ||
          saved.supplier_id,
      });
      setIsExisting(true);
      setErrors({});
      setSuccessMessage(`Draft purchase order ${state.po_number} saved successfully!`);
      setIsReadOnly(true);
      await reloadData();
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
      // Persist first (Draft), then submit for approval workflow
      const saved = await persistPO('Draft');
      setIsExisting(true);
      await approvalService.submit('purchase-orders', saved.po_number);
      const refreshed = await purchaseOrderService.getPurchaseOrder(saved.po_number);
      setFullPO({
        ...refreshed,
        supplier_name:
          suppliers.find((s) => s.supplier_id === refreshed.supplier_id)?.company_name ||
          refreshed.supplier_id,
      });
      setErrors({});
      setSuccessMessage(
        `Purchase order ${state.po_number} submitted for approval successfully!`
      );
      setIsReadOnly(true);
      await reloadData();
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
    if (window.confirm('Are you sure you want to reset the form? All unsaved work will be lost.')) {
      resetForm(generateNewPONumber());
      setIsReadOnly(false);
      setIsExisting(false);
      setErrors({});
      setSuccessMessage('');
    }
  };

  const handleLoadPO = (po: PurchaseOrder) => {
    setFullPO(po);
    setIsExisting(true);
    setIsReadOnly(true);
    setErrors({});
    setSuccessMessage('');
  };

  const handleDeletePO = async (poNumber: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete purchase order ${poNumber}?`)) {
      try {
        await purchaseOrderService.deletePurchaseOrder(poNumber);
        if (state.po_number === poNumber) {
          resetForm(generateNewPONumber());
          setIsReadOnly(false);
          setIsExisting(false);
        }
        setSuccessMessage(`Purchase order ${poNumber} deleted successfully.`);
        await reloadData();
      } catch (err) {
        setErrors({
          form: err instanceof Error ? err.message : 'Failed to delete purchase order',
        });
      }
    }
  };

  const handleToggleMode = () => {
    setIsReadOnly((prev) => !prev);
  };

  const handleApprovalChange = async () => {
    try {
      const refreshed = await purchaseOrderService.getPurchaseOrder(state.po_number);
      setFullPO({
        ...refreshed,
        supplier_name:
          suppliers.find((s) => s.supplier_id === refreshed.supplier_id)?.company_name ||
          refreshed.supplier_id,
      });
      await reloadData();
    } catch (err) {
      console.error(err);
    }
  };

  const filteredPOs = useMemo(() => {
    return savedPOs.filter(
      (po) =>
        po.po_number.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (po.supplier_name && po.supplier_name.toLowerCase().includes(searchFilter.toLowerCase())) ||
        po.status.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (po.approval_status || '').toLowerCase().includes(searchFilter.toLowerCase())
    );
  }, [savedPOs, searchFilter]);

  const handleSearchFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    startTransition(() => {
      setSearchFilter(value);
    });
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Purchase Orders Management</h2>
          <p style={pageSubStyle}>Create, edit, validate and manage purchase orders with vendors</p>
        </div>
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
        </div>
      )}

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
            <POSummaryCard state={state} updateSummary={updateSummary} isReadOnly={isReadOnly} />
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

      <div style={dashboardSectionStyle}>
        <div style={dashboardHeaderStyle}>
          <h3 style={dashboardTitleStyle}>Purchase Orders Directory</h3>
          <div style={searchContainerStyle}>
            <input
              type="text"
              placeholder="Search by PO#, Supplier, Status..."
              defaultValue={searchFilter}
              onChange={handleSearchFilterChange}
              style={searchInputStyle}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={directoryTableStyle}>
            <thead>
              <tr style={directoryTheadRowStyle}>
                <th style={directoryThStyle}>PO Number</th>
                <th style={directoryThStyle}>Supplier / Vendor</th>
                <th style={directoryThStyle}>Order Date</th>
                <th style={directoryThStyle}>Expected Delivery Date</th>
                <th style={{ ...directoryThStyle, textAlign: 'right' }}>Total Amount</th>
                <th style={{ ...directoryThStyle, textAlign: 'center' }}>Status</th>
                <th style={{ ...directoryThStyle, textAlign: 'center' }}>Approval</th>
                <th style={{ ...directoryThStyle, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPOs.length > 0 ? (
                filteredPOs.map((po) => {
                  const isCurrent = state.po_number === po.po_number;
                  return (
                    <tr
                      key={po.po_number}
                      onClick={() => handleLoadPO(po)}
                      style={{
                        ...directoryTbodyRowStyle,
                        backgroundColor: isCurrent ? 'var(--accent-bg)' : 'transparent',
                        fontWeight: isCurrent ? 'bold' : 'normal',
                        borderLeft: isCurrent ? '4px solid var(--accent)' : 'none',
                      }}
                    >
                      <td style={directoryTdStyle}>{po.po_number}</td>
                      <td style={directoryTdStyle}>{po.supplier_name}</td>
                      <td style={directoryTdStyle}>{po.order_date}</td>
                      <td style={directoryTdStyle}>{po.expected_delivery_date}</td>
                      <td style={{ ...directoryTdStyle, textAlign: 'right' }}>
                        {formatCurrency(po.grand_total)}
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 'bold',
                            backgroundColor:
                              po.status === 'Approved'
                                ? '#e8f5e9'
                                : po.status === 'Submitted'
                                ? '#e3f2fd'
                                : po.status === 'Void'
                                ? '#ffebee'
                                : '#f5f5f5',
                            color:
                              po.status === 'Approved'
                                ? '#2e7d32'
                                : po.status === 'Submitted'
                                ? '#1565c0'
                                : po.status === 'Void'
                                ? '#c62828'
                                : '#616161',
                          }}
                        >
                          {po.status}
                        </span>
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        {(po.approval_status || 'DRAFT').replace(/_/g, ' ')}
                      </td>
                      <td style={{ ...directoryTdStyle, textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={(e) => handleDeletePO(po.po_number, e)}
                          style={directoryDeleteButtonStyle}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={directoryEmptyTdStyle}>
                    No saved purchase orders found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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

const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  marginTop: '28px',
  boxShadow: 'var(--shadow)',
};

const dashboardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
  gap: '12px',
  flexWrap: 'wrap',
};

const dashboardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 700,
  color: 'var(--text-h)',
};

const searchContainerStyle: React.CSSProperties = {
  minWidth: '220px',
};

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '13px',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const directoryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

const directoryTheadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: '#f5f5f5',
};

const directoryThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
};

const directoryTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid #eee',
  cursor: 'pointer',
  transition: 'background-color 0.15s',
};

const directoryTdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
};

const directoryEmptyTdStyle: React.CSSProperties = {
  padding: '24px',
  textAlign: 'center',
  color: 'var(--text)',
};

const directoryDeleteButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  fontFamily: 'inherit',
};

export default PurchaseOrderForm;
