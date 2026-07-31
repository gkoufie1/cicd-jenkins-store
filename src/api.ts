import type {
  AuditEntry,
  AuthUser,
  InventoryInput,
  InventoryItem,
  InventoryListResponse,
  InventoryQuery,
  InventoryStats,
} from './types';

const TOKEN_KEY = 'storetrack.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(path, { ...options, headers });
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function login(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

export function fetchMe(): Promise<{ isAuthenticated: true; user: AuthUser }> {
  return request('/api/auth/me');
}

export function fetchInventory(query: InventoryQuery): Promise<InventoryListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && value !== 'All') params.set(key, String(value));
  }
  return request(`/api/inventory?${params.toString()}`);
}

export function fetchStats(): Promise<InventoryStats> {
  return request('/api/inventory/stats');
}

export function createItem(input: InventoryInput): Promise<InventoryItem> {
  return request('/api/inventory', { method: 'POST', body: JSON.stringify(input) });
}

export function updateItem(id: string, input: InventoryInput): Promise<InventoryItem> {
  return request(`/api/inventory/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function adjustStock(id: string, payload: { delta?: number; quantity?: number; reason?: string }): Promise<InventoryItem> {
  return request(`/api/inventory/${id}/stock`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function deleteItem(id: string): Promise<{ message: string }> {
  return request(`/api/inventory/${id}`, { method: 'DELETE' });
}

export function fetchAudit(): Promise<AuditEntry[]> {
  return request('/api/audit');
}

export function seedDemoData(): Promise<{ message: string }> {
  return request('/api/inventory/seed', { method: 'POST' });
}
