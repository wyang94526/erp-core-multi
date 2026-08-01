/**
 * API Service Functions
 * Contains all data fetching functions for the ERP entities
 */

import { apiClient } from './client';
import type {
  User,
  Customer,
  Location,
  Product,
  SalesOrder,
  Supplier,
  ProductBOMComponent,
  SubcontractOrder,
  MaterialIssue,
  FinishedGoodsReceipt,
} from '../types';

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
   * Fetch all customers with pagination
   */
  async listCustomers(skip: number = 0, limit: number = 100): Promise<Customer[]> {
    return apiClient.get<Customer[]>('/api/v1/customers', {
      params: { skip, limit },
    });
  },

  /**
   * Fetch a single customer by ID
   */
  async getCustomer(customerId: string): Promise<Customer> {
    return apiClient.get<Customer>(`/api/v1/customers/${customerId}`);
  },

  /**
   * Create a new customer
   */
  async createCustomer(data: {
    customer_id: string;
    customer_number_ext?: string;
    company_name: string;
  }): Promise<Customer> {
    return apiClient.post<Customer>('/api/v1/customers', data);
  },

  /**
   * Update a customer
   */
  async updateCustomer(
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
    location_name?: string;
    attention_to?: string;
    address_line1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    contact_email?: string;
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
// PRODUCT SERVICES
// ==========================================

export const productService = {
  /**
   * Fetch all products with pagination
   */
  async listProducts(skip: number = 0, limit: number = 100): Promise<Product[]> {
    return apiClient.get<Product[]>('/api/v1/products', {
      params: { skip, limit },
    });
  },

  /**
   * Fetch a single product by ID
   */
  async getProduct(productId: string): Promise<Product> {
    return apiClient.get<Product>(`/api/v1/products/${productId}`);
  },

  /**
   * Create a new product
   */
  async createProduct(data: {
    product_id: string;
    customer_part_number: string;
    description?: string;
    uom?: string;
    unit_price?: number;
  }): Promise<Product> {
    return apiClient.post<Product>('/api/v1/products', data);
  },

  /**
   * Update a product
   */
  async updateProduct(
    productId: string,
    data: Partial<Product>
  ): Promise<Product> {
    return apiClient.patch<Product>(`/api/v1/products/${productId}`, data);
  },

  /**
   * Delete a product
   */
  async deleteProduct(productId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/products/${productId}`);
  },
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
      product_id: string;
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
// VENDOR / SUPPLIER SERVICES
// ==========================================

export const vendorService = {
  /**
   * Fetch all vendors/suppliers with pagination
   */
  async listVendors(skip: number = 0, limit: number = 100): Promise<Supplier[]> {
    return apiClient.get<Supplier[]>('/api/v1/suppliers/', {
      params: { skip, limit },
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
  async createVendor(data: {
    supplier_id: string;
    company_name: string;
    contact_name?: string;
    contact_email?: string;
    phone_number?: string;
    address_line1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    vendor_number_ext?: string;
    payment_terms?: string;
    status?: string;
  }): Promise<Supplier> {
    return apiClient.post<Supplier>('/api/v1/suppliers/', data);
  },

  /**
   * Update a vendor
   */
  async updateVendor(
    supplierId: string,
    data: Partial<Supplier>
  ): Promise<Supplier> {
    return apiClient.patch<Supplier>(`/api/v1/suppliers/${supplierId}`, data);
  },

  /**
   * Delete a vendor
   */
  async deleteVendor(supplierId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/suppliers/${supplierId}`);
  },
};

// ==========================================
// PRODUCT BOM SERVICES
// ==========================================

export const productBomService = {
  /**
   * List all BOM components (raw materials) for a given finished product
   */
  async listBomComponents(productId: string): Promise<ProductBOMComponent[]> {
    return apiClient.get<ProductBOMComponent[]>(`/api/v1/products/${productId}/bom`);
  },

  /**
   * Add a component/raw-material line to a finished product's BOM
   */
  async addBomComponent(
    productId: string,
    data: { component_product_id: string; quantity_per: number }
  ): Promise<ProductBOMComponent> {
    return apiClient.post<ProductBOMComponent>(`/api/v1/products/${productId}/bom`, data);
  },

  /**
   * Remove a BOM component line
   */
  async deleteBomComponent(productId: string, bomId: number): Promise<void> {
    return apiClient.delete<void>(`/api/v1/products/${productId}/bom/${bomId}`);
  },
};

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
    product_id: string;
    quantity_ordered: number;
    order_date?: string;
    expected_return_date?: string;
    notes?: string;
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
      lines: Array<{ component_product_id: string; quantity_issued: number }>;
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
};

// Re-export related types used by consumers of this module for convenience
export type { MaterialIssue, FinishedGoodsReceipt };

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
  productBom: productBomService,
  subcontractOrders: subcontractOrderService,
};

export default apiServices;
