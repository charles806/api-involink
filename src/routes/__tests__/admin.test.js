vi.mock('@supabase/supabase-js', async () => {
  const { supabaseAdmin } = await import('../../../tests/helpers/supabaseMock.mjs');
  return { createClient: () => supabaseAdmin };
});

vi.mock('nodemailer', async () => {
  const { sendMailFn } = await import('../../../tests/helpers/nodemailerMock.mjs');
  const createTransport = () => ({ sendMail: sendMailFn });
  return { default: { createTransport }, createTransport };
});

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setResults, queriesOnTable } from '../../../tests/helpers/supabaseMock.mjs';
import { resetNodemailer } from '../../../tests/helpers/nodemailerMock.mjs';

import app from '../../index.js';

const adminToken = jwt.sign({ userId: 'admin-1', email: 'admin@test.com' }, process.env.JWT_SECRET);
const userToken = jwt.sign({ userId: 'user-1', email: 'user@test.com' }, process.env.JWT_SECRET);

const adminRole = { data: { role: 'admin' }, error: null };
const userRole = { data: { role: 'user' }, error: null };

beforeEach(() => {
  setResults();
  resetNodemailer();
});

describe('requireAdmin guard', () => {
  it('rejects non-admin users with 403', async () => {
    setResults(userRole);
    const res = await request(app).get('/api/admin/overview').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/admin/overview');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/overview', () => {
  it('returns platform KPIs with revenue by month', async () => {
    setResults(
      adminRole, // requireAdmin role lookup
      { count: 10, error: null }, // total users
      { count: 2, error: null }, // signups this month
      { count: 4, error: null }, // total invoices
      { count: 1, error: null }, // marketers
      {
        data: [
          { total: 100, status: 'paid', created_at: new Date().toISOString(), user_id: 'u-1' },
          { total: 50, status: 'sent', created_at: new Date().toISOString(), user_id: 'u-2' },
          { total: 30, status: 'overdue', created_at: new Date().toISOString(), user_id: 'u-2' },
        ],
        error: null,
      }, // invoices
      { data: [{ id: 'u-1', name: 'A' }], error: null } // recent users
    );
    const res = await request(app).get('/api/admin/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalUsers).toBe(10);
    expect(res.body.totalInvoices).toBe(4);
    expect(res.body.totalMarketers).toBe(1);
    expect(res.body.paidRevenue).toBe(100);
    expect(res.body.outstanding).toBe(80);
    expect(queriesOnTable('users').length).toBeGreaterThanOrEqual(3);
  });
});

describe('GET /api/admin/marketers', () => {
  it('lists marketers with attribution stats', async () => {
    setResults(
      adminRole,
      { data: [{ id: 'm-1', name: 'Lara', email: 'lara@test.com', status: 'active' }], error: null },
      { data: [{ id: 'u-1', marketer_id: 'm-1', created_at: new Date().toISOString() }], error: null },
      { data: [{ user_id: 'u-1', total: 200, status: 'paid' }], error: null }
    );
    const res = await request(app).get('/api/admin/marketers').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body[0].stats.users).toBe(1);
    expect(res.body[0].stats.paidRevenue).toBe(200);
  });
});

describe('POST /api/admin/marketers', () => {
  it('creates a marketer', async () => {
    setResults(
      adminRole,
      { data: { id: 'm-1', name: 'Lara', email: 'lara@test.com', status: 'active' }, error: null }
    );
    const res = await request(app)
      .post('/api/admin/marketers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lara', email: 'lara@test.com' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('lara@test.com');
    const q = queriesOnTable('marketers')[0];
    const payload = q.find(([m]) => m === 'insert')[1];
    expect(payload.name).toBe('Lara');
  });
});

describe('PUT /api/admin/marketers/:id', () => {
  it('updates a marketer status', async () => {
    setResults(
      adminRole,
      { data: { id: 'm-1', status: 'inactive' }, error: null }
    );
    const res = await request(app)
      .put('/api/admin/marketers/m-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactive');
  });
});

describe('DELETE /api/admin/marketers/:id', () => {
  it('deletes a marketer', async () => {
    setResults(adminRole, { data: null, error: null });
    const res = await request(app)
      .delete('/api/admin/marketers/m-1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Marketer deleted');
  });
});

describe('GET /api/admin/users', () => {
  it('lists users with invoice stats and marketer name', async () => {
    setResults(
      adminRole,
      { data: [{ id: 'u-1', name: 'Ann', email: 'ann@test.com', role: 'user', marketer_id: 'm-1' }], error: null },
      { data: [{ user_id: 'u-1', total: 150, status: 'paid' }], error: null },
      { data: [{ id: 'm-1', name: 'Lara' }], error: null }
    );
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body[0].marketer_name).toBe('Lara');
    expect(res.body[0].stats.paidRevenue).toBe(150);
  });
});

describe('PUT /api/admin/users/:id', () => {
  it('assigns a marketer and sets a role', async () => {
    setResults(
      adminRole,
      { data: { id: 'm-1' }, error: null }, // marketer existence check
      { data: { id: 'u-1', role: 'admin', marketer_id: 'm-1' }, error: null }
    );
    const res = await request(app)
      .put('/api/admin/users/u-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ marketer_id: 'm-1', role: 'admin' });
    expect(res.status).toBe(200);
    const q = queriesOnTable('users').filter((c) => c.some(([m]) => m === 'update')).pop();
    const payload = q.find(([m]) => m === 'update')[1];
    expect(payload.marketer_id).toBe('m-1');
    expect(payload.role).toBe('admin');
  });
});