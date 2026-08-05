import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase.js";
import { authenticateToken } from "../middleware/auth.js";

const router = Router();

router.use(authenticateToken);

// GET /api/settings/tax-rates
router.get('/tax-rates', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tax_rates')
      .select('id, name, rate, is_default, created_at')
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      const { data: seeded, error: seedError } = await supabaseAdmin
        .from('tax_rates')
        .insert([
          { user_id: req.user.userId, name: 'VAT', rate: 7.5, is_default: true },
          { user_id: req.user.userId, name: 'GST', rate: 5, is_default: false },
        ])
        .select('id, name, rate, is_default, created_at')
        .order('created_at', { ascending: true });

      if (seedError) throw seedError;
      return res.json(seeded || []);
    }

    res.json(data);
  } catch (err) {
    console.error('Get tax rates error:', err);
    res.status(500).json({ error: 'Failed to fetch tax rates' });
  }
});

// POST /api/settings/tax-rates
router.post('/tax-rates', async (req, res) => {
  try {
    const { name, rate, isDefault } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Tax rate name is required' });
    }
    if (rate === undefined || isNaN(Number(rate)) || Number(rate) < 0) {
      return res.status(400).json({ error: 'A valid tax rate percentage is required' });
    }

    const sanitizedName = name.trim();
    const numericRate = Math.round(Number(rate) * 100) / 100;
    const makeDefault = Boolean(isDefault);

    // If this is the first tax rate for the user, force it as default
    const { data: existing, error: countError } = await supabaseAdmin
      .from('tax_rates')
      .select('id')
      .eq('user_id', req.user.userId)
      .limit(1);

    if (countError) throw countError;

    if (makeDefault || existing.length === 0) {
      await supabaseAdmin
        .from('tax_rates')
        .update({ is_default: false })
        .eq('user_id', req.user.userId);
    }

    const { data, error } = await supabaseAdmin
      .from('tax_rates')
      .insert({
        user_id: req.user.userId,
        name: sanitizedName,
        rate: numericRate,
        is_default: makeDefault || existing.length === 0,
      })
      .select('id, name, rate, is_default, created_at')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Create tax rate error:', err);
    res.status(500).json({ error: 'Failed to create tax rate' });
  }
});

// PUT /api/settings/tax-rates/:id
router.put('/tax-rates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, rate, isDefault } = req.body;

    const { data: existing, error: findError } = await supabaseAdmin
      .from('tax_rates')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: 'Tax rate not found' });
    }

    const updateData = {};
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: 'Tax rate name is required' });
      }
      updateData.name = name.trim();
    }
    if (rate !== undefined) {
      const numericRate = Number(rate);
      if (isNaN(numericRate) || numericRate < 0) {
        return res.status(400).json({ error: 'A valid tax rate percentage is required' });
      }
      updateData.rate = Math.round(numericRate * 100) / 100;
    }
    if (isDefault !== undefined) {
      updateData.is_default = Boolean(isDefault);
    }

    // Enforce single default: clear others if setting this one as default
    if (updateData.is_default) {
      await supabaseAdmin
        .from('tax_rates')
        .update({ is_default: false })
        .eq('user_id', req.user.userId)
        .neq('id', id);
    }

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('tax_rates')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .select('id, name, rate, is_default, created_at')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Update tax rate error:', err);
    res.status(500).json({ error: 'Failed to update tax rate' });
  }
});

// DELETE /api/settings/tax-rates/:id
router.delete('/tax-rates/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: findError } = await supabaseAdmin
      .from('tax_rates')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: 'Tax rate not found' });
    }

    const { error } = await supabaseAdmin
      .from('tax_rates')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.userId);

    if (error) throw error;
    res.json({ message: 'Tax rate deleted successfully' });
  } catch (err) {
    console.error('Delete tax rate error:', err);
    res.status(500).json({ error: 'Failed to delete tax rate' });
  }
});

export default router;
