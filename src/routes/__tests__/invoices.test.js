import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setResults, queriesOnTable } from '../../../tests/helpers/supabaseMock.mjs';

import app from '../../index.js';

const token = jwt.sign({ userId: 'user-1', email: 'owner@test.com' }, process.env.JWT_SECRET);

const validItems = [{ description: 'Consulting', quantity: 2, rate: 100, discount: 10 }];

beforeEach(() => {
  setResults();
});

describe('authentication', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/invoices');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Access token required');
  });

  it('rejects requests with an invalid token', async () => {
    const res = await request(app).get('/api/invoices').set('Authorization', 'Bearer bad.token.here');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/invoices', () => {
  it('returns an empty array when there are no invoices', async () => {
    setResults({ data: [], error: null });
    const res = await request(app).get('/api/invoices').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('batches items by invoice (no N+1) and resolves overdue status', async () => {
    const invoices = [
      { id: 'inv-1', status: 'sent', due_date: '2020-01-01', user_id: 'user-1' },
      { id: 'inv-2', status: 'draft', due_date: null, user_id: 'user-1' },
    ];
    const items = [
      { id: 'it-1', invoice_id: 'inv-1', description: 'A' },
      { id: 'it-2', invoice_id: 'inv-2', description: 'B' },
    ];
    setResults({ data: invoices, error: null }, { data: items, error: null });

    const res = await request(app).get('/api/invoices').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].status).toBe('overdue');
    expect(res.body[0].items).toHaveLength(1);
    expect(res.body[1].status).toBe('draft');
    expect(res.body[1].items).toHaveLength(1);

    const invoiceQuery = queriesOnTable('invoices')[0];
    const itemQuery = queriesOnTable('invoice_items')[0];
    expect(itemQuery).toEqual(expect.arrayContaining([['from', 'invoice_items'], ['select', '*'], ['in', 'invoice_id', ['inv-1', 'inv-2']]]));
    expect(invoiceQuery.some(([m, k]) => m === 'eq' && k === 'user_id')).toBe(true);
  });

  it('passes status/client/date filters through to the query', async () => {
    setResults({ data: [], error: null });
    const res = await request(app)
      .get('/api/invoices?status=sent&client_id=cli-1&from_date=2024-01-01&to_date=2024-12-31')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const query = queriesOnTable('invoices')[0];
    expect(query).toEqual(expect.arrayContaining([['eq', 'status', 'sent'], ['eq', 'client_id', 'cli-1'], ['gte', 'due_date', '2024-01-01'], ['lte', 'due_date', '2024-12-31']]));
  });
});

describe('POST /api/invoices', () => {
  const freeUser = { subscription_plan: 'free' };

  it('requires a client', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: validItems });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Client is required');
  });

  it('rejects invalid items (regression: non-numeric quantity)', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 'cli-1', items: [{ description: 'x', quantity: 'abc', rate: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quantity/);
  });

  it('rejects items with a missing description', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 'cli-1', items: [{ quantity: 1, rate: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/);
  });

  it('rejects a client that does not belong to the user', async () => {
    setResults({ data: null, error: null });
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 'foreign-cli', items: validItems });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid client');
    const clientQuery = queriesOnTable('clients')[0];
    expect(clientQuery).toEqual(expect.arrayContaining([['eq', 'user_id', 'user-1']]));
  });

  it('creates an invoice with server-side totals and auto-generated number', async () => {
    setResults(
      { data: { id: 'cli-1' }, error: null },                                    // client exists
      { data: freeUser, error: null },                                           // subscription
      { count: 2, error: null },                                                 // invoice count
      { data: { invoice_number: 'INV-0007' }, error: null },                     // last invoice
      { data: { id: 'inv-1', invoice_number: 'INV-0008', status: 'draft' }, error: null }, // insert invoice
      { data: null, error: null },                                               // insert items
      { data: validItems.map((i) => ({ id: 'it-1', ...i })), error: null }       // select items
    );

    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 'cli-1', issue_date: '2024-05-01', due_date: '2024-06-01', vat_enabled: true, tax_rate: 0.075, items: validItems });

    expect(res.status).toBe(201);
    expect(res.body.invoice_number).toBe('INV-0008');

    const invoiceInsert = queriesOnTable('invoices').find((q) => q.some(([m]) => m === 'insert'));
    expect(invoiceInsert).toBeDefined();
    const insertCall = invoiceInsert.find(([m]) => m === 'insert');
    const payload = insertCall[1];
    expect(payload.invoice_number).toBe('INV-0008');
    expect(payload.subtotal).toBe(180);
    expect(payload.vat).toBe(13.5);
    expect(payload.total).toBe(193.5);
    expect(payload.vat_enabled).toBe(true);
  });

  it('returns 403 LIMIT_REACHED when a free user hits 10 invoices', async () => {
    setResults(
      { data: { id: 'cli-1' }, error: null },
      { data: freeUser, error: null },
      { count: 10, error: null }
    );
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 'cli-1', items: validItems });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LIMIT_REACHED');
  });

  it('skips the free-plan count check for active enterprise users', async () => {
    setResults(
      { data: { id: 'cli-1' }, error: null },
      { data: { subscription_plan: 'enterprise', subscription_expires_at: '2099-01-01' }, error: null },
      { data: { id: 'inv-1', invoice_number: 'INV-0009', status: 'draft' }, error: null },
      { data: null, error: null },
      { data: [], error: null }
    );
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 'cli-1', invoice_number: 'CUSTOM-1', items: validItems });
    expect(res.status).toBe(201);
    const invoiceInsert = queriesOnTable('invoices').find((q) => q.some(([m]) => m === 'insert'));
    const payload = invoiceInsert.find(([m]) => m === 'insert')[1];
    expect(payload.invoice_number).toBe('CUSTOM-1');
    expect(queriesOnTable('invoices').some((q) => q.some(([m]) => m === 'count'))).toBe(false);
  });
});

describe('GET /api/invoices/:id', () => {
  it('returns a single invoice with items', async () => {
    setResults(
      { data: { id: 'inv-1', status: 'draft', clients: { name: 'Acme' } }, error: null },
      { data: [{ id: 'it-1', description: 'A' }], error: null }
    );
    const res = await request(app).get('/api/invoices/inv-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('inv-1');
    expect(res.body.items).toHaveLength(1);
    const query = queriesOnTable('invoices')[0];
    expect(query).toEqual(expect.arrayContaining([['eq', 'id', 'inv-1'], ['eq', 'user_id', 'user-1']]));
  });

  it('returns 404 for a foreign/nonexistent invoice', async () => {
    setResults({ data: null, error: { code: 'PGRST116', message: 'not found' } });
    const res = await request(app).get('/api/invoices/foreign').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/invoices/:id', () => {
  it('updates an invoice and keeps VAT totals when VAT is enabled (regression)', async () => {
    setResults(
      { data: { id: 'inv-1', status: 'draft', vat_enabled: true }, error: null }, // existing
      { data: { id: 'inv-1', status: 'draft', vat_enabled: true }, error: null }, // update
      { data: null, error: null },                                                // items delete
      { data: null, error: null },                                                // items insert
      { data: null, error: null },                                                // totals update
      { data: { id: 'inv-1', vat_enabled: true, clients: {} }, error: null },     // fetch updated
      { data: [], error: null }                                                   // items
    );

    const res = await request(app)
      .put('/api/invoices/inv-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 'cli-1', status: 'draft', vat_enabled: true, tax_rate: 0.075, items: validItems });

    expect(res.status).toBe(200);

    const totalsUpdate = queriesOnTable('invoices').find((q) =>
      q.some((c) => c[0] === 'update' && c[1] && c[1].total !== undefined)
    );
    expect(totalsUpdate).toBeDefined();
    const totalsPayload = totalsUpdate.find((c) => c[0] === 'update' && c[1] && c[1].total !== undefined)[1];
    expect(totalsPayload.vat).toBe(13.5);
    expect(totalsPayload.total).toBe(193.5);
  });

  it('returns 404 when the invoice does not exist', async () => {
    setResults({ data: null, error: { code: 'PGRST116', message: 'not found' } });
    const res = await request(app)
      .put('/api/invoices/nope')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'draft' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/invoices/:id', () => {
  it('deletes items then the invoice', async () => {
    setResults({ data: null, error: null }, { data: null, error: null });
    const res = await request(app).delete('/api/invoices/inv-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Invoice deleted successfully');
    expect(queriesOnTable('invoice_items')[0].some(([m]) => m === 'delete')).toBe(true);
    expect(queriesOnTable('invoices')[0]).toEqual(expect.arrayContaining([['eq', 'id', 'inv-1'], ['eq', 'user_id', 'user-1']]));
  });
});

describe('POST /api/invoices/:id/send', () => {
  it('marks the invoice as sent', async () => {
    setResults(
      { data: { id: 'inv-1', status: 'sent', clients: {} }, error: null },
      { data: [], error: null }
    );
    const res = await request(app).post('/api/invoices/inv-1/send').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
    const update = queriesOnTable('invoices')[0];
    expect(update.some(([m]) => m === 'update')).toBe(true);
  });
});

describe('POST /api/invoices/:id/mark-paid', () => {
  it('marks the invoice as paid', async () => {
    setResults(
      { data: { id: 'inv-1', status: 'paid', clients: {} }, error: null },
      { data: [], error: null }
    );
    const res = await request(app).post('/api/invoices/inv-1/mark-paid').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
  });
});

describe('GET /api/invoices/:id/public (unauthenticated)', () => {
  it('is accessible without a token (regression: public payment page)', async () => {
    setResults(
      { data: { id: 'inv-1', invoice_number: 'INV-0001', status: 'draft', total: 100, clients: { name: 'Acme' } }, error: null },
      { data: [{ id: 'it-1', description: 'A' }], error: null },
      { data: { user_id: 'user-1' }, error: null },
      { data: { business_name: 'Acme Inc', name: 'Bob' }, error: null }
    );
    const res = await request(app).get('/api/invoices/inv-1/public');
    expect(res.status).toBe(200);
    expect(res.body.business.business_name).toBe('Acme Inc');
    expect(res.body.items).toHaveLength(1);
  });

  it('returns already_paid for paid invoices', async () => {
    setResults({ data: { id: 'inv-1', status: 'paid' }, error: null });
    const res = await request(app).get('/api/invoices/inv-1/public');
    expect(res.status).toBe(200);
    expect(res.body.already_paid).toBe(true);
  });

  it('returns 404 for a missing invoice', async () => {
    setResults({ data: null, error: { code: 'PGRST116', message: 'not found' } });
    const res = await request(app).get('/api/invoices/missing/public');
    expect(res.status).toBe(404);
  });
});
