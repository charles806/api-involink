const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);

router.post('/initialize', async (req, res) => {
  try {
    const { invoiceId, email } = req.body;

    if (!invoiceId || !email) {
      return res.status(400).json({ error: 'Invoice ID and email are required' });
    }

    // Verify invoice exists and belongs to user
    const { data: invoice, error: findError } = await supabaseAdmin
      .from('invoices')
      .select('id, total, status, invoice_number')
      .eq('id', invoiceId)
      .eq('user_id', req.user.userId)
      .single();

    if (findError || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({ error: 'Invoice is already paid' });
    }

    const amountInKobo = Math.round(invoice.total * 100);

    // Call Paystack API
    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amountInKobo,
        metadata: {
          invoice_id: invoiceId,
          user_id: req.user.userId,
        },
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error('Paystack initialization failed:', paystackData);
      return res.status(400).json({ error: 'Payment initialization failed' });
    }

    // Save payment attempt to database
    const { error: insertError } = await supabaseAdmin
      .from('payments')
      .insert({
        invoice_id: invoiceId,
        user_id: req.user.userId,
        reference: paystackData.data.reference,
        amount: invoice.total,
        currency: 'NGN',
        status: 'pending',
        channel: 'paystack',
      });

    if (insertError) {
      console.error('Failed to save payment record:', insertError);
      // We still return success to frontend because paystack initialized successfully,
      // but log the error. We can rely on webhooks to reconcile later if needed.
    }

    res.json({
      reference: paystackData.data.reference,
      authorization_url: paystackData.data.authorization_url,
      amount: invoice.total,
    });
  } catch (err) {
    console.error('Payment initialization error:', err);
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
});

router.get('/verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ error: 'Payment reference is required' });
    }

    // Call Paystack API
    const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error('Paystack verification failed:', paystackData);
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const isSuccessful = paystackData.data.status === 'success';

    if (isSuccessful) {
      const invoiceId = paystackData.data.metadata?.invoice_id;
      
      if (invoiceId) {
        // Update payment record
        await supabaseAdmin
          .from('payments')
          .update({ 
            status: 'success', 
            paystack_data: paystackData.data,
            updated_at: new Date().toISOString()
          })
          .eq('reference', reference);

        // Update invoice
        await supabaseAdmin
          .from('invoices')
          .update({ status: 'paid', paid_at: new Date().toISOString() })
          .eq('id', invoiceId)
          .eq('user_id', req.user.userId);
      }
    } else {
       // Update payment record as failed
       await supabaseAdmin
        .from('payments')
        .update({ 
          status: paystackData.data.status, 
          paystack_data: paystackData.data,
          updated_at: new Date().toISOString()
        })
        .eq('reference', reference);
    }

    res.json({
      success: isSuccessful,
      message: paystackData.message,
      data: paystackData.data,
    });
  } catch (err) {
    console.error('Payment verification error:', err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// --- Subscription Endpoints ---

router.post('/subscribe', async (req, res) => {
  try {
    const { plan, email } = req.body;

    if (!plan || !['monthly', 'yearly'].includes(plan)) {
      return res.status(400).json({ error: 'Valid plan (monthly or yearly) is required' });
    }
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const amountInKobo = plan === 'yearly' ? 27840 * 100 : 2900 * 100;

    // Call Paystack API
    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amountInKobo,
        metadata: {
          user_id: req.user.userId,
          subscription_plan: 'enterprise',
          subscription_interval: plan, // 'monthly' or 'yearly'
          type: 'subscription_upgrade'
        },
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error('Paystack initialization failed:', paystackData);
      return res.status(400).json({ error: 'Payment initialization failed' });
    }

    // Save payment attempt to database
    await supabaseAdmin
      .from('payments')
      .insert({
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
    console.error('Subscription initialization error:', err);
    res.status(500).json({ error: 'Failed to initialize subscription payment' });
  }
});

router.get('/verify-subscription/:reference', async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ error: 'Payment reference is required' });
    }

    // Call Paystack API
    const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error('Paystack verification failed:', paystackData);
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const isSuccessful = paystackData.data.status === 'success';

    if (isSuccessful) {
      const metadata = paystackData.data.metadata;
      
      if (metadata && metadata.type === 'subscription_upgrade') {
        // Update payment record
        await supabaseAdmin
          .from('payments')
          .update({ 
            status: 'success', 
            paystack_data: paystackData.data,
            updated_at: new Date().toISOString()
          })
          .eq('reference', reference);

        // Calculate new expiration date
        const expiresAt = new Date();
        if (metadata.subscription_interval === 'yearly') {
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        } else {
          expiresAt.setMonth(expiresAt.getMonth() + 1);
        }

        // Update user to enterprise
        await supabaseAdmin
          .from('users')
          .update({ 
            subscription_plan: 'enterprise',
            subscription_status: 'active',
            subscription_expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', req.user.userId);
      }
    } else {
       // Update payment record as failed
       await supabaseAdmin
        .from('payments')
        .update({ 
          status: paystackData.data.status, 
          paystack_data: paystackData.data,
          updated_at: new Date().toISOString()
        })
        .eq('reference', reference);
    }

    res.json({
      success: isSuccessful,
      message: paystackData.message,
    });
  } catch (err) {
    console.error('Subscription verification error:', err);
    res.status(500).json({ error: 'Failed to verify subscription payment' });
  }
});

module.exports = router;
