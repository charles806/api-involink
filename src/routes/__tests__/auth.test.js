import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setResults, queriesOnTable } from '../../../tests/helpers/supabaseMock.mjs';
import { nodemailerState, resetNodemailer } from '../../../tests/helpers/nodemailerMock.mjs';

import app from '../../index.js';

const token = jwt.sign({ userId: 'user-1', email: 'owner@test.com' }, process.env.JWT_SECRET);

const userRow = {
  id: 'user-1',
  email: 'owner@test.com',
  name: 'Owner',
  password_hash: '$2a$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZab',
  business_name: null,
  subscription_plan: 'free',
  subscription_status: 'active',
  subscription_expires_at: null,
};

beforeEach(() => {
  setResults();
  resetNodemailer();
});

describe('POST /api/auth/signup', () => {
  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Email, password, and name are required');
  });

  it('rejects an invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'not-an-email', password: 'longenough', name: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid email format');
  });

  it('rejects a short password', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'a@b.com', password: 'short', name: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Password must be at least 8 characters');
  });

  it('rejects an already-registered email', async () => {
    setResults({ data: { id: 'user-1' }, error: null });
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'owner@test.com', password: 'longenough', name: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Email already registered');
  });

  it('creates a user with a hashed password and returns a token', async () => {
    setResults({ data: null, error: null }, { data: { ...userRow, email: 'new@test.com', name: 'New' }, error: null });
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: '  NEW@test.com  ', password: 'longenough', name: '  New  ' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('new@test.com');

    const insert = queriesOnTable('users').find((q) => q.some(([m]) => m === 'insert'));
    const payload = insert.find(([m]) => m === 'insert')[1];
    expect(payload.email).toBe('new@test.com');
    expect(payload.password_hash).not.toBe('longenough');
    expect(payload.password_hash.startsWith('$2a$')).toBe(true);
    expect(payload.name).toBe('New');
  });
});

describe('POST /api/auth/login', () => {
  it('returns 401 for invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when the user does not exist', async () => {
    setResults({ data: null, error: { code: 'PGRST116' } });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.com', password: 'longenough' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('returns 401 on a wrong password', async () => {
    setResults({ data: userRow, error: null });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@test.com', password: 'not-the-password' });
    expect(res.status).toBe(401);
  });

  it('logs in and returns the user with a token', async () => {
    const hash = await import('bcryptjs').then((b) => b.hash('longenough', 4));
    setResults({ data: { ...userRow, password_hash: hash }, error: null });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@test.com', password: 'longenough' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.name).toBe('Owner');
  });
});

describe('GET /api/auth/me', () => {
  it('requires a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer bad.token');
    expect(res.status).toBe(403);
  });

  it('returns the current user', async () => {
    setResults({ data: userRow, error: null });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('user-1');
    expect(queriesOnTable('users')[0]).toEqual(expect.arrayContaining([['eq', 'id', 'user-1']]));
  });
});

describe('PUT /api/auth/profile', () => {
  it('updates the profile with the provided fields', async () => {
    setResults({ data: { ...userRow, business_name: 'Acme Inc' }, error: null });
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ business_name: 'Acme Inc', bank_name: 'GTBank' });
    expect(res.status).toBe(200);
    const query = queriesOnTable('users')[0];
    const payload = query.find(([m]) => m === 'update')[1];
    expect(payload.business_name).toBe('Acme Inc');
    expect(payload.bank_name).toBe('GTBank');
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('returns a generic message for unknown emails (no enumeration)', async () => {
    setResults({ data: null, error: { code: 'PGRST116' } });
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reset link/);
    expect(nodemailerState.calls).toHaveLength(0);
  });

  it('sends a reset email for a known user', async () => {
    setResults({ data: userRow, error: null });
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'owner@test.com' });
    expect(res.status).toBe(200);
    expect(nodemailerState.calls).toHaveLength(1);
    const mail = nodemailerState.calls[0];
    expect(mail.to).toBe('owner@test.com');
    expect(mail.html).toContain('/reset-password?token=');
  });
});

describe('POST /api/auth/reset-password', () => {
  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects a short new password', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'x', newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Password must be at least 8 characters');
  });

  it('rejects an invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'bad.token', newPassword: 'longenough' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid or expired token');
  });

  it('rejects a token whose hash prefix no longer matches (used token)', async () => {
    const resetToken = jwt.sign({ userId: 'user-1', hashPrefix: 'stale-prefix' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    setResults({ data: { ...userRow, password_hash: '$2a$12$differentvalue1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' }, error: null });
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'longenough' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This reset link has already been used');
  });

  it('updates the password when the token is valid', async () => {
    const prefix = userRow.password_hash.substring(0, 10);
    const resetToken = jwt.sign({ userId: 'user-1', hashPrefix: prefix }, process.env.JWT_SECRET, { expiresIn: '1h' });
    setResults({ data: userRow, error: null }, { data: null, error: null });
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'newlongpassword' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password reset successful');
    const update = queriesOnTable('users').find((q) => q.some(([m]) => m === 'update'));
    const payload = update.find(([m]) => m === 'update')[1];
    expect(payload.password_hash.startsWith('$2a$')).toBe(true);
  });
});