import { useReducer, useCallback } from 'react';
import type { FreightPaymentTerms, PurchaseOrder, PurchaseOrderItem } from '../types';
import { includesVendorFreight } from '../data/orderOptions';
import { isAmountOnlyLine } from '../utils/itemTypes';

export interface POFormState extends Omit<PurchaseOrder, 'subtotal' | 'total_tax' | 'discount_amount' | 'grand_total'> {
  subtotal: number;
  total_tax: number;
  discount_amount: number;
  grand_total: number;
}

export type POAction =
  | { type: 'SET_HEADER'; payload: { field: string; value: any } }
  | { type: 'ADD_ROW' }
  | { type: 'UPDATE_ROW'; payload: { id: string; field: keyof PurchaseOrderItem; value: any } }
  | { type: 'UPDATE_ROW_FIELDS'; payload: { id: string; fields: Partial<PurchaseOrderItem> } }
  | { type: 'DELETE_ROW'; payload: { id: string } }
  | { type: 'CLEAR_ALL_ROWS' }
  | { type: 'MERGE_IMPORTED_ROWS'; payload: { rows: PurchaseOrderItem[]; replaceAll?: boolean } }
  | { type: 'CLEAR_IMPORTED_ROWS' }
  | { type: 'UPDATE_SUMMARY'; payload: { field: 'shipping_fee' | 'discount_type' | 'discount_value'; value: any } }
  | { type: 'SET_FULL_PO'; payload: PurchaseOrder }
  | { type: 'RESET_FORM'; payload?: { defaultPoNumber?: string } };

const initialRow = (id: string): PurchaseOrderItem => ({
  id,
  sku: '',
  description: '',
  uom: '',
  bom_header_id: null,
  sco_component_id: null,
  item_type: 'INVENTORY',
  quantity: 1,
  unit_price: 0,
  tax_rate: 0,
  line_subtotal: 0,
  line_tax: 0,
  line_total: 0,
});

const generateId = () => `row-${Math.random().toString(36).substr(2, 9)}`;

export const getInitialState = (defaultPoNumber = ''): POFormState => {
  const today = new Date().toISOString().split('T')[0];
  return {
    po_number: defaultPoNumber,
    supplier_id: '',
    supplier_name: '',
    po_type: 'MATERIAL',
    bom_header_id: null,
    sco_number: '',
    order_date: today,
    expected_delivery_date: '',
    payment_terms: 'NET30',
    payment_term_id: '',
    status: 'Draft',
    approval_status: 'DRAFT',
    current_approval_step: null as number | null,
    items: [initialRow(generateId())],
    shipping_fee: 0,
    discount_type: 'percentage',
    discount_value: 0,
    incoterms: '',
    freight_terms: 'PREPAID_ON_PO',
    carrier_account: '',
    subtotal: 0,
    total_tax: 0,
    discount_amount: 0,
    grand_total: 0,
    notes: '',
  };
};

const cleanNum = (val: any): number => {
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
};

const round2 = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

export const calculateTotals = (
  items: PurchaseOrderItem[],
  shippingFee: number,
  discountType: 'percentage' | 'fixed',
  discountValue: number,
  freightTerms: FreightPaymentTerms | string | null | undefined = 'PREPAID_ON_PO'
) => {
  const updatedItems = items.map((item) => {
    const qty = Math.max(0, cleanNum(item.quantity));
    const price = Math.max(0, cleanNum(item.unit_price));
    const taxRate = Math.max(0, cleanNum(item.tax_rate));
    const amountOnly = isAmountOnlyLine(item.item_type, qty);
    const line_subtotal = amountOnly
      ? round2(Math.max(0, cleanNum(item.line_subtotal) || price))
      : round2(qty * price);
    const line_tax = round2(line_subtotal * (taxRate / 100));
    const line_total = round2(line_subtotal + line_tax);

    return {
      ...item,
      quantity: qty,
      unit_price: price,
      tax_rate: taxRate,
      line_subtotal,
      line_tax,
      line_total,
    };
  });

  const subtotal = round2(updatedItems.reduce((acc, item) => acc + item.line_subtotal, 0));
  const total_tax = round2(updatedItems.reduce((acc, item) => acc + item.line_tax, 0));

  let discount_amount = 0;
  const rawDiscountVal = Math.max(0, cleanNum(discountValue));
  if (discountType === 'percentage') {
    const pct = Math.min(100, rawDiscountVal);
    discount_amount = round2(subtotal * (pct / 100));
  } else {
    discount_amount = round2(rawDiscountVal);
  }

  const shipping = Math.max(0, cleanNum(shippingFee));
  const vendorShipping = includesVendorFreight(freightTerms) ? shipping : 0;
  const grand_total = Math.max(0, round2(subtotal + total_tax + vendorShipping - discount_amount));

  return {
    items: updatedItems,
    subtotal,
    total_tax,
    discount_amount,
    grand_total,
    shipping_fee: shipping,
    discount_value: rawDiscountVal,
  };
};

function withTotals(state: POFormState, items: PurchaseOrderItem[]): POFormState {
  return {
    ...state,
    ...calculateTotals(items, state.shipping_fee, state.discount_type, state.discount_value, state.freight_terms),
  };
}

function poReducer(state: POFormState, action: POAction): POFormState {
  switch (action.type) {
    case 'SET_HEADER': {
      const updated = {
        ...state,
        [action.payload.field]: action.payload.value,
      };
      if (action.payload.field === 'order_date' && state.expected_delivery_date) {
        if (new Date(action.payload.value) > new Date(state.expected_delivery_date)) {
          updated.expected_delivery_date = action.payload.value;
        }
      }
      if (action.payload.field === 'po_type' && action.payload.value !== state.po_type) {
        const cleared = [initialRow(generateId())];
        if (action.payload.value === 'SUBCONTRACT') {
          updated.incoterms = updated.incoterms || '';
        }
        return withTotals({ ...updated, items: cleared }, cleared);
      }
      if (action.payload.field === 'freight_terms') {
        if (action.payload.value === 'PREPAID_ON_PO') {
          updated.carrier_account = updated.carrier_account || '';
        }
        return withTotals(updated, updated.items);
      }
      return updated;
    }

    case 'ADD_ROW': {
      const updatedItems = [...state.items, initialRow(generateId())];
      return withTotals(state, updatedItems);
    }

    case 'UPDATE_ROW': {
      const updatedItems = state.items.map((item) => {
        if (item.id === action.payload.id) {
          const next = {
            ...item,
            [action.payload.field]: action.payload.value,
          };
          if (action.payload.field === 'sku') {
            next.sco_component_id = null;
          }
          return next;
        }
        return item;
      });
      return withTotals(state, updatedItems);
    }

    case 'UPDATE_ROW_FIELDS': {
      const updatedItems = state.items.map((item) => {
        if (item.id === action.payload.id) {
          const next = { ...item, ...action.payload.fields };
          if (action.payload.fields.sku != null && action.payload.fields.sku !== item.sku) {
            if (action.payload.fields.sco_component_id === undefined) {
              next.sco_component_id = null;
            }
          }
          return next;
        }
        return item;
      });
      return withTotals(state, updatedItems);
    }

    case 'DELETE_ROW': {
      let updatedItems = state.items.filter((item) => item.id !== action.payload.id);
      if (updatedItems.length === 0) {
        updatedItems = [initialRow(generateId())];
      }
      return withTotals(state, updatedItems);
    }

    case 'CLEAR_ALL_ROWS': {
      return withTotals(state, [initialRow(generateId())]);
    }

    case 'MERGE_IMPORTED_ROWS': {
      const incoming = action.payload.rows;
      if (action.payload.replaceAll) {
        const rows = incoming.length > 0 ? incoming : [initialRow(generateId())];
        return withTotals(state, rows);
      }
      const byComponent = new Map<number, PurchaseOrderItem>();
      for (const row of incoming) {
        if (row.sco_component_id) byComponent.set(row.sco_component_id, row);
      }
      const kept: PurchaseOrderItem[] = [];
      const usedComponents = new Set<number>();
      for (const item of state.items) {
        if (!item.sku && !item.sco_component_id) {
          continue;
        }
        if (item.sco_component_id && byComponent.has(item.sco_component_id)) {
          const next = byComponent.get(item.sco_component_id)!;
          kept.push({ ...item, ...next, id: item.id, tax_rate: item.tax_rate });
          usedComponents.add(item.sco_component_id);
        } else {
          kept.push(item);
        }
      }
      for (const row of incoming) {
        if (row.sco_component_id && usedComponents.has(row.sco_component_id)) continue;
        kept.push(row);
      }
      return withTotals(state, kept.length > 0 ? kept : [initialRow(generateId())]);
    }

    case 'CLEAR_IMPORTED_ROWS': {
      const kept = state.items.filter((item) => !item.sco_component_id);
      return withTotals(state, kept.length > 0 ? kept : [initialRow(generateId())]);
    }

    case 'UPDATE_SUMMARY': {
      const { field, value } = action.payload;
      const updatedVal = {
        shipping_fee: state.shipping_fee,
        discount_type: state.discount_type,
        discount_value: state.discount_value,
        [field]: value,
      };
      return {
        ...state,
        ...calculateTotals(
          state.items,
          updatedVal.shipping_fee,
          updatedVal.discount_type as 'percentage' | 'fixed',
          updatedVal.discount_value,
          state.freight_terms
        ),
      };
    }

    case 'SET_FULL_PO': {
      const po = action.payload;
      const freightTerms = po.freight_terms || 'PREPAID_ON_PO';
      const totals = calculateTotals(
        po.items,
        po.shipping_fee,
        po.discount_type,
        po.discount_value,
        freightTerms
      );
      return {
        po_number: po.po_number,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name || '',
        po_type: po.po_type || 'MATERIAL',
        bom_header_id: po.bom_header_id ?? null,
        sco_number: po.sco_number || '',
        order_date: po.order_date,
        expected_delivery_date: po.expected_delivery_date,
        payment_terms: po.payment_terms,
        payment_term_id: po.payment_term_id || '',
        status: po.status,
        approval_status: po.approval_status || 'DRAFT',
        current_approval_step: po.current_approval_step ?? null,
        shipping_fee: totals.shipping_fee,
        discount_type: po.discount_type,
        discount_value: totals.discount_value,
        incoterms: po.incoterms || '',
        freight_terms: freightTerms,
        carrier_account: po.carrier_account || '',
        notes: po.notes || '',
        ...totals,
      };
    }

    case 'RESET_FORM': {
      return getInitialState(action.payload?.defaultPoNumber || '');
    }

    default:
      return state;
  }
}

export function usePurchaseOrderState(initialPoNumber = '') {
  const [state, dispatch] = useReducer(poReducer, initialPoNumber, (poNum) => getInitialState(poNum));

  const setHeader = useCallback((field: string, value: any) => {
    dispatch({ type: 'SET_HEADER', payload: { field, value } });
  }, []);

  const addRow = useCallback(() => {
    dispatch({ type: 'ADD_ROW' });
  }, []);

  const updateRow = useCallback((id: string, field: keyof PurchaseOrderItem, value: any) => {
    dispatch({ type: 'UPDATE_ROW', payload: { id, field, value } });
  }, []);

  const updateRowFields = useCallback((id: string, fields: Partial<PurchaseOrderItem>) => {
    dispatch({ type: 'UPDATE_ROW_FIELDS', payload: { id, fields } });
  }, []);

  const deleteRow = useCallback((id: string) => {
    dispatch({ type: 'DELETE_ROW', payload: { id } });
  }, []);

  const clearAllRows = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL_ROWS' });
  }, []);

  const mergeImportedRows = useCallback((rows: PurchaseOrderItem[], replaceAll = false) => {
    dispatch({ type: 'MERGE_IMPORTED_ROWS', payload: { rows, replaceAll } });
  }, []);

  const clearImportedRows = useCallback(() => {
    dispatch({ type: 'CLEAR_IMPORTED_ROWS' });
  }, []);

  const updateSummary = useCallback((field: 'shipping_fee' | 'discount_type' | 'discount_value', value: any) => {
    dispatch({ type: 'UPDATE_SUMMARY', payload: { field, value } });
  }, []);

  const setFullPO = useCallback((po: PurchaseOrder) => {
    dispatch({ type: 'SET_FULL_PO', payload: po });
  }, []);

  const resetForm = useCallback((defaultPoNumber?: string) => {
    dispatch({ type: 'RESET_FORM', payload: { defaultPoNumber } });
  }, []);

  return {
    state,
    setHeader,
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
  };
}
