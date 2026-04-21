#!/usr/bin/env node
/**
 * Integration test — Self-Healing Error Handler.
 *
 * Six cases per workflows/self-healing-handler.md:
 *   1. transient → retry succeeds on second attempt
 *   2. auth → refresh_dropbox_token called
 *   3. data → skip_record or mark_waiting picked
 *   4. unknown → straight to alert (no recovery attempted)
 *   5. dedup window → second failure within 5 min skips Claude call
 *   6. Claude API failure → graceful fallback, no unhandled throw
 *
 * Uses real Supabase + real Claude + real ClickUp (stubbed in --dry-run).
 * Run:
 *   node scripts/test-self-heal.js          # live (writes real ClickUp comments)
 *   node scripts/test-self-heal.js --dry-run  # stubs clickup.addComment
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const selfHeal = require('../lib/self-heal');
const claude = require('../lib/claude');
const clickup = require('../lib/clickup');
const dropbox = require('../lib/dropbox');

const CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const DRY_RUN = process.argv.includes('--dry-run');
const TEST_PREFIX = '__self_heal_test_' + Date.now();

let testVideoId = null;
let testTaskId = null;

const capturedComments = [];
const originalAddComment = clickup.addComment;
const originalRefresh = dropbox.refreshAccessToken;
const originalAskJson = claude.askJson;

// ── Helpers ────────────────────────────────────────

function log(msg) { console.log(`[test] ${msg}`); }
function fail(msg) { console.error(`[FAIL] ${msg}`); process.exit(1); }
function pass(msg) { console.log(`[PASS] ${msg}`); }

async function waitForLog({ agent, action, payloadContains, sinceMs }) {
  const since = new Date(Date.now() - sinceMs).toISOString();
  for (let i = 0; i < 10; i++) {
    const { data } = await supabase
      .from('agent_logs')
      .select('id, action, payload, created_at, status, error_message')
      .eq('agent_name', agent)
      .eq('action', action)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5);
    if (data && data.length) {
      if (!payloadContains) return data[0];
      const match = data.find((r) => {
        const p = r.payload || {};
        return Object.entries(payloadContains).every(([k, v]) => JSON.stringify(p[k] ?? p) === JSON.stringify(v) || p[k] === v);
      });
      if (match) return match;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// ── Fixtures ────────────────────────────────────────

async function setup() {
  // Alert target: a task id passed as context.taskId in cases 4 and 6.
  // In dry-run, clickup.addComment is stubbed so the task id is never
  // actually hit. In live mode we reuse an existing Austin task so the
  // comment posts to something real.
  testTaskId = `fake_${TEST_PREFIX}`;
  if (!DRY_RUN) {
    try {
      const listId = process.env.CLICKUP_AUSTIN_LIST_ID;
      if (listId) {
        const tasks = await clickup.getTasks(listId);
        if (tasks && tasks.tasks && tasks.tasks.length) {
          testTaskId = tasks.tasks[0].id;
          log(`using live ClickUp task for alert target: ${testTaskId}`);
        }
      }
    } catch (err) {
      log(`could not fetch a live ClickUp task (${err.message}); alert case will log skipped`);
    }
  }

  // Test video has NO clickup_task_id to avoid any unique-constraint collision.
  // Case 3 (mark_waiting with videoId) therefore triggers the alert_skipped
  // path after a failed mark_waiting — which is the contract we want to verify.
  const { data, error } = await supabase
    .from('videos')
    .insert({
      campus_id: CAMPUS_ID,
      title: TEST_PREFIX,
      status: 'IDEA',
    })
    .select('id')
    .single();

  if (error) throw new Error(`setup failed: ${error.message}`);
  testVideoId = data.id;
  log(`seeded test video: ${testVideoId} (no clickup_task_id)`);
}

async function teardown() {
  if (testVideoId) {
    await supabase.from('videos').delete().eq('id', testVideoId);
  }
  // Best-effort cleanup of our test log entries
  const { data: rows } = await supabase
    .from('agent_logs')
    .select('id')
    .or(`action.like.${TEST_PREFIX}%,agent_name.eq.self_heal_test`)
    .limit(500);
  if (rows && rows.length) {
    await supabase.from('agent_logs').delete().in('id', rows.map((r) => r.id));
  }
  clickup.addComment = originalAddComment;
  dropbox.refreshAccessToken = originalRefresh;
  claude.askJson = originalAskJson;
}

// ── Stubs ────────────────────────────────────────

function stubClickupComment() {
  clickup.addComment = async (taskId, text) => {
    capturedComments.push({ taskId, text });
    if (DRY_RUN) return { id: 'dry-run-comment' };
    return originalAddComment(taskId, text);
  };
}

// ── Cases ────────────────────────────────────────

async function case1_transientRetry() {
  log('CASE 1: transient → retry → succeeds on attempt 2');
  let attempts = 0;
  const fn = async () => {
    attempts++;
    if (attempts === 1) throw new Error('503 Service Unavailable (simulated transient)');
    return { ok: true };
  };

  // Force Claude to return retry/high so we don't rely on model judgment
  claude.askJson = async () => ({
    classification: 'transient',
    confidence: 'high',
    recovery_action: 'retry',
    recovery_params: {},
    human_summary: 'Simulated 503',
  });

  const action = `${TEST_PREFIX}_case1`;
  try {
    await fn();
  } catch (err) {
    await selfHeal.handle(err, { agent: 'self_heal_test', action }, { retry: fn });
  }

  claude.askJson = originalAskJson;

  if (attempts !== 2) fail(`expected 2 attempts, got ${attempts}`);
  const attemptLog = await waitForLog({ agent: 'self_heal_test', action: 'self_heal_attempted', sinceMs: 60000 });
  if (!attemptLog || attemptLog.payload?.succeeded !== true) fail(`expected succeeded=true self_heal_attempted log; got ${JSON.stringify(attemptLog)}`);
  pass('CASE 1: retry recovered');
}

async function case2_authRefresh() {
  log('CASE 2: auth → refresh_dropbox_token called');
  let refreshCalled = 0;
  dropbox.refreshAccessToken = async () => { refreshCalled++; return 'new-token'; };

  claude.askJson = async () => ({
    classification: 'auth',
    confidence: 'high',
    recovery_action: 'refresh_dropbox_token',
    recovery_params: {},
    human_summary: 'Dropbox token expired',
  });

  const action = `${TEST_PREFIX}_case2`;
  let retries = 0;
  const fn = async () => { retries++; return { ok: true }; };

  await selfHeal.handle(new Error('expired_access_token/'), { agent: 'self_heal_test', action }, { retry: fn });

  claude.askJson = originalAskJson;
  dropbox.refreshAccessToken = originalRefresh;

  if (refreshCalled !== 1) fail(`expected 1 refresh call, got ${refreshCalled}`);
  if (retries !== 1) fail(`expected retry after refresh, got ${retries}`);
  pass('CASE 2: token refresh + retry executed');
}

async function case3_dataMarkWaiting() {
  log('CASE 3: data → mark_waiting is selected and attempted');
  claude.askJson = async () => ({
    classification: 'data',
    confidence: 'high',
    recovery_action: 'mark_waiting',
    recovery_params: {},
    human_summary: 'Malformed video; needs human review',
  });

  const action = `${TEST_PREFIX}_case3`;

  // Stub clickup.updateTask so mark_waiting doesn't hit a real task when task is fake
  const origUpdate = clickup.updateTask;
  clickup.updateTask = async () => ({ ok: true });

  await selfHeal.handle(new Error('title is required'), {
    agent: 'self_heal_test',
    action,
    videoId: testVideoId,
    campusId: CAMPUS_ID,
  });

  clickup.updateTask = origUpdate;
  claude.askJson = originalAskJson;

  // Primary assertion: handler logged self_heal_attempted for mark_waiting.
  const attemptLog = await waitForLog({ agent: 'self_heal_test', action: 'self_heal_attempted', sinceMs: 10000 });
  if (!attemptLog || attemptLog.payload?.recoveryAction !== 'mark_waiting') {
    fail(`expected self_heal_attempted with recoveryAction=mark_waiting; got ${JSON.stringify(attemptLog?.payload)}`);
  }

  // Secondary assertion: if the DB write succeeded, status should be WAITING.
  // If it failed (stale videos_status_check constraint), the handler must have
  // escalated to an alert instead.
  const { data: video } = await supabase.from('videos').select('status').eq('id', testVideoId).single();
  if (attemptLog.payload?.succeeded === true) {
    if (video.status !== 'WAITING') fail(`expected status WAITING on successful mark_waiting, got ${video.status}`);
    pass('CASE 3: video marked WAITING');
  } else {
    const escalated = await waitForLog({ agent: 'self_heal_test', action: 'self_heal_alert_sent', sinceMs: 15000 })
      || await waitForLog({ agent: 'self_heal_test', action: 'self_heal_alert_skipped', sinceMs: 15000 });
    if (!escalated) fail('mark_waiting failed but no alert was escalated');
    log(`  NOTE: mark_waiting update failed (likely videos_status_check constraint stale — see migration 2026-04-20-videos-status-check.sql). Handler correctly escalated.`);
    pass('CASE 3: mark_waiting attempted and escalated after DB rejection');
  }

  // Reset for remaining tests — only if we successfully flipped it
  if (video.status === 'WAITING') {
    await supabase.from('videos').update({ status: 'IDEA' }).eq('id', testVideoId);
  }
}

async function case4_unknownAlert() {
  log('CASE 4: unknown / low confidence → straight to alert');
  claude.askJson = async () => ({
    classification: 'unknown',
    confidence: 'low',
    recovery_action: 'none',
    recovery_params: {},
    human_summary: 'No recognizable pattern',
  });

  capturedComments.length = 0;
  const action = `${TEST_PREFIX}_case4`;

  await selfHeal.handle(new Error('xqjr: synthetic chaos'), {
    agent: 'self_heal_test',
    action,
    taskId: testTaskId,
    campusId: CAMPUS_ID,
  });

  claude.askJson = originalAskJson;

  // Must not log self_heal_attempted — low confidence skips recovery
  const attemptLog = await waitForLog({ agent: 'self_heal_test', action: 'self_heal_attempted', sinceMs: 5000 });
  if (attemptLog && (attemptLog.payload?.originalAction === action)) {
    fail('unexpected self_heal_attempted log for low-confidence unknown case');
  }

  // Must log alert sent (or skipped if no taskId)
  const alertSent = await waitForLog({ agent: 'self_heal_test', action: 'self_heal_alert_sent', sinceMs: 10000 });
  const alertSkipped = await waitForLog({ agent: 'self_heal_test', action: 'self_heal_alert_skipped', sinceMs: 10000 });
  if (!alertSent && !alertSkipped) fail('expected alert_sent or alert_skipped log');
  pass('CASE 4: unknown went straight to alert without recovery');
}

async function case5_dedupWindow() {
  log('CASE 5: second failure within 5 min skips Claude call');
  const action = `${TEST_PREFIX}_case5`;

  claude.askJson = async () => ({
    classification: 'transient',
    confidence: 'high',
    recovery_action: 'retry',
    recovery_params: {},
    human_summary: 'First call',
  });

  let retries = 0;
  const fn = async () => { retries++; throw new Error('still failing'); };

  // First call — should attempt recovery
  await selfHeal.handle(new Error('first'), { agent: 'self_heal_test', action }, { retry: fn });

  // Second call — should hit dedup window and skip Claude
  let claudeCalls = 0;
  claude.askJson = async () => { claudeCalls++; return { classification: 'transient', confidence: 'high', recovery_action: 'none', recovery_params: {}, human_summary: 'x' }; };

  await selfHeal.handle(new Error('second'), { agent: 'self_heal_test', action }, { retry: fn });

  claude.askJson = originalAskJson;

  if (claudeCalls !== 0) fail(`expected 0 Claude calls on second firing, got ${claudeCalls}`);
  const windowHit = await waitForLog({ agent: 'self_heal_test', action: 'self_heal_window_hit', sinceMs: 15000 });
  if (!windowHit) fail('expected self_heal_window_hit log on second firing');
  pass('CASE 5: dedup window prevented second Claude call');
}

async function case6_claudeDown() {
  log('CASE 6: Claude askJson throws → graceful fallback');
  claude.askJson = async () => { throw new Error('simulated Anthropic outage'); };

  const action = `${TEST_PREFIX}_case6`;
  let threw = false;
  try {
    await selfHeal.handle(new Error('downstream failure'), {
      agent: 'self_heal_test',
      action,
      taskId: testTaskId,
      campusId: CAMPUS_ID,
    });
  } catch (_err) {
    threw = true;
  }

  claude.askJson = originalAskJson;

  if (threw) fail('handle() must not throw when Claude is down');
  const claudeErr = await waitForLog({ agent: 'self_heal_test', action: 'self_heal_claude_error', sinceMs: 10000 });
  if (!claudeErr) fail('expected self_heal_claude_error log');
  pass('CASE 6: Claude outage did not escape handler');
}

// ── Main ────────────────────────────────────────

(async () => {
  if (DRY_RUN) log('DRY RUN — clickup.addComment is stubbed');
  stubClickupComment();

  await setup();

  try {
    await case1_transientRetry();
    await case2_authRefresh();
    await case3_dataMarkWaiting();
    await case4_unknownAlert();
    await case5_dedupWindow();
    await case6_claudeDown();

    log('');
    log(`captured ${capturedComments.length} comment(s) during run`);
    log('all cases passed');
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await teardown();
    log('teardown complete');
  }
})();
