import { useReducer, useCallback } from 'react';
import type { PurchaseOrder, PurchaseOrderItem } from '../types';

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
  | { type: 'UPDATE_SUMMARY'; payload: { field: 'shipping_fee' | 'discount_type' | 'discount_value'; value: any } }
  | { type: 'SET_FULL_PO'; payload: PurchaseOrder }
  | { type: 'RESET_FORM'; payload?: { defaultPoNumber?: string } };

const initialRow = (id: string): PurchaseOrderItem => ({
  id,
  sku: '',
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
    order_date: today,
    expected_delivery_date: '',
    payment_terms: 'Net 30',
    status: 'Draft',
    approval_status: 'DRAFT',
    current_approval_step: null as number | null,
    items: [initialRow(generateId())],
    shipping_fee: 0,
    discount_type: 'percentage',
    discount_value: 0,
    subtotal: 0,
    total_tax: 0,
    discount_amount: 0,
    grand_total: 0,
    notes: '',
  };
};

/**
 * Clean numeric string parsing to floating number
 */
const cleanNum = (val: any): number => {
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
};

/**
 * Computes precision-safe rounding to 2 decimal places
 */
const round2 = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

/**
 * Calculates subtotals, tax, and totals for all line items and the summary card.
 */
export const calculateTotals = (
  items: PurchaseOrderItem[],
  shippingFee: number,
  discountType: 'percentage' | 'fixed',
  discountValue: number
) => {
  const updatedItems = items.map((item) => {
    const qty = Math.max(0, cleanNum(item.quantity));
    const price = Math.max(0, cleanNum(item.unit_price));
    const taxRate = Math.max(0, cleanNum(item.tax_rate));

    const line_subtotal = round2(qty * price);
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
  const grand_total = Math.max(0, round2(subtotal + total_tax + shipping - discount_amount));

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

function poReducer(state: POFormState, action: POAction): POFormState {
  switch (action.type) {
    case 'SET_HEADER': {
      const updated = {
        ...state,
        [action.payload.field]: action.payload.value,
      };
      // Auto-update expected delivery date to be order date if invalid sequence
      if (action.payload.field === 'order_date' && state.expected_delivery_date) {
        if (new Date(action.payload.value) > new Date(state.expected_delivery_date)) {
          updated.expected_delivery_date = action.payload.value;
        }
      }
      return updated;
    }

    case 'ADD_ROW': {
      const newRow = initialRow(generateId());
      const updatedItems = [...state.items, newRow];
      return {
        ...state,
        ...calculateTotals(updatedItems, state.shipping_fee, state.discount_type, state.discount_value),
      };
    }

    case 'UPDATE_ROW': {
      const updatedItems = state.items.map((item) => {
        if (item.id === action.payload.id) {
          return {
            ...item,
            [action.payload.field]: action.payload.value,
          };
        }
        return item;
      });
      return {
        ...state,
        ...calculateTotals(updatedItems, state.shipping_fee, state.discount_type, state.discount_value),
      };
    }

    case 'UPDATE_ROW_FIELDS': {
      const updatedItems = state.items.map((item) => {
        if (item.id === action.payload.id) {
          return {
            ...item,
            ...action.payload.fields,
          };
        }
        return item;
      });
      return {
        ...state,
        ...calculateTotals(updatedItems, state.shipping_fee, state.discount_type, state.discount_value),
      };
    }

    case 'DELETE_ROW': {
      // Keep at least one row, but clear it if only one
      let updatedItems = state.items.filter((item) => item.id !== action.payload.id);
      if (updatedItems.length === 0) {
        updatedItems = [initialRow(generateId())];
      }
      return {
        ...state,
        ...calculateTotals(updatedItems, state.shipping_fee, state.discount_type, state.discount_value),
      };
    }

    case 'CLEAR_ALL_ROWS': {
      const updatedItems = [initialRow(generateId())];
      return {
        ...state,
        ...calculateTotals(updatedItems, state.shipping_fee, state.discount_type, state.discount_value),
      };
    }

    case 'UPDATE_SUMMARY': {
      const { field, value } = action.payload;
      const keyMap = {
        shipping_fee: state.shipping_fee,
        discount_type: state.discount_type,
        discount_value: state.discount_value,
      };

      const updatedVal = {
        ...keyMap,
        [field]: value,
      };

      return {
        ...state,
        ...calculateTotals(
          state.items,
          updatedVal.shipping_fee,
          updatedVal.discount_type as 'percentage' | 'fixed',
          updatedVal.discount_value
        ),
      };
    }

    case 'SET_FULL_PO': {
      const po = action.payload;
      return {
        po_number: po.po_number,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name || '',
        order_date: po.order_date,
        expected_delivery_date: po.expected_delivery_date,
        payment_terms: po.payment_terms,
        status: po.status,
        approval_status: po.approval_status || 'DRAFT',
        current_approval_step: po.current_approval_step ?? null,
        items: po.items,
        shipping_fee: po.shipping_fee,
        discount_type: po.discount_type,
        discount_value: po.discount_value,
        subtotal: po.subtotal,
        total_tax: po.total_tax,
        discount_amount: po.discount_amount,
        grand_total: po.grand_total,
        notes: po.notes || '',
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
    updateSummary,
    setFullPO,
    resetForm,
  };
}
