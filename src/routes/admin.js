import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const monthKey = (d) => {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

router.use(authenticateToken);
router.use(requireAdmin);

// GET /api/admin/overview — platform-wide KPIs
router.get('/overview', async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();

    const { count: userCount, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true });
    if (userErr) throw userErr;

    const { count: signupsThisMonth, error: signupErr } = await supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart);
    if (signupErr) throw signupErr;

    const { count: invoiceCount, error: invErr } = await supabaseAdmin
      .from('invoices')
      .select('id', { count: 'exact', head: true });
    if (invErr) throw invErr;

    const { count: marketerCount, error: mkErr } = await supabaseAdmin
      .from('marketers')
      .select('id', { count: 'exact', head: true });
    if (mkErr) throw mkErr;

    const { data: invoices, error: invsErr } = await supabaseAdmin
      .from('invoices')
      .select('total, status, created_at, due_date, user_id');
    if (invsErr) throw invsErr;

    let paidRevenue = 0;
    let outstanding = 0;
    let overdueAmount = 0;
    let invoicesCreatedThisMonth = 0;

    const byMonth = {};
    for (let i = 0; i < 12; i++) {
      const key = monthKey(new Date(now.getFullYear(), now.getMonth() - (11 - i), 1));
      byMonth[key] = { revenue: 0, volume: 0 };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const inv of invoices || []) {
      const createdKey = monthKey(inv.created_at);
      if (new Date(inv.created_at) >= new Date(monthStart)) invoicesCreatedThisMonth++;
      if (inv.status === 'paid') {
        paidRevenue += Number(inv.total) || 0;
        if (createdKey in byMonth) {
          byMonth[createdKey].revenue += Number(inv.total) || 0;
          byMonth[createdKey].volume += 1;
        }
      } else {
        outstanding += Number(inv.total) || 0;
        if (inv.due_date && new Date(inv.due_date + 'T00:00:00') < today) {
          overdueAmount += Number(inv.total) || 0;
        }
      }
    }

    const revenueByMonth = Object.keys(byMonth).map((k) => ({
      month: k,
      revenue: round2(byMonth[k].revenue),
      volume: byMonth[k].volume,
    }));

    const { data: recentUsers } = await supabaseAdmin
      .from('users')
      .select('id, name, email, business_name, created_at')
      .order('created_at', { ascending: false })
      .limit(8);

    res.json({
      totalUsers: userCount || 0,
      signupsThisMonth: signupsThisMonth || 0,
      totalInvoices: invoiceCount || 0,
      invoicesCreatedThisMonth,
      totalMarketers: marketerCount || 0,
      paidRevenue: round2(paidRevenue),
      outstanding: round2(outstanding),
      overdue: round2(overdueAmount),
      revenueByMonth,
      recentUsers: recentUsers || [],
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    res.status(500).json({ error: 'Failed to fetch admin overview' });
  }
});

// GET /api/admin/marketers — list marketers with attribution stats
router.get('/marketers', async (req, res) => {
  try {
    const { data: marketers, error } = await supabaseAdmin
      .from('marketers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const list = marketers || [];

    if (list.length > 0) {
      const marketerIds = list.map((m) => m.id);

      const { data: users, error: uErr } = await supabaseAdmin
        .from('users')
        .select('id, marketer_id, created_at')
        .in('marketer_id', marketerIds);
      if (uErr) throw uErr;

      const userIds = (users || []).map((u) => u.id);
      const { data: invoices, error: iErr } = userIds.length
        ? await supabaseAdmin.from('invoices').select('user_id, total, status').in('user_id', userIds)
        : await supabaseAdmin.from('invoices').select('user_id, total, status').limit(0);
      if (iErr) throw iErr;

      const statsByMarketer = {};
      for (const m of list) {
        const attributed = (users || []).filter((u) => u.marketer_id === m.id);
        const ids = new Set(attributed.map((u) => u.id));
        const invs = (invoices || []).filter((i) => ids.has(i.user_id));
        const paid = invs.filter((i) => i.status === 'paid').reduce((s, i) => s + (Number(i.total) || 0), 0);
        const outstanding = invs
          .filter((i) => i.status !== 'paid')
          .reduce((s, i) => s + (Number(i.total) || 0), 0);
        statsByMarketer[m.id] = {
          users: attributed.length,
          invoices: invs.length,
          paidRevenue: round2(paid),
          outstanding: round2(outstanding),
        };
      }

      res.json(list.map((m) => ({ ...m, stats: statsByMarketer[m.id] || { users: 0, invoices: 0, paidRevenue: 0, outstanding: 0 } })));
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error('Admin marketers error:', err);
    res.status(500).json({ error: 'Failed to fetch marketers' });
  }
});

// POST /api/admin/marketers
router.post('/marketers', async (req, res) => {
  try {
    const { name, email, phone, status } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('marketers')
      .insert({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone?.trim() || null,
        status: status === 'inactive' ? 'inactive' : 'active',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Create marketer error:', err);
    res.status(500).json({ error: 'Failed to create marketer' });
  }
});

// PUT /api/admin/marketers/:id
router.put('/marketers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, status } = req.body;

    const updateData = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
      updateData.name = name.trim();
    }
    if (email !== undefined) {
      if (!email.trim()) return res.status(400).json({ error: 'Email cannot be empty' });
      updateData.email = email.trim().toLowerCase();
    }
    if (phone !== undefined) updateData.phone = phone?.trim() || null;
    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      updateData.status = status;
    }
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('marketers')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(404).json({ error: 'Marketer not found' });
    res.json(data);
  } catch (err) {
    console.error('Update marketer error:', err);
    res.status(500).json({ error: 'Failed to update marketer' });
  }
});

// DELETE /api/admin/marketers/:id
router.delete('/marketers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Attribution column uses ON DELETE SET NULL, so users are un-assigned, not deleted.
    const { error } = await supabaseAdmin.from('marketers').delete().eq('id', id);
    if (error) return res.status(404).json({ error: 'Marketer not found' });
    res.json({ message: 'Marketer deleted' });
  } catch (err) {
    console.error('Delete marketer error:', err);
    res.status(500).json({ error: 'Failed to delete marketer' });
  }
});

// GET /api/admin/users — list users with marketer attribution and invoice stats
router.get('/users', async (req, res) => {
  try {
    const { search, marketer_id } = req.query;

    let query = supabaseAdmin
      .from('users')
      .select('id, name, email, business_name, role, marketer_id, subscription_plan, subscription_status, created_at');

    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }
    if (marketer_id) {
      query = query.eq('marketer_id', marketer_id);
    }

    const { data: users, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    const list = users || [];
    if (list.length > 0) {
      const userIds = list.map((u) => u.id);
      const { data: invoices, error: iErr } = await supabaseAdmin
        .from('invoices')
        .select('user_id, total, status')
        .in('user_id', userIds);
      if (iErr) throw iErr;

      const invByUser = {};
      for (const u of list) invByUser[u.id] = { invoices: 0, paidRevenue: 0, outstanding: 0 };
      for (const inv of invoices || []) {
        const agg = invByUser[inv.user_id];
        if (!agg) continue;
        agg.invoices += 1;
        if (inv.status === 'paid') agg.paidRevenue += Number(inv.total) || 0;
        else agg.outstanding += Number(inv.total) || 0;
      }

      const marketerIds = [...new Set(list.map((u) => u.marketer_id).filter(Boolean))];
      const { data: marketers } = marketerIds.length
        ? await supabaseAdmin.from('marketers').select('id, name').in('id', marketerIds)
        : { data: [] };
      const marketerName = {};
      for (const m of marketers || []) marketerName[m.id] = m.name;

      res.json(list.map((u) => ({
        ...u,
        stats: {
          invoices: invByUser[u.id].invoices,
          paidRevenue: round2(invByUser[u.id].paidRevenue),
          outstanding: round2(invByUser[u.id].outstanding),
        },
        marketer_name: u.marketer_id ? marketerName[u.marketer_id] || null : null,
      })));
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PUT /api/admin/users/:id — assign marketer and/or set role
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { marketer_id, role } = req.body;

    const updateData = { updated_at: new Date().toISOString() };

    if (marketer_id !== undefined) {
      if (marketer_id === null || marketer_id === '') {
        updateData.marketer_id = null;
      } else {
        const { data: m, error: mErr } = await supabaseAdmin
          .from('marketers')
          .select('id')
          .eq('id', marketer_id)
          .single();
        if (mErr || !m) return res.status(400).json({ error: 'Marketer not found' });
        updateData.marketer_id = marketer_id;
      }
    }

    if (role !== undefined) {
      if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      updateData.role = role;
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select('id, name, email, role, marketer_id')
      .single();

    if (error) return res.status(404).json({ error: 'User not found' });
    res.json(data);
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

export default router;