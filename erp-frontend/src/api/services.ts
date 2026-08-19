/**
 * API Service Functions
 * Contains all data fetching functions for the ERP entities
 */

import { apiClient } from './client';
import type {
  User,
  Customer,
  CustomerWrite,
  Location,
  Item,
  Product,
  SalesOrder,
  Supplier,
  SupplierWrite,
  PurchaseOrder,
  ProductBOMComponent,
  ItemBOMHeader,
  SubcontractOrder,
  MaterialIssue,
  FinishedGoodsReceipt,
  ARInvoice,
  APBill,
  CashTransaction,
  JournalEntry,
  ChartOfAccount,
  ChartOfAccountCreate,
  ApprovalHistory,
  CurrentUser,
  InventoryStockItem,
  StockMovement,
  Warehouse,
  WorkCenter,
  ItemFulfillment,
  SalesInvoiceDoc,
  SupplierInvoice,
  BinLocation,
  VendorItemMapping,
  SubcontractBOM,
  SubcontractBOMLine,
  CalculateComponentsResponse,
  AuditLog,
  DocumentAttachment,
  DocumentType,
} from '../types';

/** Map backend Item.item_id wire format → frontend Item */
function mapItem(raw: Record<string, unknown>): Item {
  const id = String(raw.item_id ?? '');
  return {
    item_id: id,
    customer_part_number: String(raw.customer_part_number ?? ''),
    description: (raw.description as string | null) ?? null,
    uom: String(raw.uom ?? 'Each'),
    unit_price: (raw.unit_price as number | null | undefined) ?? null,
    on_hand_quantity: Number(raw.on_hand_quantity ?? 0),
    wip_quantity: Number(raw.wip_quantity ?? 0),
    is_outside_processed: Boolean(raw.is_outside_processed),
    is_purchase_item: Boolean(raw.is_purchase_item),
    is_subcontract_assembly: Boolean(raw.is_subcontract_assembly),
    is_raw_material: Boolean(raw.is_raw_material),
  };
}

function mapVendorMapping(raw: Record<string, unknown>): VendorItemMapping {
  return {
    mapping_id: Number(raw.mapping_id),
    supplier_id: String(raw.supplier_id),
    item_id: String(raw.item_id ?? ''),
    vendor_sku: (raw.vendor_sku as string | null) ?? null,
    unit_cost: (raw.unit_cost as number | null) ?? null,
    minimum_order_qty: Number(raw.minimum_order_qty ?? 1),
    lead_time_days: Number(raw.lead_time_days ?? 0),
    is_primary_vendor: Boolean(raw.is_primary_vendor),
    created_at: (raw.created_at as string | null) ?? null,
    supplier_name: (raw.supplier_name as string | null) ?? null,
    item_description: (raw.item_description as string | null) ?? null,
  };
}

// ==========================================
// USER SERVICES
// ==========================================

export const userService = {
  /**
   * Fetch all users with pagination
   */
  async listUsers(skip: number = 0, limit: number = 100): Promise<User[]> {
    return apiClient.get<User[]>('/api/v1/users', {
      params: { skip, limit },
    });
  },

  /**
   * Fetch a single user by ID
   */
  async getUser(userId: string): Promise<User> {
    return apiClient.get<User>(`/api/v1/users/${userId}`);
  },
};

// ==========================================
// CUSTOMER SERVICES
// ==========================================

export const customerService = {
  /**
   * Fetch all customers with pagination and optional search/status filters
   */
  async listCustomers(
    skip: number = 0,
    limit: number = 100,
    filters?: { q?: string; status?: string },
  ): Promise<Customer[]> {
    return apiClient.get<Customer[]>('/api/v1/customers', {
      params: { skip, limit, q: filters?.q, status: filters?.status },
    });
  },

  /**
   * Fetch a single customer by ID (includes locations and certifications)
   */
  async getCustomer(customerId: string): Promise<Customer> {
    return apiClient.get<Customer>(`/api/v1/customers/${customerId}`);
  },

  /**
   * Create a new customer, optionally with nested locations and certifications
   */
  async createCustomer(data: CustomerWrite): Promise<Customer> {
    return apiClient.post<Customer>('/api/v1/customers', data);
  },

  /**
   * Full nested update (locations + certifications upsert)
   */
  async updateCustomer(customerId: string, data: CustomerWrite): Promise<Customer> {
    return apiClient.put<Customer>(`/api/v1/customers/${customerId}`, data);
  },

  /**
   * Header-only partial update
   */
  async patchCustomer(
    customerId: string,
    data: Partial<Customer>
  ): Promise<Customer> {
    return apiClient.patch<Customer>(`/api/v1/customers/${customerId}`, data);
  },

  /**
   * Delete a customer
   */
  async deleteCustomer(customerId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/customers/${customerId}`);
  },
};

// ==========================================
// LOCATION SERVICES
// ==========================================

export const locationService = {
  /**
   * Fetch all locations for a specific customer
   */
  async listLocationsByCustomer(customerId: string): Promise<Location[]> {
    return apiClient.get<Location[]>(
      `/api/v1/customer-locations/customer/${customerId}`
    );
  },

  /**
   * Fetch a single location by ID
   */
  async getLocation(locationId: string): Promise<Location> {
    return apiClient.get<Location>(`/api/v1/customer-locations/${locationId}`);
  },

  /**
   * Create a new location
   */
  async createLocation(data: {
    location_id: string;
    customer_id: string;
    location_type: 'BILL_TO' | 'SHIP_TO' | 'BOTH';
    location_code?: string;
    location_name?: string;
    attention_to?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    state_province?: string;
    postal_code?: string;
    country?: string;
    contact_person?: string;
    contact_email?: string;
    contact_phone?: string;
    is_default?: boolean;
    tax_id?: string;
    shipping_instructions?: string;
  }): Promise<Location> {
    return apiClient.post<Location>('/api/v1/customer-locations/', data);
  },

  /**
   * Update a location
   */
  async updateLocation(
    locationId: string,
    data: Partial<Location>
  ): Promise<Location> {
    return apiClient.put<Location>(
      `/api/v1/customer-locations/${locationId}`,
      data
    );
  },

  /**
   * Delete a location
   */
  async deleteLocation(locationId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/customer-locations/${locationId}`);
  },
};

// ==========================================
// ITEM CATALOG SERVICES (SKU master)
// Uses /api/v1/items; maps item_id ↔ backend item_id.
// ==========================================

export const itemService = {
  async listItems(skip: number = 0, limit: number = 100): Promise<Item[]> {
    const rows = await apiClient.get<Record<string, unknown>[]>('/api/v1/items', {
      params: { skip, limit },
    });
    return rows.map(mapItem);
  },

  async listPurchaseItems(skip: number = 0, limit: number = 500): Promise<Item[]> {
    const rows = await apiClient.get<Record<string, unknown>[]>('/api/v1/items/purchase-items', {
      params: { skip, limit },
    });
    return rows.map(mapItem);
  },

  async listRawMaterials(skip: number = 0, limit: number = 500): Promise<Item[]> {
    const rows = await apiClient.get<Record<string, unknown>[]>('/api/v1/items/raw-materials', {
      params: { skip, limit },
    });
    return rows.map(mapItem);
  },

  async listAssemblies(skip: number = 0, limit: number = 500): Promise<Item[]> {
    const rows = await apiClient.get<Record<string, unknown>[]>('/api/v1/items/assemblies', {
      params: { skip, limit },
    });
    return rows.map(mapItem);
  },

  async getItem(itemId: string): Promise<Item> {
    const raw = await apiClient.get<Record<string, unknown>>(`/api/v1/items/${itemId}`);
    return mapItem(raw);
  },

  async createItem(data: {
    item_id: string;
    customer_part_number: string;
    description?: string;
    uom?: string;
    unit_price?: number;
    is_outside_processed?: boolean;
    is_purchase_item?: boolean;
    is_subcontract_assembly?: boolean;
    is_raw_material?: boolean;
  }): Promise<Item> {
    const { item_id, ...rest } = data;
    const raw = await apiClient.post<Record<string, unknown>>('/api/v1/items', {
      item_id: item_id,
      ...rest,
    });
    return mapItem(raw);
  },

  async updateItem(itemId: string, data: Partial<Omit<Item, 'item_id'>>): Promise<Item> {
    const raw = await apiClient.patch<Record<string, unknown>>(
      `/api/v1/items/${itemId}`,
      data
    );
    return mapItem(raw);
  },

  async deleteItem(itemId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/items/${itemId}`);
  },

  async listItemVendors(itemId: string): Promise<VendorItemMapping[]> {
    const rows = await apiClient.get<Record<string, unknown>[]>(
      `/api/v1/items/${itemId}/vendors`
    );
    return rows.map(mapVendorMapping);
  },

  async addItemVendor(
    itemId: string,
    data: {
      supplier_id: string;
      item_id?: string;
      vendor_sku?: string | null;
      unit_cost?: number | null;
      minimum_order_qty?: number;
      lead_time_days?: number;
      is_primary_vendor?: boolean;
    }
  ): Promise<VendorItemMapping> {
    const raw = await apiClient.post<Record<string, unknown>>(
      `/api/v1/items/${itemId}/vendors`,
      {
        ...data,
        item_id: data.item_id ?? itemId,
      }
    );
    return mapVendorMapping(raw);
  },

  async updateItemVendor(
    itemId: string,
    mappingId: number,
    data: Partial<{
      vendor_sku: string | null;
      unit_cost: number | null;
      minimum_order_qty: number;
      lead_time_days: number;
      is_primary_vendor: boolean;
    }>
  ): Promise<VendorItemMapping> {
    const raw = await apiClient.patch<Record<string, unknown>>(
      `/api/v1/items/${itemId}/vendors/${mappingId}`,
      data
    );
    return mapVendorMapping(raw);
  },

  async deleteItemVendor(itemId: string, mappingId: number): Promise<void> {
    return apiClient.delete<void>(`/api/v1/items/${itemId}/vendors/${mappingId}`);
  },
};

/** @deprecated Use itemService */
export const productService = {
  listProducts: (skip = 0, limit = 100) => itemService.listItems(skip, limit),
  getProduct: (id: string) => itemService.getItem(id),
  createProduct: (data: {
    item_id: string;
    customer_part_number: string;
    description?: string;
    uom?: string;
    unit_price?: number;
    is_outside_processed?: boolean;
    is_purchase_item?: boolean;
    is_subcontract_assembly?: boolean;
    is_raw_material?: boolean;
  }) =>
    itemService.createItem({
      item_id: data.item_id,
      customer_part_number: data.customer_part_number,
      description: data.description,
      uom: data.uom,
      unit_price: data.unit_price,
      is_outside_processed: data.is_outside_processed,
      is_purchase_item: data.is_purchase_item,
      is_subcontract_assembly: data.is_subcontract_assembly,
      is_raw_material: data.is_raw_material,
    }),
  updateProduct: (id: string, data: Partial<Product>) => {
    const { item_id: _id, ...rest } = data as Partial<Item> & {
      item_id?: string;
    };
    return itemService.updateItem(id, rest);
  },
  deleteProduct: (id: string) => itemService.deleteItem(id),
};

// ==========================================
// SALES ORDER SERVICES
// ==========================================

export const salesOrderService = {
  /**
   * Fetch all sales orders with pagination
   */
  async listSalesOrders(
    skip: number = 0,
    limit: number = 100
  ): Promise<SalesOrder[]> {
    return apiClient.get<SalesOrder[]>('/api/v1/sales-orders', {
      params: { skip, limit },
    });
  },

  /**
   * Fetch a single sales order by ID
   */
  async getSalesOrder(orderId: string): Promise<SalesOrder> {
    return apiClient.get<SalesOrder>(`/api/v1/sales-orders/${orderId}`);
  },

  /**
   * Create a new sales order with items
   */
  async createSalesOrder(data: {
    sales_order_id: string;
    customer_id: string;
    bill_to_location_id: string;
    ship_to_location_id: string;
    customer_po_number: string;
    po_revision_number?: number;
    order_date: string; // ISO date
    payment_terms?: string;
    freight_terms?: string;
    shipping_method?: string;
    currency?: string;
    buyer_contact_name?: string;
    buyer_contact_email?: string;
    status?: string;
    total_amount?: number;
    items: Array<{
      line_number: number;
      item_id: string;
      quantity_ordered: number;
      unit_price: number;
      tax_amount?: number;
      total_amount: number;
    }>;
  }): Promise<SalesOrder> {
    return apiClient.post<SalesOrder>('/api/v1/sales-orders', data);
  },

  /**
   * Update a sales order
   */
  async updateSalesOrder(
    orderId: string,
    data: Partial<SalesOrder>
  ): Promise<SalesOrder> {
    return apiClient.patch<SalesOrder>(`/api/v1/sales-orders/${orderId}`, data);
  },

  /**
   * Cancel a sales order (updates status to CANCELLED)
   */
  async cancelSalesOrder(orderId: string): Promise<SalesOrder> {
    return apiClient.patch<SalesOrder>(`/api/v1/sales-orders/${orderId}`, {
      status: 'CANCELLED',
    });
  },
};

// ==========================================
// ITEM FULFILLMENT SERVICES
// ==========================================

export const fulfillmentService = {
  list(skip = 0, limit = 100): Promise<ItemFulfillment[]> {
    return apiClient.get<ItemFulfillment[]>('/api/v1/fulfillments', {
      params: { skip, limit },
    });
  },

  get(id: number): Promise<ItemFulfillment> {
    return apiClient.get<ItemFulfillment>(`/api/v1/fulfillments/${id}`);
  },

  create(data: {
    sales_order_id: string;
    carrier?: string | null;
    tracking_number?: string | null;
    status?: string;
    lines: Array<{ sales_order_line_id: number; quantity_fulfilled: number }>;
  }): Promise<ItemFulfillment> {
    return apiClient.post<ItemFulfillment>('/api/v1/fulfillments', data);
  },

  updateStatus(
    id: number,
    data: {
      status: string;
      shipped_date?: string | null;
      carrier?: string | null;
      tracking_number?: string | null;
    },
  ): Promise<ItemFulfillment> {
    return apiClient.patch<ItemFulfillment>(`/api/v1/fulfillments/${id}/status`, data);
  },
};

// ==========================================
// SALES INVOICE (O2C) SERVICES
// ==========================================

export const salesInvoiceService = {
  list(skip = 0, limit = 100): Promise<SalesInvoiceDoc[]> {
    return apiClient.get<SalesInvoiceDoc[]>('/api/v1/sales-invoices', {
      params: { skip, limit },
    });
  },

  get(id: number): Promise<SalesInvoiceDoc> {
    return apiClient.get<SalesInvoiceDoc>(`/api/v1/sales-invoices/${id}`);
  },

  create(data: {
    sales_order_id: string;
    fulfillment_id?: number | null;
    issue_date?: string | null;
    payment_terms?: string | null;
    lines?: Array<{
      item_id: string;
      description?: string | null;
      quantity: number;
      unit_price: number;
    }> | null;
  }): Promise<SalesInvoiceDoc> {
    return apiClient.post<SalesInvoiceDoc>('/api/v1/sales-invoices', data);
  },

  approve(id: number): Promise<SalesInvoiceDoc> {
    return apiClient.post<SalesInvoiceDoc>(`/api/v1/sales-invoices/${id}/approve`);
  },

  void(id: number): Promise<SalesInvoiceDoc> {
    return apiClient.post<SalesInvoiceDoc>(`/api/v1/sales-invoices/${id}/void`);
  },
};

// ==========================================
// VENDOR / SUPPLIER INVOICE (P2P) SERVICES
// ==========================================

export const vendorInvoiceService = {
  list(params: {
    skip?: number;
    limit?: number;
    source_type?: string;
    status?: string;
    vendor_id?: string;
    source_order_id?: string;
  } = {}): Promise<SupplierInvoice[]> {
    const query: Record<string, string | number> = {
      skip: params.skip ?? 0,
      limit: params.limit ?? 100,
    };
    if (params.source_type) query.source_type = params.source_type;
    if (params.status) query.status = params.status;
    if (params.vendor_id) query.vendor_id = params.vendor_id;
    if (params.source_order_id) query.source_order_id = params.source_order_id;
    return apiClient.get<SupplierInvoice[]>('/api/v1/vendor-invoices', {
      params: query,
    });
  },

  get(id: number): Promise<SupplierInvoice> {
    return apiClient.get<SupplierInvoice>(`/api/v1/vendor-invoices/${id}`);
  },

  create(data: {
    source_type: 'PURCHASE_ORDER' | 'SUBCONTRACT_ORDER';
    source_order_id: string;
    vendor_invoice_number?: string | null;
    invoice_date?: string | null;
    due_date?: string | null;
    tax_amount?: number | null;
    freight_amount?: number | null;
    currency?: string;
    lines?: Array<{
      source_line_id?: number | null;
      item_id?: string | null;
      description?: string | null;
      quantity_billed: number;
      unit_price: number;
    }> | null;
  }): Promise<SupplierInvoice> {
    return apiClient.post<SupplierInvoice>('/api/v1/vendor-invoices', data);
  },

  approve(id: number): Promise<SupplierInvoice> {
    return apiClient.patch<SupplierInvoice>(`/api/v1/vendor-invoices/${id}/approve`);
  },

  pay(
    id: number,
    data: { amount?: number | null; bank_account_id?: string | null } = {},
  ): Promise<SupplierInvoice> {
    return apiClient.patch<SupplierInvoice>(`/api/v1/vendor-invoices/${id}/pay`, data);
  },
};

// ==========================================
// VENDOR / SUPPLIER SERVICES
// ==========================================

export const vendorService = {
  /**
   * Fetch all vendors/suppliers with pagination
   */
  async listVendors(
    skip: number = 0,
    limit: number = 100,
    filters?: { vendorType?: string },
  ): Promise<Supplier[]> {
    return apiClient.get<Supplier[]>('/api/v1/suppliers/', {
      params: { skip, limit, vendor_type: filters?.vendorType },
    });
  },

  /**
   * Fetch a single vendor by ID
   */
  async getVendor(supplierId: string): Promise<Supplier> {
    return apiClient.get<Supplier>(`/api/v1/suppliers/${supplierId}`);
  },

  /**
   * Create a new vendor
   */
  async createVendor(data: SupplierWrite): Promise<Supplier> {
    return apiClient.post<Supplier>('/api/v1/suppliers/', data);
  },

  /**
   * Full vendor update
   */
  async updateVendor(supplierId: string, data: Partial<SupplierWrite>): Promise<Supplier> {
    return apiClient.put<Supplier>(`/api/v1/suppliers/${supplierId}`, data);
  },

  /**
   * Delete a vendor
   */
  async deleteVendor(supplierId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/suppliers/${supplierId}`);
  },
};

export const workCenterService = {
  async listWorkCenters(skip: number = 0, limit: number = 100): Promise<WorkCenter[]> {
    return apiClient.get<WorkCenter[]>('/api/v1/work-centers', {
      params: { skip, limit },
    })
  },
};

// ==========================================
// PURCHASE ORDER SERVICES
// ==========================================

function mapPurchaseOrderFromApi(po: PurchaseOrder): PurchaseOrder {
  const rawItems = (po.items || []) as Array<Record<string, unknown> | PurchaseOrder['items'][number]>;
  return {
    ...po,
    order_date: String(po.order_date || '').slice(0, 10),
    expected_delivery_date: po.expected_delivery_date
      ? String(po.expected_delivery_date).slice(0, 10)
      : '',
    shipping_fee: Number(po.shipping_fee ?? 0),
    discount_value: Number(po.discount_value ?? 0),
    subtotal: Number(po.subtotal ?? 0),
    total_tax: Number(po.total_tax ?? 0),
    discount_amount: Number(po.discount_amount ?? 0),
    grand_total: Number(po.grand_total ?? 0),
    approval_status: po.approval_status || 'DRAFT',
    current_approval_step: po.current_approval_step ?? null,
    items: rawItems.map((item, idx) => {
      const row = item as Record<string, unknown>;
      return {
        id: String(row.item_id ?? row.id ?? `row-${idx}`),
        sku: String(row.sku || ''),
        quantity: Number(row.quantity ?? 0),
        unit_price: Number(row.unit_price ?? 0),
        tax_rate: Number(row.tax_rate ?? 0),
        line_subtotal: Number(row.line_subtotal ?? 0),
        line_tax: Number(row.line_tax ?? 0),
        line_total: Number(row.line_total ?? 0),
      };
    }),
  };
}

export const purchaseOrderService = {
  async listPurchaseOrders(skip: number = 0, limit: number = 100): Promise<PurchaseOrder[]> {
    const rows = await apiClient.get<PurchaseOrder[]>('/api/v1/purchase-orders', {
      params: { skip, limit },
    });
    return rows.map(mapPurchaseOrderFromApi);
  },

  async getPurchaseOrder(poNumber: string): Promise<PurchaseOrder> {
    const po = await apiClient.get<PurchaseOrder>(`/api/v1/purchase-orders/${poNumber}`);
    return mapPurchaseOrderFromApi(po);
  },

  async createPurchaseOrder(data: Omit<PurchaseOrder, 'supplier_name' | 'approval_status'> & {
    items: Array<{
      sku: string;
      quantity: number;
      unit_price: number;
      tax_rate: number;
      line_subtotal: number;
      line_tax: number;
      line_total: number;
    }>;
  }): Promise<PurchaseOrder> {
    const po = await apiClient.post<PurchaseOrder>('/api/v1/purchase-orders', data);
    return mapPurchaseOrderFromApi(po);
  },

  async updatePurchaseOrder(
    poNumber: string,
    data: Partial<Omit<PurchaseOrder, 'po_number' | 'supplier_name' | 'items'>> & {
      items?: Array<{
        sku: string;
        quantity: number;
        unit_price: number;
        tax_rate: number;
        line_subtotal: number;
        line_tax: number;
        line_total: number;
      }>;
    }
  ): Promise<PurchaseOrder> {
    const po = await apiClient.patch<PurchaseOrder>(
      `/api/v1/purchase-orders/${poNumber}`,
      data
    );
    return mapPurchaseOrderFromApi(po);
  },

  async deletePurchaseOrder(poNumber: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/purchase-orders/${poNumber}`);
  },

  async receiveGoods(
    poNumber: string,
    data: {
      receipt_date?: string | null;
      notes?: string | null;
      lines: Array<{
        source_line_id: number;
        quantity_received: number;
        unit_cost?: number | null;
      }>;
    },
  ) {
    return apiClient.post(`/api/v1/purchase-orders/${poNumber}/receive`, data);
  },
};

// ==========================================
// ITEM BOM SERVICES
// ==========================================

export const itemBomService = {
  async listHeaders(itemId: string): Promise<ItemBOMHeader[]> {
    return apiClient.get<ItemBOMHeader[]>(`/api/v1/items/${itemId}/bom-headers`);
  },

  async createVersion(
    itemId: string,
    data: { copy_from_header_id?: number | null; notes?: string | null } = {},
  ): Promise<ItemBOMHeader> {
    return apiClient.post<ItemBOMHeader>(`/api/v1/items/${itemId}/bom-headers`, data);
  },

  async activateVersion(itemId: string, headerId: number): Promise<ItemBOMHeader> {
    return apiClient.post<ItemBOMHeader>(
      `/api/v1/items/${itemId}/bom-headers/${headerId}/activate`,
      {},
    );
  },

  /**
   * List BOM components for a version. Omit headerId to use the active version.
   */
  async listBomComponents(itemId: string, headerId?: number | null): Promise<ProductBOMComponent[]> {
    return apiClient.get<ProductBOMComponent[]>(`/api/v1/items/${itemId}/bom`, {
      params: { bom_header_id: headerId ?? undefined },
    });
  },

  /**
   * Add a component/raw-material/labor/outside-service line to a finished product's BOM.
   * For item_type='Material', pass component_item_id. For 'Labor'/'Outside Service',
   * pass component_code (one of the predefined LABOR_SERVICE_CODES).
   */
  async addBomComponent(
    itemId: string,
    data: {
      component_item_id?: string | null;
      component_code?: string | null;
      quantity_per: number;
      item_type?: 'Material' | 'Labor' | 'Outside Service';
      scrap_factor?: number;
      yield_loss_percentage?: number;
    },
    headerId?: number | null,
  ): Promise<ProductBOMComponent> {
    return apiClient.post<ProductBOMComponent>(`/api/v1/items/${itemId}/bom`, data, {
      params: { bom_header_id: headerId ?? undefined },
    });
  },

  /**
   * Update an existing BOM component line (e.g. quantity or item type)
   */
  async updateBomComponent(
    itemId: string,
    bomId: number,
    data: Partial<{
      component_item_id: string | null;
      component_code: string | null;
      quantity_per: number;
      item_type: 'Material' | 'Labor' | 'Outside Service';
      scrap_factor: number;
      yield_loss_percentage: number;
    }>
  ): Promise<ProductBOMComponent> {
    return apiClient.patch<ProductBOMComponent>(
      `/api/v1/items/${itemId}/bom/${bomId}`,
      data
    );
  },


  /**
   * Remove a BOM component line
   */
  async deleteBomComponent(itemId: string, bomId: number): Promise<void> {
    return apiClient.delete<void>(`/api/v1/items/${itemId}/bom/${bomId}`);
  },

};

/** @deprecated Use itemBomService */
export const productBomService = itemBomService;

// ==========================================
// SUBCONTRACT ORDER SERVICES
// ==========================================

export const subcontractOrderService = {
  /**
   * Fetch all subcontract orders with pagination
   */
  async listSubcontractOrders(
    skip: number = 0,
    limit: number = 100
  ): Promise<SubcontractOrder[]> {
    return apiClient.get<SubcontractOrder[]>('/api/v1/subcontract-orders', {
      params: { skip, limit },
    });
  },

  /**
   * Fetch a single subcontract order by SCO number
   */
  async getSubcontractOrder(scoNumber: string): Promise<SubcontractOrder> {
    return apiClient.get<SubcontractOrder>(`/api/v1/subcontract-orders/${scoNumber}`);
  },

  /**
   * Create a new subcontract order. The backend automatically populates
   * the component requirements from the product's Bill of Materials.
   */
  async createSubcontractOrder(data: {
    sco_number: string;
    supplier_id: string;
    item_id: string;
    quantity_ordered: number;
    order_date?: string;
    expected_return_date?: string;
    notes?: string;
    bom_header_id?: number | null;
  }): Promise<SubcontractOrder> {
    return apiClient.post<SubcontractOrder>('/api/v1/subcontract-orders', data);
  },

  /**
   * Update a subcontract order's header fields
   */
  async updateSubcontractOrder(
    scoNumber: string,
    data: Partial<{
      supplier_id: string;
      quantity_ordered: number;
      status: string;
      expected_return_date: string;
      notes: string;
    }>
  ): Promise<SubcontractOrder> {
    return apiClient.patch<SubcontractOrder>(`/api/v1/subcontract-orders/${scoNumber}`, data);
  },

  /**
   * Record a shipment of raw materials issued out to the subcontractor
   */
  async issueMaterials(
    scoNumber: string,
    data: {
      issue_id: string;
      issue_date?: string;
      notes?: string;
      lines: Array<{ component_item_id: string; quantity_issued: number }>;
    }
  ): Promise<SubcontractOrder> {
    return apiClient.post<SubcontractOrder>(
      `/api/v1/subcontract-orders/${scoNumber}/issue-materials`,
      data
    );
  },

  /**
   * Record receipt of finished goods back from the subcontractor
   */
  async receiveGoods(
    scoNumber: string,
    data: {
      receipt_id: string;
      quantity_received: number;
      receipt_date?: string;
      notes?: string;
      unit_cost?: number;
    }
  ): Promise<SubcontractOrder> {
    return apiClient.post<SubcontractOrder>(
      `/api/v1/subcontract-orders/${scoNumber}/receive-goods`,
      data
    );
  },

  /**
   * Cancel a subcontract order (updates status to CANCELLED)
   */
  async cancelSubcontractOrder(scoNumber: string): Promise<SubcontractOrder> {
    return apiClient.patch<SubcontractOrder>(`/api/v1/subcontract-orders/${scoNumber}`, {
      status: 'CANCELLED',
    });
  },

  /**
   * Explode assembly BOM kit for this SCO (qty × BOM + scrap/yield) vs issued stock.
   */
  async calculateComponents(scoNumber: string): Promise<CalculateComponentsResponse> {
    return apiClient.post<CalculateComponentsResponse>(
      `/api/v1/subcontract-orders/${scoNumber}/calculate-components`
    );
  },
};

export const subcontractBomService = {
  async getKit(assemblyId: string): Promise<SubcontractBOM> {
    return apiClient.get<SubcontractBOM>(`/api/v1/subcontract-boms/${assemblyId}`);
  },

  async addComponent(data: {
    assembly_item_id: string;
    component_item_id: string;
    quantity_required: number;
    scrap_factor?: number;
    yield_loss_percentage?: number;
  }): Promise<SubcontractBOMLine> {
    return apiClient.post<SubcontractBOMLine>('/api/v1/subcontract-boms/', data);
  },

  async deleteComponent(assemblyId: string, bomId: number): Promise<void> {
    return apiClient.delete<void>(
      `/api/v1/subcontract-boms/${assemblyId}/components/${bomId}`
    );
  },
};

// Re-export related types used by consumers of this module for convenience
export type { MaterialIssue, FinishedGoodsReceipt };

// ==========================================
// APPROVAL WORKFLOW SERVICES
// ==========================================

export type AuthTokenResponse = {
  access_token: string;
  token_type: string;
  user: CurrentUser;
};

export type AuthChangePasswordResponse = {
  message: string;
};

export type AuthSecurityQuestionLookupResponse = {
  email: string;
  security_question: string;
};

export type AuthResetPasswordResponse = {
  message: string;
};

export const authService = {
  login(data: { email: string; password: string }): Promise<AuthTokenResponse> {
    return apiClient.post<AuthTokenResponse>('/api/v1/auth/login', data);
  },

  register(data: {
    email: string;
    full_name: string;
    password: string;
    security_question: string;
    security_answer: string;
  }): Promise<AuthTokenResponse> {
    return apiClient.post<AuthTokenResponse>('/api/v1/auth/register', data);
  },

  changePassword(data: {
    email: string;
    current_password: string;
    new_password: string;
  }): Promise<AuthChangePasswordResponse> {
    return apiClient.post<AuthChangePasswordResponse>(
      '/api/v1/auth/change-password',
      data,
    );
  },

  lookupSecurityQuestion(data: {
    email: string;
  }): Promise<AuthSecurityQuestionLookupResponse> {
    return apiClient.post<AuthSecurityQuestionLookupResponse>(
      '/api/v1/auth/security-question',
      data,
    );
  },

  resetPassword(data: {
    email: string;
    security_answer: string;
    new_password: string;
  }): Promise<AuthResetPasswordResponse> {
    return apiClient.post<AuthResetPasswordResponse>(
      '/api/v1/auth/reset-password',
      data,
    );
  },

  listSecurityQuestions(): Promise<{ questions: string[] }> {
    return apiClient.get<{ questions: string[] }>('/api/v1/auth/security-questions');
  },

  me(): Promise<CurrentUser> {
    return apiClient.get<CurrentUser>('/api/v1/auth/me');
  },
};

export type AiPendingAction = {
  action_id: string;
  action_type: string;
  summary: string;
  payload?: Record<string, unknown> | null;
};

export type AiChatResponse = {
  conversation_id: string;
  reply: string;
  pending_action?: AiPendingAction | null;
};

export type AiConfirmResponse = {
  reply: string;
  result?: Record<string, unknown> | null;
};

export const aiService = {
  chat(data: {
    message: string;
    conversation_id?: string | null;
    page_context?: Record<string, string | null | undefined>;
  }): Promise<AiChatResponse> {
    return apiClient.post<AiChatResponse>('/api/v1/ai/chat', data);
  },

  confirm(data: {
    action_id: string;
    conversation_id?: string | null;
  }): Promise<AiConfirmResponse> {
    return apiClient.post<AiConfirmResponse>('/api/v1/ai/confirm', data);
  },
};

export const approvalService = {
  me(): Promise<CurrentUser> {
    return authService.me();
  },

  submit(module: string, documentId: string, comments?: string) {
    return apiClient.post(`/api/v1/transactions/${module}/${documentId}/submit`, {
      comments,
    });
  },

  approve(module: string, documentId: string, comments?: string) {
    return apiClient.post(`/api/v1/transactions/${module}/${documentId}/approve`, {
      comments,
    });
  },

  reject(module: string, documentId: string, comments?: string) {
    return apiClient.post(`/api/v1/transactions/${module}/${documentId}/reject`, {
      comments,
    });
  },

  /** @deprecated use reject */
  decline(module: string, documentId: string, comments?: string) {
    return this.reject(module, documentId, comments);
  },

  getHistory(module: string, documentId: string): Promise<ApprovalHistory[]> {
    return apiClient.get<ApprovalHistory[]>(
      `/api/v1/transactions/${module}/${documentId}/approval-history`,
    );
  },
};

export const adminRbacService = {
  listRoles() {
    return apiClient.get<import('../types').RoleDetail[]>('/api/v1/admin/roles');
  },
  createRole(data: {
    role_id: string;
    role_name: string;
    description?: string | null;
    permission_codes?: string[];
  }) {
    return apiClient.post<import('../types').RoleDetail>('/api/v1/admin/roles', data);
  },
  updateRole(
    roleId: string,
    data: {
      role_name?: string;
      description?: string | null;
      permission_codes?: string[];
    }
  ) {
    return apiClient.patch<import('../types').RoleDetail>(
      `/api/v1/admin/roles/${roleId}`,
      data
    );
  },
  deleteRole(roleId: string) {
    return apiClient.delete<void>(`/api/v1/admin/roles/${roleId}`);
  },
  listPermissions() {
    return apiClient.get<import('../types').Permission[]>('/api/v1/admin/permissions');
  },
  createPermission(data: {
    id: string;
    code: string;
    module: string;
    description?: string | null;
  }) {
    return apiClient.post<import('../types').Permission>('/api/v1/admin/permissions', data);
  },
  updatePermission(
    permissionId: string,
    data: {
      code?: string;
      module?: string;
      description?: string | null;
    }
  ) {
    return apiClient.patch<import('../types').Permission>(
      `/api/v1/admin/permissions/${permissionId}`,
      data
    );
  },
  deletePermission(permissionId: string) {
    return apiClient.delete<void>(`/api/v1/admin/permissions/${permissionId}`);
  },
  listUsers() {
    return apiClient.get<import('../types').UserSummary[]>('/api/v1/admin/users');
  },
  assignRoles(userId: string, roleIds: string[]) {
    return apiClient.post<import('../types').UserSummary>(
      `/api/v1/admin/users/${userId}/roles`,
      { role_ids: roleIds },
    );
  },
  listWorkflows(module?: string) {
    return apiClient.get<import('../types').WorkflowDefinition[]>(
      '/api/v1/admin/workflows',
      module ? { params: { module } } : undefined,
    );
  },
  createWorkflow(data: {
    id: string;
    module: string;
    min_amount: number;
    max_amount?: number | null;
    is_active?: boolean;
    name?: string | null;
    steps?: import('../types').WorkflowStep[];
  }) {
    return apiClient.post<import('../types').WorkflowDefinition>(
      '/api/v1/admin/workflows',
      data
    );
  },
  updateWorkflow(
    workflowId: string,
    data: {
      module?: string;
      min_amount?: number;
      max_amount?: number | null;
      is_active?: boolean;
      name?: string | null;
      steps?: Array<{
        id: string;
        step_number: number;
        step_name: string;
        required_role_id?: string | null;
        required_permission?: string | null;
      }>;
    }
  ) {
    return apiClient.patch<import('../types').WorkflowDefinition>(
      `/api/v1/admin/workflows/${workflowId}`,
      data
    );
  },
  deleteWorkflow(workflowId: string) {
    return apiClient.delete<void>(`/api/v1/admin/workflows/${workflowId}`);
  },
};

export type DataImportWarning = {
  entity: string
  id: string
  message: string
}

export type DataImportLocation = {
  location_id: string
  location_type: string
  location_code?: string | null
  location_name?: string
  attention_to?: string | null
  address_line1?: string
  address_line2?: string | null
  city?: string
  state?: string | null
  postal_code?: string
  country?: string
  contact_person?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  is_default?: boolean
  tax_id?: string | null
  shipping_instructions?: string | null
  address_display?: string | null
}

export type DataImportCustomer = {
  customer_id: string
  customer_number_ext?: string | null
  company_name: string
  tax_id_type?: string | null
  tax_id?: string | null
  industry_type?: string | null
  facility_type?: string | null
  website?: string | null
  primary_contact_name?: string | null
  primary_email?: string | null
  primary_phone?: string | null
  currency?: string
  credit_limit?: string
  payment_terms?: string | null
  preferred_incoterms?: string | null
  tax_exempt?: boolean
  tax_exempt_certificate_id?: string | null
  status: string
  created_at?: string | null
  updated_at?: string | null
  has_address: boolean
  address_display?: string | null
  locations: DataImportLocation[]
  warnings: string[]
}

export type DataImportSupplier = {
  supplier_id: string
  company_name: string
  contact_name?: string | null
  contact_email?: string | null
  phone_number?: string | null
  address_line1?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country?: string | null
  vendor_number_ext?: string | null
  payment_terms?: string | null
  status?: string | null
  vendor_type: string
  tax_id?: string | null
  tax_document_type?: string | null
  is_overseas?: boolean
  currency?: string
  ap_account_id?: string | null
  payment_method?: string | null
  incoterms?: string | null
  incoterm_location?: string | null
  country_of_origin?: string | null
  bank_name?: string | null
  swift_code?: string | null
  iban_account_number?: string | null
  bank_address?: string | null
  intermediary_bank_name?: string | null
  intermediary_swift_code?: string | null
  intermediary_routing_aba?: string | null
  lead_time_days?: number | string | null
  work_center_id?: string | null
  consignment_stock_loc_id?: string | null
  standard_scrap_rate?: string | null
  iso_certified?: boolean
  qc_status?: string | null
  notes?: string | null
  address_line2?: string | null
  created_at?: string | null
  updated_at?: string | null
  has_address: boolean
  address_display?: string | null
  warnings: string[]
}

export type DataImportItem = {
  item_id: string
  customer_part_number: string
  description?: string | null
  uom?: string
  unit_price?: string | null
  on_hand_quantity?: number | string
  wip_quantity?: number | string
  is_outside_processed?: boolean
  is_purchase_item?: boolean
  is_subcontract_assembly?: boolean
  is_raw_material?: boolean
  flags: string[]
  vendor_id?: string | null
  vendor_cost?: string | null
  vendor_mappings?: DataImportVendorMapping[]
  warnings: string[]
}

export type DataImportVendorMapping = {
  mapping_id?: string | number | null
  supplier_id: string
  item_id: string
  vendor_sku?: string | null
  unit_cost?: string | null
  minimum_order_qty?: string | null
  lead_time_days?: number | string | null
  is_primary_vendor?: boolean
  created_at?: string | null
}

export type DataImportBomLine = {
  bom_id?: string | number | null
  bom_header_id?: string | number | null
  parent_item_id: string
  component_item_id: string
  component_code?: string | null
  quantity_per: string
  item_type?: string
  scrap_factor: string
  yield_loss_percentage?: string
  version_no?: number | string | null
  status?: string | null
  created_at?: string | null
  parent_description?: string | null
  component_description?: string | null
}

export type DataImportAccount = {
  account_code: string
  account_name: string
  account_type: string
  type_basis: string
  warnings: string[]
}

export type DataImportFileInfo = {
  name: string
  size: number
} | null

export type DataImportPreview = {
  dry_run: boolean
  ready: boolean
  data_dir: string
  missing: string[]
  files: Record<string, DataImportFileInfo>
  source_files: Record<string, string>
  counts: {
    customers: number
    suppliers: number
    items: number
    bom: number
    accounts?: number
    customers_with_address: number
    suppliers_with_address: number
    warnings: number
  }
  warnings: DataImportWarning[]
  customers: DataImportCustomer[]
  suppliers: DataImportSupplier[]
  items: DataImportItem[]
  vendor_mappings?: DataImportVendorMapping[]
  bom: DataImportBomLine[]
  accounts?: DataImportAccount[]
}

export const dataImportService = {
  preview() {
    return apiClient.get<DataImportPreview>('/api/v1/admin/data-import/preview')
  },
  upload(files: File[]) {
    const formData = new FormData()
    for (const file of files) {
      formData.append('files', file)
    }
    return apiClient.upload<{ saved: Record<string, string> } & DataImportPreview>(
      '/api/v1/admin/data-import/files',
      formData,
    )
  },
};

// ==========================================
// CHART OF ACCOUNTS SERVICES
// ==========================================

export const chartOfAccountsService = {
  async listAccounts(skip: number = 0, limit: number = 100): Promise<ChartOfAccount[]> {
    return apiClient.get<ChartOfAccount[]>('/api/v1/accounts', {
      params: { skip, limit },
    });
  },

  async getAccount(accountId: string): Promise<ChartOfAccount> {
    return apiClient.get<ChartOfAccount>(`/api/v1/accounts/${accountId}`);
  },

  async createAccount(data: ChartOfAccountCreate): Promise<ChartOfAccount> {
    return apiClient.post<ChartOfAccount>('/api/v1/accounts', data);
  },

  async updateAccount(
    accountId: string,
    data: Partial<ChartOfAccountCreate>,
  ): Promise<ChartOfAccount> {
    return apiClient.patch<ChartOfAccount>(`/api/v1/accounts/${accountId}`, data);
  },

  async deleteAccount(accountId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/accounts/${accountId}`);
  },
};

// ==========================================
// ACCOUNTS RECEIVABLE (AR INVOICE) SERVICES
// ==========================================

export const arInvoiceService = {
  /**
   * Fetch all AR invoices with pagination
   */
  async listInvoices(skip: number = 0, limit: number = 100): Promise<ARInvoice[]> {
    return apiClient.get<ARInvoice[]>('/api/v1/ar-invoices', {
      params: { skip, limit },
    });
  },

  /**
   * Fetch a single AR invoice by ID
   */
  async getInvoice(invoiceId: string): Promise<ARInvoice> {
    return apiClient.get<ARInvoice>(`/api/v1/ar-invoices/${invoiceId}`);
  },

  /**
   * Record receipt of payment against an AR Invoice.
   * Marks the invoice Paid, creates a Cash Transaction (Check Deposit),
   * and posts a balanced Journal Entry (Debit: Cash, Credit: AR).
   */
  async receivePayment(invoiceId: string): Promise<CashTransaction> {
    return apiClient.post<CashTransaction>(`/api/v1/ar-invoices/${invoiceId}/pay`);
  },
};

// ==========================================
// ACCOUNTS PAYABLE (AP BILL) SERVICES
// ==========================================

export const apBillService = {
  /**
   * Fetch all AP bills with pagination
   */
  async listBills(skip: number = 0, limit: number = 100): Promise<APBill[]> {
    return apiClient.get<APBill[]>('/api/v1/ap-bills', {
      params: { skip, limit },
    });
  },

  /**
   * Fetch a single AP bill by ID
   */
  async getBill(billId: string): Promise<APBill> {
    return apiClient.get<APBill>(`/api/v1/ap-bills/${billId}`);
  },

  /**
   * Record an outgoing payment against an AP Bill.
   * Marks the bill Paid, creates a Cash Transaction (Check Issue),
   * and posts a balanced Journal Entry (Debit: AP, Credit: Cash).
   */
  async makePayment(billId: string): Promise<CashTransaction> {
    return apiClient.post<CashTransaction>(`/api/v1/ap-bills/${billId}/pay`);
  },
};

// ==========================================
// CASH MANAGEMENT SERVICES
// ==========================================

export const cashTransactionService = {
  /**
   * Fetch all cash transactions (chronological ledger) with pagination
   */
  async listTransactions(
    skip: number = 0,
    limit: number = 100
  ): Promise<CashTransaction[]> {
    return apiClient.get<CashTransaction[]>('/api/v1/cash-transactions', {
      params: { skip, limit },
    });
  },

  /**
   * Fetch a single cash transaction by ID
   */
  async getTransaction(transactionId: string): Promise<CashTransaction> {
    return apiClient.get<CashTransaction>(`/api/v1/cash-transactions/${transactionId}`);
  },
};

// ==========================================
// GENERAL LEDGER / JOURNAL ENTRY SERVICES
// ==========================================

export const journalEntryService = {
  /**
   * Fetch all journal entries (with nested ledger postings) with pagination
   */
  async listJournalEntries(
    skip: number = 0,
    limit: number = 100
  ): Promise<JournalEntry[]> {
    return apiClient.get<JournalEntry[]>('/api/v1/journal-entries', {
      params: { skip, limit },
    });
  },

  /**
   * Fetch a single journal entry by ID
   */
  async getJournalEntry(entryId: string): Promise<JournalEntry> {
    return apiClient.get<JournalEntry>(`/api/v1/journal-entries/${entryId}`);
  },

  /**
   * Trigger the batch Month-End Close posting process
   * (flips any Draft journal entries to Posted).
   */
  async runMonthEndClose(): Promise<{
    message: string;
    entries_posted: number;
    journal_entry_ids: string[];
  }> {
    return apiClient.post('/api/v1/journal-entries/month-end-close');
  },
};

// ==========================================
// INVENTORY & WAREHOUSE SERVICES
// ==========================================

export const inventoryService = {
  async listStock(): Promise<InventoryStockItem[]> {
    return apiClient.get<InventoryStockItem[]>('/api/v1/inventory/stock');
  },

  async listMovements(itemId?: string): Promise<StockMovement[]> {
    return apiClient.get<StockMovement[]>('/api/v1/inventory/movements', {
      params: itemId ? { item_id: itemId } : undefined,
    });
  },

  async listWarehouses(skip: number = 0, limit: number = 100): Promise<Warehouse[]> {
    return apiClient.get<Warehouse[]>('/api/v1/inventory/warehouses', {
      params: { skip, limit },
    });
  },

  async listBins(warehouseId?: string): Promise<BinLocation[]> {
    return apiClient.get<BinLocation[]>('/api/v1/inventory/bins', {
      params: warehouseId ? { warehouse_id: warehouseId } : undefined,
    });
  },

  async adjustStock(
    itemId: string,
    quantityDelta: number,
    notes?: string,
  ): Promise<InventoryStockItem> {
    return apiClient.post<InventoryStockItem>('/api/v1/inventory/adjust', {
      item_id: itemId,
      quantity_delta: quantityDelta,
      notes,
    });
  },

  async transferStock(
    itemId: string,
    quantity: number,
    toWarehouseId: string,
    toBinId: string,
  ): Promise<InventoryStockItem> {
    return apiClient.post<InventoryStockItem>('/api/v1/inventory/transfer', {
      item_id: itemId,
      quantity,
      to_warehouse_id: toWarehouseId,
      to_bin_id: toBinId,
    });
  },
};

// ==========================================
// AUDIT LOGS
// ==========================================

export const auditLogService = {
  async listAuditLogs(skip: number = 0, limit: number = 50): Promise<AuditLog[]> {
    return apiClient.get<AuditLog[]>('/api/v1/audit-logs', {
      params: { skip, limit },
    });
  },
};

export const attachmentService = {
  async list(documentType: DocumentType, documentId: string): Promise<DocumentAttachment[]> {
    return apiClient.get<DocumentAttachment[]>('/api/v1/attachments', {
      params: { document_type: documentType, document_id: documentId },
    });
  },

  async upload(
    documentType: DocumentType,
    documentId: string,
    file: File,
    notes?: string,
  ): Promise<DocumentAttachment> {
    const formData = new FormData();
    formData.append('document_type', documentType);
    formData.append('document_id', documentId);
    formData.append('file', file);
    if (notes) formData.append('notes', notes);
    return apiClient.upload<DocumentAttachment>('/api/v1/attachments', formData);
  },

  async download(attachment: DocumentAttachment): Promise<void> {
    return apiClient.download(
      `/api/v1/attachments/${attachment.id}/download`,
      attachment.original_filename,
    );
  },

  async view(attachment: DocumentAttachment): Promise<void> {
    return apiClient.openInViewer(
      `/api/v1/attachments/${attachment.id}/download`,
      attachment.original_filename,
    );
  },

  async remove(attachmentId: number): Promise<void> {
    await apiClient.delete(`/api/v1/attachments/${attachmentId}`);
  },
};

// ==========================================
// EXPORT ALL SERVICES
// ==========================================

export const apiServices = {
  users: userService,
  customers: customerService,
  locations: locationService,
  products: productService,
  salesOrders: salesOrderService,
  vendors: vendorService,
  purchaseOrders: purchaseOrderService,
  itemBom: itemBomService,
  productBom: productBomService,
  subcontractOrders: subcontractOrderService,
  items: itemService,
  subcontractBoms: subcontractBomService,
  chartOfAccounts: chartOfAccountsService,
  arInvoices: arInvoiceService,
  apBills: apBillService,
  cashTransactions: cashTransactionService,
  journalEntries: journalEntryService,
  inventory: inventoryService,
  auditLogs: auditLogService,
  attachments: attachmentService,
};

export default apiServices;
