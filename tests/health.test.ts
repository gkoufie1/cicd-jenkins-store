import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { app } from '../server';

test('GET /api/health/live returns ok without touching the database', async () => {
  const response = await request(app).get('/api/health/live');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('GET /api/health reports the in-memory dev fallback when MongoDB is not configured', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.database, 'development-memory');
});

test('unknown /api routes return a 404 with a JSON error body', async () => {
  const response = await request(app).get('/api/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal(typeof response.body.error, 'string');
});
