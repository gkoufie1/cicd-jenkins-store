import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { before, test } from 'node:test';
import request from 'supertest';
import { app } from '../server';

let token: string;

before(async () => {
  const response = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'test-password' });
  token = response.body.token;
});

function authedRequest(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

test('rejects creating an item without authentication', async () => {
  const response = await request(app)
    .post('/api/inventory')
    .send({ itemName: 'Test', sku: 'X', category: 'Y', quantity: 1, price: 1, lowStockThreshold: 1, notes: '' });
  assert.equal(response.status, 401);
});

test('rejects an invalid payload with a friendly validation message', async () => {
  const response = await authedRequest('post', '/api/inventory').send({
    itemName: '',
    sku: 'X',
    category: 'Y',
    quantity: 1,
    price: 1,
    lowStockThreshold: 1,
    notes: '',
  });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Item name is required/);
});

test('creates, lists, updates, adjusts stock, audits, and deletes an inventory item', async () => {
  const sku = `TEST-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();

  const created = await authedRequest('post', '/api/inventory').send({
    itemName: 'Integration Test Widget',
    sku,
    category: 'Test Category',
    quantity: 10,
    price: 2.5,
    lowStockThreshold: 3,
    notes: 'created by tests',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.sku, sku);
  const id = created.body._id as string;

  const list = await request(app).get('/api/inventory').query({ search: sku });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0]._id, id);

  const updated = await authedRequest('put', `/api/inventory/${id}`).send({
    itemName: 'Integration Test Widget',
    sku,
    category: 'Test Category',
    quantity: 10,
    price: 3,
    lowStockThreshold: 3,
    notes: 'updated by tests',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.price, 3);

  const increased = await authedRequest('patch', `/api/inventory/${id}/stock`).send({ delta: 5, reason: 'restock' });
  assert.equal(increased.status, 200);
  assert.equal(increased.body.quantity, 15);

  const setDirect = await authedRequest('patch', `/api/inventory/${id}/stock`).send({ quantity: 2 });
  assert.equal(setDirect.status, 200);
  assert.equal(setDirect.body.quantity, 2);

  // Would drive quantity negative — must be rejected, not clamped or wrapped.
  const overDrawn = await authedRequest('patch', `/api/inventory/${id}/stock`).send({ delta: -100 });
  assert.equal(overDrawn.status, 400);

  const invalidBoth = await authedRequest('patch', `/api/inventory/${id}/stock`).send({ delta: 1, quantity: 1 });
  assert.equal(invalidBoth.status, 400);

  const audit = await authedRequest('get', '/api/audit');
  assert.equal(audit.status, 200);
  const entries = audit.body as { itemId: string; action: string }[];
  assert.ok(entries.some((entry) => entry.itemId === id && entry.action === 'create'));
  assert.ok(entries.some((entry) => entry.itemId === id && entry.action === 'stock-adjustment'));

  const deleted = await authedRequest('delete', `/api/inventory/${id}`);
  assert.equal(deleted.status, 200);

  const afterDelete = await authedRequest('patch', `/api/inventory/${id}/stock`).send({ delta: 1 });
  assert.equal(afterDelete.status, 404);
});

test('GET /api/inventory/stats reflects current inventory', async () => {
  const response = await request(app).get('/api/inventory/stats');
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.totalItems, 'number');
  assert.ok(Array.isArray(response.body.categories));
});
