#!/usr/bin/env node
// Manual test harness for docs/dashboard-scoring-fix-spec.md.
// Inserts synthetic conditions, lets you screenshot the dashboard against
// each, and cleans up. Synthetic rows are tagged so cleanup is bulletproof.
//
// Usage:
//   node scripts/test-dashboard-scoring.js setup <test#>
//   node scripts/test-dashboard-scoring.js cleanup <test#>
//   node scripts/test-dashboard-scoring.js cleanup-all
//   node scripts/test-dashboard-scoring.js list
//
// Tests are numbered per the spec's manual test plan table:
//   1  baseline / weekly cron not yet due
//   2  daily cron missed by 26h
//   3  cron fired with errors
//   4  audio gate not exercised (baseline)
//   4b audio: single LUFS error → amber
//   4c audio: two LUFS errors → red
//   5  webhook failure
//   6  idle integration (baseline)
//   7  stuck videos
//   8  empty state ALL CLEAR
//
// Tests 1, 4, 6, 8 are "baseline" scenarios — they don't need synthetic
// data; you screenshot the natural Austin state. The script's setup for
// those is a no-op. Test 8 also runs a `cleanup-all` first to ensure no
// other synthetic markers are present.

require('dotenv').config();
const { supabase } = require('../lib/supabase');

const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const TAG = '[SYNTH-DASH-FIX]'; // prefix on every synthetic row's user-visible field

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

// --- inserts ---------------------------------------------------------------

async function insertAgentLog({ agent_name, action, status, error_message, created_at }) {
  const { error } = await supabase.from('agent_logs').insert({
    campus_id: AUSTIN_CAMPUS_ID,
    agent_name,
    action: `${TAG} ${action}`,
    status,
    error_message: error_message || null,
    created_at,
  });
  if (error) throw error;
}

async function insertWebhookInbox({ event_type, failed_at, error_message }) {
  const { error } = await supabase.from('webhook_inbox').insert({
    event_type: `${TAG.toLowerCase()} ${event_type}`,
    payload: { synthetic: true, tag: TAG },
    received_at: failed_at,
    failed_at,
    error_message,
    retry_count: 1,
  });
  if (error) throw error;
}

async function insertVideo({ status, title, updated_at, qa_passed = null, assignee_id = null }) {
  const { error } = await supabase.from('videos').insert({
    campus_id: AUSTIN_CAMPUS_ID,
    title: `${TAG} ${title}`,
    status,
    updated_at,
    qa_passed,
    assignee_id,
  });
  if (error) throw error;
}

// --- cleanups --------------------------------------------------------------

async function deleteTaggedAgentLogs() {
  const { error, count } = await supabase
    .from('agent_logs')
    .delete({ count: 'exact' })
    .like('action', `${TAG}%`);
  if (error) throw error;
  return count || 0;
}

async function deleteTaggedWebhookInbox() {
  const { error, count } = await supabase
    .from('webhook_inbox')
    .delete({ count: 'exact' })
    .like('event_type', `${TAG.toLowerCase()}%`);
  if (error) throw error;
  return count || 0;
}

async function deleteTaggedVideos() {
  const { error, count } = await supabase
    .from('videos')
    .delete({ count: 'exact' })
    .like('title', `${TAG}%`);
  if (error) throw error;
  return count || 0;
}

async function cleanupAll() {
  const logs = await deleteTaggedAgentLogs();
  const inbox = await deleteTaggedWebhookInbox();
  const videos = await deleteTaggedVideos();
  return { logs, inbox, videos };
}

// --- list ------------------------------------------------------------------

async function list() {
  const { data: logs } = await supabase
    .from('agent_logs')
    .select('id, agent_name, action, status, created_at')
    .like('action', `${TAG}%`)
    .order('created_at', { ascending: false });
  const { data: inbox } = await supabase
    .from('webhook_inbox')
    .select('id, event_type, failed_at, received_at')
    .like('event_type', `${TAG.toLowerCase()}%`)
    .order('received_at', { ascending: false });
  const { data: videos } = await supabase
    .from('videos')
    .select('id, status, title, updated_at, qa_passed')
    .like('title', `${TAG}%`)
    .order('updated_at', { ascending: false });
  console.log(`Synthetic agent_logs: ${(logs || []).length}`);
  for (const r of logs || []) console.log(`  ${r.created_at}  ${r.agent_name}  [${r.status}] ${r.action}`);
  console.log(`Synthetic webhook_inbox: ${(inbox || []).length}`);
  for (const r of inbox || []) console.log(`  ${r.received_at}  failed=${r.failed_at}  ${r.event_type}`);
  console.log(`Synthetic videos: ${(videos || []).length}`);
  for (const r of videos || []) console.log(`  ${r.updated_at}  ${r.status}  ${r.title}`);
}

// --- per-test setup --------------------------------------------------------

const TESTS = {
  // 1. Baseline: weekly cron not yet due. No synthetic data needed — the
  //    real Austin state already has performance never-due since Apr 29.
  '1': {
    desc: 'weekly cron not yet due → green',
    setup: async () => {
      // No-op. Verify against real Austin data.
    },
    cleanup: async () => {},
  },

  // 2. research log 50h ago, all newer activity removed. Insert one log
  //    50h old with action='cron_run_complete' (the agent's normal action).
  //    To simulate "no newer log," we don't insert anything newer; the
  //    real Austin data may or may not have newer research logs. To make
  //    this test deterministic, the script inserts a log 50h old AND
  //    flags the test description: the result depends on whether real
  //    Austin has any research log within ~28h. If real data has a recent
  //    research log, the spec rule says green (last >= prev). To force red,
  //    the synthetic log must be the most recent. Spec phrases this as
  //    "current time 09:00", so we trust there's no real recent research log.
  '2': {
    desc: 'research log 50h ago → cron red, action item',
    setup: async () => {
      await insertAgentLog({
        agent_name: 'research',
        action: 'cron_run_complete',
        status: 'success',
        created_at: isoAgo(50 * HOUR_MS),
      });
    },
    cleanup: deleteTaggedAgentLogs,
  },

  // 3. Ten fireflies error logs in last 24h. The most recent one becomes
  //    last_fireflies_run (any status, no filter), so the cron rule says
  //    green. The errors_last_hour bumps if any are within the last hour.
  '3': {
    desc: '10 fireflies error logs in 24h → cron green, error-spike action item',
    setup: async () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        await insertAgentLog({
          agent_name: 'fireflies',
          action: `cron_run_failed (synthetic ${i + 1}/10)`,
          status: 'error',
          error_message: 'synthetic test error',
          created_at: new Date(now - i * 5 * 60 * 1000).toISOString(), // every 5 min back
        });
      }
    },
    cleanup: deleteTaggedAgentLogs,
  },

  // 4. Audio gate not exercised — default. No EDITED videos, no LUFS logs.
  '4': {
    desc: 'audio gate not exercised → green',
    setup: async () => {
      // No-op.
    },
    cleanup: async () => {},
  },

  // 4b. One EDITED video, one LUFS error. Audio amber.
  '4b': {
    desc: 'audio: 1 LUFS error → amber',
    setup: async () => {
      await insertVideo({
        status: 'EDITED',
        title: 'Audio amber test',
        updated_at: isoAgo(2 * HOUR_MS),
      });
      await insertAgentLog({
        agent_name: 'qa',
        action: 'lufs_failed (synthetic)',
        status: 'error',
        error_message: 'LUFS -17.2',
        created_at: isoAgo(2 * HOUR_MS),
      });
    },
    cleanup: async () => {
      await deleteTaggedAgentLogs();
      await deleteTaggedVideos();
    },
  },

  // 4c. One EDITED video, two LUFS errors. Audio red.
  '4c': {
    desc: 'audio: 2 LUFS errors → red',
    setup: async () => {
      await insertVideo({
        status: 'EDITED',
        title: 'Audio red test',
        updated_at: isoAgo(2 * HOUR_MS),
      });
      await insertAgentLog({
        agent_name: 'qa',
        action: 'lufs_failed (synthetic 1)',
        status: 'error',
        error_message: 'LUFS -17.2',
        created_at: isoAgo(3 * HOUR_MS),
      });
      await insertAgentLog({
        agent_name: 'qa',
        action: 'lufs_failed (synthetic 2)',
        status: 'error',
        error_message: 'LUFS -19.0',
        created_at: isoAgo(2 * HOUR_MS),
      });
    },
    cleanup: async () => {
      await deleteTaggedAgentLogs();
      await deleteTaggedVideos();
    },
  },

  // 5. Webhook failure 30 min ago.
  '5': {
    desc: 'webhook failure 30m ago → webhook red, action item',
    setup: async () => {
      await insertWebhookInbox({
        event_type: 'taskStatusUpdated',
        failed_at: isoAgo(30 * 60 * 1000),
        error_message: 'synthetic 502 Bad Gateway',
      });
    },
    cleanup: deleteTaggedWebhookInbox,
  },

  // 6. Idle integrations — default. No setup.
  '6': {
    desc: 'idle integrations → neutral rows',
    setup: async () => {},
    cleanup: async () => {},
  },

  // 7. Three stuck videos (in IDEA, threshold 7d). Insert with updated_at
  //    8 days ago.
  '7': {
    desc: '3 stuck videos in IDEA → action item',
    setup: async () => {
      for (let i = 0; i < 3; i++) {
        await insertVideo({
          status: 'IDEA',
          title: `Stuck idea ${i + 1}`,
          updated_at: isoAgo(8 * DAY_MS),
        });
      }
    },
    cleanup: deleteTaggedVideos,
  },

  // 8. Empty state. Cleanup-all to ensure no other synthetic data.
  '8': {
    desc: 'empty state → ALL CLEAR / ALL GREEN',
    setup: async () => {
      const result = await cleanupAll();
      console.log('  cleared synthetic data first:', result);
    },
    cleanup: async () => {},
  },
};

// --- main ------------------------------------------------------------------

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd) {
    console.log('Usage:');
    console.log('  setup <test#>   apply synthetic input for a test');
    console.log('  cleanup <test#> remove synthetic input for a test');
    console.log('  cleanup-all     remove all synthetic data');
    console.log('  list            show currently inserted synthetic rows');
    process.exit(2);
  }

  if (cmd === 'list') {
    await list();
    return;
  }
  if (cmd === 'cleanup-all') {
    const r = await cleanupAll();
    console.log('cleaned:', r);
    return;
  }
  if (!arg || !TESTS[arg]) {
    console.error(`unknown test: ${arg}. valid: ${Object.keys(TESTS).join(', ')}`);
    process.exit(2);
  }
  const t = TESTS[arg];
  if (cmd === 'setup') {
    console.log(`setup test ${arg}: ${t.desc}`);
    await t.setup();
    console.log('done.');
  } else if (cmd === 'cleanup') {
    console.log(`cleanup test ${arg}`);
    const r = await t.cleanup();
    console.log('done', r);
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('failed:', err);
  process.exit(1);
});
