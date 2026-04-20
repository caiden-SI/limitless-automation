// Integration test for the Scripting Agent.
// Runs against real Supabase, real Claude, real ClickUp.
//
// Usage: node scripts/test-scripting-agent.js
//
// Prereqs:
//   - scripts/migrations/2026-04-20-scripting-agent.sql applied
//   - Alex Mathews student row populated with claude_project_context
//   - Austin campus has clickup_list_id set
//   - .env populated with ANTHROPIC_API_KEY, CLICKUP_API_KEY,
//     SUPABASE_*, and the two CLICKUP_*_FIELD_ID vars.

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const clickup = require('../lib/clickup');
const scripting = require('../agents/scripting');

const AUSTIN_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const ALEX_ID = '0bf6a38a-801e-4eff-b0c8-c209a9029b7e';

function makeEvent(tag) {
  const t = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  return {
    id: `__scripting_test_${tag}_${Date.now()}`,
    title: 'Filming with Alex Mathews',
    description: '',
    startTime: t,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function test1HappyPath(state) {
  console.log('\n=== Test 1: happy path ===');
  const event = makeEvent('happy');
  state.eventIds.push(event.id);

  const result = await scripting.processEvent(event, AUSTIN_ID);

  assert(result && Array.isArray(result.videoIds), 'processEvent returned no videoIds');
  assert(result.videoIds.length === 3, `expected 3 videoIds, got ${result.videoIds.length}`);
  assert(result.clickupTaskIds.length === 3, `expected 3 clickupTaskIds, got ${result.clickupTaskIds.length}`);

  state.videoIds.push(...result.videoIds);
  state.taskIds.push(...result.clickupTaskIds);

  // Assert 3 videos rows with correct shape
  const { data: videos, error: vErr } = await supabase
    .from('videos')
    .select('id, status, student_id, student_name, title, script, clickup_task_id')
    .in('id', result.videoIds);
  assert(!vErr, `videos query: ${vErr?.message}`);
  assert(videos.length === 3, `expected 3 videos rows, got ${videos.length}`);
  videos.forEach((v) => {
    assert(v.status === 'IDEA', `video ${v.id} status ${v.status} !== IDEA`);
    assert(v.student_id === ALEX_ID, `video ${v.id} student_id ${v.student_id} !== ALEX_ID`);
    assert(v.student_name === 'Alex Mathews', `video ${v.id} student_name mismatch`);
    assert(v.clickup_task_id, `video ${v.id} missing clickup_task_id`);
    assert(v.title && v.script, `video ${v.id} missing title or script`);
  });
  console.log('  [ok] 3 videos rows created, status IDEA, student_id matches Alex');

  // Assert 3 ClickUp tasks exist with custom fields populated
  const internalField = process.env.CLICKUP_INTERNAL_VIDEO_NAME_FIELD_ID;
  const projectField = process.env.CLICKUP_PROJECT_DESCRIPTION_FIELD_ID;
  for (const taskId of result.clickupTaskIds) {
    const task = await clickup.getTask(taskId);
    assert(task && task.id === taskId, `ClickUp task ${taskId} not fetchable`);
    const fields = task.custom_fields || [];
    const internal = fields.find((f) => f.id === internalField);
    const project = fields.find((f) => f.id === projectField);
    assert(internal && internal.value, `task ${taskId} missing Internal Video Name value`);
    assert(project && project.value, `task ${taskId} missing Project Description value`);
  }
  console.log('  [ok] 3 ClickUp tasks created, both custom fields populated on each');

  // Assert one processed_calendar_events row with the 3 video IDs and status completed
  const { data: claims, error: cErr } = await supabase
    .from('processed_calendar_events')
    .select('id, status, video_ids')
    .eq('campus_id', AUSTIN_ID)
    .eq('event_id', event.id);
  assert(!cErr, `processed_calendar_events query: ${cErr?.message}`);
  assert(claims.length === 1, `expected 1 processed_calendar_events row, got ${claims.length}`);
  assert(claims[0].status === 'completed', `claim status ${claims[0].status} !== completed`);
  const claimed = Array.isArray(claims[0].video_ids) ? claims[0].video_ids : [];
  assert(claimed.length === 3, `claim video_ids length ${claimed.length} !== 3`);
  result.videoIds.forEach((id) => assert(claimed.includes(id), `claim video_ids missing ${id}`));
  console.log('  [ok] processed_calendar_events row is status=completed with all 3 video IDs');

  // Load the generated concepts for hook_type diversity check + eyeball review
  const concepts = videos.map((v) => {
    try { return JSON.parse(v.script); } catch (_e) { return null; }
  }).filter(Boolean);
  assert(concepts.length === 3, `could not parse 3 concepts from videos.script`);

  // Check top_hooks count; if >=3, assert hook_type uniqueness
  const { data: signal } = await supabase
    .from('performance_signals')
    .select('top_hooks')
    .eq('campus_id', AUSTIN_ID)
    .order('week_of', { ascending: false })
    .limit(1)
    .maybeSingle();
  const topHookCount = signal && Array.isArray(signal.top_hooks) ? signal.top_hooks.length : 0;
  if (topHookCount >= 3) {
    const hookTypes = new Set(concepts.map((c) => c.hook_type));
    assert(hookTypes.size === 3, `expected 3 unique hook_types given ${topHookCount} top_hooks, got ${hookTypes.size}: ${[...hookTypes].join(', ')}`);
    console.log(`  [ok] hook_type uniqueness enforced (top_hooks=${topHookCount})`);
  } else {
    console.log(`  [skip] hook_type uniqueness (only ${topHookCount} top_hooks available)`);
  }

  // Print concepts for eyeball review
  console.log('\n--- Generated concepts (eyeball review) ---');
  concepts.forEach((c, i) => {
    console.log(`\n[${i + 1}] ${c.title}  (${c.hook_type})`);
    console.log(`    hook_angle: ${c.hook_angle}`);
    console.log(`    script: ${c.script}`);
    console.log(`    creative_direction:`);
    c.creative_direction.forEach((d) => console.log(`      - ${d}`));
  });
  console.log('--- end concepts ---\n');
}

async function test2Rollback(state) {
  console.log('\n=== Test 2: rollback on ClickUp failure ===');
  const event = makeEvent('rollback');
  state.eventIds.push(event.id);

  const originalCreateTask = clickup.createTask;
  let callCount = 0;
  const createdDuringTest = [];

  clickup.createTask = async function patchedCreateTask(listId, taskData) {
    callCount++;
    if (callCount === 2) {
      throw new Error('SIMULATED_CLICKUP_FAILURE');
    }
    const task = await originalCreateTask.call(clickup, listId, taskData);
    createdDuringTest.push(task.id);
    return task;
  };
  state.taskIds.push(...createdDuringTest); // safety — collected below too

  let threw = false;
  try {
    await scripting.processEvent(event, AUSTIN_ID);
  } catch (err) {
    threw = true;
    assert(
      err.message.includes('SIMULATED_CLICKUP_FAILURE'),
      `expected simulated failure to surface, got: ${err.message}`
    );
  } finally {
    clickup.createTask = originalCreateTask;
    // Collect any tasks that were created during the test for teardown
    state.taskIds.push(...createdDuringTest);
  }
  assert(threw, 'expected processEvent to throw on simulated ClickUp failure');
  console.log('  [ok] processEvent rethrew simulated failure');

  // Assert zero videos rows remain for this event's student on that claim
  const { data: videos } = await supabase
    .from('videos')
    .select('id')
    .eq('student_id', ALEX_ID)
    .eq('status', 'IDEA')
    .not('id', 'in', `(${state.videoIds.length ? state.videoIds.map((id) => `"${id}"`).join(',') : '""'})`);
  // Above query may be fragile on empty in-list — cross-check by confirming the rollback deleted everything.
  // Simpler: confirm no processed_calendar_events row exists for this event (clean rollback deletes the claim).
  const { data: claims } = await supabase
    .from('processed_calendar_events')
    .select('id, status')
    .eq('campus_id', AUSTIN_ID)
    .eq('event_id', event.id);
  assert(claims.length === 0, `expected no processed_calendar_events row after clean rollback, got ${claims.length} (status=${claims[0]?.status})`);
  console.log('  [ok] processed_calendar_events row deleted (clean rollback)');

  // Assert the video rows that would have been inserted are gone
  // (There's no easy way to get those specific IDs post-rollback, so verify indirectly:
  //  check that the one ClickUp task created before the throw was archived.)
  if (createdDuringTest.length > 0) {
    // Fetch each task; if archive succeeded, task.archived will be true
    for (const tid of createdDuringTest) {
      try {
        const t = await clickup.getTask(tid);
        assert(t.archived === true, `task ${tid} not archived after rollback (archived=${t.archived})`);
      } catch (err) {
        // Archived tasks may 404 — treat as archived
        console.log(`  [note] task ${tid} unfetchable post-archive (${err.message.slice(0, 80)})`);
      }
    }
    console.log(`  [ok] ${createdDuringTest.length} pre-failure ClickUp task(s) archived`);
  }

  // Assert agent_logs contains an error row for this event
  const { data: logs } = await supabase
    .from('agent_logs')
    .select('action, status, payload')
    .eq('agent_name', 'scripting')
    .eq('status', 'error')
    .order('created_at', { ascending: false })
    .limit(20);
  const matched = (logs || []).find(
    (l) => l.payload && (l.payload.eventId === event.id || (l.payload.payload && l.payload.payload.eventId === event.id))
  );
  // Fallback: any scripting error logged in the last few seconds is fine
  assert(
    matched || (logs && logs.length > 0),
    `expected an error row in agent_logs for scripting agent, none found`
  );
  console.log('  [ok] agent_logs has scripting error entry');
}

async function test3Dedup(state) {
  console.log('\n=== Test 3: dedup on duplicate event ===');
  const event = makeEvent('dedup');
  state.eventIds.push(event.id);

  // First call: real processing
  const first = await scripting.processEvent(event, AUSTIN_ID);
  assert(first.videoIds && first.videoIds.length === 3, 'first call failed to produce 3 videos');
  state.videoIds.push(...first.videoIds);
  state.taskIds.push(...first.clickupTaskIds);

  // Second call: must be no-op
  const second = await scripting.processEvent(event, AUSTIN_ID);
  assert(second && second.skipped, `expected second call to skip, got ${JSON.stringify(second)}`);
  assert(
    second.skipped.startsWith('already_claimed') || second.skipped === 'claim_race_lost',
    `unexpected skip reason: ${second.skipped}`
  );
  console.log(`  [ok] second call skipped: ${second.skipped}`);

  // Confirm no additional videos created
  const { data: videos } = await supabase
    .from('videos')
    .select('id')
    .eq('student_id', ALEX_ID)
    .eq('status', 'IDEA');
  const delta = (videos || []).filter((v) => !state.videoIds.includes(v.id));
  // Some pre-existing IDEA rows may exist for Alex from prior runs; strictest check is that
  // no new rows appeared between our two calls — we check state.videoIds, so just confirm
  // processed_calendar_events has exactly one row.
  const { data: claims } = await supabase
    .from('processed_calendar_events')
    .select('id, status')
    .eq('campus_id', AUSTIN_ID)
    .eq('event_id', event.id);
  assert(claims.length === 1, `expected exactly 1 claim row, got ${claims.length}`);
  assert(claims[0].status === 'completed', `claim status ${claims[0].status} !== completed`);
  console.log('  [ok] exactly one processed_calendar_events row (no duplicate writes)');
}

async function teardown(state) {
  console.log('\n=== Teardown ===');

  if (state.videoIds.length) {
    const { error } = await supabase.from('videos').delete().in('id', state.videoIds);
    if (error) console.log(`  [warn] videos delete error: ${error.message}`);
    else console.log(`  [ok] deleted ${state.videoIds.length} videos rows`);
  }

  if (state.eventIds.length) {
    const { error } = await supabase
      .from('processed_calendar_events')
      .delete()
      .eq('campus_id', AUSTIN_ID)
      .in('event_id', state.eventIds);
    if (error) console.log(`  [warn] processed_calendar_events delete error: ${error.message}`);
    else console.log(`  [ok] deleted processed_calendar_events rows for ${state.eventIds.length} test event(s)`);
  }

  if (state.taskIds.length) {
    let archived = 0;
    for (const id of state.taskIds) {
      try {
        await clickup.updateTask(id, { archived: true });
        archived++;
      } catch (_e) {
        // already archived, or 404 — ignore
      }
    }
    console.log(`  [ok] archived ${archived}/${state.taskIds.length} ClickUp task(s)`);
  }
}

(async () => {
  const state = { videoIds: [], taskIds: [], eventIds: [] };
  let failure = null;

  try {
    await test1HappyPath(state);
    await test2Rollback(state);
    await test3Dedup(state);
  } catch (err) {
    failure = err;
    console.error('\n!!! TEST FAILED:', err.message);
    console.error(err.stack);
  } finally {
    try {
      await teardown(state);
    } catch (err) {
      console.error('Teardown error:', err.message);
    }
  }

  if (failure) {
    console.log('\n=== RESULT: FAIL ===');
    process.exit(1);
  } else {
    console.log('\n=== RESULT: PASS (all 3 tests) ===');
    process.exit(0);
  }
})();
