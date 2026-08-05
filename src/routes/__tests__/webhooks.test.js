import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { setResults, queriesOnTable } from '../../../tests/helpers/supabaseMock.mjs';

import app from '../../index.js';

const SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;

function signedBody(payload) {
  const json = JSON.stringify(payload);
  const hash = crypto.createHmac('sha512', SECRET).update(json).digest('hex');
  return { json, hash };
}

beforeEach(() => {
  setResults();
});

describe('POST /api/webhooks/paystack', () => {
  it('rejects a request with an invalid signature', async () => {
    const { json } = signedBody({ event: 'charge.success' });
    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', 'wrong-signature')
      .send(json);
    expect(res.status).toBe(400);
    expect(res.text).toBe('Invalid signature');
  });

  it('acknowledges non-charge events without touching the DB', async () => {
    const { json, hash } = signedBody({ event: 'transfer.success', data: {} });
    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', hash)
      .send(json);
    expect(res.status).toBe(200);
    expect(queriesOnTable('payments')).toHaveLength(0);
    expect(queriesOnTable('invoices')).toHaveLength(0);
  });

  it('marks the invoice and payment as paid on charge.success', async () => {
    const payload = {
      event: 'charge.success',
      data: { reference: 'ref-1', metadata: { invoice_id: 'inv-1' } },
    };
    const { json, hash } = signedBody(payload);
    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', hash)
      .send(json);
    expect(res.status).toBe(200);
    expect(res.text).toBe('Webhook received successfully');

    const paymentUpdate = queriesOnTable('payments').find((q) => q.some(([m]) => m === 'update'));
    expect(paymentUpdate.find(([m]) => m === 'update')[1].status).toBe('success');

    const invoiceUpdate = queriesOnTable('invoices').find((q) => q.some(([m]) => m === 'update'));
    const payload2 = invoiceUpdate.find(([m]) => m === 'update')[1];
    expect(payload2.status).toBe('paid');
    expect(invoiceUpdate).toEqual(expect.arrayContaining([['eq', 'id', 'inv-1']]));
  });

  it('does nothing for charge.success without an invoice id in metadata', async () => {
    const { json, hash } = signedBody({ event: 'charge.success', data: { reference: 'ref-9', metadata: {} } });
    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', hash)
      .send(json);
    expect(res.status).toBe(200);
    expect(queriesOnTable('payments')).toHaveLength(0);
  });
});