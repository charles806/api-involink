const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

// Validation helpers
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (!validateEmail(trimmedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', trimmedEmail)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const { data: newUser, error } = await supabaseAdmin
      .from('users')
      .insert({
        email: trimmedEmail,
        password_hash: hashedPassword,
        name: name.trim(),
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        business_name: newUser.business_name || null,
      },
      token
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (!validateEmail(trimmedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', trimmedEmail)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        business_name: user.business_name || null,
      },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, name, business_name, bank_name, account_number, account_name, logo_url')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(403).json({ error: 'Invalid token' });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { business_name, bank_name, account_number, account_name, name } = req.body;

    const updateData = {};
    if (business_name !== undefined) updateData.business_name = business_name;
    if (bank_name !== undefined) updateData.bank_name = bank_name;
    if (account_number !== undefined) updateData.account_number = account_number;
    if (account_name !== undefined) updateData.account_name = account_name;
    if (name !== undefined) updateData.name = name;
    updateData.updated_at = new Date().toISOString();

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', decoded.userId)
      .select('id, email, name, business_name, bank_name, account_number, account_name, logo_url')
      .single();

    if (error) throw error;

    res.json({ user });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;