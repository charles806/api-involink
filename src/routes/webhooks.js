import { Router, raw } from 'express';
import { createHmac } from 'crypto';
import { supabaseAdmin } from "../lib/supabase.js";
import { sendPaymentReceipt, sendSubscriptionActivated } from "../services/emailService.js";

const router = Router();

// Paystack webhook endpoint
// Mounted raw express.json() is NOT applied globally before this route, so we parse the raw body here.
router.post('/paystack', raw({ type: 'application/json' }), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;

    const hash = createHmac('sha512', secret).update(req.body).digest('hex');
    if (hash !== req.headers['x-paystack-signature']) {
      console.warn('Invalid Paystack webhook signature');
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString());
    const data = event.data;
    const reference = data?.reference;

    switch (event.event) {
      case 'charge.success': {
        const metadata = data?.metadata || {};
        const invoiceId = metadata.invoice_id;
        const isSubscription =
          metadata.type?.startsWith('subscription') ||
          metadata.subscription_plan === 'pro' ||
          metadata.subscription_interval;

        // Subscription activation should not depend on a pre-created payments row
        // (that insert is best-effort and may have failed). Handle it up front.
        if (isSubscription && metadata.user_id) {
          const expiresAt = new Date();
          if (metadata.subscription_interval === 'yearly') {
            expiresAt.setFullYear(expiresAt.getFullYear() + 1);
          } else {
            expiresAt.setMonth(expiresAt.getMonth() + 1);
          }

          const { error: subErr } = await supabaseAdmin
            .from('users')
            .update({
              subscription_plan: 'pro',
              subscription_status: 'active',
              subscription_expires_at: expiresAt.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', metadata.user_id);

          if (subErr) {
            console.error('Subscription activation DB error via webhook:', subErr);
          } else {
            console.log(`User ${metadata.user_id} upgraded to pro via webhook`);
          }

          try {
            const { data: user } = await supabaseAdmin
              .from('users')
              .select('email')
              .eq('id', metadata.user_id)
              .single();
            if (user?.email) {
              await sendSubscriptionActivated({
                to: user.email,
                plan: 'Pro',
                interval: metadata.subscription_interval || 'monthly',
                expiresAt: expiresAt.toISOString(),
              });
            }
          } catch (emailErr) {
            console.error('Failed to send subscription email:', emailErr);
          }
        }

        // Idempotency guard for invoice payment records: only process a charge once.
        if (invoiceId && reference) {
          const { data: existing, error: exErr } = await supabaseAdmin
            .from('payments')
            .select('status')
            .eq('reference', reference)
            .single();
          if (exErr || !existing) {
            console.log(`Ignoring unknown reference ${reference}`);
            break;
          }
          if (existing.status === 'success') {
            console.log(`Skipping duplicate webhook for reference ${reference}`);
            break;
          }
        }

        await supabaseAdmin
          .from('payments')
          .update({ status: 'success', paystack_data: data, updated_at: new Date().toISOString() })
          .eq('reference', reference);

        if (invoiceId) {
          await supabaseAdmin
            .from('invoices')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('id', invoiceId);
          console.log(`Invoice ${invoiceId} marked as paid via webhook for reference ${reference}`);

          try {
            const { data: invoice } = await supabaseAdmin
              .from('invoices')
              .select('invoice_number, total, clients(email, name)')
              .eq('id', invoiceId)
              .single();
            const emailTo = invoice?.clients?.email;
            if (emailTo) {
              await sendPaymentReceipt({
                to: emailTo,
                invoiceNumber: invoice?.invoice_number || invoiceId,
                amount: invoice?.total || 0,
                reference,
                businessName: invoice?.clients?.name,
              });
            }
          } catch (emailErr) {
            console.error('Failed to send receipt email:', emailErr);
          }
        }
        break;
      }

      case 'charge.failed': {
        if (reference) {
          await supabaseAdmin
            .from('payments')
            .update({ status: 'failed', paystack_data: data, updated_at: new Date().toISOString() })
            .eq('reference', reference);
          console.log(`Payment ${reference} recorded as failed`);
        }
        break;
      }

      case 'transfer.success': {
        const transferRef = data?.reference;
        const transferCode = data?.transfer_code;
        if (transferRef) {
          const { data: existingWd } = await supabaseAdmin
            .from('withdrawals')
            .select('status')
            .eq('reference', transferRef)
            .single();
          if (existingWd?.status === 'success') {
            console.log(`Skipping duplicate transfer webhook for ${transferRef}`);
            break;
          }
          await supabaseAdmin
            .from('withdrawals')
            .update({
              status: 'success',
              transfer_code: transferCode || null,
              updated_at: new Date().toISOString(),
            })
            .eq('reference', transferRef);
          console.log(`Withdrawal ${transferRef} marked as successful`);
        }
        break;
      }

      case 'transfer.failed': {
        const transferRef = data?.reference;
        const failures = data?.failures;
        const failureReason = Array.isArray(failures) && failures.length > 0
          ? failures.map((f) => f.message || f.type).join('; ')
          : data?.gateway_response || 'Transfer failed';
        if (transferRef) {
          await supabaseAdmin
            .from('withdrawals')
            .update({
              status: 'failed',
              failure_reason: failureReason,
              updated_at: new Date().toISOString(),
            })
            .eq('reference', transferRef);
          console.log(`Withdrawal ${transferRef} marked as failed: ${failureReason}`);
        }
        break;
      }

      case 'transfer.reversed': {
        const transferRef = data?.reference;
        if (transferRef) {
          await supabaseAdmin
            .from('withdrawals')
            .update({
              status: 'reversed',
              failure_reason: 'Transfer reversed by Paystack',
              updated_at: new Date().toISOString(),
            })
            .eq('reference', transferRef);
          console.log(`Withdrawal ${transferRef} reversed`);
        }
        break;
      }

      case 'subscription.disable': {
        const userId = data?.customer?.metadata?.user_id || data?.metadata?.user_id;
        if (userId) {
          await supabaseAdmin
            .from('users')
            .update({
              subscription_plan: 'free',
              subscription_status: 'cancelled',
              subscription_expires_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', userId);
          console.log(`Subscription disabled for user ${userId}`);
        }
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event.event}`);
    }

    res.status(200).send('Webhook received successfully');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Webhook error');
  }
});

export default router;