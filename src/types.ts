export interface AuthUser {
  username: string;
  role: 'admin';
}

export interface InventoryInput {
  itemName: string;
  sku: string;
  category: string;
  quantity: number;
  price: number;
  lowStockThreshold: number;
  notes: string;
}

export interface InventoryItem extends InventoryInput {
  _id: string;
  lastUpdated: string;
}

export interface InventoryListResponse {
  items: InventoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InventoryStats {
  totalItems: number;
  totalUnits: number;
  totalValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  categoriesCount: number;
  categories: string[];
}

export type AuditAction = 'create' | 'update' | 'stock-adjustment' | 'delete' | 'seed' | 'clear';

export interface AuditEntry {
  _id?: string;
  itemId: string;
  itemName: string;
  action: AuditAction;
  previousQuantity?: number;
  newQuantity?: number;
  reason?: string;
  performedBy: string;
  createdAt: string;
}

export type StockStatus = '' | 'low' | 'out' | 'healthy';
export type SortField = 'itemName' | 'category' | 'quantity' | 'price' | 'lowStockThreshold' | 'lastUpdated';
export type SortOrder = 'asc' | 'desc';

export interface InventoryQuery {
  search?: string;
  category?: string;
  stockStatus?: StockStatus;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  page?: number;
  pageSize?: number;
}
