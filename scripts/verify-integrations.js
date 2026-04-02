#!/usr/bin/env node
/**
 * Integration verification script — tests live API access for:
 * 1. Supabase (service role + anon key)
 * 2. Anthropic Claude API
 * 3. Dropbox API
 * 4. Frame.io API
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const results = [];

function log(service, status, detail) {
  const icon = status === 'PASS' ? '[PASS]' : '[FAIL]';
  console.log(`${icon} ${service} — ${detail}`);
  results.push({ service, status, detail });
}

// ── 1. Supabase ──────────────────────────────────────────────
async function verifySupabase() {
  console.log('\n── Supabase ──');

  // Service role key
  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    // Try listing tables via a simple query — even if no tables exist yet,
    // a successful response (empty array) proves the connection works.
    const { data, error } = await sb.from('campuses').select('*').limit(1);
    if (error) {
      // Table might not exist yet — that's fine if the error is "relation does not exist"
      if (error.message.includes('does not exist') || error.code === '42P01') {
        log('Supabase (service role)', 'PASS', `Connected — "campuses" table not yet created (expected). Error: ${error.message}`);
      } else {
        log('Supabase (service role)', 'FAIL', `Query error: ${error.message}`);
      }
    } else {
      log('Supabase (service role)', 'PASS', `Connected — "campuses" returned ${data.length} row(s)`);
    }
  } catch (e) {
    log('Supabase (service role)', 'FAIL', e.message);
  }

  // Anon key
  try {
    const sbAnon = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    const { data, error } = await sbAnon.from('campuses').select('*').limit(1);
    if (error) {
      if (error.message.includes('does not exist') || error.code === '42P01') {
        log('Supabase (anon key)', 'PASS', `Connected — "campuses" table not yet created (expected)`);
      } else {
        log('Supabase (anon key)', 'FAIL', `Query error: ${error.message}`);
      }
    } else {
      log('Supabase (anon key)', 'PASS', `Connected — "campuses" returned ${data.length} row(s)`);
    }
  } catch (e) {
    log('Supabase (anon key)', 'FAIL', e.message);
  }
}

// ── 2. Anthropic ─────────────────────────────────────────────
async function verifyAnthropic() {
  console.log('\n── Anthropic ──');
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with exactly: CONNECTION_OK' }],
    });
    const text = msg.content[0]?.text || '';
    if (text.includes('CONNECTION_OK')) {
      log('Anthropic (claude-sonnet-4-20250514)', 'PASS', `API responded: "${text.trim()}"`);
    } else {
      log('Anthropic (claude-sonnet-4-20250514)', 'PASS', `API responded (unexpected text but connection works): "${text.trim().slice(0, 80)}"`);
    }
  } catch (e) {
    log('Anthropic', 'FAIL', e.message?.slice(0, 200));
  }
}

// ── 3. Dropbox ───────────────────────────────────────────────
async function verifyDropbox() {
  console.log('\n── Dropbox ──');
  try {
    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DROPBOX_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: '', recursive: false, limit: 5 }),
    });
    if (res.ok) {
      const data = await res.json();
      const names = data.entries.map(e => e.name).join(', ');
      log('Dropbox (list_folder)', 'PASS', `Root contains: ${names || '(empty)'}`);
    } else {
      const err = await res.json().catch(() => ({}));
      log('Dropbox (list_folder)', 'FAIL', `HTTP ${res.status}: ${err.error_summary || JSON.stringify(err).slice(0, 200)}`);
    }
  } catch (e) {
    log('Dropbox', 'FAIL', e.message);
  }
}

// ── 4. Frame.io ──────────────────────────────────────────────
async function verifyFrameio() {
  console.log('\n── Frame.io ──');
  try {
    // v2 endpoint — get current user (me) to verify token
    const res = await fetch('https://api.frame.io/v2/me', {
      headers: { 'Authorization': `Bearer ${process.env.FRAMEIO_API_TOKEN}` },
    });
    if (res.ok) {
      const data = await res.json();
      log('Frame.io (v2/me)', 'PASS', `Authenticated as: ${data.name || data.email || JSON.stringify(data).slice(0, 100)}`);
    } else {
      const err = await res.text();
      log('Frame.io (v2/me)', 'FAIL', `HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
  } catch (e) {
    log('Frame.io', 'FAIL', e.message);
  }

  // Also try v4 to check if the token works there
  try {
    const res = await fetch('https://api.frame.io/v4/accounts', {
      headers: { 'Authorization': `Bearer ${process.env.FRAMEIO_API_TOKEN}` },
    });
    if (res.ok) {
      const data = await res.json();
      const accounts = Array.isArray(data) ? data : (data.results || data.data || []);
      log('Frame.io (v4/accounts)', 'PASS', `v4 API accessible — ${accounts.length} account(s)`);
    } else {
      const err = await res.text();
      log('Frame.io (v4/accounts)', 'FAIL', `HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
  } catch (e) {
    log('Frame.io (v4)', 'FAIL', e.message);
  }
}

// ── Run all ──────────────────────────────────────────────────
async function main() {
  console.log('=== Integration Verification ===');
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  await verifySupabase();
  await verifyAnthropic();
  await verifyDropbox();
  await verifyFrameio();

  console.log('\n=== Summary ===');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`${passed} passed, ${failed} failed out of ${results.length} checks`);

  if (failed > 0) {
    console.log('\nFailed checks:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.service}: ${r.detail}`);
    });
  }
}

main().catch(console.error);
