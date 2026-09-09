-- Migration: Add bank details to clients table for cached payment details
-- Run this in your Supabase SQL Editor

ALTER TABLE clients ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_name TEXT;