-- Migration: Add discount, unit, and issue_date to invoice tables
-- Run this in your Supabase SQL Editor

-- Add columns to invoice_items
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount NUMERIC(5, 2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'pcs';

-- Add columns to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issue_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'NGN';