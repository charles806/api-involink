process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT || '3999';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'service';
process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_placeholder';
process.env.PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET || 'whsec_placeholder';
process.env.SMTP_USER = process.env.SMTP_USER || 'test@example.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'pass';

import * as shim from './shim.cjs';
import { supabaseAdmin, supabase } from './helpers/supabaseMock.mjs';
import { nodemailerFake } from './helpers/nodemailerMock.mjs';

shim.installSupabaseMock({ supabaseAdmin, supabase });
shim.installNodemailerMock(nodemailerFake);