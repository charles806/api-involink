import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticateToken } from '../middleware/auth.js';
import { attachSubscription } from '../middleware/featureGating.js';
import { subscriptionSummary, remainingQuota, isPro } from '../lib/subscription.js';
import { sendSubscriptionCancelled } from '../services/emailService.js';

const router = Router();

router.use(authenticateToken, attachSubscription);

// GET /api/subscriptions/status
router.get('/status', async (req, res) => {
  try {
    const summary = subscriptionSummary(req.user.subscription);
    let quota = { remaining: null, used: null, limit: null };

    if (!summary.isPro) {
      const { count } = await supabaseAdmin
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.user.userId);
      quota = {
        remaining: remainingQuota(req.user.subscription, count || 0),
        used: count || 0,
        limit: summary.freeQuota,
      };
    }

    res.json({
      ...summary,
      quota,
      features: {
        unlimitedInvoices: summary.isPro,
        onlinePayments: true,
        multiCurrency: summary.isPro,
        branding: summary.isPro,
        analytics: summary.isPro,
      },
    });
  } catch (err) {
    console.error('Subscription status error:', err);
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

// POST /api/subscriptions/cancel
router.post('/cancel', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({
        subscription_plan: 'free',
        subscription_status: 'cancelled',
        subscription_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.user.userId)
      .select('subscription_plan, subscription_status, subscription_expires_at')
      .single();

    if (error) throw error;
    res.json({ message: 'Subscription cancelled. You have been reverted to the Free plan.', subscription: subscriptionSummary(data) });

    // Fire-and-forget cancellation email
    const { data: user } = await supabaseAdmin.from('users').select('email').eq('id', req.user.userId).single();
    if (user?.email) {
      try {
        await sendSubscriptionCancelled({ to: user.email, plan: 'Pro' });
      } catch (e) {
        console.error('Cancel email error:', e);
      }
    }
  } catch (err) {
    console.error('Cancel subscription error:', err);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// POST /api/subscriptions/renew
// Re-initiates a Paystack transaction for the given interval ('monthly' | 'yearly').
// The existing /api/payments/verify-subscription flow finalizes the upgrade.
router.post('/renew', async (req, res) => {
  try {
    const { interval } = req.body;
    if (!['monthly', 'yearly'].includes(interval)) {
      return res.status(400).json({ error: 'Valid interval (monthly or yearly) is required' });
    }
    if (!isPro(req.user.subscription)) {
      return res.status(400).json({ error: 'No active Pro subscription to renew.' });
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', req.user.userId)
      .single();

    const amountInKobo = interval === 'yearly' ? 95990 * 100 : 9999 * 100;

    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user?.email,
        amount: amountInKobo,
        callback_url: `${process.env.FRONTEND_URL}/verify-subscription`,
        metadata: {
          user_id: req.user.userId,
          subscription_plan: 'pro',
          subscription_interval: interval,
          type: 'subscription_renewal',
        },
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error('Paystack renewal initialization failed:', paystackData);
      return res.status(400).json({ error: 'Payment initialization failed' });
    }

    await supabaseAdmin.from('payments').insert({
      user_id: req.user.userId,
      reference: paystackData.data.reference,
      amount: amountInKobo / 100,
      currency: 'NGN',
      status: 'pending',
      channel: 'paystack',
    });

    res.json({
      reference: paystackData.data.reference,
      authorization_url: paystackData.data.authorization_url,
    });
  } catch (err) {
    console.error('Renew subscription error:', err);
    res.status(500).json({ error: 'Failed to initialize subscription renewal' });
  }
});

export default router;