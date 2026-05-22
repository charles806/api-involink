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

module.exports = router;
