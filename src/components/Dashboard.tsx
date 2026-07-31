import { useCallback, useEffect, useMemo, useState } from 'react';
import { adjustStock, createItem, deleteItem, fetchAudit, fetchInventory, fetchStats, seedDemoData, updateItem } from '../api';
import type { AuditEntry, AuthUser, InventoryInput, InventoryItem, InventoryStats, SortField, SortOrder, StockStatus } from '../types';
import StatsBar from './StatsBar';
import InventoryTable from './InventoryTable';
import InventoryFormModal from './InventoryFormModal';
import AuditPanel from './AuditPanel';

const PAGE_SIZE = 10;

export default function Dashboard({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<InventoryStats | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [stockStatus, setStockStatus] = useState<StockStatus>('');
  const [sortBy, setSortBy] = useState<SortField>('itemName');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const [modalItem, setModalItem] = useState<InventoryItem | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchInventory({ search, category, stockStatus, sortBy, sortOrder, page, pageSize: PAGE_SIZE });
      setItems(response.items);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load inventory.');
    } finally {
      setLoading(false);
    }
  }, [search, category, stockStatus, sortBy, sortOrder, page]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await fetchStats());
    } catch {
      // Stats are supplementary; a failure here shouldn't block the table.
    }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      setAuditEntries(await fetchAudit());
    } catch {
      // Same as stats: non-critical for the main workflow.
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (showAudit) void loadAudit();
  }, [showAudit, loadAudit]);

  useEffect(() => {
    setPage(1);
  }, [search, category, stockStatus]);

  const refreshAfterMutation = useCallback(async () => {
    await Promise.all([loadInventory(), loadStats()]);
    if (showAudit) await loadAudit();
  }, [loadInventory, loadStats, showAudit, loadAudit]);

  function handleSortChange(field: SortField) {
    if (field === sortBy) {
      setSortOrder((order) => (order === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  }

  async function handleSave(input: InventoryInput) {
    if (modalItem && modalItem !== 'new') {
      await updateItem(modalItem._id, input);
    } else {
      await createItem(input);
    }
    setModalItem(null);
    await refreshAfterMutation();
  }

  async function handleAdjustStock(item: InventoryItem, delta: number) {
    try {
      await adjustStock(item._id, { delta });
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not adjust stock.');
    }
  }

  async function handleDelete(item: InventoryItem) {
    if (!window.confirm(`Delete "${item.itemName}"? This cannot be undone.`)) return;
    try {
      await deleteItem(item._id);
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the item.');
    }
  }

  async function handleSeed() {
    if (!window.confirm('Load demo inventory? This replaces the current items.')) return;
    try {
      await seedDemoData();
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load demo data.');
    }
  }

  const categoryOptions = useMemo(() => ['All', ...(stats?.categories ?? [])], [stats]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>StoreTrack</h1>
        <div className="user-row">
          <span>{user.username}</span>
          <button type="button" className="btn" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main">
        <StatsBar stats={stats} />

        {error && <div className="alert alert-error">{error}</div>}

        <div className="toolbar">
          <input placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select value={stockStatus} onChange={(e) => setStockStatus(e.target.value as StockStatus)}>
            <option value="">All stock levels</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
            <option value="healthy">Healthy</option>
          </select>
          <div className="spacer" />
          <button type="button" className="btn" onClick={() => setShowAudit((value) => !value)}>
            {showAudit ? 'Hide activity' : 'Show activity'}
          </button>
          <button type="button" className="btn" onClick={handleSeed}>
            Load demo data
          </button>
          <button type="button" className="btn btn-primary" style={{ width: 'auto' }} onClick={() => setModalItem('new')}>
            Add item
          </button>
        </div>

        {loading ? (
          <div className="empty-state">Loading inventory…</div>
        ) : (
          <InventoryTable
            items={items}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChange={handleSortChange}
            onAdjustStock={handleAdjustStock}
            onEdit={setModalItem}
            onDelete={handleDelete}
          />
        )}

        <div className="pagination">
          <span>
            Page {page} of {totalPages} · {total} item{total === 1 ? '' : 's'}
          </span>
          <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            Previous
          </button>
          <button type="button" className="btn" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
            Next
          </button>
        </div>

        {showAudit && <AuditPanel entries={auditEntries} />}
      </main>

      {modalItem && (
        <InventoryFormModal item={modalItem === 'new' ? null : modalItem} onSave={handleSave} onClose={() => setModalItem(null)} />
      )}
    </div>
  );
}
