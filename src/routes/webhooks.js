const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

// Paystack webhook endpoint
// Requires express.raw or express.json middleware before this route if we need raw body,
// but since we are using express.json() globally, we can use req.body as long as we also 
// have the raw body. However, to verify the signature properly, we need the raw payload.
// Since index.js mounts this BEFORE express.json(), we need to parse it using express.raw() here.
router.post('/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
    
    // Validate event
    const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
    
    if (hash !== req.headers['x-paystack-signature']) {
      console.warn('Invalid Paystack webhook signature');
      return res.status(400).send('Invalid signature');
    }

    // Parse the event body
    const event = JSON.parse(req.body.toString());

    if (event.event === 'charge.success') {
      const data = event.data;
      const invoiceId = data.metadata?.invoice_id;
      const reference = data.reference;

      if (invoiceId) {
        // Update payment record
        await supabaseAdmin
          .from('payments')
          .update({ 
            status: 'success', 
            paystack_data: data,
            updated_at: new Date().toISOString()
          })
          .eq('reference', reference);

        // Update invoice
        await supabaseAdmin
          .from('invoices')
          .update({ status: 'paid', paid_at: new Date().toISOString() })
          .eq('id', invoiceId);
          
        console.log(`Invoice ${invoiceId} marked as paid via webhook for reference ${reference}`);
      }
    }

    // Return 200 OK to acknowledge receipt
    res.status(200).send('Webhook received successfully');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Webhook error');
  }
});

module.exports = router;
