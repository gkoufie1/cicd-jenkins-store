import type { InventoryStats } from '../types';

export default function StatsBar({ stats }: { stats: InventoryStats | null }) {
  const tiles = [
    { label: 'Items', value: stats?.totalItems ?? '—' },
    { label: 'Units in stock', value: stats?.totalUnits ?? '—' },
    { label: 'Inventory value', value: stats ? `$${stats.totalValue.toFixed(2)}` : '—' },
    { label: 'Low stock', value: stats?.lowStockCount ?? '—' },
    { label: 'Out of stock', value: stats?.outOfStockCount ?? '—' },
    { label: 'Categories', value: stats?.categoriesCount ?? '—' },
  ];

  return (
    <div className="stats-grid">
      {tiles.map((tile) => (
        <div className="stat-tile" key={tile.label}>
          <div className="label">{tile.label}</div>
          <div className="value">{tile.value}</div>
        </div>
      ))}
    </div>
  );
}
