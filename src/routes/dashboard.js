import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
router.use(authenticateToken);

const monthKey = (d) => {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

// GET /api/dashboard/metrics
router.get('/metrics', async (req, res) => {
  try {
    const userId = req.user.userId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();

    const { data: invoices, error } = await supabaseAdmin
      .from('invoices')
      .select('total, status, due_date, created_at, paid_at')
      .eq('user_id', userId);

    if (error) throw error;

    const list = invoices || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Aggregates
    let monthlyRevenue = 0;
    let paidAmount = 0;
    let outstanding = 0;
    let overdueAmount = 0;
    let createdThisMonth = 0;
    let paidThisMonth = 0;

    const byMonth = {};
    for (let i = 0; i < 12; i++) {
      const key = monthKey(new Date(now.getFullYear(), now.getMonth() - (11 - i), 1));
      byMonth[key] = { revenue: 0, volume: 0 };
    }

    const overdueDate = new Date();
    overdueDate.setHours(0, 0, 0, 0);

    for (const inv of list) {
      const created = new Date(inv.created_at);
      const createdKey = monthKey(inv.created_at);
      if (created >= monthStart) createdThisMonth++;
      if (inv.status === 'paid') {
        paidAmount += Number(inv.total) || 0;
        if (created >= monthStart) {
          monthlyRevenue += Number(inv.total) || 0;
          paidThisMonth++;
        }
        if (createdKey in byMonth) {
          byMonth[createdKey].revenue += Number(inv.total) || 0;
          byMonth[createdKey].volume += 1;
        }
      } else {
        outstanding += Number(inv.total) || 0;
        if (inv.due_date && new Date(inv.due_date) < overdueDate) {
          overdueAmount += Number(inv.total) || 0;
        }
      }
    }

    // Recent payments
    const { data: recentPayments, error: payErr } = await supabaseAdmin
      .from('payments')
      .select('id, reference, amount, status, channel, created_at, invoices(invoice_number)')
      .eq('user_id', userId)
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10);

    if (payErr) {
      console.error('Recent payments error:', payErr);
    }

    const revenueSeries = Object.keys(byMonth).map((k) => ({
      month: k,
      revenue: Math.round(byMonth[k].revenue * 100) / 100,
      volume: byMonth[k].volume,
    }));

    res.json({
      revenueThisMonth: Math.round(monthlyRevenue * 100) / 100,
      paidAmount: Math.round(paidAmount * 100) / 100,
      outstanding: Math.round(outstanding * 100) / 100,
      overdue: Math.round(overdueAmount * 100) / 100,
      invoicesCreatedThisMonth: createdThisMonth,
      invoicesPaidThisMonth: paidThisMonth,
      monthlyMode: revenueSeries.length ? revenueSeries.slice(-12) : [],
      revenueByMonth: revenueSeries,
      recentPayments: recentPayments || [],
    });
  } catch (err) {
    console.error('Dashboard metrics error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

export default router;