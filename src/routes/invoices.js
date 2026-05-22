const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// --- Helpers ---

function calculateInvoiceTotals(items, vatEnabled, taxRate) {
  const subtotal = items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const rate = parseFloat(item.rate) || 0;
    const discount = parseFloat(item.discount) || 0;
    const lineTotal = qty * rate;
    const afterDiscount = lineTotal - (lineTotal * (discount / 100));
    return sum + afterDiscount;
  }, 0);
  
  const vat = vatEnabled ? subtotal * (parseFloat(taxRate) || 0.075) : 0;
  const total = subtotal + vat;
  
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return 'At least one line item is required';
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.description || typeof item.description !== 'string' || !item.description.trim()) {
      return `Item ${i + 1}: description is required`;
    }
    if (item.quantity === undefined || item.quantity === null || parseFloat(item.quantity) <= 0) {
      return `Item ${i + 1}: quantity must be greater than 0`;
    }
    if (item.rate === undefined || item.rate === null || parseFloat(item.rate) < 0) {
      return `Item ${i + 1}: rate cannot be negative`;
    }
    if (item.discount !== undefined && (parseFloat(item.discount) < 0 || parseFloat(item.discount) > 100)) {
      return `Item ${i + 1}: discount must be between 0 and 100`;
    }
  }
  return null;
}

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
router.post('/', async (req, res) => {
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

      let nextNum = 1;
      if (lastInvoice?.invoice_number) {
        const match = lastInvoice.invoice_number.match(/(\d+)$/);
        if (match) {
          nextNum = parseInt(match[1]) + 1;
        }
      }
      finalInvoiceNumber = `INV-${String(nextNum).padStart(4, '0')}`;
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

// SEND invoice
router.post('/:id/send', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
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

// PUBLIC: Get invoice for payment page (NO AUTH)
// This is mounted separately — see index.js
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

module.exports = router;