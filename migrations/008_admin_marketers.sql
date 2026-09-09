-- Migration: Admin roles + marketer tracking
-- Run this in your Supabase SQL Editor

-- 1. Role on users ('user' or 'admin'). Defaults to 'user'.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- 2. Marketers table
CREATE TABLE IF NOT EXISTS marketers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_marketers_email ON marketers(email);

-- RLS
ALTER TABLE marketers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view marketers" ON marketers FOR SELECT USING (
  (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
);
CREATE POLICY "Admins can insert marketers" ON marketers FOR INSERT WITH CHECK (
  (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
);
CREATE POLICY "Admins can update marketers" ON marketers FOR UPDATE USING (
  (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
);
CREATE POLICY "Admins can delete marketers" ON marketers FOR DELETE USING (
  (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
);

-- 3. Marketer attribution on users (manual assignment)
-- Erase the attribution if the marketer is deleted.
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketer_id UUID REFERENCES marketers(id) ON DELETE SET NULL;

-- Index for marketer rollups
CREATE INDEX IF NOT EXISTS idx_users_marketer_id ON users(marketer_id);