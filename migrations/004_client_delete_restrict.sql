-- Migration: Prevent deleting clients that have invoices
-- Run this in your Supabase SQL Editor

-- Change the invoices.client_id foreign key to RESTRICT so a client
-- with invoices cannot be deleted (defense-in-depth behind the API check).
ALTER TABLE invoices
  DROP CONSTRAINT invoices_client_id_fkey;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_client_id_fkey
  FOREIGN KEY (client_id)
  REFERENCES clients(id)
  ON DELETE RESTRICT;