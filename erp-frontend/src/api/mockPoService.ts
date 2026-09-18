/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import type { Supplier, PurchaseOrder } from '../types';

// Mock list of suppliers/vendors
const INITIAL_SUPPLIERS: Supplier[] = [
  { supplier_id: 'SUP-001', company_name: 'Apex Industrial Supply' },
  { supplier_id: 'SUP-002', company_name: 'Global Logistics Partners' },
  { supplier_id: 'SUP-003', company_name: 'Reliable Parts Corp' },
  { supplier_id: 'SUP-004', company_name: 'Stellar Tech Solutions' },
  { supplier_id: 'SUP-005', company_name: 'Vertex Raw Materials Inc.' },
];

const INITIAL_POS: PurchaseOrder[] = [
  {
    po_number: 'PO-20260731-001',
    supplier_id: 'SUP-001',
    supplier_name: 'Apex Industrial Supply',
    order_date: '2026-07-30',
    expected_delivery_date: '2026-08-15',
    payment_terms: 'Net 30',
    status: 'Approved',
    items: [
      {
        id: 'item-1',
        sku: 'SKU-APX-982',
        quantity: 100,
        unit_price: 15.50,
        tax_rate: 8.25,
        line_subtotal: 1550.00,
        line_tax: 127.88,
        line_total: 1677.88,
      },
      {
        id: 'item-2',
        sku: 'SKU-APX-012',
        quantity: 10,
        unit_price: 245.00,
        tax_rate: 8.25,
        line_subtotal: 2450.00,
        line_tax: 202.13,
        line_total: 2652.13,
      }
    ],
    shipping_fee: 45.00,
    discount_type: 'percentage',
    discount_value: 5,
    subtotal: 4000.00,
    total_tax: 330.01,
    discount_amount: 200.00,
    grand_total: 4175.01,
    notes: 'Urgent production materials. Please dispatch via expedited courier.',
  },
  {
    po_number: 'PO-20260731-002',
    supplier_id: 'SUP-004',
    supplier_name: 'Stellar Tech Solutions',
    order_date: '2026-07-31',
    expected_delivery_date: '2026-08-10',
    payment_terms: 'Net 60',
    status: 'Draft',
    items: [
      {
        id: 'item-3',
        sku: 'SKU-STL-X900',
        quantity: 5,
        unit_price: 1200.00,
        tax_rate: 10,
        line_subtotal: 6000.00,
        line_tax: 600.00,
        line_total: 6600.00,
      }
    ],
    shipping_fee: 150.00,
    discount_type: 'fixed',
    discount_value: 500,
    subtotal: 6000.00,
    total_tax: 600.00,
    discount_amount: 500.00,
    grand_total: 6250.00,
    notes: 'Development workstations project.',
  }
];

export const mockPoService = {
  /**
   * Get suppliers (simulating backend call / autocomplete)
   */
  async getSuppliers(): Promise<Supplier[]> {
    // Check if suppliers are stored in localStorage
    const stored = localStorage.getItem('erp_suppliers');
    if (!stored) {
      localStorage.setItem('erp_suppliers', JSON.stringify(INITIAL_SUPPLIERS));
      return INITIAL_SUPPLIERS;
    }
    return JSON.parse(stored);
  },

  /**
   * Add a new supplier
   */
  async addSupplier(supplier: Supplier): Promise<Supplier> {
    const suppliers = await this.getSuppliers();
    suppliers.push(supplier);
    localStorage.setItem('erp_suppliers', JSON.stringify(suppliers));
    return supplier;
  },

  /**
   * Get all purchase orders
   */
  async getPurchaseOrders(): Promise<PurchaseOrder[]> {
    const stored = localStorage.getItem('erp_purchase_orders');
    if (!stored) {
      localStorage.setItem('erp_purchase_orders', JSON.stringify(INITIAL_POS));
      return INITIAL_POS;
    }
    return JSON.parse(stored);
  },

  /**
   * Get a single purchase order by number
   */
  async getPurchaseOrder(poNumber: string): Promise<PurchaseOrder | null> {
    const pos = await this.getPurchaseOrders();
    const po = pos.find((p) => p.po_number === poNumber);
    return po || null;
  },

  /**
   * Save (create or update) a purchase order
   */
  async savePurchaseOrder(po: PurchaseOrder): Promise<PurchaseOrder> {
    const pos = await this.getPurchaseOrders();
    const index = pos.findIndex((p) => p.po_number === po.po_number);

    // Resolve company_name for supplier if missing
    if (!po.supplier_name) {
      const suppliers = await this.getSuppliers();
      const s = suppliers.find((supplier) => supplier.supplier_id === po.supplier_id);
      po.supplier_name = s ? s.company_name : po.supplier_id;
    }

    if (index >= 0) {
      pos[index] = po;
    } else {
      pos.unshift(po); // Add to the front of the list
    }

    localStorage.setItem('erp_purchase_orders', JSON.stringify(pos));
    return po;
  },

  /**
   * Delete a purchase order
   */
  async deletePurchaseOrder(poNumber: string): Promise<boolean> {
    const pos = await this.getPurchaseOrders();
    const filtered = pos.filter((p) => p.po_number !== poNumber);
    localStorage.setItem('erp_purchase_orders', JSON.stringify(filtered));
    return filtered.length < pos.length;
  }
};
