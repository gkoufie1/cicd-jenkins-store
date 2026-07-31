import type { AuditEntry } from '../types';

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  create: 'Created',
  update: 'Updated',
  'stock-adjustment': 'Stock adjusted',
  delete: 'Deleted',
  seed: 'Demo data seeded',
  clear: 'Cleared',
};

export default function AuditPanel({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="panel">
      <h2>Recent activity</h2>
      {entries.length === 0 ? (
        <p className="empty-state">No activity recorded yet.</p>
      ) : (
        <div className="audit-list">
          {entries.map((entry, index) => (
            <div className="audit-entry" key={entry._id ?? index}>
              <strong>{ACTION_LABEL[entry.action]}</strong> — {entry.itemName}
              {entry.previousQuantity !== undefined && entry.newQuantity !== undefined && (
                <span>
                  {' '}
                  ({entry.previousQuantity} → {entry.newQuantity})
                </span>
              )}
              {entry.reason && <span> — {entry.reason}</span>}
              <div className="meta">
                {entry.performedBy} · {new Date(entry.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
