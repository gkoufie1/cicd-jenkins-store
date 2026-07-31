import type { InventoryItem, SortField, SortOrder } from '../types';

const COLUMNS: { key: SortField; label: string }[] = [
  { key: 'itemName', label: 'Item' },
  { key: 'category', label: 'Category' },
  { key: 'quantity', label: 'Qty' },
  { key: 'price', label: 'Price' },
  { key: 'lowStockThreshold', label: 'Threshold' },
  { key: 'lastUpdated', label: 'Updated' },
];

function stockBadge(item: InventoryItem) {
  if (item.quantity === 0) return <span className="badge badge-danger">Out of stock</span>;
  if (item.quantity <= item.lowStockThreshold) return <span className="badge badge-warn">Low stock</span>;
  return <span className="badge badge-ok">Healthy</span>;
}

export default function InventoryTable({
  items,
  sortBy,
  sortOrder,
  onSortChange,
  onAdjustStock,
  onEdit,
  onDelete,
}: {
  items: InventoryItem[];
  sortBy: SortField;
  sortOrder: SortOrder;
  onSortChange: (field: SortField) => void;
  onAdjustStock: (item: InventoryItem, delta: number) => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="table-wrap">
        <div className="empty-state">No inventory items match the current filters.</div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key}>
                <button type="button" onClick={() => onSortChange(column.key)}>
                  {column.label}
                  {sortBy === column.key ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
              </th>
            ))}
            <th>Status</th>
            <th>SKU</th>
            <th>Stock</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item._id}>
              <td>{item.itemName}</td>
              <td>{item.category}</td>
              <td>{item.quantity}</td>
              <td>${item.price.toFixed(2)}</td>
              <td>{item.lowStockThreshold}</td>
              <td>{new Date(item.lastUpdated).toLocaleString()}</td>
              <td>{stockBadge(item)}</td>
              <td>{item.sku}</td>
              <td>
                <div className="stock-controls">
                  <button type="button" onClick={() => onAdjustStock(item, -1)} disabled={item.quantity <= 0} aria-label={`Decrease ${item.itemName} stock`}>
                    −
                  </button>
                  <button type="button" onClick={() => onAdjustStock(item, 1)} aria-label={`Increase ${item.itemName} stock`}>
                    +
                  </button>
                </div>
              </td>
              <td>
                <div className="row-actions">
                  <button type="button" className="btn" onClick={() => onEdit(item)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => onDelete(item)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
