// Integration test for the Fireflies Agent.
// Run: node scripts/test-fireflies-integration.js
//
// PREREQUISITES (at top so this is impossible to miss):
//   - FIREFLIES_API_KEY set in .env, against a Fireflies account with
//     recent meetings. Test widens the window to 30 days if 48h returns 0.
//   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set (lib/supabase.js
//     throws at import otherwise).
//   - ANTHROPIC_API_KEY set (lib/claude.js throws at import otherwise).
//   - CLICKUP_TEST_LIST_ID set in .env to the ID of a non-production
//     ClickUp list. WHEN MISSING, the ClickUp-write assertions skip with
//     a clear log line — Fireflies fetch, Supabase insert, and dedup
//     assertions still run. Create a test list in ClickUp and drop the
//     ID into .env before relying on the full pass.
//
// Spec: workflows/fireflies-integration.md §"Test requirements".

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const fireflies = require('../lib/fireflies');
const clickup = require('../lib/clickup');
const claude = require('../lib/claude');
const fireflyAgent = require('../agents/fireflies');

// Claude action-item extraction is non-deterministic. The dedup-on-rerun
// assertion in Test 3 only proves what we want it to prove if both runs
// see the same item list. Stub askJson to a fixed two-item response for
// the duration of the test so Test 3's "zero new tasks" assertion is
// actually verifying the ledger's UNIQUE(fireflies_id, action_item_hash)
// behavior rather than Claude's cooperation.
const realAskJson = claude.askJson;
const STUB_ITEMS = {
  action_items: [
    { text: 'Fireflies test stub item 1: send the outline by Friday' },
    { text: 'Fireflies test stub item 2: schedule the follow-up call' },
  ],
};
claude.askJson = async () => STUB_ITEMS;

const TEST_LIST_ID = process.env.CLICKUP_TEST_LIST_ID || null;
const CAMPUS_ID = fireflyAgent.CAMPUS_DOMAIN_MAP['limitlessyt.com'];

let pass = 0;
let fail = 0;
let skipped = 0;
const trackedClickUpTasks = new Set();
let preTestFirefliesIds = new Set();

function header(s) {
  console.log(`\n=== ${s} ===`);
}
function ok(s) {
  pass++;
  console.log(`  PASS  ${s}`);
}
function bad(s, err) {
  fail++;
  console.log(`  FAIL  ${s}${err ? `: ${err.message || err}` : ''}`);
}
function skip(s) {
  skipped++;
  console.log(`  SKIP  ${s}`);
}

/**
 * Patch the campus's ClickUp list ID to the test list so any tasks
 * the agent creates land in the test list, not the production Austin
 * list. Restored on teardown. When TEST_LIST_ID is null we skip both
 * the patch and any test that would write to ClickUp.
 */
let originalCampusListId = null;
async function pointCampusAtTestList() {
  if (!TEST_LIST_ID) return;
  const { data, error } = await supabase
    .from('campuses')
    .select('clickup_list_id')
    .eq('id', CAMPUS_ID)
    .maybeSingle();
  if (error || !data) throw new Error(`Cannot read campus ${CAMPUS_ID}: ${error?.message || 'not found'}`);
  originalCampusListId = data.clickup_list_id;
  const { error: updErr } = await supabase
    .from('campuses')
    .update({ clickup_list_id: TEST_LIST_ID })
    .eq('id', CAMPUS_ID);
  if (updErr) throw new Error(`Cannot repoint campus list ID: ${updErr.message}`);
}
async function restoreCampusListId() {
  if (originalCampusListId === null) return;
  await supabase
    .from('campuses')
    .update({ clickup_list_id: originalCampusListId })
    .eq('id', CAMPUS_ID);
}

// Wrap clickup.createTask so we can (a) track every created task ID for
// teardown, and (b) substitute stubs for the failure-mode tests.
const realCreateTask = clickup.createTask;
function trackingCreateTask(listId, body) {
  return realCreateTask(listId, body).then((res) => {
    if (res?.id) trackedClickUpTasks.add(res.id);
    return res;
  });
}
clickup.createTask = trackingCreateTask;

async function snapshotPreTestFirefliesIds() {
  const { data, error } = await supabase.from('meeting_transcripts').select('fireflies_id');
  if (error) throw new Error(`Cannot snapshot pre-test fireflies_ids: ${error.message}`);
  preTestFirefliesIds = new Set((data || []).map((r) => r.fireflies_id));
}

async function teardown() {
  header('Teardown');
  // Delete created_action_items first (FK to meeting_transcripts).
  const { data: caiRows } = await supabase
    .from('created_action_items')
    .select('id, fireflies_id, clickup_task_id');
  const caiToDelete = (caiRows || []).filter((r) => !preTestFirefliesIds.has(r.fireflies_id));
  if (caiToDelete.length) {
    const ids = caiToDelete.map((r) => r.id);
    const { error: delCaiErr } = await supabase.from('created_action_items').delete().in('id', ids);
    if (delCaiErr) console.log(`  WARN  delete created_action_items failed: ${delCaiErr.message}`);
    else console.log(`  cleaned ${ids.length} created_action_items rows`);
  }

  const { data: mtRows } = await supabase.from('meeting_transcripts').select('id, fireflies_id');
  const mtToDelete = (mtRows || []).filter((r) => !preTestFirefliesIds.has(r.fireflies_id));
  if (mtToDelete.length) {
    const ids = mtToDelete.map((r) => r.id);
    const { error: delMtErr } = await supabase.from('meeting_transcripts').delete().in('id', ids);
    if (delMtErr) console.log(`  WARN  delete meeting_transcripts failed: ${delMtErr.message}`);
    else console.log(`  cleaned ${ids.length} meeting_transcripts rows`);
  }

  // Restore campus list ID before deleting tasks so we don't accidentally
  // hit the wrong list during cleanup.
  await restoreCampusListId();

  if (TEST_LIST_ID && trackedClickUpTasks.size) {
    let deletedTasks = 0;
    for (const taskId of trackedClickUpTasks) {
      try {
        const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
          method: 'DELETE',
          headers: { Authorization: process.env.CLICKUP_API_KEY },
        });
        if (res.ok) deletedTasks++;
      } catch (_) { /* swallow — best-effort cleanup */ }
    }
    console.log(`  cleaned ${deletedTasks}/${trackedClickUpTasks.size} ClickUp test tasks`);
  }

  // Restore real createTask and askJson for any subsequent code in the same process.
  clickup.createTask = realCreateTask;
  claude.askJson = realAskJson;
}

async function main() {
  console.log('Fireflies Agent integration test');
  console.log(`  CLICKUP_TEST_LIST_ID: ${TEST_LIST_ID || '(unset — ClickUp-write assertions will skip)'}`);
  console.log(`  Campus under test:    ${CAMPUS_ID}`);

  try {
    await snapshotPreTestFirefliesIds();
    await pointCampusAtTestList();

    // -------- Test 1: Fireflies fetch --------
    header('Test 1: live Fireflies fetch returns transcripts');
    let transcripts = await fireflies.fetchRecentTranscripts(48);
    if (transcripts.length === 0) {
      console.log('  48h window empty — widening to 720h (30 days) per spec');
      transcripts = await fireflies.fetchRecentTranscripts(720);
    }
    if (transcripts.length > 0) ok(`fetched ${transcripts.length} transcripts`);
    else bad('fetched 0 transcripts even at 30 days — confirm Fireflies account has meetings');

    // -------- Test 2: Full sync inserts rows --------
    header('Test 2: full sync inserts meeting_transcripts and created_action_items');
    const stats1 = await fireflyAgent.run();
    if (stats1.fetched > 0 || stats1.inserted_transcripts > 0 || stats1.skipped_duplicate_transcripts > 0) {
      ok(`run completed: ${JSON.stringify(stats1)}`);
    } else {
      bad('run returned no stats — likely silent failure');
    }

    if (stats1.inserted_transcripts > 0) ok('at least one meeting_transcripts row inserted');
    else skip('no new meeting_transcripts inserted (window may already be ingested — re-run after Supabase cleanup)');

    if (TEST_LIST_ID) {
      if (stats1.action_items_created > 0) ok(`${stats1.action_items_created} ClickUp tasks created`);
      else skip('no action items extracted from window — Claude found none. Not a failure.');
    } else {
      skip('CLICKUP_TEST_LIST_ID unset — skipping ClickUp-write assertion');
    }

    // -------- Test 3: Idempotency on re-run --------
    header('Test 3: immediate re-run is a no-op');
    const stats2 = await fireflyAgent.run();
    if (stats2.inserted_transcripts === 0) ok('zero new meeting_transcripts on re-run');
    else bad(`re-run inserted ${stats2.inserted_transcripts} transcripts — dedup broken`);

    if (stats2.action_items_created === 0) ok('zero new ClickUp tasks created on re-run');
    else bad(`re-run created ${stats2.action_items_created} new tasks — dedup broken`);

    // -------- Test 4: ClickUp 500 retry path --------
    header('Test 4: ClickUp 500 leaves clickup_task_id null, then retry populates it');
    if (TEST_LIST_ID) {
      // Stub createTask to fail, then run a fresh transcript through.
      // We rely on the existing transcripts being already deduped, so
      // we can't easily get a fresh ClickUp create from the agent path
      // without faking a transcript. Instead, manually insert a fake
      // pending row and let step 3's retry-pending pass cover it.
      const fakeTranscriptId = `test-${Date.now()}`;
      const { error: fakeMtErr } = await supabase.from('meeting_transcripts').insert({
        campus_id: CAMPUS_ID,
        fireflies_id: fakeTranscriptId,
        title: 'Fireflies test fixture',
        meeting_date: new Date().toISOString(),
      });
      if (fakeMtErr) {
        bad('could not insert fake meeting_transcripts fixture', fakeMtErr);
      } else {
        const fakeHash = 'a'.repeat(64);
        const fakeText = 'Fireflies test fixture: send Sarah the outline by Friday';
        const { error: fakeCaiErr } = await supabase.from('created_action_items').insert({
          fireflies_id: fakeTranscriptId,
          action_item_hash: fakeHash,
          action_item_text: fakeText,
          campus_id: CAMPUS_ID,
        });
        if (fakeCaiErr) {
          bad('could not insert fake created_action_items pending row', fakeCaiErr);
        } else {
          // First retry pass: ClickUp stubbed to throw 500.
          clickup.createTask = async () => {
            const e = new Error('ClickUp createTask failed: 500 simulated outage');
            throw e;
          };
          await fireflyAgent.run();
          const { data: still } = await supabase
            .from('created_action_items')
            .select('clickup_task_id')
            .eq('fireflies_id', fakeTranscriptId)
            .eq('action_item_hash', fakeHash)
            .maybeSingle();
          if (still && still.clickup_task_id === null) ok('ClickUp 500 left clickup_task_id null');
          else bad(`expected null clickup_task_id, got ${still?.clickup_task_id}`);

          // Second pass: restore createTask, expect retry to populate.
          clickup.createTask = trackingCreateTask;
          await fireflyAgent.run();
          const { data: retried } = await supabase
            .from('created_action_items')
            .select('clickup_task_id')
            .eq('fireflies_id', fakeTranscriptId)
            .eq('action_item_hash', fakeHash)
            .maybeSingle();
          if (retried?.clickup_task_id) ok(`retry populated clickup_task_id (${retried.clickup_task_id})`);
          else bad('retry did not populate clickup_task_id');
        }
      }
    } else {
      skip('CLICKUP_TEST_LIST_ID unset — skipping ClickUp 500 retry assertion');
    }

    // -------- Test 5: Bad API key surfaces an error log --------
    header('Test 5: bad FIREFLIES_API_KEY logs an error and inserts nothing');
    const realKey = process.env.FIREFLIES_API_KEY;
    process.env.FIREFLIES_API_KEY = 'invalid-test-key';
    const { count: countBefore } = await supabase
      .from('meeting_transcripts')
      .select('*', { count: 'exact', head: true });
    const stats3 = await fireflyAgent.run();
    process.env.FIREFLIES_API_KEY = realKey;
    const { count: countAfter } = await supabase
      .from('meeting_transcripts')
      .select('*', { count: 'exact', head: true });
    if (countAfter === countBefore) ok('no meeting_transcripts inserted with bad key');
    else bad(`row count changed: ${countBefore} → ${countAfter}`);

    // The bad-key error path goes through self-heal, which logs to
    // agent_logs. Check that an error row exists.
    const { data: errorLogs } = await supabase
      .from('agent_logs')
      .select('action, error_message')
      .eq('agent_name', 'fireflies')
      .eq('status', 'error')
      .order('created_at', { ascending: false })
      .limit(5);
    if ((errorLogs || []).some((r) => /Fireflies/i.test(r.error_message || ''))) {
      ok('error logged to agent_logs');
    } else {
      bad('expected a Fireflies error in recent agent_logs');
    }
    void stats3;
  } catch (err) {
    bad('unexpected exception', err);
  } finally {
    await teardown();
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed, ${skipped} skipped`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
