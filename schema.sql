-- Involink Database Schema for Supabase

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  business_name TEXT,
  logo_url TEXT,
  bank_name TEXT,
  account_number TEXT,
  account_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL NOT NULL,
  invoice_number TEXT NOT NULL,
  subtotal NUMERIC(12, 2) DEFAULT 0,
  vat NUMERIC(12, 2) DEFAULT 0,
  total NUMERIC(12, 2) DEFAULT 0,
  vat_enabled BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'draft',
  due_date DATE,
  notes TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Invoice items table
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(10, 2) DEFAULT 1,
  rate NUMERIC(12, 2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- Row Level Security (RLS) Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

-- Users: Users can only access their own data
CREATE POLICY "Users can view own data" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own data" ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own data" ON users FOR INSERT WITH CHECK (auth.uid() = id);

-- Clients: Users can only access their own clients
CREATE POLICY "Users can view own clients" ON clients FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own clients" ON clients FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own clients" ON clients FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own clients" ON clients FOR DELETE USING (user_id = auth.uid());

-- Invoices: Users can only access their own invoices
CREATE POLICY "Users can view own invoices" ON invoices FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own invoices" ON invoices FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own invoices" ON invoices FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own invoices" ON invoices FOR DELETE USING (user_id = auth.uid());

-- Invoice Items: Users can only access items for their invoices
CREATE POLICY "Users can view own invoice items" ON invoice_items FOR SELECT 
  USING (invoice_id IN (SELECT id FROM invoices WHERE user_id = auth.uid()));
CREATE POLICY "Users can insert own invoice items" ON invoice_items FOR INSERT 
  WITH CHECK (invoice_id IN (SELECT id FROM invoices WHERE user_id = auth.uid()));
CREATE POLICY "Users can update own invoice items" ON invoice_items FOR UPDATE 
  USING (invoice_id IN (SELECT id FROM invoices WHERE user_id = auth.uid()));
CREATE POLICY "Users can delete own invoice items" ON invoice_items FOR DELETE 
  USING (invoice_id IN (SELECT id FROM invoices WHERE user_id = auth.uid()));