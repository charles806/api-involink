-- Migration: Add business profile fields + tax_rates table
-- Run this in your Supabase SQL Editor

-- Add missing business profile columns to users (IF NOT EXISTS to be idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Tax rates table
CREATE TABLE IF NOT EXISTS tax_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_tax_rates_user_id ON tax_rates(user_id);

-- RLS
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tax rates" ON tax_rates FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own tax rates" ON tax_rates FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own tax rates" ON tax_rates FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own tax rates" ON tax_rates FOR DELETE USING (user_id = auth.uid());