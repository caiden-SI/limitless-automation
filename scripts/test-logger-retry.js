#!/usr/bin/env node
/**
 * Unit test — lib/logger.js retry-with-backoff.
 *
 * Simulates the boot-time symptom from post-cutover-cleanup.md Fix 1: the
 * first Supabase insert fails with a fetch error, the second succeeds. The
 * logger must retry transparently and the row must eventually land.
 *
 * No external services. Stubs the supabase module before the logger requires
 * it. Also short-circuits the retry sleep so the test runs in <1s.
 *
 * Run:
 *   node scripts/test-logger-retry.js
 */

// .env is needed because lib/supabase.js validates SUPABASE_URL on require.
// The actual client is replaced with a stub immediately below.
require('dotenv').config();

const supabaseModule = require('../lib/supabase');

// Capture the inserts the logger attempts. Each call returns the next entry
// from `responses` — supports simulating a transient failure followed by success.
let insertCalls = 0;
const responses = [];

supabaseModule.supabase = {
  from(table) {
    if (table !== 'agent_logs') {
      throw new Error(`unexpected table: ${table}`);
    }
    return {
      async insert(_row) {
        const idx = insertCalls;
        insertCalls += 1;
        const next = responses[idx];
        if (!next) {
          throw new Error(`no stub response queued for insert call #${idx + 1}`);
        }
        if (next.throw) throw next.throw;
        return { error: next.error || null };
      },
    };
  },
};

// Require the logger AFTER stubbing — but it reads supabaseModule.supabase
// per-call now, so order is not strict. Patch RETRY_DELAYS_MS to zero so
// tests don't sleep.
const logger = require('../lib/logger');
for (let i = 0; i < logger.RETRY_DELAYS_MS.length; i++) logger.RETRY_DELAYS_MS[i] = 0;

let failed = false;
function pass(msg) { console.log(`[PASS] ${msg}`); }
function fail(msg) { console.error(`[FAIL] ${msg}`); failed = true; }

async function reset() {
  insertCalls = 0;
  responses.length = 0;
}

// Capture console.error so we can assert on the final-fallback message.
const originalConsoleError = console.error;
let capturedErrors = [];
console.error = (...args) => { capturedErrors.push(args.join(' ')); };

async function run() {
  // ── Case 1: first call fails with a fetch error, second succeeds ──
  await reset();
  capturedErrors = [];
  responses.push({ throw: new TypeError('fetch failed') });
  responses.push({ error: null });

  await logger.log({ agent: 'test', action: 'retry_first_attempt' });

  if (insertCalls !== 2) fail(`expected 2 insert attempts, got ${insertCalls}`);
  else pass('retried after transient fetch failure on first attempt');

  const fallbackLogged = capturedErrors.some((e) => e.includes('Failed to write to agent_logs after'));
  if (fallbackLogged) fail('logged the final-fallback message even though retry succeeded');
  else pass('no final-fallback message logged on eventual success');

  // ── Case 2: first two calls fail, third succeeds ──
  await reset();
  capturedErrors = [];
  responses.push({ throw: new TypeError('fetch failed') });
  responses.push({ error: { message: 'connection reset' } });
  responses.push({ error: null });

  await logger.log({ agent: 'test', action: 'retry_third_attempt' });

  if (insertCalls !== 3) fail(`expected 3 insert attempts, got ${insertCalls}`);
  else pass('retried twice and succeeded on third attempt');

  // ── Case 3: all three attempts fail → fall back to console only, never throw ──
  await reset();
  capturedErrors = [];
  responses.push({ throw: new TypeError('fetch failed') });
  responses.push({ throw: new TypeError('fetch failed') });
  responses.push({ error: { message: 'still down' } });

  let threw = null;
  try {
    await logger.log({ agent: 'test', action: 'all_attempts_fail' });
  } catch (err) {
    threw = err;
  }

  if (threw) fail(`logger threw to caller: ${threw.message}`);
  else pass('logger does not throw when all attempts fail');

  if (insertCalls !== 3) fail(`expected 3 insert attempts on full failure, got ${insertCalls}`);
  else pass('attempted exactly 3 times before giving up');

  const fellBack = capturedErrors.some((e) => e.includes('Failed to write to agent_logs after 3 attempts'));
  if (!fellBack) fail('expected console.error fallback message on full failure');
  else pass('logged console fallback message on full failure');

  // ── Case 4: happy path — first call succeeds, no retry, no console error ──
  await reset();
  capturedErrors = [];
  responses.push({ error: null });

  await logger.log({ agent: 'test', action: 'happy_path' });

  if (insertCalls !== 1) fail(`expected 1 insert attempt on happy path, got ${insertCalls}`);
  else pass('no retry on happy path');

  const noisy = capturedErrors.some((e) => e.includes('Failed to write to agent_logs'));
  if (noisy) fail('logged a fallback message on a successful first attempt');
  else pass('no fallback message on happy path');
}

run()
  .then(() => {
    console.error = originalConsoleError;
    if (failed) {
      console.log('\nSome assertions failed.');
      process.exit(1);
    }
    console.log('\nAll assertions passed.');
  })
  .catch((err) => {
    console.error = originalConsoleError;
    console.error('Unexpected test error:', err);
    process.exit(1);
  });
