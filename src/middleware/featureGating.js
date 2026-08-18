import { supabaseAdmin } from "../lib/supabase.js";
import { isPro, FREE_QUOTA } from "../lib/subscription.js";

// Loads the current user's subscription record into req.user.subscription.
async function attachSubscription(req, res, next) {
  try {
    const { data } = await supabaseAdmin
      .from('users')
      .select('subscription_plan, subscription_status, subscription_expires_at')
      .eq('id', req.user.userId)
      .single();
    req.user.subscription = data || { subscription_plan: 'free', subscription_status: 'active', subscription_expires_at: null };
    next();
  } catch (err) {
    console.error('attachSubscription error:', err);
    res.status(500).json({ error: 'Failed to load subscription' });
  }
}

// Rejects requests from free users. Returns 403 with code REQUIRES_PRO.
function requirePaid(req, res, next) {
  const { subscription } = req.user;
  if (!isPro(subscription)) {
    return res.status(403).json({
      error: 'This feature requires a Pro subscription.',
      code: 'REQUIRES_PRO',
    });
  }
  next();
}

// Middleware for enforcing the free-tiers invoice creation quota.
// Must be used on the POST invoice route. Queries the current invoice count;
// when the user is on an active Pro plan the quota is unlimited.
async function requireInvoiceQuota(req, res, next) {
  const { subscription } = req.user;
  if (isPro(subscription)) return next();

  const { count, error } = await supabaseAdmin
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user.userId);

  if (error) {
    console.error('Invoice count error:', error);
    return res.status(500).json({ error: 'Failed to verify account limits' });
  }

  if (count >= FREE_QUOTA) {
    return res.status(403).json({
      error: `Free plan limit reached. Please upgrade to Pro.`,
      code: 'LIMIT_REACHED',
      quota: FREE_QUOTA,
    });
  }

  req.user.invoiceCount = count || 0;
  next();
}

export { attachSubscription, requirePaid, requireInvoiceQuota };