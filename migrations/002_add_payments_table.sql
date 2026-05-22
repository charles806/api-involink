-- Migration: Add payments table
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  reference TEXT UNIQUE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT DEFAULT 'NGN',
  status TEXT DEFAULT 'pending',
  channel TEXT,
  paystack_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference);

-- RLS
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payments" ON payments FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own payments" ON payments FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own payments" ON payments FOR UPDATE USING (user_id = auth.uid());
