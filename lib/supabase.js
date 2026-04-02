// Supabase client — single source of truth for all agents.
// Uses service role key (bypasses RLS) for server-side agent calls.
// Dashboard frontend uses anon key separately.

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

module.exports = { supabase };
