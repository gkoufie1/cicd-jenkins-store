import { useState } from 'react';
import type { FormEvent } from 'react';
import type { InventoryInput, InventoryItem } from '../types';

const EMPTY_FORM: InventoryInput = {
  itemName: '',
  sku: '',
  category: '',
  quantity: 0,
  price: 0,
  lowStockThreshold: 0,
  notes: '',
};

export default function InventoryFormModal({
  item,
  onSave,
  onClose,
}: {
  item: InventoryItem | null;
  onSave: (input: InventoryInput) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<InventoryInput>(item ? { ...item } : EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function updateField<K extends keyof InventoryInput>(key: K, value: InventoryInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the item.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h2>{item ? 'Edit item' : 'Add item'}</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field field-full">
              <label htmlFor="itemName">Item name</label>
              <input id="itemName" value={form.itemName} onChange={(e) => updateField('itemName', e.target.value)} maxLength={120} required />
            </div>
            <div className="field">
              <label htmlFor="sku">SKU</label>
              <input id="sku" value={form.sku} onChange={(e) => updateField('sku', e.target.value)} maxLength={64} required />
            </div>
            <div className="field">
              <label htmlFor="category">Category</label>
              <input id="category" value={form.category} onChange={(e) => updateField('category', e.target.value)} maxLength={80} required />
            </div>
            <div className="field">
              <label htmlFor="quantity">Quantity</label>
              <input
                id="quantity"
                type="number"
                min={0}
                step={1}
                value={form.quantity}
                onChange={(e) => updateField('quantity', Number(e.target.value))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="price">Price</label>
              <input
                id="price"
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={(e) => updateField('price', Number(e.target.value))}
                required
              />
            </div>
            <div className="field field-full">
              <label htmlFor="lowStockThreshold">Low-stock threshold</label>
              <input
                id="lowStockThreshold"
                type="number"
                min={0}
                step={1}
                value={form.lowStockThreshold}
                onChange={(e) => updateField('lowStockThreshold', Number(e.target.value))}
                required
              />
            </div>
            <div className="field field-full">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" rows={2} maxLength={500} value={form.notes} onChange={(e) => updateField('notes', e.target.value)} />
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
