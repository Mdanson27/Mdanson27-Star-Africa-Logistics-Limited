import { apiRequest } from "@/lib/api";

export interface InventoryCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryUnit {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  unit_id: string | null;
  unit_code: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  unit_cost_ugx: number;
  minimum_stock_level: number;
  total_quantity: number;
  total_value_ugx: number;
  is_low_stock: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WarehouseLocation {
  id: string;
  warehouse_id: string;
  parent_location_id: string | null;
  code: string;
  name: string;
  location_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockBalance {
  id: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  warehouse_id: string;
  warehouse_name: string;
  location_id: string | null;
  location_name: string | null;
  project_id: string | null;
  project_name: string | null;
  quantity: number;
  unit_cost_ugx: number;
  value_ugx: number;
}

export interface StockTransaction {
  id: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  movement_type: string;
  quantity: number;
  unit_cost_ugx: number;
  from_warehouse_id: string | null;
  from_location_id: string | null;
  from_project_id: string | null;
  to_warehouse_id: string | null;
  to_location_id: string | null;
  to_project_id: string | null;
  reference: string | null;
  notes: string | null;
  created_by_email: string;
  created_at: string;
}

export interface InventoryDashboard {
  items: number;
  warehouses: number;
  total_quantity: number;
  inventory_value_ugx: number;
  low_stock_items: number;
  project_stock_value_ugx: number;
  recent_movements: StockTransaction[];
}

export interface StockRequest {
  id: string;
  project_id: string;
  project_name: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  requested_quantity: number;
  approved_quantity: number;
  status: string;
  requested_by_email: string;
  approved_by_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const qs = (values: Record<string, string | number | boolean | null | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const result = params.toString();
  return result ? `?${result}` : "";
};

export const inventoryApi = {
  dashboard: () => apiRequest<InventoryDashboard>("/inventory/dashboard"),
  categories: () => apiRequest<InventoryCategory[]>("/inventory/categories"),
  createCategory: (body: Record<string, unknown>) =>
    apiRequest<InventoryCategory>("/inventory/categories", { method: "POST", body: JSON.stringify(body) }),
  units: () => apiRequest<InventoryUnit[]>("/inventory/units"),
  createUnit: (body: Record<string, unknown>) =>
    apiRequest<InventoryUnit>("/inventory/units", { method: "POST", body: JSON.stringify(body) }),
  items: (options: { q?: string; low_stock?: boolean; include_inactive?: boolean } = {}) =>
    apiRequest<InventoryItem[]>(`/inventory/items${qs(options)}`),
  createItem: (body: Record<string, unknown>) =>
    apiRequest<InventoryItem>("/inventory/items", { method: "POST", body: JSON.stringify(body) }),
  updateItem: (id: string, body: Record<string, unknown>) =>
    apiRequest<InventoryItem>(`/inventory/items/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  warehouses: () => apiRequest<Warehouse[]>("/inventory/warehouses"),
  createWarehouse: (body: Record<string, unknown>) =>
    apiRequest<Warehouse>("/inventory/warehouses", { method: "POST", body: JSON.stringify(body) }),
  locations: (warehouseId?: string) =>
    apiRequest<WarehouseLocation[]>(`/inventory/locations${qs({ warehouse_id: warehouseId })}`),
  createLocation: (body: Record<string, unknown>) =>
    apiRequest<WarehouseLocation>("/inventory/locations", { method: "POST", body: JSON.stringify(body) }),
  balances: (options: { project_id?: string; warehouse_id?: string } = {}) =>
    apiRequest<StockBalance[]>(`/inventory/balances${qs(options)}`),
  projectStock: (projectId: string) => apiRequest<StockBalance[]>(`/inventory/projects/${projectId}`),
  movements: (options: { item_id?: string; project_id?: string; limit?: number } = {}) =>
    apiRequest<StockTransaction[]>(`/inventory/movements${qs(options)}`),
  createMovement: (body: Record<string, unknown>) =>
    apiRequest<StockTransaction>("/inventory/movements", { method: "POST", body: JSON.stringify(body) }),
  requests: (projectId?: string) =>
    apiRequest<StockRequest[]>(`/inventory/requests${qs({ project_id: projectId })}`),
  createRequest: (body: Record<string, unknown>) =>
    apiRequest<StockRequest>("/inventory/requests", { method: "POST", body: JSON.stringify(body) }),
  updateRequest: (id: string, body: Record<string, unknown>) =>
    apiRequest<StockRequest>(`/inventory/requests/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  issueRequest: (id: string, body: Record<string, unknown>) =>
    apiRequest<StockRequest>(`/inventory/requests/${id}/issue`, { method: "POST", body: JSON.stringify(body) }),
};
