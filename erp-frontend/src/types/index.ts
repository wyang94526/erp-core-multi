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
export type LocationType = 'BILL_TO' | 'SHIP_TO' | 'BOTH'
export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'ON_HOLD'
export type TaxIdType = 'EIN' | 'TIN' | 'VAT' | 'SSN' | 'OTHER' | string

export interface CustomerCertification {
  id?: number
  customer_id?: string
  certification_name: string
  certificate_number: string | null
  valid_until: string | null
}

export interface Location {
  location_id: string
  customer_id: string
  location_type: LocationType
  location_code?: string | null
  location_name: string | null
  attention_to: string | null
  address_line1: string | null
  address_line2?: string | null
  city: string | null
  state: string | null
  state_province?: string | null
  postal_code: string | null
  country: string | null
  contact_person?: string | null
  contact_email: string | null
  contact_phone?: string | null
  is_default?: boolean
  tax_id?: string | null
  shipping_instructions?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface Customer {
  customer_id: string
  customer_number_ext: string | null
  company_name: string
  tax_id_type?: TaxIdType | null
  tax_id?: string | null
  industry_type?: string | null
  facility_type?: string | null
  website?: string | null
  primary_contact_name?: string | null
  primary_email?: string | null
  primary_phone?: string | null
  currency?: string
  credit_limit?: number | string
  payment_terms?: string | null
  payment_term_id?: string | null
  preferred_incoterms?: string | null
  preferred_shipping_method?: string | null
  tax_exempt?: boolean
  tax_exempt_certificate_id?: string | null
  status?: CustomerStatus | string
  created_at?: string | null
  updated_at?: string | null
  locations?: Location[]
  bill_to_locations?: Location[]
  ship_to_locations?: Location[]
  certifications?: CustomerCertification[]
}

export type CustomerWrite = {
  customer_id?: string
  customer_number_ext?: string | null
  company_name: string
  tax_id_type?: TaxIdType | null
  tax_id?: string | null
  industry_type?: string | null
  facility_type?: string | null
  website?: string | null
  primary_contact_name?: string | null
  primary_email?: string | null
  primary_phone?: string | null
  currency?: string
  credit_limit?: number | string
  payment_terms?: string | null
  payment_term_id?: string | null
  preferred_incoterms?: string | null
  preferred_shipping_method?: string | null
  tax_exempt?: boolean
  tax_exempt_certificate_id?: string | null
  status?: string
  locations: Array<{
    location_id?: string
    location_type: LocationType
    location_code?: string | null
    location_name: string
    address_line1: string
    address_line2?: string | null
    city: string
    state?: string | null
    state_province?: string | null
    postal_code: string
    country: string
    contact_person?: string | null
    contact_email?: string | null
    contact_phone?: string | null
    is_default?: boolean
    tax_id?: string | null
    shipping_instructions?: string | null
  }>
  certifications?: Array<{
    id?: number
    certification_name: string
    certificate_number?: string | null
    valid_until?: string | null
  }>
}

// ==========================================
// ITEM CATALOG TYPES (SKU master)
// Catalog item master (DB table `items`, PK `item_id`).
// ==========================================
export interface Item {
  item_id: string;
  customer_part_number: string;
  description: string | null;
  uom: string;
  item_type?: 'INVENTORY' | 'NON_INVENTORY' | 'SERVICE';
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
/** @deprecated use Item */
export type Product = Item;

export interface VendorItemMapping {
  mapping_id: number;
  supplier_id: string;
  /** Catalog item (API field: item_id) */
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
  bom_header_id?: number | null;
  bom_version_no?: number | null;
  bom_status?: string | null;
  components: SubcontractBOMLine[];
}

export interface CalculatedComponentLine {
  component_item_id: string;
  description?: string | null;
  uom?: string | null;
  quantity_per: number;
  scrap_factor: number;
  yield_loss_percentage: number;
  quantity_required: number;
  quantity_issued: number;
  quantity_remaining: number;
  on_hand_quantity: number;
  available_to_promise?: number;
  stock_shortfall?: number;
  primary_vendor_id?: string | null;
  primary_vendor_sku?: string | null;
  unit_cost?: number | null;
  sco_line_id?: number | null;
  notes?: string | null;
  is_overridden?: boolean;
}

export interface SubcontractCharge {
  sco_charge_id?: number | null;
  sco_line_id?: number | null;
  line_no: number;
  name: string;
  detail_explanation?: string | null;
  labor_minutes?: number | null;
  sf_rate?: number | null;
  cost_per_unit: number;
  margin_percent?: number | null;
  is_margin: boolean;
}

export interface SubcontractOrderLine {
  sco_line_id: number;
  sco_number: string;
  line_number: number;
  so_item_id?: number | null;
  so_line_number?: number | null;
  item_id: string;
  bom_header_id?: number | null;
  bom_version_no?: number | null;
  quantity_ordered: number;
  unit_price: number;
  margin_percent?: number;
  margin_amount?: number;
  cost_subtotal?: number;
  tax_exempt?: boolean;
  tax_amount?: number;
  line_total: number;
  notes?: string | null;
  components: SubcontractOrderComponent[];
  charges: SubcontractCharge[];
}

export interface EligibleSalesOrder {
  sales_order_id: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_po_number?: string | null;
  order_date?: string | null;
  status?: string | null;
  approval_status?: string | null;
  open_line_count: number;
}

export interface SalesOrderSubcontractLine {
  so_item_id: number;
  line_number: number;
  item_id: string;
  item_description?: string | null;
  customer_part_number?: string | null;
  quantity_ordered: number;
  quantity_subcontracted: number;
  quantity_remaining: number;
  has_active_bom: boolean;
  active_bom_header_id?: number | null;
  active_bom_version_no?: number | null;
  bom_status?: string | null;
  is_subcontract_assembly?: boolean;
}

export interface PreviewComponentLine {
  so_item_id?: number | null;
  item_id: string;
  quantity_ordered: number;
  bom_header_id?: number | null;
  bom_header_id_resolved?: number | null;
  bom_version_no?: number | null;
  bom_status?: string | null;
  quantity_remaining_on_so_line?: number | null;
  charges: SubcontractCharge[];
  unit_price: number;
  line_total: number;
  components: CalculatedComponentLine[];
}

export interface PreviewComponentsResponse {
  can_create: boolean;
  warnings: Array<{
    code: string;
    message: string;
    so_item_id?: number;
    item_id?: string;
    component_item_id?: string;
  }>;
  default_charges: SubcontractCharge[];
  lines: PreviewComponentLine[];
  consolidated_components: CalculatedComponentLine[];
}

export interface CalculateComponentsResponse {
  sco_number: string;
  assembly_item_id: string;
  quantity_ordered: number;
  components: CalculatedComponentLine[];
  lines?: PreviewComponentLine[];
}


// ==========================================
// SALES ORDER TYPES
// ==========================================
export interface SalesOrderItem {
  so_item_id: number;
  sales_order_id: string;
  line_number: number;
  item_id: string;
  customer_part_number?: string | null;
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
  has_security_question?: boolean;
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
  customer_revision_date?: string | null;
  payment_terms: string | null;
  payment_term_id?: string | null;
  freight_terms: string | null;
  shipping_method: string | null;
  currency: string;
  buyer_contact_name: string | null;
  buyer_contact_email: string | null;
  status: string;
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
  total_amount: number; // Decimal from backend
  billed_amount?: number;
  remaining_billable_amount?: number;
  invoice_status?: 'UNBILLED' | 'PARTIALLY_BILLED' | 'FULLY_BILLED' | string;
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
export type VendorType = 'material' | 'subcontractor' | 'both' | 'service'
export type VendorPaymentMethod = 'wire' | 'ach' | 'check' | 'credit_card'
export type VendorQcStatus = 'approved' | 'probation' | 'blocked'
export type TaxDocumentType =
  | 'W-8BEN-E'
  | 'W-8BEN'
  | 'Certificate of Foreign Status'
  | 'Other'
  | 'W-9'
  | 'None'
  | string
export type VendorIncoterm = 'FOB' | 'EXW' | 'DDP' | 'CIF' | 'FCA' | 'CPT' | string

export interface WorkCenter {
  work_center_id: string
  name: string
  warehouse_id?: string | null
  is_active?: boolean
}

export interface Supplier {
  supplier_id: string;
  company_name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  phone_number?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  vendor_number_ext?: string | null;
  payment_terms?: string | null
  payment_term_id?: string | null;
  status?: 'Active' | 'Inactive' | string | null;
  vendor_type?: VendorType | string;
  tax_id?: string | null;
  tax_document_type?: TaxDocumentType | null;
  is_overseas?: boolean;
  currency?: 'USD' | 'EUR' | 'JPY' | 'TWD' | 'CNY' | string;
  ap_account_id?: string | null;
  payment_method?: VendorPaymentMethod | string | null;
  incoterms?: VendorIncoterm | null;
  incoterm_location?: string | null;
  country_of_origin?: string | null;
  bank_name?: string | null;
  swift_code?: string | null;
  iban_account_number?: string | null;
  bank_address?: string | null;
  intermediary_bank_name?: string | null;
  intermediary_swift_code?: string | null;
  intermediary_routing_aba?: string | null;
  lead_time_days?: number;
  work_center_id?: string | null;
  consignment_stock_loc_id?: string | null;
  standard_scrap_rate?: number | string;
  iso_certified?: boolean;
  qc_status?: VendorQcStatus | string;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type SupplierWrite = Omit<Supplier, 'created_at' | 'updated_at'> & {
  supplier_id: string
  company_name: string
}

// Alias for clearer domain naming in the UI ("Vendor" is used in Purchase Order contexts)
export type Vendor = Supplier;

export interface PurchaseOrderItem {
  id: string; // React-friendly unique row id (maps to backend item_id)
  sku: string;
  description?: string | null;
  uom?: string | null;
  item_type?: 'INVENTORY' | 'NON_INVENTORY' | 'SERVICE';
  bom_header_id?: number | null;
  sco_component_id?: number | null;
  quantity: number;
  unit_price: number;
  tax_rate: number; // e.g., 5 for 5%
  line_subtotal: number; // qty * price
  line_tax: number; // line_subtotal * (tax_rate / 100)
  line_total: number; // line_subtotal + line_tax
}

export type FreightPaymentTerms = 'PREPAID_ON_PO' | 'THIRD_PARTY_COLLECT' | 'ROUTING_ACCOUNT';

export interface PurchaseOrder {
  po_number: string;
  supplier_id: string;
  supplier_name?: string;
  po_type?: 'MATERIAL' | 'SUBCONTRACT';
  bom_header_id?: number | null;
  sco_number?: string | null;
  order_date: string;
  expected_delivery_date: string;
  payment_terms: string;
  payment_term_id?: string | null;
  status: 'Draft' | 'Submitted' | 'Approved' | 'Void';
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
  billing_status?: string;
  items: PurchaseOrderItem[];
  shipping_fee: number;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  incoterms?: string | null;
  freight_terms?: FreightPaymentTerms;
  carrier_account?: string | null;
  subtotal: number;
  total_tax: number;
  discount_amount: number;
  grand_total: number;
  notes?: string;
}

export interface EligibleMaterialPoSco {
  sco_number: string;
  supplier_id: string;
  supplier_name?: string | null;
  item_id: string;
  fg_description?: string | null;
  expected_return_date?: string | null;
  status: string;
  quantity_ordered: number;
  open_component_line_count: number;
}

export interface UnfulfilledScoComponent {
  sco_component_id: number;
  sco_line_id?: number | null;
  component_item_id: string;
  description?: string | null;
  uom?: string | null;
  quantity_required: number;
  quantity_already_ordered: number;
  quantity_on_draft_pos: number;
  quantity_remaining: number;
  unit_cost?: number | null;
  price_source?:
    | 'VENDOR_MAPPING'
    | 'PRIMARY_VENDOR'
    | 'LAST_PO_VENDOR'
    | 'LAST_PO'
    | 'CATALOG'
    | 'NONE';
}

// ==========================================
// SUBCONTRACTING / OUTSIDE PROCESSING TYPES
// ==========================================

export interface ItemBOMHeader {
  bom_header_id: number;
  parent_item_id: string;
  version_no: number;
  status: 'draft' | 'active' | 'obsolete' | string;
  effective_from?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

export interface ProductBOMComponent {
  bom_id: number;
  bom_header_id?: number;
  parent_item_id: string;
  component_item_id: string | null;
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
  sco_line_id?: number | null;
  component_item_id: string;
  quantity_required: number;
  quantity_required_bom?: number | null;
  quantity_issued: number;
  is_overridden?: boolean;
  notes?: string | null;
}

export interface MaterialIssueLine {
  issue_line_id: number;
  issue_id: string;
  sco_line_id?: number | null;
  component_item_id: string;
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
  sco_line_id?: number | null;
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
  sales_order_id?: string | null;
  item_id: string;
  bom_header_id?: number | null;
  bom_version_no?: number | null;
  quantity_ordered: number;
  unit_price?: number;
  document_total?: number;
  line_count?: number;
  status: SubcontractOrderStatus | string;
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
  amendment_number?: number;
  billing_status?: string;
  order_date: string;
  expected_return_date: string | null;
  notes: string | null;
  created_at: string;
  lines?: SubcontractOrderLine[];
  components: SubcontractOrderComponent[];
  material_issues: MaterialIssue[];
  finished_goods_receipts: FinishedGoodsReceipt[];
}

// ==========================================
// FINANCE MODULE: AR / AP / CASH MANAGEMENT / GENERAL LEDGER
// ==========================================

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense' | string;
export type { PaymentTerm, PaymentTermWrite } from '../utils/paymentTerms';

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

export interface ARInvoicePayment {
  payment_date: string | null;
  method: string;
  reference: string;
  amount_applied: number;
  unapplied_balance: number;
}

export interface ARInvoiceLineDetail {
  item_id: string;
  description?: string | null;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
}

export interface ARInvoiceDetail extends ARInvoice {
  customer_name?: string | null;
  customer_email?: string | null;
  display_status?: 'Paid' | 'Overdue' | 'Partial' | 'Open' | string;
  issue_date?: string | null;
  payment_date?: string | null;
  payment_terms?: string | null
  payment_term_id?: string | null;
  currency?: string;
  subtotal?: number;
  tax_amount?: number;
  freight_amount?: number;
  total_amount?: number;
  outstanding_balance?: number;
  sales_invoice_id?: number | null;
  sales_invoice_number?: string | null;
  sales_invoice_status?: string | null;
  lines: ARInvoiceLineDetail[];
  payments: ARInvoicePayment[];
  can_create_credit_memo?: boolean;
  credit_memo_reason?: string | null;
  duplicate_invoice_ids?: string[];
}

export type FulfillmentStatus = 'DRAFT' | 'PICKED' | 'PACKED' | 'SHIPPED' | string;

export interface ItemFulfillmentLine {
  id: number;
  fulfillment_id: number;
  sales_order_line_id: number;
  item_id: string;
  quantity_fulfilled: number;
}

export interface ItemFulfillment {
  id: number;
  fulfillment_number: string;
  sales_order_id: string;
  customer_id: string;
  customer_name?: string | null;
  status: FulfillmentStatus;
  shipped_date?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  lines: ItemFulfillmentLine[];
}

export type SalesInvoiceStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'VOID' | string;

export interface SalesInvoiceLine {
  id: number;
  invoice_id: number;
  item_id: string;
  description?: string | null;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
}

export interface SalesInvoiceDoc {
  id: number;
  invoice_number: string;
  sales_order_id: string;
  fulfillment_id?: number | null;
  customer_id: string;
  customer_name?: string | null;
  status: SalesInvoiceStatus;
  issue_date: string;
  due_date: string;
  payment_terms?: string | null
  payment_term_id?: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  outstanding_balance: number;
  ar_invoice_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  lines: SalesInvoiceLine[];
}

export interface APBill {
  bill_id: string;
  purchase_order_id: string | null;
  vendor_id: string;
  supplier_invoice_id?: number | null;
  source_type?: string | null;
  source_order_id?: string | null;
  amount: number;
  status: 'Unpaid' | 'Partial' | 'Paid' | string;
  approval_status?: ApprovalStatus;
  current_approval_step?: number | null;
  due_date: string; // ISO date
  created_at: string | null;
}

export interface APBillPayment {
  payment_date: string | null;
  method: string;
  reference: string;
  amount_applied: number;
  unapplied_balance: number;
}

export interface APBillLineDetail {
  item_id?: string | null;
  description?: string | null;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
}

export interface APBillDetail extends APBill {
  vendor_name?: string | null;
  vendor_email?: string | null;
  vendor_invoice_number?: string | null;
  display_status?: 'Paid' | 'Overdue' | 'Partial' | 'Open' | string;
  issue_date?: string | null;
  payment_date?: string | null;
  payment_terms?: string | null
  payment_term_id?: string | null;
  currency?: string;
  subtotal?: number;
  tax_amount?: number;
  freight_amount?: number;
  total_amount?: number;
  outstanding_balance?: number;
  supplier_invoice_number?: string | null;
  supplier_invoice_status?: string | null;
  invoice_type?: 'PO_MATCHED' | 'LANDED_COST' | 'EXPENSE' | string | null;
  match_warnings?: string[];
  lines: APBillLineDetail[];
  payments: APBillPayment[];
}

export type VendorInvoiceSourceType = 'PURCHASE_ORDER' | 'SUBCONTRACT_ORDER' | 'NON_PO' | string;
export type VendorInvoiceType = 'PO_MATCHED' | 'LANDED_COST' | 'EXPENSE' | string;
export type VendorInvoiceStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PAID'
  | 'CANCELLED'
  | string;

export interface SupplierInvoiceLine {
  id: number;
  invoice_id: number;
  source_line_id?: number | null;
  item_id?: string | null;
  description?: string | null;
  quantity_billed: number;
  unit_price: number;
  line_subtotal: number;
  goods_receipt_line_id?: number | null;
}

export interface SupplierInvoiceDistribution {
  id: number;
  invoice_id: number;
  gl_account_id: string;
  gl_account_code?: string | null;
  gl_account_name?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  amount: number;
  description?: string | null;
  goods_receipt_id?: number | null;
  goods_receipt_line_id?: number | null;
}

export interface SupplierInvoice {
  id: number;
  invoice_number: string;
  vendor_id: string;
  vendor_name?: string | null;
  invoice_type: VendorInvoiceType;
  source_type: VendorInvoiceSourceType;
  source_order_id?: string | null;
  vendor_invoice_number?: string | null;
  invoice_date: string;
  due_date: string;
  payment_term_id?: string | null;
  payment_terms?: string | null;
  status: VendorInvoiceStatus;
  subtotal: number;
  tax_amount: number;
  freight_amount: number;
  total_amount: number;
  outstanding_balance: number;
  currency: string;
  ap_bill_id?: string | null;
  match_warnings?: string[];
  created_at?: string | null;
  updated_at?: string | null;
  lines: SupplierInvoiceLine[];
  distributions?: SupplierInvoiceDistribution[];
  payment_transaction_id?: string | null;
}

export interface Department {
  id: string;
  name: string;
}

export type CashPaymentMethod = 'CHECK' | 'WIRE' | 'ACH' | 'CARD'

export type CashPaymentPayload = {
  amount?: number | null
  bank_account_id?: string | null
  payment_method?: CashPaymentMethod | null
  instrument_ref_no?: string | null
  payment_date?: string | null
}

export interface BankAccount {
  bank_account_id: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  account_number_masked?: string | null;
  routing_number?: string | null;
  display_name?: string | null;
  is_default?: boolean;
  is_active?: boolean;
}

export interface CashTransaction {
  transaction_id: string;
  type: 'Check Issue' | 'Check Deposit' | string;
  type_label?: string | null;
  reference_id: string;
  amount: number;
  transaction_date: string | null; // ISO datetime
  bank_account_id: string | null;
  bank_account_name?: string | null;
  bank_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  account_number_masked?: string | null;
  routing_number?: string | null;
  payment_method?: CashPaymentMethod | string;
  instrument_ref_no?: string | null;
  instrument_display_number?: string | null;
  entity_name?: string | null;
  entity_role?: 'Payee' | 'Payer' | string | null;
  clearing_status?: 'PENDING' | 'CLEARED' | 'VOID' | string;
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
  account_code?: string | null;
  account_name?: string | null;
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
  item_id: string;
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
  item_id: string;
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

export interface AuditLog {
  id: number;
  table_name: string;
  record_id: string;
  action: string;
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
  user_id: string | null;
  changed_at: string;
}

export type DocumentType = string;

export interface DocumentAttachment {
  id: number;
  document_type: DocumentType;
  document_id: string;
  original_filename: string;
  content_type: string;
  file_size: number;
  notes: string | null;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}
