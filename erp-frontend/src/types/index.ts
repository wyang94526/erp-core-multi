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
// ITEM CATALOG TYPES (SKU master)
// Backend table/API still uses products.product_id; frontend maps to item_id.
// ==========================================
export interface Item {
  item_id: string;
  customer_part_number: string;
  description: string | null;
  uom: string;
  unit_price?: number | null;
  on_hand_quantity?: number;
  wip_quantity?: number;
  is_outside_processed?: boolean;
  /** Eligible for purchase order line selection */
  is_purchase_item?: boolean;
  /** Finished / subcontracted assembly with a component kit */
  is_subcontract_assembly?: boolean;
  /** Raw material / purchased part used in kits */
  is_raw_material?: boolean;
}

/** @deprecated Prefer Item — alias during migration */
export type Product = Item & { product_id: string };

export interface VendorItemMapping {
  mapping_id: number;
  supplier_id: string;
  /** Catalog item (API field: product_id) */
  item_id: string;
  vendor_sku: string | null;
  unit_cost: number | null;
  minimum_order_qty: number;
  lead_time_days: number;
  is_primary_vendor: boolean;
  created_at?: string | null;
  supplier_name?: string | null;
  item_description?: string | null;
}

export interface SubcontractBOMLine {
  bom_id: number;
  assembly_item_id: string;
  component_item_id: string | null;
  quantity_required: number;
  scrap_factor: number;
  yield_loss_percentage: number;
  component_description?: string | null;
  is_purchase_item?: boolean | null;
  is_raw_material?: boolean | null;
  primary_vendor_id?: string | null;
  primary_vendor_sku?: string | null;
  unit_cost?: number | null;
}

export interface SubcontractBOM {
  assembly_item_id: string;
  assembly_description?: string | null;
  is_subcontract_assembly: boolean;
  components: SubcontractBOMLine[];
}

export interface CalculatedComponentLine {
  component_product_id: string;
  description?: string | null;
  quantity_per: number;
  scrap_factor: number;
  yield_loss_percentage: number;
  quantity_required: number;
  quantity_issued: number;
  quantity_remaining: number;
  on_hand_quantity: number;
  primary_vendor_id?: string | null;
  primary_vendor_sku?: string | null;
  unit_cost?: number | null;
}

export interface CalculateComponentsResponse {
  sco_number: string;
  assembly_item_id: string;
  quantity_ordered: number;
  components: CalculatedComponentLine[];
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

export type ApprovalStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | string;

export interface ApprovalHistory {
  id: number;
  document_type?: string;
  document_id?: string;
  transaction_type?: string;
  transaction_id?: string;
  step_number?: number | null;
  step_name?: string | null;
  action: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'DELEGATED' | string;
  performed_by_user_id?: string | null;
  actor_user_id?: string | null;
  actor_name?: string | null;
  comments: string | null;
  created_at: string;
  timestamp?: string;
}

export interface RoleBrief {
  role_id: string;
  role_name: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string;
  status?: string;
  department_id?: string | null;
  department_name?: string | null;
  roles?: RoleBrief[];
  permissions?: string[];
  role_id: string | null;
  role_name: string | null;
}

export interface UserSummary {
  id: string;
  email: string;
  full_name: string;
  status?: string;
  department_id?: string | null;
  roles?: RoleBrief[];
}

export interface RoleDetail {
  role_id: string;
  role_name: string;
  description?: string | null;
  permissions?: string[];
  created_at?: string | null;
}

export interface Permission {
  id: string;
  code: string;
  module: string;
  description?: string | null;
}

export interface WorkflowStep {
  id: string;
  step_number: number;
  step_name: string;
  required_role_id?: string | null;
  required_permission?: string | null;
}

export interface WorkflowDefinition {
  id: string;
  module: string;
  min_amount: number;
  max_amount: number | null;
  is_active: boolean;
  name?: string | null;
  steps: WorkflowStep[];
  created_at?: string | null;
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
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
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
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
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
  component_product_id: string | null;
  component_code: string | null;
  quantity_per: number;
  item_type: 'Material' | 'Labor' | 'Outside Service' | string;
  scrap_factor?: number;
  yield_loss_percentage?: number;
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
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
  order_date: string;
  expected_return_date: string | null;
  notes: string | null;
  created_at: string;
  components: SubcontractOrderComponent[];
  material_issues: MaterialIssue[];
  finished_goods_receipts: FinishedGoodsReceipt[];
}

// ==========================================
// FINANCE MODULE: AR / AP / CASH MANAGEMENT / GENERAL LEDGER
// ==========================================

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense' | string;

export interface ChartOfAccount {
  id: string; // UUID
  account_code: string;
  account_name: string;
  account_type: AccountType;
  created_at: string; // ISO datetime
}

export interface ChartOfAccountCreate {
  account_code: string;
  account_name: string;
  account_type: AccountType;
}

export interface ARInvoice {
  invoice_id: string;
  sales_order_id: string;
  customer_id: string;
  amount: number;
  status: 'Unpaid' | 'Partial' | 'Paid' | string;
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
  due_date: string; // ISO date
  created_at: string | null;
}

export interface APBill {
  bill_id: string;
  purchase_order_id: string;
  vendor_id: string;
  amount: number;
  status: 'Unpaid' | 'Partial' | 'Paid' | string;
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
  due_date: string; // ISO date
  created_at: string | null;
}

export interface CashTransaction {
  transaction_id: string;
  type: 'Check Issue' | 'Check Deposit' | string;
  reference_id: string;
  amount: number;
  transaction_date: string | null; // ISO datetime
  bank_account_id: string | null;
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
}

export interface LedgerPosting {
  id: string; // UUID
  entry_id: string; // UUID
  account_id: string; // UUID
  debit: number;
  credit: number;
  currency: string;
}

export interface JournalEntry {
  id: string; // UUID
  created_at: string; // ISO datetime
  description: string;
  posted_by_user_id: string | null;
  period: string | null; // e.g. '2026-08'
  posting_status: 'Draft' | 'Posted' | string | null;
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
  postings: LedgerPosting[];
}

// ==========================================
// INVENTORY & WAREHOUSE TYPES
// ==========================================

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock';

export type StockMovementType = 'Receipt' | 'Issue' | 'Adjustment' | 'Transfer';

export interface Warehouse {
  warehouse_id: string;
  name: string;
  code: string;
  address: string | null;
  is_active: boolean;
}

export interface BinLocation {
  bin_id: string;
  warehouse_id: string;
  warehouse_code?: string | null;
  bin_code: string;
  description: string | null;
  is_active: boolean;
}

export interface InventoryStockItem {
  product_id: string;
  description: string | null;
  uom: string;
  on_hand_quantity: number;
  allocated_quantity: number; // reserved for open Sales Orders
  on_order_quantity: number; // open Purchase Orders
  available_to_promise: number; // on_hand - allocated + on_order
  reorder_point: number;
  status: StockStatus;
  primary_warehouse_id: string;
  primary_warehouse_code: string;
  primary_bin_code: string;
}

export interface StockMovement {
  movement_id: string;
  product_id: string;
  movement_type: StockMovementType;
  quantity: number;
  warehouse_id: string;
  warehouse_code: string | null;
  bin_id: string;
  bin_code: string | null;
  reference: string | null;
  notes: string | null;
  movement_date: string; // ISO date
  created_at?: string | null;
}
