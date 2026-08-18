import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase.js";
import { authenticateToken } from "../middleware/auth.js";
import { sendSubscriptionActivated } from "../services/emailService.js";

const router = Router();

router.use(authenticateToken);

router.post("/initialize", async (req, res) => {
  try {
    const { invoiceId, email } = req.body;

    if (!invoiceId || !email) {
      return res
        .status(400)
        .json({ error: "Invoice ID and email are required" });
    }

    // Verify invoice exists and belongs to user
    const { data: invoice, error: findError } = await supabaseAdmin
      .from("invoices")
      .select("id, total, status, invoice_number")
      .eq("id", invoiceId)
      .eq("user_id", req.user.userId)
      .single();

    if (findError || !invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (invoice.status === "paid") {
      return res.status(400).json({ error: "Invoice is already paid" });
    }

    const amountInKobo = Math.round(invoice.total * 100);

    // Call Paystack API
    const paystackResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: amountInKobo,
          callback_url: `${process.env.FRONTEND_URL}/pay/${invoiceId}`,
          metadata: {
            invoice_id: invoiceId,
            user_id: req.user.userId,
          },
        }),
      },
    );

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error("Paystack initialization failed:", paystackData);
      return res.status(400).json({ error: "Payment initialization failed" });
    }

    // Save payment attempt to database
    const { error: insertError } = await supabaseAdmin.from("payments").insert({
      invoice_id: invoiceId,
      user_id: req.user.userId,
      reference: paystackData.data.reference,
      amount: invoice.total,
      currency: "NGN",
      status: "pending",
      channel: "paystack",
    });

    if (insertError) {
      console.error("Failed to save payment record:", insertError);
      // We still return success to frontend because paystack initialized successfully,
      // but log the error. We can rely on webhooks to reconcile later if needed.
    }

    res.json({
      reference: paystackData.data.reference,
      authorization_url: paystackData.data.authorization_url,
      amount: invoice.total,
    });
  } catch (err) {
    console.error("Payment initialization error:", err);
    res.status(500).json({ error: "Failed to initialize payment" });
  }
});

router.get("/verify/:reference", async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ error: "Payment reference is required" });
    }

    // Call Paystack API
    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error("Paystack verification failed:", paystackData);
      return res.status(400).json({ error: "Payment verification failed" });
    }

    const isSuccessful = paystackData.data.status === "success";

    if (isSuccessful) {
      const invoiceId = paystackData.data.metadata?.invoice_id;

      if (invoiceId) {
        // Update payment record
        await supabaseAdmin
          .from("payments")
          .update({
            status: "success",
            paystack_data: paystackData.data,
            updated_at: new Date().toISOString(),
          })
          .eq("reference", reference);

        // Update invoice
        await supabaseAdmin
          .from("invoices")
          .update({ status: "paid", paid_at: new Date().toISOString() })
          .eq("id", invoiceId)
          .eq("user_id", req.user.userId);
      }
    } else {
      // Update payment record as failed
      await supabaseAdmin
        .from("payments")
        .update({
          status: paystackData.data.status,
          paystack_data: paystackData.data,
          updated_at: new Date().toISOString(),
        })
        .eq("reference", reference);
    }

    res.json({
      success: isSuccessful,
      message: paystackData.message,
      data: paystackData.data,
    });
  } catch (err) {
    console.error("Payment verification error:", err);
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

// --- Subscription Endpoints ---

router.post("/subscribe", async (req, res) => {
  try {
    const { plan, email } = req.body;

    if (!plan || !["monthly", "yearly"].includes(plan)) {
      return res
        .status(400)
        .json({ error: "Valid plan (monthly or yearly) is required" });
    }
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const amountInKobo = plan === "yearly" ? 95990 * 100 : 9999 * 100;

    // Call Paystack API
    const paystackResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: amountInKobo,
          callback_url: `${process.env.FRONTEND_URL}/verify-subscription`,
          metadata: {
            user_id: req.user.userId,
            subscription_plan: "pro",
            subscription_interval: plan, // 'monthly' or 'yearly'
            type: "subscription_upgrade",
          },
        }),
      },
    );

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error("Paystack initialization failed:", paystackData);
      return res.status(400).json({ error: "Payment initialization failed" });
    }

    // Save payment attempt to database
    await supabaseAdmin.from("payments").insert({
      user_id: req.user.userId,
      reference: paystackData.data.reference,
      amount: amountInKobo / 100,
      currency: "NGN",
      status: "pending",
      channel: "paystack",
    });

    res.json({
      reference: paystackData.data.reference,
      authorization_url: paystackData.data.authorization_url,
    });
  } catch (err) {
    console.error("Subscription initialization error:", err);
    res
      .status(500)
      .json({ error: "Failed to initialize subscription payment" });
  }
});

router.get("/verify-subscription/:reference", async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ error: "Payment reference is required" });
    }

    // Call Paystack API
    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error("Paystack verification failed:", paystackData);
      return res.status(400).json({ error: "Payment verification failed" });
    }

    const isSuccessful = paystackData.data.status === "success";

    if (isSuccessful) {
      const metadata = paystackData.data.metadata || {};
      const isSubscription =
        metadata.type?.startsWith("subscription") ||
        metadata.subscription_plan === "pro" ||
        metadata.subscription_interval;

      if (isSubscription) {
        // Update payment record
        await supabaseAdmin
          .from("payments")
          .update({
            status: "success",
            paystack_data: paystackData.data,
            updated_at: new Date().toISOString(),
          })
          .eq("reference", reference);

        // Calculate new expiration date
        const interval = metadata.subscription_interval === "yearly" ? "yearly" : "monthly";
        const expiresAt = new Date();
        if (interval === "yearly") {
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        } else {
          expiresAt.setMonth(expiresAt.getMonth() + 1);
        }

        const targetUserId = metadata.user_id || req.user.userId;

        // Update user to pro
        const { error: userUpdateError } = await supabaseAdmin
          .from("users")
          .update({
            subscription_plan: "pro",
            subscription_status: "active",
            subscription_expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", targetUserId);

        if (userUpdateError) {
          console.error("Subscription activation DB error:", userUpdateError);
        } else {
          console.log(`Subscription activated for user ${targetUserId} (${interval})`);
        }

        // Fire-and-forget activation email
        const { data: user } = await supabaseAdmin.from("users").select("email").eq("id", targetUserId).single();
        if (user?.email) {
          try {
            await sendSubscriptionActivated({ to: user.email, plan: "Pro", interval, expiresAt: expiresAt.toISOString() });
          } catch (e) {
            console.error("Subscription activation email error:", e);
          }
        }
      }
    } else {
      // Update payment record as failed
      await supabaseAdmin
        .from("payments")
        .update({
          status: paystackData.data.status,
          paystack_data: paystackData.data,
          updated_at: new Date().toISOString(),
        })
        .eq("reference", reference);
    }

    res.json({
      success: isSuccessful,
      message: paystackData.message,
    });
  } catch (err) {
    console.error("Subscription verification error:", err);
    res.status(500).json({ error: "Failed to verify subscription payment" });
  }
});

// --- Payment History ---

router.get("/history", async (req, res) => {
  try {
    const { status, from_date, to_date, invoice, page = 1, limit = 20 } = req.query;

    let query = supabaseAdmin
      .from("payments")
      .select("id, invoice_id, reference, amount, currency, status, channel, created_at, invoices(invoice_number)", { count: "exact" })
      .eq("user_id", req.user.userId);

    // Exclude subscription billing records (no invoice_id) when a filter targets invoices.
    if (status) query = query.eq("status", status);
    if (from_date) query = query.gte("created_at", from_date);
    if (to_date) query = query.lte("created_at", to_date);
    if (invoice) query = query.ilike("invoices.invoice_number", `%${invoice}%`);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range((pageNum - 1) * limitNum, pageNum * limitNum - 1);

    if (error) throw error;

    // Shallow-clone selector workaround: Supabase returns nested invoices as { invoices: {...} }.
    const rows = (data || []).map((row) => ({
      ...row,
      invoice_number: row.invoices?.invoice_number || null,
    }));

    res.json({
      payments: rows,
      total: count || 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    console.error("Payment history error:", err);
    res.status(500).json({ error: "Failed to fetch payment history" });
  }
});

export default router;
