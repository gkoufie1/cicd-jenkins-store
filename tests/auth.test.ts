import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { app } from '../server';

// ADMIN_USERNAME=admin / ADMIN_PASSWORD=test-password come from the `test`
// script in package.json (dev-mode password comparison, no hash needed).

test('rejects login with the wrong password', async () => {
  const response = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong-password' });
  assert.equal(response.status, 401);
});

test('rejects login with an unknown username', async () => {
  const response = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'test-password' });
  assert.equal(response.status, 401);
});

test('logs in with valid admin credentials and returns a bearer token', async () => {
  const response = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'test-password' });
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.token, 'string');
  assert.equal(response.body.user.username, 'admin');
});

test('GET /api/auth/me requires a bearer token', async () => {
  const response = await request(app).get('/api/auth/me');
  assert.equal(response.status, 401);
});

test('GET /api/auth/me returns the authenticated user for a valid token', async () => {
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'test-password' });
  const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.user.username, 'admin');
});

test('GET /api/auth/me rejects a malformed token', async () => {
  const response = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
  assert.equal(response.status, 401);
});
