-- Migration: Add withdrawals table + paystack_recipient_code to users
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT,
  bank_code TEXT,
  status TEXT DEFAULT 'pending',
  reference TEXT UNIQUE NOT NULL,
  paystack_recipient_code TEXT,
  transfer_code TEXT,
  failure_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_reference ON withdrawals(reference);

-- RLS
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own withdrawals" ON withdrawals FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own withdrawals" ON withdrawals FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own withdrawals" ON withdrawals FOR UPDATE USING (user_id = auth.uid());

-- Cache the Paystack transfer recipient code on the user
ALTER TABLE users ADD COLUMN IF NOT EXISTS paystack_recipient_code TEXT;
