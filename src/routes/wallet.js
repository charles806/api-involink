import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase.js";
import { authenticateToken } from "../middleware/auth.js";

const router = Router();

router.use(authenticateToken);

const validateAmount = (amount) => {
  if (amount === undefined || amount === null) return "Amount is required";
  if (typeof amount !== "number" || isNaN(amount)) return "Amount must be a number";
  if (amount <= 0) return "Amount must be greater than zero";
  if (amount < 100) return "Minimum withdrawal is ₦100";
  return null;
};

const validateBankDetails = (bank_name, account_number, bank_code) => {
  if (!bank_name || !bank_name.trim()) return "Bank name is required";
  if (!account_number || !account_number.trim()) return "Account number is required";
  if (!/^\d{10}$/.test(account_number.trim())) return "Account number must be 10 digits";
  if (!bank_code || !bank_code.trim()) return "Bank code is required";
  return null;
};

// GET /wallet/balance
router.get("/balance", async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: successfulPayments, error: payErr } = await supabaseAdmin
      .from("payments")
      .select("amount")
      .eq("user_id", userId)
      .eq("status", "success");

    if (payErr) throw payErr;

    const { data: successfulWithdrawals, error: wdErr } = await supabaseAdmin
      .from("withdrawals")
      .select("amount")
      .eq("user_id", userId)
      .eq("status", "success");

    if (wdErr) throw wdErr;

    const totalEarned = (successfulPayments || []).reduce(
      (sum, p) => sum + Number(p.amount || 0),
      0,
    );
    const totalWithdrawn = (successfulWithdrawals || []).reduce(
      (sum, w) => sum + Number(w.amount || 0),
      0,
    );
    const availableBalance = Math.round((totalEarned - totalWithdrawn) * 100) / 100;

    let paystackBalance = null;
    try {
      const psRes = await fetch("https://api.paystack.co/balance", {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      });
      const psData = await psRes.json();
      if (psData.status && Array.isArray(psData.data)) {
        const ngnBalance = psData.data.find((b) => b.currency === "NGN");
        if (ngnBalance) {
          paystackBalance = ngnBalance.balance / 100;
        }
      }
    } catch (e) {
      console.error("Failed to fetch Paystack balance:", e.message);
    }

    res.json({
      available_balance: availableBalance,
      total_earned: Math.round(totalEarned * 100) / 100,
      total_withdrawn: Math.round(totalWithdrawn * 100) / 100,
      paystack_balance: paystackBalance,
    });
  } catch (err) {
    console.error("Get balance error:", err);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

// POST /wallet/withdraw
router.post("/withdraw", async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount, bank_name, account_number, bank_code, account_name } = req.body;

    const amountError = validateAmount(amount);
    if (amountError) return res.status(400).json({ error: amountError });

    const bankError = validateBankDetails(bank_name, account_number, bank_code);
    if (bankError) return res.status(400).json({ error: bankError });

    const trimmedAccount = account_number.trim();
    const trimmedBankCode = bank_code.trim();
    const trimmedBankName = bank_name.trim();
    const trimmedAccountName = (account_name || "").trim();

    // Compute available balance
    const { data: successfulPayments } = await supabaseAdmin
      .from("payments")
      .select("amount")
      .eq("user_id", userId)
      .eq("status", "success");

    const { data: successfulWithdrawals } = await supabaseAdmin
      .from("withdrawals")
      .select("amount")
      .eq("user_id", userId)
      .eq("status", "success");

    const totalEarned = (successfulPayments || []).reduce(
      (sum, p) => sum + Number(p.amount || 0), 0,
    );
    const totalWithdrawn = (successfulWithdrawals || []).reduce(
      (sum, w) => sum + Number(w.amount || 0), 0,
    );
    const availableBalance = Math.round((totalEarned - totalWithdrawn) * 100) / 100;

    if (amount > availableBalance) {
      return res.status(400).json({
        error: `Insufficient balance. Available: ₦${availableBalance.toLocaleString("en-NG")}`,
      });
    }

    // Get or create Paystack transfer recipient
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("paystack_recipient_code, name, email")
      .eq("id", userId)
      .single();

    let recipientCode = user?.paystack_recipient_code;

    if (!recipientCode) {
      const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "nuban",
          name: trimmedAccountName || user?.name || "Involink User",
          account_number: trimmedAccount,
          bank_code: trimmedBankCode,
          currency: "NGN",
          description: `Involink withdrawal recipient for ${user?.email || userId}`,
        }),
      });

      const recipientData = await recipientRes.json();

      if (!recipientRes.ok || !recipientData.status) {
        console.error("Paystack recipient creation failed:", recipientData);
        return res.status(400).json({ error: "Failed to create transfer recipient. Check your bank details." });
      }

      recipientCode = recipientData.data.recipient_code;

      // Cache recipient code on user
      await supabaseAdmin
        .from("users")
        .update({ paystack_recipient_code: recipientCode })
        .eq("id", userId);
    }

    // Generate reference
    const reference = `wd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const amountInKobo = Math.round(amount * 100);

    // Initiate transfer via Paystack
    const transferRes = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "balance",
        amount: amountInKobo,
        recipient: recipientCode,
        reference,
        reason: "Withdrawal from Involink",
      }),
    });

    const transferData = await transferRes.json();

    if (!transferRes.ok || !transferData.status) {
      console.error("Paystack transfer failed:", transferData);
      const msg = transferData.message || "Transfer failed";
      return res.status(400).json({ error: msg });
    }

    // Save withdrawal record
    const { error: insertErr } = await supabaseAdmin.from("withdrawals").insert({
      user_id: userId,
      amount,
      bank_name: trimmedBankName,
      account_number: trimmedAccount,
      account_name: trimmedAccountName || null,
      bank_code: trimmedBankCode,
      status: "pending",
      reference,
      paystack_recipient_code: recipientCode,
      transfer_code: transferData.data.transfer_code || null,
    });

    if (insertErr) {
      console.error("Failed to save withdrawal record:", insertErr);
    }

    res.json({
      success: true,
      reference,
      message: "Withdrawal initiated. You will receive the funds shortly.",
      transfer_code: transferData.data.transfer_code || null,
    });
  } catch (err) {
    console.error("Withdraw error:", err);
    res.status(500).json({ error: "Failed to process withdrawal" });
  }
});

// GET /wallet/withdrawals
router.get("/withdrawals", async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, page = 1, limit = 20 } = req.query;

    let query = supabaseAdmin
      .from("withdrawals")
      .select("id, amount, bank_name, account_number, account_name, status, reference, failure_reason, created_at", { count: "exact" })
      .eq("user_id", userId);

    if (status) query = query.eq("status", status);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range((pageNum - 1) * limitNum, pageNum * limitNum - 1);

    if (error) throw error;

    res.json({
      withdrawals: data || [],
      total: count || 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    console.error("Get withdrawals error:", err);
    res.status(500).json({ error: "Failed to fetch withdrawals" });
  }
});

// GET /wallet/banks
router.get("/banks", async (req, res) => {
  try {
    const bankRes = await fetch("https://api.paystack.co/bank?country=nigeria&perPage=100", {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });

    const bankData = await bankRes.json();

    if (!bankRes.ok || !bankData.status) {
      return res.status(400).json({ error: "Failed to fetch banks" });
    }

    const banks = (bankData.data || []).map((b) => ({
      name: b.name,
      code: b.code,
      longcode: b.longcode || null,
    }));

    res.json(banks);
  } catch (err) {
    console.error("Get banks error:", err);
    res.status(500).json({ error: "Failed to fetch banks" });
  }
});

// POST /wallet/resolve-account
router.post("/resolve-account", async (req, res) => {
  try {
    const { account_number, bank_code } = req.body;

    if (!account_number || !bank_code) {
      return res.status(400).json({ error: "Account number and bank code are required" });
    }

    const resolveRes = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(account_number.trim())}&bank_code=${encodeURIComponent(bank_code.trim())}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      },
    );

    const resolveData = await resolveRes.json();

    if (!resolveRes.ok || !resolveData.status) {
      return res.status(400).json({ error: resolveData.message || "Could not resolve account" });
    }

    res.json({
      account_name: resolveData.data.account_name,
      account_number: resolveData.data.account_number,
    });
  } catch (err) {
    console.error("Resolve account error:", err);
    res.status(500).json({ error: "Failed to resolve account" });
  }
});

export default router;
