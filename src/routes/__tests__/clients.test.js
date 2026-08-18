vi.mock('@supabase/supabase-js', async () => {
  const { supabaseAdmin } = await import('../../../tests/helpers/supabaseMock.mjs');
  return { createClient: () => supabaseAdmin };
});

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setResults, queriesOnTable } from '../../../tests/helpers/supabaseMock.mjs';

import app from '../../index.js';

const token = jwt.sign({ userId: 'user-1', email: 'owner@test.com' }, process.env.JWT_SECRET);

beforeEach(() => {
  setResults();
});

describe('GET /api/clients', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/clients');
    expect(res.status).toBe(401);
  });

  it('returns all clients scoped to the user', async () => {
    setResults({ data: [{ id: 'cli-1', name: 'Acme' }], error: null });
    const res = await request(app).get('/api/clients').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const query = queriesOnTable('clients')[0];
    expect(query).toEqual(expect.arrayContaining([['eq', 'user_id', 'user-1']]));
  });

  it('passes a search filter through as a wildcard OR query', async () => {
    setResults({ data: [], error: null });
    await request(app).get('/api/clients?search=acme').set('Authorization', `Bearer ${token}`);
    const query = queriesOnTable('clients')[0];
    expect(query.some(([m, k]) => m === 'or' && String(k).includes('acme'))).toBe(true);
  });
});

describe('POST /api/clients', () => {
  it('rejects a client without a name', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Client name is required');
  });

  it('rejects an invalid email format', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid email format');
  });

  it('creates a client with trimmed values scoped to the user', async () => {
    setResults({ data: { id: 'cli-1', name: 'Acme' }, error: null });
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '  Acme  ', email: '  a@b.com  ' });
    expect(res.status).toBe(201);
    const insert = queriesOnTable('clients')[0];
    const payload = insert.find(([m]) => m === 'insert')[1];
    expect(payload.name).toBe('Acme');
    expect(payload.email).toBe('a@b.com');
    expect(payload.user_id).toBe('user-1');
  });
});

describe('PUT /api/clients/:id', () => {
  it('rejects an empty name', async () => {
    const res = await request(app)
      .put('/api/clients/cli-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Client name cannot be empty');
  });

  it('updates the client scoped to the user', async () => {
    setResults({ data: { id: 'cli-1', name: 'New' }, error: null });
    const res = await request(app)
      .put('/api/clients/cli-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New', phone: '123' });
    expect(res.status).toBe(200);
    const query = queriesOnTable('clients')[0];
    expect(query).toEqual(expect.arrayContaining([['eq', 'id', 'cli-1'], ['eq', 'user_id', 'user-1']]));
  });

  it('returns 404 when the client is missing/foreign', async () => {
    setResults({ data: null, error: { code: 'PGRST116', message: 'not found' } });
    const res = await request(app)
      .put('/api/clients/foreign')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/clients/:id', () => {
  it('verifies ownership then deletes', async () => {
    setResults({ data: { id: 'cli-1' }, error: null }, { data: null, error: null });
    const res = await request(app).delete('/api/clients/cli-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Client deleted successfully');
    const deleteQuery = queriesOnTable('clients')[1];
    expect(deleteQuery.some(([m]) => m === 'delete')).toBe(true);
    expect(deleteQuery).toEqual(expect.arrayContaining([['eq', 'user_id', 'user-1']]));
  });

  it('returns 404 if the client does not belong to the user', async () => {
    setResults({ data: null, error: { code: 'PGRST116', message: 'not found' } });
    const res = await request(app).delete('/api/clients/foreign').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});