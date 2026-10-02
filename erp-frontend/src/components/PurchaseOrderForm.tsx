/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, FileDown, Loader2, Mail, PackageCheck, Receipt, RotateCcw } from 'lucide-react';
import { usePurchaseOrderState } from '../hooks/usePurchaseOrderState';
import { purchaseOrderService, vendorService, approvalService, itemService, subcontractOrderService, goodsReceiptService, vendorInvoiceService } from '../api/services';
import type { Supplier, PurchaseOrder, Item, SubcontractOrder, GoodsReceipt, SupplierInvoice } from '../types';
import { generatePurchaseOrderVendorPdf } from '../utils/generatePurchaseOrderPdf';
import { loadCompanyPdfBranding } from '../utils/pdfLetterhead';
import { requiresCarrierAccount } from '../data/orderOptions';
import { isNonStockItem } from '../utils/itemTypes'
import { isRecallablePurchaseOrder, isPurchaseOrderEditable, purchaseOrderLockReason } from '../utils/poWorkflow'
import {
  canCreatePoBill,
  canReceivePoGoods,
  canShowPoCloseRemaining,
  closeRemainingBlockedReason,
  createBillBlockedReason,
  remainingReceiveQty,
  receiveGoodsBlockedReason,
} from '../utils/poP2p'
import { DocumentAttachmentsPanel } from './DocumentAttachmentsPanel';
import { POHeader } from './POHeader';
import { POLineItemsTable } from './POLineItemsTable';
import { POSummaryCard } from './POSummaryCard';
import { POActionToolbar } from './POActionToolbar';
import { ApprovalPanel } from './ApprovalPanel';
import { DocumentRevisionPanel } from './DocumentRevisionPanel';
import { GoodsReceiptHistoryTable } from './GoodsReceiptHistoryTable';
import { ReceivePurchaseOrderDialog } from './ReceivePurchaseOrderDialog';
import { billDetailHref } from '../utils/cashReference';
import {
  HoverTip,
  actionRowStyle,
  badgeStyle,
  dangerButtonStyle,
  disabledActionStyle,
  documentPageHeaderStyle,
  documentPageSubStyle,
  documentPageTitleBlockStyle,
  documentPageTitleStyle,
  headerActionsStyle,
  headerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../utils/documentPageStyles';
import { useAuth } from '../context/AuthContext';

const money = (n: number | null | undefined, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n) || 0);

function poStatusColors(status: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    Draft: { bg: '#f5f5f5', text: '#616161' },
    DRAFT: { bg: '#f5f5f5', text: '#616161' },
    Submitted: { bg: '#fff3e0', text: '#e65100' },
    PENDING_APPROVAL: { bg: '#fff3e0', text: '#e65100' },
    Approved: { bg: '#e8f5e9', text: '#2e7d32' },
    APPROVED: { bg: '#e3f2fd', text: '#1565c0' },
    REJECTED: { bg: '#ffebee', text: '#c62828' },
    Void: { bg: '#ffebee', text: '#c62828' },
    CANCELLED: { bg: '#ffebee', text: '#c62828' },
  };
  return map[status] || { bg: '#f5f5f5', text: '#616161' };
}

function roundTo(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function toApiItems(items: PurchaseOrder['items']) {
  return items
    .filter((item) => {
      if (!item.sku || !item.sku.trim()) return false
      if (item.quantity > 0) return true
      return Number(item.line_subtotal) > 0 || Number(item.unit_price) > 0
    })
    .map(({ sku, description, uom, bom_header_id, sco_component_id, quantity, unit_price, tax_rate, line_subtotal, line_tax, line_total }) => ({
      sku,
      description: description ? String(description).slice(0, 255) : null,
      uom: uom ? String(uom).slice(0, 20) : null,
      bom_header_id: bom_header_id || null,
      sco_component_id: sco_component_id || null,
      quantity: roundTo(quantity, 4),
      unit_price: roundTo(unit_price, 4),
      tax_rate: roundTo(tax_rate, 3),
      line_subtotal: roundTo(Number(line_subtotal) > 0 ? line_subtotal : unit_price, 2),
      line_tax: roundTo(line_tax, 2),
      line_total: roundTo(line_total, 2),
    }));
}

function buildPayload(state: PurchaseOrder, status: PurchaseOrder['status']) {
  return {
    po_number: state.po_number || undefined,
    supplier_id: state.supplier_id,
    po_type: state.po_type || 'MATERIAL',
    bom_header_id: state.bom_header_id || null,
    sco_number: state.sco_number || null,
    order_date: state.order_date || undefined,
    expected_delivery_date: state.expected_delivery_date || null,
    payment_terms: state.payment_terms || 'NET30',
    payment_term_id: state.payment_term_id || null,
    status,
    shipping_fee: state.shipping_fee,
    discount_type: state.discount_type,
    discount_value: state.discount_value,
    incoterms: state.incoterms || null,
    freight_terms: state.freight_terms || 'PREPAID_ON_PO',
    carrier_account: state.carrier_account || null,
    subtotal: state.subtotal,
    total_tax: state.total_tax,
    discount_amount: state.discount_amount,
    grand_total: state.grand_total,
    notes: state.notes || null,
    items: toApiItems(state.items),
  };
}

export function PurchaseOrderForm() {
  const navigate = useNavigate();
  const { id: poNumberParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isNew = !poNumberParam;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Item[]>([]);
  const [subcontractOrders, setSubcontractOrders] = useState<SubcontractOrder[]>([]);
  const [isReadOnly, setIsReadOnly] = useState(!isNew && searchParams.get('edit') !== '1');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(!isNew);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [isExisting, setIsExisting] = useState(!isNew);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [receivingGoods, setReceivingGoods] = useState(false);
  const [closingRemaining, setClosingRemaining] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [p2pError, setP2pError] = useState<string | null>(null);
  const [recalling, setRecalling] = useState(false);
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [supplierInvoices, setSupplierInvoices] = useState<SupplierInvoice[]>([]);
  const { hasAnyPermission } = useAuth();
  const queryClient = useQueryClient();

  const {
    state,
    setHeader: setHeaderField,
    addRow,
    updateRow,
    updateRowFields,
    deleteRow,
    clearAllRows,
    mergeImportedRows,
    clearImportedRows,
    updateSummary,
    setFullPO,
    resetForm,
  } = usePurchaseOrderState('');

  const setHeader = (field: string, value: unknown) => {
    setHeaderField(field, value);
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const withSupplierName = (po: PurchaseOrder, sups: Supplier[]) => {
    const nameById = Object.fromEntries(sups.map((s) => [s.supplier_id, s.company_name]));
    return {
      ...po,
      supplier_name: nameById[po.supplier_id] || po.supplier_name || po.supplier_id,
    };
  };

  const loadCatalog = async (poType: 'MATERIAL' | 'SUBCONTRACT' = 'MATERIAL') => {
    if (poType === 'SUBCONTRACT') {
      const assemblies = await itemService.listItems(0, 1000, { catalog: 'assembly' }).catch(() => [] as Item[]);
      if (assemblies.length > 0) return assemblies;
    }
    const purchaseItems = await itemService.listPurchaseItems(0, 1000).catch(() => [] as Item[]);
    if (purchaseItems.length > 0) return purchaseItems;
    return itemService.listItems(0, 1000);
  };

  const loadReferenceData = async () => {
    const sups = await vendorService.listVendors();
    setSuppliers(sups);
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
        const materialCatalog = await loadCatalog('MATERIAL');
        if (!cancelled) setProducts(materialCatalog);

        if (isNew) {
          resetForm('');
          setIsExisting(false);
          setIsReadOnly(false);
          setSuccessMessage('');
          return;
        }

        const po = await purchaseOrderService.getPurchaseOrder(poNumberParam!);
        if (cancelled) return;
        const poCatalog = await loadCatalog(po.po_type || 'MATERIAL');
        if (!cancelled) setProducts(poCatalog);
        setFullPO(withSupplierName(po, sups));
        setIsExisting(true);
        setIsReadOnly(searchParams.get('edit') !== '1' || !isPurchaseOrderEditable(po));
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

  useEffect(() => {
    let cancelled = false;
    const poType = state.po_type || 'MATERIAL';
    void loadCatalog(poType).then((catalog) => {
      if (!cancelled) setProducts(catalog);
    });
    return () => {
      cancelled = true;
    };
  }, [state.po_type]);

  useEffect(() => {
    if (isExisting && !isPurchaseOrderEditable(state)) {
      setIsReadOnly(true);
    }
  }, [
    isExisting,
    state.status,
    state.approval_status,
    state.has_posted_receipts,
    state.has_supplier_invoices,
  ]);

  useEffect(() => {
    if ((state.po_type || 'MATERIAL') !== 'SUBCONTRACT') return;
    if (subcontractOrders.length > 0) return;
    let cancelled = false;
    void subcontractOrderService
      .listSubcontractOrders(0, 200)
      .then((rows) => {
        if (!cancelled) setSubcontractOrders(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.po_type, subcontractOrders.length]);

  useEffect(() => {
    if (!isExisting || !state.po_number) {
      setReceipts([]);
      return;
    }
    let cancelled = false;
    void goodsReceiptService
      .list({ source_type: 'PURCHASE_ORDER', source_order_id: state.po_number })
      .then((rows) => {
        if (!cancelled) setReceipts(rows);
      })
      .catch(() => {
        if (!cancelled) setReceipts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isExisting, state.po_number, state.has_posted_receipts, successMessage]);

  useEffect(() => {
    if (!isExisting || !state.po_number) {
      setSupplierInvoices([]);
      return;
    }
    let cancelled = false;
    void vendorInvoiceService
      .list({ source_type: 'PURCHASE_ORDER', source_order_id: state.po_number, limit: 100 })
      .then((rows) => {
        if (!cancelled) setSupplierInvoices(rows);
      })
      .catch(() => {
        if (!cancelled) setSupplierInvoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isExisting, state.po_number, state.has_supplier_invoices, state.billing_status, successMessage]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (isExisting && (!state.po_number || !state.po_number.trim())) {
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

    if (requiresCarrierAccount(state.freight_terms) && !(state.carrier_account || '').trim()) {
      newErrors.carrier_account = 'Carrier / 3PL account is required for 3rd-party or routing freight';
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
        const itemType = item.item_type || products.find((p) => p.item_id === item.sku)?.item_type
        if (item.quantity <= 0) {
          if (!isNonStockItem(itemType, item.sku)) {
            newErrors[`qty_${item.id}`] = 'Quantity must be greater than 0'
            itemErrors.push('qty')
          } else if (Number(item.line_subtotal) <= 0 && Number(item.unit_price) <= 0) {
            newErrors[`amount_${item.id}`] = 'Enter an amount for this non-inventory line'
            itemErrors.push('amount')
          }
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

  const persistPO = async (status: PurchaseOrder['status']) => {
    if (isExisting && !isPurchaseOrderEditable(state)) {
      throw new Error(
        purchaseOrderLockReason(state) ||
          'Approved purchase orders cannot be modified directly. Use Create Revision.',
      );
    }
    const payload = buildPayload(state as PurchaseOrder, status);
    if (payload.items.length === 0 && status !== 'Draft') {
      throw new Error('At least one valid line item is required');
    }
    if (payload.items.length === 0) {
      throw new Error('Add at least one line item with SKU before saving');
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
      await approvalService.submit('purchase-orders', saved.po_number);
      const refreshed = await purchaseOrderService.getPurchaseOrder(saved.po_number);
      setFullPO(withSupplierName(refreshed, suppliers));
      setIsExisting(true);
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
      resetForm('');
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
        setIsReadOnly(!isPurchaseOrderEditable(po));
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
    if (isExisting && !isPurchaseOrderEditable(state)) return;
    setIsReadOnly((prev) => !prev);
  };

  const handleApprovalChange = async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders', state.po_number, 'revisions'] })
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders', state.po_number, 'change-logs'] })
      const refreshed = await purchaseOrderService.getPurchaseOrder(state.po_number);
      setFullPO(withSupplierName(refreshed, suppliers));
      const next = (refreshed.approval_status || '').toUpperCase();
      if (next === 'DRAFT' || next === 'REJECTED') {
        setIsReadOnly(false);
      } else {
        setIsReadOnly(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const isApproved =
    (state.approval_status || '').toUpperCase() === 'APPROVED' ||
    state.status === 'Approved';
  const editLockedReason = isExisting ? purchaseOrderLockReason(state) : null;
  const editLocked = Boolean(editLockedReason);
  const fieldsReadOnly = isReadOnly || editLocked;
  const isRecallableStatus = isExisting && isRecallablePurchaseOrder(state.status, state.approval_status);
  const canRecallAction =
    Boolean(state.can_recall) &&
    hasAnyPermission(['po:submit_for_approval', 'po:approve']);
  const recallDisabledReason =
    state.recall_blocked_reason ||
    (isRecallableStatus && !hasAnyPermission(['po:submit_for_approval', 'po:approve'])
      ? 'You need po:submit_for_approval or po:approve to recall this purchase order'
      : null);

  const handleRecallPO = async () => {
    if (!state.po_number) return;
    if (
      !window.confirm(
        'Create a revision of this purchase order? The PO number stays the same. The current approved state is frozen, then you can edit and re-submit. Receive Goods and Create Bill stay blocked until it is approved again.',
      )
    ) {
      return;
    }
    setRecalling(true);
    setErrors({});
    setP2pError(null);
    try {
      const updated = await purchaseOrderService.revisePurchaseOrder(state.po_number);
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders', state.po_number, 'revisions'] })
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders', state.po_number, 'change-logs'] })
      setFullPO(withSupplierName(updated, suppliers));
      setIsReadOnly(false);
      setSuccessMessage(`Purchase order ${updated.po_number} reopened as Draft for revision ${updated.revision_number || ''}.`.trim());
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'Failed to create purchase order revision',
      });
    } finally {
      setRecalling(false);
    }
  };

  const handleExportVendorPdf = async () => {
    setExportError(null);
    setExportingPdf(true);
    try {
      let poForPdf = state;
      let vendorForPdf: Supplier | null = null;
      if (poForPdf.supplier_id) {
        try {
          vendorForPdf = await vendorService.getVendor(poForPdf.supplier_id);
          if (!(poForPdf.supplier_name || '').trim() && vendorForPdf) {
            poForPdf = {
              ...poForPdf,
              supplier_name: vendorForPdf.company_name,
            };
          }
        } catch {
          // Keep ID-only supplier info if lookup fails.
        }
      }

      const itemDescriptions = Object.fromEntries(
        products
          .filter((p) => p.item_id)
          .map((p) => [p.item_id, p.description || p.customer_part_number || '']),
      );
      const branding = await loadCompanyPdfBranding().catch(() => null);

      generatePurchaseOrderVendorPdf({
        po: poForPdf,
        itemDescriptions,
        vendor: vendorForPdf,
        branding,
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export vendor PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleEmailVendor = async () => {
    const listed = suppliers.find((s) => s.supplier_id === state.supplier_id);
    let email = (listed?.contact_email || '').trim();
    if (!email && state.supplier_id) {
      try {
        const vendor = await vendorService.getVendor(state.supplier_id);
        email = (vendor.contact_email || '').trim();
      } catch {
        email = '';
      }
    }
    if (!email) {
      setExportError('No vendor email on file. Add a contact email on the vendor.');
      return;
    }
    await handleExportVendorPdf();
    const subject = encodeURIComponent(`Purchase order ${state.po_number} from Grand-Tek Technology USA`);
    const body = encodeURIComponent(
      [
        `Please find purchase order ${state.po_number} for ${money(state.grand_total)}.`,
        '',
        'The purchase order PDF was downloaded so you can attach it to this email.',
      ].join('\n'),
    );
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
  };

  const handleCloseRemaining = async () => {
    if (!state.po_number) return
    if (
      !window.confirm(
        `Cancel the remaining unreceived quantity on ${state.po_number}? Further receipts will be closed.`,
      )
    ) {
      return
    }
    setClosingRemaining(true)
    setP2pError(null)
    try {
      const refreshed = await purchaseOrderService.closeRemaining(state.po_number)
      setFullPO(withSupplierName(refreshed, suppliers))
      setSuccessMessage('Remaining quantity cancelled. This purchase order is closed for further receipts.')
    } catch (err) {
      setP2pError(err instanceof Error ? err.message : 'Failed to cancel remaining quantity')
    } finally {
      setClosingRemaining(false)
    }
  }

  const handleOpenReceive = () => {
    if (!state.po_number || !state.items.length) return
    if (!canReceivePoGoods(state)) {
      setP2pError(receiveGoodsBlockedReason(state) || 'Nothing remaining to receive.')
      return
    }
    const receivableLines = state.items.filter((item) => remainingReceiveQty(item) > 0)
    if (receivableLines.length === 0) {
      setP2pError('No receivable lines. Enter a quantity or amount before receiving.')
      return
    }
    setP2pError(null)
    setReceiveOpen(true)
  }

  const handleSubmitReceive = async (payload: {
    receipt_date: string
    notes: string | null
    lines: Array<{ source_line_id: number; quantity_received: number; unit_cost?: number | null }>
  }) => {
    if (!state.po_number) return
    setReceivingGoods(true)
    setP2pError(null)
    try {
      await purchaseOrderService.receiveGoods(state.po_number, payload)
      const refreshed = await purchaseOrderService.getPurchaseOrder(state.po_number)
      setFullPO(withSupplierName(refreshed, suppliers))
      setReceiveOpen(false)
      setSuccessMessage(
        `Goods receipt posted for ${payload.lines.length} line${payload.lines.length === 1 ? '' : 's'}. Remaining quantity can be received later.`,
      )
    } catch (err) {
      setP2pError(err instanceof Error ? err.message : 'Failed to receive goods')
    } finally {
      setReceivingGoods(false)
    }
  }

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
      <header style={documentPageHeaderStyle}>
        <div style={documentPageTitleBlockStyle}>
          <h1 style={documentPageTitleStyle}>
            {isNew ? 'Create Purchase Order' : state.po_number || 'Purchase Order'}
          </h1>
          {isExisting ? (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <span style={{ ...badgeStyle, backgroundColor: poStatusColors(state.status).bg, color: poStatusColors(state.status).text }}>
                  {state.status}
                </span>
                <span
                  style={{
                    ...badgeStyle,
                    backgroundColor: poStatusColors(state.approval_status || 'DRAFT').bg,
                    color: poStatusColors(state.approval_status || 'DRAFT').text,
                  }}
                >
                  {(state.approval_status || 'DRAFT').replace(/_/g, ' ')}
                </span>
                {state.billing_status ? (
                  <span style={{ ...badgeStyle, backgroundColor: '#eceff1', color: '#37474f' }}>
                    {String(state.billing_status).replace(/_/g, ' ')}
                  </span>
                ) : null}
                {Number(state.revision_number || 0) > 0 ? (
                  <span style={{ ...badgeStyle, backgroundColor: '#fff3e0', color: '#e65100' }}>
                    Rev {state.revision_number}
                  </span>
                ) : null}
                {state.remaining_closed ? (
                  <span style={{ ...badgeStyle, backgroundColor: '#eceff1', color: '#455a64' }}>
                    Remaining cancelled
                  </span>
                ) : null}
              </div>
              <p style={documentPageSubStyle}>
                {state.supplier_id}
                {state.supplier_name ? ` · ${state.supplier_name}` : ''}
                {state.sco_number ? ` · ${state.sco_number}` : ''}
              </p>
            </>
          ) : (
            <p style={documentPageSubStyle}>
              Enter vendor, line items, and notes, then save draft or submit for approval
            </p>
          )}
        </div>
        <div style={headerActionsStyle}>
          {isExisting ? (
            <div style={actionRowStyle}>
              <HoverTip label="Download or print this purchase order as a PDF">
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={() => void handleExportVendorPdf()}
                  disabled={exportingPdf}
                >
                  {exportingPdf ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <FileDown size={15} />}
                  PDF
                </button>
              </HoverTip>
              <HoverTip label="Email this purchase order to the vendor. The PDF downloads first so you can attach it.">
                <button type="button" style={secondaryButtonStyle} onClick={() => void handleEmailVendor()}>
                  <Mail size={15} />
                  Email vendor
                </button>
              </HoverTip>
              {isApproved ? (
                <>
                  <HoverTip
                    label={
                      canReceivePoGoods(state)
                        ? 'Post a goods receipt. Enter a partial quantity if the vendor shipped less than ordered.'
                        : receiveGoodsBlockedReason(state) || 'Receive goods is not available'
                    }
                  >
                    <button
                      type="button"
                      style={{ ...secondaryButtonStyle, ...disabledActionStyle(canReceivePoGoods(state) && !receivingGoods) }}
                      disabled={receivingGoods || !canReceivePoGoods(state)}
                      onClick={handleOpenReceive}
                    >
                      {receivingGoods ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <PackageCheck size={15} />}
                      {receivingGoods ? 'Receiving…' : 'Receive Goods'}
                    </button>
                  </HoverTip>
                  {canShowPoCloseRemaining(state) ? (
                    <HoverTip
                      label={
                        closeRemainingBlockedReason(state) ||
                        'Cancel leftover quantity after this partial receipt. Remaining quantity will not be received.'
                      }
                    >
                      <button
                        type="button"
                        style={{
                          ...dangerButtonStyle,
                          ...disabledActionStyle(state.can_close_remaining && !closingRemaining),
                        }}
                        disabled={closingRemaining || !state.can_close_remaining}
                        onClick={() => void handleCloseRemaining()}
                      >
                        {closingRemaining ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Ban size={15} />}
                        {closingRemaining ? 'Closing…' : 'Cancel remaining'}
                      </button>
                    </HoverTip>
                  ) : null}
                  <HoverTip
                    label={
                      canCreatePoBill(state)
                        ? 'Create a supplier invoice from unbilled receipts'
                        : createBillBlockedReason(state) || 'Create bill is not available'
                    }
                  >
                    <button
                      type="button"
                      style={{ ...secondaryButtonStyle, ...disabledActionStyle(canCreatePoBill(state)) }}
                      disabled={!canCreatePoBill(state)}
                      onClick={() =>
                        navigate(
                          `/supplier-invoices/new?source_type=PURCHASE_ORDER&source_order_id=${encodeURIComponent(state.po_number)}`,
                        )
                      }
                    >
                      <Receipt size={15} />
                      Create Bill
                    </button>
                  </HoverTip>
                </>
              ) : null}
              {isRecallableStatus ? (
                <HoverTip
                  label={
                    canRecallAction
                      ? 'Keep this PO number. Freeze the approved snapshot, then edit and re-submit for approval.'
                      : recallDisabledReason || 'Create Revision is not available'
                  }
                >
                  <button
                    type="button"
                    style={{ ...secondaryButtonStyle, ...disabledActionStyle(canRecallAction && !recalling && !isSubmitting) }}
                    disabled={!canRecallAction || recalling || isSubmitting}
                    onClick={() => void handleRecallPO()}
                  >
                    {recalling ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={15} />}
                    {recalling ? 'Opening…' : 'Create Revision'}
                  </button>
                </HoverTip>
              ) : null}
            </div>
          ) : null}
          <div style={actionRowStyle}>
            <HoverTip label="Back to the purchase order list">
              <button type="button" style={headerButtonStyle} onClick={() => navigate('/purchase-orders')}>
                <ArrowLeft size={15} />
                Purchase Orders
              </button>
            </HoverTip>
          </div>
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
      {exportError && (
        <div style={errorAlertStyle} role="alert">
          <span>⚠️ {exportError}</span>
        </div>
      )}
      {p2pError && (
        <div style={errorAlertStyle} role="alert">
          <span>⚠️ {p2pError}</span>
        </div>
      )}

      <>
          <POActionToolbar
            isReadOnly={fieldsReadOnly}
            editLocked={editLocked}
            editLockedReason={editLockedReason}
            onToggleMode={handleToggleMode}
            onSaveDraft={handleSaveDraft}
            onSubmit={handleSubmitPO}
            onReset={handleResetForm}
            isSubmitting={isSubmitting}
            showRecall={false}
            canRecall={canRecallAction}
            recallDisabledReason={recallDisabledReason}
            onRecall={() => void handleRecallPO()}
            isRecalling={recalling}
          />

          {isExisting && (
            <ApprovalPanel
              module="purchase-orders"
              documentId={state.po_number}
              approvalStatus={state.approval_status}
              currentApprovalStep={state.current_approval_step}
              onStatusChange={handleApprovalChange}
              allowRecall={canRecallAction}
              recallDisabledReason={recallDisabledReason}
              documentStatus={state.status}
            />
          )}

          {isExisting ? (
            <DocumentRevisionPanel
              kind="purchase-orders"
              documentId={state.po_number}
              revisionNumber={state.revision_number}
              listRevisions={purchaseOrderService.listRevisions}
              listChangeLogs={purchaseOrderService.listChangeLogs}
            />
          ) : null}

          <div style={documentAreaStyle}>
            <div style={headerSummaryRowStyle}>
              <div style={headerColumnStyle}>
                <POHeader
                  state={state}
                  setHeader={setHeader}
                  isReadOnly={fieldsReadOnly}
                  suppliers={suppliers}
                  subcontractOrders={subcontractOrders}
                  errors={errors}
                  hasImportedLines={state.items.some((item) => Boolean(item.sco_component_id))}
                  onClearImportedLines={clearImportedRows}
                />
              </div>
              <div style={summaryColumnStyle}>
                <POSummaryCard
                  state={state}
                  updateSummary={updateSummary}
                  isReadOnly={fieldsReadOnly}
                />
              </div>
            </div>

            <POLineItemsTable
              items={state.items}
              products={products}
              poType={state.po_type || 'MATERIAL'}
              updateRow={updateRow}
              updateRowFields={updateRowFields}
              deleteRow={deleteRow}
              addRow={addRow}
              clearAllRows={clearAllRows}
              isReadOnly={fieldsReadOnly}
              errors={errors}
              scoNumber={state.sco_number}
              supplierId={state.supplier_id}
              excludePoNumber={isExisting ? state.po_number : undefined}
              onImportComponents={mergeImportedRows}
            />

            {isExisting && (
              <div style={notesCardStyle}>
                <h3 style={receiptsHeadingStyle}>Goods Receipts</h3>
                <p style={receiptsHintStyle}>
                  Click a receipt ID to open posting status, per-line quantities, and the GRNI accounting trail.
                  Mixed-item receipts show percent of the PO ordered quantity.
                </p>
                <GoodsReceiptHistoryTable
                  receipts={receipts}
                  orderQtyTotal={state.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}
                />
              </div>
            )}

            {isExisting &&
            (supplierInvoices.length > 0 ||
              ['FULLY_BILLED', 'PARTIALLY_BILLED'].includes((state.billing_status || '').toUpperCase())) ? (
              <div style={notesCardStyle}>
                <h3 style={receiptsHeadingStyle}>Related supplier invoices</h3>
                <p style={receiptsHintStyle}>
                  Bills created against this purchase order. Click an invoice number to open the bill.
                </p>
                {supplierInvoices.length === 0 ? (
                  <p style={{ color: 'var(--text)', fontStyle: 'italic', margin: 0 }}>
                    No supplier invoices are linked to this purchase order yet.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={relatedDocsTableStyle}>
                      <thead>
                        <tr style={relatedDocsTheadRowStyle}>
                          <th style={relatedDocsThStyle}>Invoice</th>
                          <th style={relatedDocsThStyle}>Vendor invoice #</th>
                          <th style={relatedDocsThStyle}>Date</th>
                          <th style={relatedDocsThStyle}>Status</th>
                          <th style={{ ...relatedDocsThStyle, textAlign: 'right' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierInvoices.map((invoice) => {
                          const href = billDetailHref(invoice.ap_bill_id || invoice.invoice_number)
                          return (
                            <tr key={invoice.id} style={relatedDocsTbodyRowStyle}>
                              <td style={relatedDocsTdStyle}>
                                <Link to={href} style={relatedDocsLinkStyle} title={`Open invoice ${invoice.invoice_number}`}>
                                  {invoice.invoice_number}
                                </Link>
                              </td>
                              <td style={relatedDocsTdStyle}>{invoice.vendor_invoice_number || '—'}</td>
                              <td style={relatedDocsTdStyle}>
                                {invoice.invoice_date
                                  ? new Date(invoice.invoice_date).toLocaleDateString()
                                  : '—'}
                              </td>
                              <td style={relatedDocsTdStyle}>{(invoice.status || '').replace(/_/g, ' ')}</td>
                              <td style={{ ...relatedDocsTdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                                {money(invoice.total_amount, invoice.currency || state.currency || 'USD')}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            <div style={notesCardStyle}>
              <label style={notesLabelStyle} htmlFor="po_notes">
                Order Notes & Internal Comments
              </label>
              {fieldsReadOnly ? (
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

            <DocumentAttachmentsPanel
              documentType="PURCHASE_ORDER"
              documentId={isExisting ? state.po_number : ''}
            />
          </div>
        </>

      <ReceivePurchaseOrderDialog
        open={receiveOpen}
        poNumber={state.po_number}
        items={state.items}
        busy={receivingGoods}
        error={p2pError}
        onClose={() => {
          if (!receivingGoods) setReceiveOpen(false)
        }}
        onSubmit={(payload) => void handleSubmitReceive(payload)}
      />
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  maxWidth: '1200px',
  margin: '0 auto',
  textAlign: 'left',
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

const receiptsHeadingStyle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--text-h)',
};

const receiptsHintStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 13,
  color: 'var(--text)',
};

const relatedDocsTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const relatedDocsTheadRowStyle: React.CSSProperties = {
  backgroundColor: 'var(--social-bg)',
};

const relatedDocsTbodyRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--divider)',
};

const relatedDocsThStyle: React.CSSProperties = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: 'var(--text-h)',
};

const relatedDocsTdStyle: React.CSSProperties = {
  padding: '12px 10px',
  color: 'var(--text)',
  verticalAlign: 'middle',
};

const relatedDocsLinkStyle: React.CSSProperties = {
  color: '#1565c0',
  textDecoration: 'none',
  fontWeight: 600,
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
