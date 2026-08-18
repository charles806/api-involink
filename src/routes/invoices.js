import { Router } from 'express';
import { supabaseAdmin } from "../lib/supabase.js";
import { authenticateToken } from "../middleware/auth.js";
import { attachSubscription, requireInvoiceQuota } from "../middleware/featureGating.js";
import { calculateInvoiceTotals, validateItems, nextInvoiceNumber } from '../lib/invoiceMath.js';
import { sendInvoiceEmail, sendInvoiceReminder } from "../services/emailService.js";

const router = Router();

// PUBLIC: Get invoice for payment page (NO AUTH)
// Must be registered BEFORE router.use(authenticateToken) so anyone with the
// payment link can fetch the invoice without a token.
router.get('/:id/public', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .select('id, invoice_number, subtotal, vat, total, status, due_date, issue_date, vat_enabled, clients(name, email, phone)')
      .eq('id', id)
      .single();

    if (error || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoice.status === 'paid') {
      return res.json({ ...invoice, already_paid: true });
    }

    const { data: items } = await supabaseAdmin
      .from('invoice_items')
      .select('description, quantity, rate, discount, unit')
      .eq('invoice_id', id);

    // Get the business owner info for branding
    const { data: invoiceFull } = await supabaseAdmin
      .from('invoices')
      .select('user_id')
      .eq('id', id)
      .single();

    let businessInfo = null;
    if (invoiceFull) {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('name, business_name, bank_name, account_number, account_name')
        .eq('id', invoiceFull.user_id)
        .single();
      businessInfo = user;
    }

    res.json({
      ...invoice,
      items: items || [],
      business: businessInfo,
    });
  } catch (err) {
    console.error('Get public invoice error:', err);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// --- Protected routes ---

router.use(authenticateToken);

// GET all invoices
router.get('/', async (req, res) => {
  try {
    const { status, client_id, from_date, to_date } = req.query;

    let query = supabaseAdmin
      .from('invoices')
      .select('*, clients(name, email, phone, address)')
      .eq('user_id', req.user.userId);

    if (status) query = query.eq('status', status);
    if (client_id) query = query.eq('client_id', client_id);
    if (from_date) query = query.gte('due_date', from_date);
    if (to_date) query = query.lte('due_date', to_date);

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.json([]);
    }

    // Batch-fetch all items for all invoices (avoids N+1)
    const invoiceIds = data.map(inv => inv.id);
    const { data: allItems, error: itemsError } = await supabaseAdmin
      .from('invoice_items')
      .select('*')
      .in('invoice_id', invoiceIds);

    if (itemsError) throw itemsError;

    // Group items by invoice_id
    const itemsByInvoice = {};
    (allItems || []).forEach(item => {
      if (!itemsByInvoice[item.invoice_id]) {
        itemsByInvoice[item.invoice_id] = [];
      }
      itemsByInvoice[item.invoice_id].push(item);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const invoicesWithItems = data.map(inv => {
      let resolvedStatus = inv.status;
      
      if (inv.status === 'sent' && inv.due_date) {
        const dueDate = new Date(inv.due_date);
        dueDate.setHours(0, 0, 0, 0);
        if (dueDate < today) {
          resolvedStatus = 'overdue';
        }
      }
      
      return {
        ...inv,
        items: itemsByInvoice[inv.id] || [],
        status: resolvedStatus,
      };
    });

    res.json(invoicesWithItems);
  } catch (err) {
    console.error('Get invoices error:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// CREATE invoice
router.post('/', attachSubscription, requireInvoiceQuota, async (req, res) => {
  try {
    const { client_id, issue_date, due_date, items, notes, vat_enabled, tax_rate, invoice_number } = req.body;

    if (!client_id) {
      return res.status(400).json({ error: 'Client is required' });
    }

    const itemError = validateItems(items);
    if (itemError) {
      return res.status(400).json({ error: itemError });
    }

    // Verify client belongs to this user
    const { data: clientExists } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', client_id)
      .eq('user_id', req.user.userId)
      .single();

    if (!clientExists) {
      return res.status(400).json({ error: 'Invalid client' });
    }

    // Generate invoice number if not provided
    let finalInvoiceNumber;
    if (!invoice_number || !invoice_number.trim()) {
      const { data: lastInvoice } = await supabaseAdmin
        .from('invoices')
        .select('invoice_number')
        .eq('user_id', req.user.userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      finalInvoiceNumber = nextInvoiceNumber(lastInvoice?.invoice_number);
    } else {
      finalInvoiceNumber = invoice_number.trim();
    }

    const { subtotal, vat, total } = calculateInvoiceTotals(items, vat_enabled, tax_rate || 0.075);

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .insert({
        user_id: req.user.userId,
        client_id,
        invoice_number: finalInvoiceNumber,
        issue_date: issue_date || new Date().toISOString().split('T')[0],
        due_date: due_date || null,
        subtotal,
        vat,
        total,
        vat_enabled: vat_enabled || false,
        status: 'draft',
        notes: notes || null,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    const itemsWithInvoiceId = items.map(item => ({
      invoice_id: invoice.id,
      description: item.description.trim(),
      quantity: parseFloat(item.quantity) || 1,
      rate: parseFloat(item.rate) || 0,
      discount: parseFloat(item.discount) || 0,
      unit: item.unit || 'pcs'
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('invoice_items')
      .insert(itemsWithInvoiceId);

    if (itemsError) throw itemsError;

    const { data: savedItems } = await supabaseAdmin
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoice.id);

    res.status(201).json({ ...invoice, items: savedItems || [] });
  } catch (err) {
    console.error('Create invoice error:', err);
    res.status(500).json({ error: err.message || 'Failed to create invoice' });
  }
});

// UPDATE invoice
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { client_id, issue_date, due_date, status, notes, vat_enabled, tax_rate, items, invoice_number } = req.body;

    // Verify invoice belongs to user
    const { data: existingInvoice, error: findError } = await supabaseAdmin
      .from('invoices')
      .select('id, status')
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .single();

    if (findError || !existingInvoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    let updateData = { 
      client_id, 
      issue_date, 
      due_date, 
      status, 
      notes, 
      vat_enabled,
      invoice_number,
      updated_at: new Date().toISOString(),
    };
    updateData = Object.fromEntries(Object.entries(updateData).filter(([_, v]) => v !== undefined));

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .select()
      .single();

    if (error) throw error;

    if (items) {
      const itemError = validateItems(items);
      if (itemError) {
        return res.status(400).json({ error: itemError });
      }

      await supabaseAdmin.from('invoice_items').delete().eq('invoice_id', id);
      
      const itemsWithInvoiceId = items.map(item => ({
        invoice_id: id,
        description: item.description.trim(),
        quantity: parseFloat(item.quantity) || 1,
        rate: parseFloat(item.rate) || 0,
        discount: parseFloat(item.discount) || 0,
        unit: item.unit || 'pcs'
      }));

      await supabaseAdmin.from('invoice_items').insert(itemsWithInvoiceId);

      const { subtotal, vat, total } = calculateInvoiceTotals(items, invoice.vat_enabled, tax_rate || 0.075);

      await supabaseAdmin
        .from('invoices')
        .update({ subtotal, vat, total })
        .eq('id', id);
    }

    const { data: updatedInvoice } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(name, email, phone, address)')
      .eq('id', id)
      .single();

    const { data: savedItems } = await supabaseAdmin
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', id);

    res.json({ ...updatedInvoice, items: savedItems || [] });
  } catch (err) {
    console.error('Update invoice error:', err);
    res.status(500).json({ error: err.message || 'Failed to update invoice' });
  }
});

// DELETE invoice
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await supabaseAdmin.from('invoice_items').delete().eq('invoice_id', id);

    const { error } = await supabaseAdmin
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.userId);

    if (error) throw error;
    res.json({ message: 'Invoice deleted successfully' });
  } catch (err) {
    console.error('Delete invoice error:', err);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// GET single invoice (authenticated)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(*)')
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .single();

    if (error || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const { data: items } = await supabaseAdmin
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', id);

    let resolvedStatus = invoice.status;
    
    if (invoice.status === 'sent' && invoice.due_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(invoice.due_date);
      dueDate.setHours(0, 0, 0, 0);
      if (dueDate < today) {
        resolvedStatus = 'overdue';
      }
    }

    res.json({ ...invoice, items: items || [], status: resolvedStatus });
  } catch (err) {
    console.error('Get invoice error:', err);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// SEND invoice / SEND reminder
// draft   -> marks as sent, emails the initial invoice
// sent/overdue -> keeps status, bumps reminder_count, emails a reminder (tone: friendly|firm)
router.post('/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const tone = req.body?.tone === 'firm' ? 'firm' : 'friendly';

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(*)')
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .single();

    if (error || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({ error: 'Invoice is already paid', code: 'ALREADY_PAID' });
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('name, business_name')
      .eq('id', req.user.userId)
      .single();

    const clientEmail = invoice.clients?.email;
    const businessName = user?.business_name || user?.name || null;
    const frontendUrl = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',')[0].trim()
      : 'http://localhost:5173';
    const paymentUrl = `${frontendUrl}/pay/${id}`;

    const isFirstSend = invoice.status === 'draft';
    const isReminder = !isFirstSend;

    const updateData = { updated_at: new Date().toISOString() };
    if (isFirstSend) {
      updateData.status = 'sent';
      updateData.sent_at = new Date().toISOString();
    } else {
      updateData.reminder_count = (Number(invoice.reminder_count) || 0) + 1;
      updateData.last_reminded_at = new Date().toISOString();
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('invoices')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .select('*, clients(*)')
      .single();

    if (updateErr) throw updateErr;

    if (clientEmail) {
      try {
        if (isFirstSend) {
          await sendInvoiceEmail({
            to: clientEmail,
            clientName: invoice.clients?.name,
            businessName,
            invoiceNumber: invoice.invoice_number,
            amount: invoice.total,
            dueDate: invoice.due_date,
            paymentUrl,
          });
        } else {
          const daysOverdue = invoice.due_date
            ? Math.max(
                0,
                Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(invoice.due_date).setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24))
              )
            : 0;
          await sendInvoiceReminder({
            to: clientEmail,
            clientName: invoice.clients?.name,
            businessName,
            invoiceNumber: invoice.invoice_number,
            amount: invoice.total,
            dueDate: invoice.due_date,
            paymentUrl,
            tone,
            daysOverdue,
          });
        }
      } catch (emailErr) {
        console.error('Send invoice email error:', emailErr);
      }
    }

    const { data: items } = await supabaseAdmin
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', id);

    res.json({ ...updated, items: items || [] });
  } catch (err) {
    console.error('Send invoice error:', err);
    res.status(500).json({ error: 'Failed to send invoice' });
  }
});

// MARK PAID
router.post('/:id/mark-paid', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .select('*, clients(*)')
      .single();

    if (error) throw error;

    const { data: items } = await supabaseAdmin
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', id);

    res.json({ ...invoice, items: items || [] });
  } catch (err) {
    console.error('Mark paid error:', err);
    res.status(500).json({ error: 'Failed to mark invoice as paid' });
  }
});

// RECORD MANUAL PAYMENT
// Inserts a real payments row (shows up in Payment History) and marks the invoice paid.
router.post('/:id/record-payment', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, method, reference } = req.body;

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'A valid payment amount is required' });
    }

    const validMethods = ['bank_transfer', 'cash', 'card', 'cheque', 'other'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .select('id, total, status')
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .single();

    if (error || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({ error: 'Invoice is already paid', code: 'ALREADY_PAID' });
    }

    const finalReference = (reference && reference.trim())
      ? reference.trim()
      : `MAN-${Date.now()}`;

    const { error: insertErr } = await supabaseAdmin
      .from('payments')
      .insert({
        invoice_id: id,
        user_id: req.user.userId,
        reference: finalReference,
        amount: Math.round(parsedAmount * 100) / 100,
        status: 'success',
        channel: method,
      });

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(400).json({ error: 'That reference already exists' });
      }
      throw insertErr;
    }

    const { data: updated, error: invoiceErr } = await supabaseAdmin
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .select('*, clients(*)')
      .single();

    if (invoiceErr) throw invoiceErr;

    const { data: items } = await supabaseAdmin
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', id);

    res.json({ ...updated, items: items || [], payment: { reference: finalReference, amount: parsedAmount, method } });
  } catch (err) {
    console.error('Record payment error:', err);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

export default router;