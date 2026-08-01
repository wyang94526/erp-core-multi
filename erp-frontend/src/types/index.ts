/**
 * TypeScript interfaces for ERP Frontend
 * These types correspond to the backend Pydantic schemas
 */

// ==========================================
// USER TYPES
// ==========================================
export interface User {
  id: string; // UUID
  email: string;
  full_name: string;
  created_at: string; // ISO datetime
}

// ==========================================
// CUSTOMER & LOCATION TYPES
// ==========================================
export interface Customer {
  customer_id: string;
  customer_number_ext: string | null;
  company_name: string;
}

export interface Location {
  location_id: string;
  customer_id: string;
  location_type: 'BILL_TO' | 'SHIP_TO' | 'BOTH';
  location_name: string | null;
  attention_to: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  contact_email: string | null;
}

// ==========================================
// PRODUCT TYPES
// ==========================================
export interface Product {
  product_id: string;
  customer_part_number: string;
  description: string | null;
  uom: string;
  unit_price?: number | null;
  on_hand_quantity?: number;
  wip_quantity?: number;
}

// ==========================================
// SALES ORDER TYPES
// ==========================================
export interface SalesOrderItem {
  so_item_id: number;
  sales_order_id: string;
  line_number: number;
  product_id: string;
  quantity_ordered: number;
  unit_price: number; // Decimal from backend
  tax_amount: number; // Decimal from backend
  total_amount: number; // Decimal from backend
}

export interface SalesOrder {
  sales_order_id: string;
  customer_id: string;
  bill_to_location_id: string;
  ship_to_location_id: string;
  customer_po_number: string;
  po_revision_number: number;
  order_date: string; // ISO date
  payment_terms: string | null;
  freight_terms: string | null;
  shipping_method: string | null;
  currency: string;
  buyer_contact_name: string | null;
  buyer_contact_email: string | null;
  status: string;
  total_amount: number; // Decimal from backend
  created_at: string | null; // ISO datetime
  items: SalesOrderItem[];
}

// ==========================================
// API RESPONSE TYPES
// ==========================================
export interface ApiResponse<T> {
  data: T;
  status: number;
}

export interface ApiError {
  detail: string;
  status: number;
}

// ==========================================
// SUPPLIER & PURCHASE ORDER TYPES
// ==========================================
export interface Supplier {
  supplier_id: string;
  company_name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  phone_number?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  vendor_number_ext?: string | null;
  payment_terms?: string | null;
  status?: 'Active' | 'Inactive' | string | null;
}

// Alias for clearer domain naming in the UI ("Vendor" is used in Purchase Order contexts)
export type Vendor = Supplier;

export interface PurchaseOrderItem {
  id: string; // React-friendly unique row id
  sku: string;
  quantity: number;
  unit_price: number;
  tax_rate: number; // e.g., 5 for 5%
  line_subtotal: number; // qty * price
  line_tax: number; // line_subtotal * (tax_rate / 100)
  line_total: number; // line_subtotal + line_tax
}

export interface PurchaseOrder {
  po_number: string;
  supplier_id: string;
  supplier_name?: string;
  order_date: string;
  expected_delivery_date: string;
  payment_terms: string;
  status: 'Draft' | 'Submitted' | 'Approved' | 'Void';
  items: PurchaseOrderItem[];
  shipping_fee: number;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  subtotal: number;
  total_tax: number;
  discount_amount: number;
  grand_total: number;
  notes?: string;
}

// ==========================================
// SUBCONTRACTING / OUTSIDE PROCESSING TYPES
// ==========================================

export interface ProductBOMComponent {
  bom_id: number;
  parent_product_id: string;
  component_product_id: string;
  quantity_per: number;
  created_at: string;
}

export interface SubcontractOrderComponent {
  sco_component_id: number;
  sco_number: string;
  component_product_id: string;
  quantity_required: number;
  quantity_issued: number;
}

export interface MaterialIssueLine {
  issue_line_id: number;
  issue_id: string;
  component_product_id: string;
  quantity_issued: number;
}

export interface MaterialIssue {
  issue_id: string;
  sco_number: string;
  issue_date: string;
  notes: string | null;
  created_at: string;
  lines: MaterialIssueLine[];
}

export interface FinishedGoodsReceipt {
  receipt_id: string;
  sco_number: string;
  quantity_received: number;
  receipt_date: string;
  notes: string | null;
  created_at: string;
}

export type SubcontractOrderStatus =
  | 'PLANNED'
  | 'PARTIALLY_ISSUED'
  | 'MATERIALS_ISSUED'
  | 'PARTIALLY_RECEIVED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface SubcontractOrder {
  sco_number: string;
  supplier_id: string;
  product_id: string;
  quantity_ordered: number;
  status: SubcontractOrderStatus | string;
  order_date: string;
  expected_return_date: string | null;
  notes: string | null;
  created_at: string;
  components: SubcontractOrderComponent[];
  material_issues: MaterialIssue[];
  finished_goods_receipts: FinishedGoodsReceipt[];
}
