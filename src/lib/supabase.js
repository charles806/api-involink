const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false }
});
const supabaseAdmin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

module.exports = { supabase, supabaseAdmin };