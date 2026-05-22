const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../lib/supabase');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

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

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // 1. Check if user exists
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, password_hash, name')
      .eq('email', trimmedEmail)
      .single();

    if (error || !user) {
      // Return 200 to prevent email enumeration attacks
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    // 2. Generate a stateless reset token
    // We embed the first 10 chars of the current password hash. 
    // If password changes, token becomes invalid.
    const hashPrefix = user.password_hash.substring(0, 10);
    const token = jwt.sign(
      { userId: user.id, hashPrefix },
      process.env.JWT_SECRET,
      { expiresIn: '1h' } // Token expires in 1 hour
    );

    // 3. Construct reset link
    const frontendUrl = process.env.FRONTEND_URL 
      ? process.env.FRONTEND_URL.split(',')[0].trim() 
      : 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    // 4. Send Email via Nodemailer (Google SMTP)
    await transporter.sendMail({
      from: `"Involink" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: 'Reset your Involink password',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #10b981;">Involink Password Reset</h2>
          <p>Hi ${user.name},</p>
          <p>We received a request to reset your password. Click the button below to choose a new password:</p>
          <div style="margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          <p>If you didn't request a password reset, you can safely ignore this email.</p>
          <p style="color: #6b7280; font-size: 14px; margin-top: 40px;">This link will expire in 1 hour.</p>
        </div>
      `
    });

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process forgot password request' });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // 1. Verify Token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    // 2. Fetch User
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, password_hash')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 3. Verify Hash Prefix (ensure token is single-use)
    const currentHashPrefix = user.password_hash.substring(0, 10);
    if (decoded.hashPrefix !== currentHashPrefix) {
      return res.status(400).json({ error: 'This reset link has already been used' });
    }

    // 4. Hash New Password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // 5. Update User in DB
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ 
        password_hash: hashedPassword,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) throw updateError;

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;