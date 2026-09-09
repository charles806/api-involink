import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase.js";
import { authenticateToken } from "../middleware/auth.js";

const router = Router();

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = supabaseAdmin
      .from('clients')
      .select('*')
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false });

    if (search && search.trim()) {
      const sanitized = search.trim();
      query = query.or(`name.ilike.%${sanitized}%,email.ilike.%${sanitized}%`);
    }

    const { data, error } = await query;

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Get clients error:', err);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, phone, address, bank_name, account_number, account_name } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    // Validate email format if provided
    if (email && typeof email === 'string' && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    // Validate account number if provided
    if (account_number && typeof account_number === 'string' && account_number.trim()) {
      if (!/^\d{10,}$/.test(account_number.trim())) {
        return res.status(400).json({ error: 'Account number must contain at least 10 digits' });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert({
        user_id: req.user.userId,
        name: name.trim(),
        email: email ? email.trim() : null,
        phone: phone ? phone.trim() : null,
        address: address ? address.trim() : null,
        bank_name: bank_name ? bank_name.trim() : null,
        account_number: account_number ? account_number.trim() : null,
        account_name: account_name ? account_name.trim() : null,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, address, bank_name, account_number, account_name } = req.body;

    if (name !== undefined && (!name || !name.trim())) {
      return res.status(400).json({ error: 'Client name cannot be empty' });
    }

    if (email && typeof email === 'string' && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    if (account_number && typeof account_number === 'string' && account_number.trim()) {
      if (!/^\d{10,}$/.test(account_number.trim())) {
        return res.status(400).json({ error: 'Account number must contain at least 10 digits' });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (email !== undefined) updateData.email = email ? email.trim() : null;
    if (phone !== undefined) updateData.phone = phone ? phone.trim() : null;
    if (address !== undefined) updateData.address = address ? address.trim() : null;
    if (bank_name !== undefined) updateData.bank_name = bank_name ? bank_name.trim() : null;
    if (account_number !== undefined) updateData.account_number = account_number ? account_number.trim() : null;
    if (account_name !== undefined) updateData.account_name = account_name ? account_name.trim() : null;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('clients')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Client not found' });
      }
      throw error;
    }

    res.json(data);
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify the client exists and belongs to this user
    const { data: existing, error: findError } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Check if the client has invoices — do not allow deletion if so
    const { count, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', id);

    if (invoiceError) throw invoiceError;

    if (count !== null && count > 0) {
      return res.status(409).json({
        error: 'This client has invoices and cannot be deleted.'
      });
    }

    const { error } = await supabaseAdmin
      .from('clients')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.userId);

    if (error) throw error;
    res.json({ message: 'Client deleted successfully' });
  } catch (err) {
    console.error('Delete client error:', err);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

export default router;