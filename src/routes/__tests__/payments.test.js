vi.mock('@supabase/supabase-js', async () => {
  const { supabaseAdmin } = await import('../../../tests/helpers/supabaseMock.mjs');
  return { createClient: () => supabaseAdmin };
});

vi.mock('nodemailer', async () => {
  const { sendMailFn } = await import('../../../tests/helpers/nodemailerMock.mjs');
  const createTransport = () => ({ sendMail: sendMailFn });
  return { default: { createTransport }, createTransport };
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setResults, queriesOnTable } from '../../../tests/helpers/supabaseMock.mjs';

import app from '../../index.js';

const token = jwt.sign({ userId: 'user-1', email: 'owner@test.com' }, process.env.JWT_SECRET);

const successPayload = {
  ok: true,
  json: async () => ({
    status: true,
    message: 'Success',
    data: { reference: 'ref-1', authorization_url: 'https://paystack/widget', status: 'success', metadata: { invoice_id: 'inv-1', type: 'subscription_upgrade', subscription_interval: 'monthly' } },
  }),
};

const failurePayload = {
  ok: false,
  json: async () => ({ status: false, message: 'Failure' }),
};

beforeEach(() => {
  setResults();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/payments/initialize', () => {
  it('rejects without an invoice id or email', async () => {
    const res = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 if the invoice does not belong to the user', async () => {
    setResults({ data: null, error: { code: 'PGRST116' } });
    const res = await request(app)
      .post('/api/payments/initialize')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId: 'foreign', email: 'a@b.com' });
    expect(res.status).toBe(404);
  });

  it('rejects already-paid invoices', async () => {
    setResults({ data: { id: 'inv-1', total: 100, status: 'paid' }, error: null });
    const res = await request(app)
      .post('/api/payments/initialize')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId: 'inv-1', email: 'a@b.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invoice is already paid');
  });

  it('sends the amount in kobo and records a pending payment', async () => {
    setResults({ data: { id: 'inv-1', total: 150.5, status: 'sent' }, error: null });
    const fetchMock = vi.fn(async () => successPayload);
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app)
      .post('/api/payments/initialize')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId: 'inv-1', email: 'a@b.com' });

    expect(res.status).toBe(200);
    expect(res.body.reference).toBe('ref-1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(JSON.parse(opts.body).amount).toBe(150.5 * 100); // kobo
    expect(JSON.parse(opts.body).metadata.invoice_id).toBe('inv-1');

    const paymentInsert = queriesOnTable('payments').find((q) => q.some(([m]) => m === 'insert'));
    const payload = paymentInsert.find(([m]) => m === 'insert')[1];
    expect(payload.status).toBe('pending');
    expect(payload.amount).toBe(150.5);
  });

  it('returns 400 when paystack fails', async () => {
    setResults({ data: { id: 'inv-1', total: 10, status: 'sent' }, error: null });
    vi.stubGlobal('fetch', vi.fn(async () => failurePayload));
    const res = await request(app)
      .post('/api/payments/initialize')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId: 'inv-1', email: 'a@b.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Payment initialization failed');
  });
});

describe('POST /api/payments/subscribe', () => {
  it('rejects an invalid plan', async () => {
    const res = await request(app)
      .post('/api/payments/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'weekly', email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  it('charges yearly amount in kobo for a yearly subscription', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => successPayload));
    const res = await request(app)
      .post('/api/payments/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'yearly', email: 'a@b.com' });
    expect(res.status).toBe(200);
    const body = fetch.mock.calls[0][1];
    expect(JSON.parse(body.body).amount).toBe(95990 * 100);
  });

  it('charges monthly amount in kobo for a monthly subscription', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => successPayload));
    const res = await request(app)
      .post('/api/payments/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'monthly', email: 'a@b.com' });
    expect(res.status).toBe(200);
    const body = fetch.mock.calls[0][1];
    expect(JSON.parse(body.body).amount).toBe(9999 * 100);
  });
});

describe('GET /api/payments/verify/:reference', () => {
  it('marks the invoice and payment as paid on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => successPayload));
    setResults({ data: null, error: null });
    const res = await request(app)
      .get('/api/payments/verify/ref-1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const invoiceUpdate = queriesOnTable('invoices').find((q) => q.some(([m]) => m === 'update'));
    const payload = invoiceUpdate.find(([m]) => m === 'update')[1];
    expect(payload.status).toBe('paid');
  });

  it('returns success=false and records a failed payment otherwise', async () => {
    const failed = { ok: true, json: async () => ({ status: true, message: 'F', data: { status: 'failed', metadata: {} } }) };
    vi.stubGlobal('fetch', vi.fn(async () => failed));
    const res = await request(app)
      .get('/api/payments/verify/ref-fail')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    const paymentUpdate = queriesOnTable('payments').find((q) => q.some(([m]) => m === 'update'));
    expect(paymentUpdate.find(([m]) => m === 'update')[1].status).toBe('failed');
  });
});

describe('GET /api/payments/verify-subscription/:reference', () => {
  it('upgrades the user to pro on a successful subscription', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => successPayload));
    const res = await request(app)
      .get('/api/payments/verify-subscription/ref-1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const userUpdate = queriesOnTable('users').find((q) => q.some(([m]) => m === 'update'));
    const payload = userUpdate.find(([m]) => m === 'update')[1];
    expect(payload.subscription_plan).toBe('pro');
    expect(payload.subscription_status).toBe('active');
  });
});