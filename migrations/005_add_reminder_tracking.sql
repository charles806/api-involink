-- Migration: Add reminder tracking to invoices
-- Run this in your Supabase SQL Editor

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMP WITH TIME ZONE;