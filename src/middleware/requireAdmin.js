import { supabaseAdmin } from '../lib/supabase.js';

// Requires authenticateToken to have run first (sets req.user).
// Fetches the user's role from the DB rather than trusting the JWT,
// so demoting an admin takes effect immediately.
export const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', req.user.userId)
      .single();

    if (error || !user) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    res.status(500).json({ error: 'Failed to verify admin access' });
  }
};