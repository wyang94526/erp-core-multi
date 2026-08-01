import React, { useState, useEffect, useMemo, useTransition } from 'react';
import { usePurchaseOrderState } from '../hooks/usePurchaseOrderState';
import { mockPoService } from '../api/mockPoService';
import type { Supplier, PurchaseOrder } from '../types';
import { POHeader } from './POHeader';
import { POLineItemsTable } from './POLineItemsTable';
import { POSummaryCard } from './POSummaryCard';
import { POActionToolbar } from './POActionToolbar';

export function PurchaseOrderForm() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [savedPOs, setSavedPOs] = useState<PurchaseOrder[]>([]);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [, startTransition] = useTransition();

  // Helper to generate a new PO Number
  const generateNewPONumber = () => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const randomHex = Math.floor(1000 + Math.random() * 9000);
    return `PO-${dateStr}-${randomHex}`;
  };

  // Instantiate our centralized state management hook
  const {
    state,
    setHeader,
    addRow,
    updateRow,
    deleteRow,
    clearAllRows,
    updateSummary,
    setFullPO,
    resetForm,
  } = usePurchaseOrderState(generateNewPONumber());

  // Load initial suppliers and saved POs
  const reloadData = async () => {
    try {
      const sups = await mockPoService.getSuppliers();
      setSuppliers(sups);
      const pos = await mockPoService.getPurchaseOrders();
      setSavedPOs(pos);
    } catch (err) {
      console.error('Failed to load PO initial data', err);
    }
  };

  useEffect(() => {
    reloadData();
  }, []);

  // Form Validation logic
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // 1. PO Number must be non-empty
    if (!state.po_number || !state.po_number.trim()) {
      newErrors.po_number = 'PO Number is required';
    }

    // 2. Vendor must be selected
    if (!state.supplier_id) {
      newErrors.supplier_id = 'Supplier/Vendor selection is required';
    }

    // 3. Date check
    if (!state.order_date) {
      newErrors.order_date = 'Order date is required';
    }
    if (!state.expected_delivery_date) {
      newErrors.expected_delivery_date = 'Expected delivery date is required';
    } else if (state.order_date && new Date(state.order_date) > new Date(state.expected_delivery_date)) {
      newErrors.expected_delivery_date = 'Expected delivery date must be on or after Order Date';
    }

    // 4. Line items validation (At least one valid line item)
    if (state.items.length === 0) {
      newErrors.lineItems = 'At least one line item is required';
    } else {
      let validItemCount = 0;
      state.items.forEach((item) => {
        const itemErrors: string[] = [];
        if (!item.sku || !item.sku.trim()) {
          newErrors[`sku_${item.id}`] = 'SKU / description is required';
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

  // Track if we currently have live validation errors
  const hasValidationError = useMemo(() => {
    return Object.keys(errors).length > 0;
  }, [errors]);

  // Actions
  const handleSaveDraft = async () => {
    setIsSubmitting(true);
    setSuccessMessage('');

    // Pre-validate minimal requirements for a draft: PO number and Vendor
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
      const updatedPo: PurchaseOrder = {
        ...state,
        status: 'Draft',
      };
      await mockPoService.savePurchaseOrder(updatedPo);
      setErrors({});
      setSuccessMessage(`Draft purchase order ${state.po_number} saved successfully!`);
      setIsReadOnly(true);
      await reloadData();
    } catch (err) {
      console.error(err);
      setErrors({ form: 'An error occurred while saving Draft PO' });
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
      const updatedPo: PurchaseOrder = {
        ...state,
        status: 'Submitted',
      };
      await mockPoService.savePurchaseOrder(updatedPo);
      setErrors({});
      setSuccessMessage(`Purchase order ${state.po_number} has been submitted successfully!`);
      setIsReadOnly(true);
      await reloadData();
    } catch (err) {
      console.error(err);
      setErrors({ form: 'An error occurred while submitting PO' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForm = () => {
    if (window.confirm('Are you sure you want to reset the form? All unsaved work will be lost.')) {
      resetForm(generateNewPONumber());
      setIsReadOnly(false);
      setErrors({});
      setSuccessMessage('');
    }
  };

  const handleLoadPO = (po: PurchaseOrder) => {
    setFullPO(po);
    setIsReadOnly(true);
    setErrors({});
    setSuccessMessage('');
  };

  const handleDeletePO = async (poNumber: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete purchase order ${poNumber}?`)) {
      await mockPoService.deletePurchaseOrder(poNumber);
      if (state.po_number === poNumber) {
        resetForm(generateNewPONumber());
        setIsReadOnly(false);
      }
      setSuccessMessage(`Purchase order ${poNumber} deleted successfully.`);
      await reloadData();
    }
  };

  const handleToggleMode = () => {
    setIsReadOnly((prev) => !prev);
  };

  const filteredPOs = useMemo(() => {
    return savedPOs.filter(
      (po) =>
        po.po_number.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (po.supplier_name && po.supplier_name.toLowerCase().includes(searchFilter.toLowerCase())) ||
        po.status.toLowerCase().includes(searchFilter.toLowerCase())
    );
  }, [savedPOs, searchFilter]);

  const handleSearchFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    startTransition(() => {
      setSearchFilter(value);
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  return (
    <div style={containerStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={pageTitleStyle}>Purchase Orders Management</h2>
          <p style={pageSubStyle}>Create, edit, validate and manage purchase orders with vendors</p>
        </div>
      </header>

      {/* Success Notification Bar */}
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

      {/* Main Form validation summary errors */}
      {errors.lineItems && (
        <div style={errorAlertStyle}>
          <span>⚠️ {errors.lineItems}</span>
        </div>
      )}

      {/* Action Toolbar */}
      <POActionToolbar
        isReadOnly={isReadOnly}
        onToggleMode={handleToggleMode}
        onSaveDraft={handleSaveDraft}
        onSubmit={handleSubmitPO}
        onReset={handleResetForm}
        isSubmitting={isSubmitting}
        hasValidationError={hasValidationError}
      />

      <div style={workspaceLayoutstyle}>
        {/* Main Document Area */}
        <div style={documentAreaStyle}>
          {/* Header Card */}
          <POHeader
            state={state}
            setHeader={setHeader}
            isReadOnly={isReadOnly}
            suppliers={suppliers}
            errors={errors}
          />

          {/* Line Items Table */}
          <POLineItemsTable
            items={state.items}
            updateRow={updateRow}
            deleteRow={deleteRow}
            addRow={addRow}
            clearAllRows={clearAllRows}
            isReadOnly={isReadOnly}
            errors={errors}
          />

          {/* Notes Section */}
          <div style={notesCardStyle}>
            <label style={notesLabelStyle} htmlFor="po_notes">Order Notes & Internal Comments</label>
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

        {/* Sidebar Summary Area */}
        <div style={sidebarAreaStyle}>
          <POSummaryCard
            state={state}
            updateSummary={updateSummary}
            isReadOnly={isReadOnly}
          />
        </div>
      </div>

      {/* Dashboard: Saved POs Table list */}
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
                  <td colSpan={7} style={directoryEmptyTdStyle}>
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

// Styling definitions
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
  backgroundColor: '#e8f5e9',
  color: '#2e7d32',
  border: '1px solid #c8e6c9',
  borderRadius: '6px',
  padding: '12px 20px',
  marginBottom: '20px',
  fontSize: '14px',
  fontWeight: 'bold',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const errorAlertStyle: React.CSSProperties = {
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: '6px',
  padding: '12px 20px',
  marginBottom: '20px',
  fontSize: '14px',
  fontWeight: 'bold',
};

const workspaceLayoutstyle: React.CSSProperties = {
  display: 'flex',
  gap: '24px',
  flexWrap: 'wrap',
  marginBottom: '40px',
};

const documentAreaStyle: React.CSSProperties = {
  flex: '3 1 650px',
  display: 'flex',
  flexDirection: 'column',
};

const sidebarAreaStyle: React.CSSProperties = {
  flex: '1 1 300px',
};

const notesCardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: 'var(--shadow)',
};

const notesLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
  marginBottom: '8px',
  display: 'block',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '100px',
  padding: '12px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '13px',
  color: 'var(--text-h)',
  backgroundColor: 'var(--bg)',
  fontFamily: 'inherit',
  outline: 'none',
  resize: 'vertical',
  boxSizing: 'border-box',
};

const readOnlyNotesValueStyle: React.CSSProperties = {
  padding: '12px',
  borderRadius: '6px',
  backgroundColor: 'var(--social-bg)',
  border: '1px solid var(--border)',
  fontSize: '13px',
  color: 'var(--text)',
  minHeight: '100px',
  boxSizing: 'border-box',
  whiteSpace: 'pre-wrap',
};

// Dashboard/Directory Styles
const dashboardSectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '24px',
  boxShadow: 'var(--shadow)',
  marginTop: '20px',
};

const dashboardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
  flexWrap: 'wrap',
  gap: '12px',
};

const dashboardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'var(--text-h)',
};

const searchContainerStyle: React.CSSProperties = {
  display: 'flex',
  width: '300px',
};

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  fontSize: '13px',
  color: 'var(--text-h)',
  backgroundColor: 'var(--bg)',
  outline: 'none',
  fontFamily: 'inherit',
};

const directoryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

const directoryTheadRowStyle: React.CSSProperties = {
  borderBottom: '2px solid var(--border)',
  backgroundColor: 'var(--social-bg)',
};

const directoryThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
};

const directoryTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
  cursor: 'pointer',
  transition: 'background-color 0.2s',
};

const directoryTdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
};

const directoryDeleteButtonStyle: React.CSSProperties = {
  padding: '4px 8px',
  backgroundColor: '#ffebee',
  color: '#c62828',
  border: '1px solid #ffcdd2',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '11px',
  fontWeight: 'bold',
  transition: 'background-color 0.2s',
};

const directoryEmptyTdStyle: React.CSSProperties = {
  padding: '30px',
  textAlign: 'center',
  color: '#666',
  fontStyle: 'italic',
};

export default PurchaseOrderForm;
