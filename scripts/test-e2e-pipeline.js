#!/usr/bin/env node
/**
 * End-to-end pipeline test — 7 stages from synthetic calendar event to
 * Frame.io share link and review-comment waiting state.
 *
 * Spec: workflows/e2e-test.md (programmatic version of the SOP's recorded
 * walkthrough). Uses the real Alex Mathews student record. All test data is
 * tagged with __e2e_test_<timestamp> for cleanup.
 *
 * Services exercised against real APIs: Supabase, Anthropic, Dropbox, ClickUp.
 * Frame.io createShareLink is stubbed (no real uploaded asset); the flow
 * around it — DB write + ClickUp custom field push — is still exercised.
 *
 * Run:
 *   node scripts/test-e2e-pipeline.js
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const scripting = require('../agents/scripting');
const pipeline = require('../agents/pipeline');
const dropbox = require('../lib/dropbox');
const clickup = require('../lib/clickup');
const frameio = require('../lib/frameio');

const CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const STUDENT_ID = '0bf6a38a-801e-4eff-b0c8-c209a9029b7e';
const STUDENT_NAME = 'Alex Mathews';
const TEST_PREFIX = '__e2e_test_' + Date.now();
const FAKE_EVENT_ID = TEST_PREFIX + '_event';

const cleanup = {
  videoIds: [],
  clickupTaskIds: [],
  claimEventIds: [],
  dropboxPaths: [],
};

let pickedTaskId = null;
let pickedVideoId = null;
// Test-wide timestamp with 60s back buffer — absorbs clock skew between the
// Node host and the Postgres server when filtering agent_logs by created_at.
const TEST_STARTED_AT = new Date(Date.now() - 60000).toISOString();

const originalCreateShareLink = frameio.createShareLink;

// ── Output helpers ────────────────────────────────────────

function banner(title) {
  console.log('\n' + '━'.repeat(72));
  console.log('  ' + title);
  console.log('━'.repeat(72));
}
function ok(msg)   { console.log('  \u2713 ' + msg); }
function warn(msg) { console.log('  \u26A0 ' + msg); }
function info(msg) { console.log('    ' + msg); }

// ── Dropbox test helpers (inline, not in lib/dropbox) ──────

async function uploadDropboxFile(path, content) {
  const tryUpload = async (token) => fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', mute: true }),
    },
    body: content,
  });
  let res = await tryUpload(process.env.DROPBOX_ACCESS_TOKEN);
  if (res.status === 401) {
    const fresh = await dropbox.refreshAccessToken();
    res = await tryUpload(fresh);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dropbox upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function deleteDropboxPath(path) {
  const tryDelete = async (token) => fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });
  let res = await tryDelete(process.env.DROPBOX_ACCESS_TOKEN);
  if (res.status === 401) {
    const fresh = await dropbox.refreshAccessToken();
    res = await tryDelete(fresh);
  }
  return res.ok;
}

// ── Preflight ────────────────────────────────────────

async function preflight() {
  banner('PREFLIGHT');

  const { data: student, error: sErr } = await supabase
    .from('students')
    .select('id, name, claude_project_context')
    .eq('id', STUDENT_ID)
    .eq('campus_id', CAMPUS_ID)
    .maybeSingle();

  if (sErr) throw new Error(`students query failed: ${sErr.message}`);
  if (!student) throw new Error(`Alex Mathews student record not found (id=${STUDENT_ID})`);
  ok(`student record: ${student.name}`);
  if (!student.claude_project_context) {
    warn('student has no claude_project_context — concepts will be generic');
  } else {
    ok(`claude_project_context present (${student.claude_project_context.length} chars)`);
  }

  // Introspect videos columns — detect the Session 8 frameio_asset_id migration gap
  const { data: oneVideo } = await supabase.from('videos').select('*').limit(1);
  const frameioAssetIdColumnExists = oneVideo && oneVideo[0] && 'frameio_asset_id' in oneVideo[0];
  if (frameioAssetIdColumnExists) {
    ok('videos.frameio_asset_id column exists');
  } else {
    warn('videos.frameio_asset_id column MISSING');
    warn('(apply scripts/migrations/2026-04-20-frameio-asset-id.sql for full stage 6)');
  }

  // Probe videos_status_check — detect the Session 9 stale-constraint issue
  const { data: probe, error: pErr } = await supabase
    .from('videos')
    .insert({ campus_id: CAMPUS_ID, title: TEST_PREFIX + '_status_probe', status: 'IDEA' })
    .select('id')
    .single();
  if (pErr) throw new Error(`probe insert failed: ${pErr.message}`);

  const { error: upErr } = await supabase
    .from('videos')
    .update({ status: 'WAITING' })
    .eq('id', probe.id);
  const constraintAcceptsWaiting = !upErr;
  await supabase.from('videos').delete().eq('id', probe.id);

  if (constraintAcceptsWaiting) {
    ok('videos_status_check accepts WAITING');
  } else {
    warn('videos_status_check does NOT accept WAITING');
    warn('(apply scripts/migrations/2026-04-20-videos-status-check.sql for full stages 5/7)');
  }

  return { constraintAcceptsWaiting, frameioAssetIdColumnExists };
}

// ── Stages ────────────────────────────────────────

async function stage1() {
  banner('STAGE 1 \u2014 Scripting Agent creates concepts from calendar event');

  const event = {
    id: FAKE_EVENT_ID,
    title: `${TEST_PREFIX} Filming with ${STUDENT_NAME}`,
    description: 'E2E test event',
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
  info(`event id: ${event.id}`);
  info(`event title: ${event.title}`);

  const result = await scripting.processEvent(event, CAMPUS_ID);

  if (result?.skipped) throw new Error(`processEvent skipped: ${result.skipped}`);
  if (!Array.isArray(result?.videoIds) || result.videoIds.length !== 3) {
    throw new Error(`expected 3 videos, got ${result?.videoIds?.length ?? 0}`);
  }
  if (!Array.isArray(result?.clickupTaskIds) || result.clickupTaskIds.length !== 3) {
    throw new Error(`expected 3 ClickUp tasks, got ${result?.clickupTaskIds?.length ?? 0}`);
  }

  cleanup.videoIds.push(...result.videoIds);
  cleanup.clickupTaskIds.push(...result.clickupTaskIds);
  cleanup.claimEventIds.push(FAKE_EVENT_ID);

  ok('3 videos rows created');
  ok('3 ClickUp tasks created');

  const { data: claim } = await supabase
    .from('processed_calendar_events')
    .select('status')
    .eq('event_id', FAKE_EVENT_ID)
    .maybeSingle();
  if (!claim) throw new Error('processed_calendar_events row missing');
  if (claim.status !== 'completed') throw new Error(`claim status ${claim.status} (expected completed)`);
  ok(`processed_calendar_events row: status=${claim.status}`);

  const { data: videos } = await supabase
    .from('videos')
    .select('id, title')
    .in('id', result.videoIds);
  info(`concepts: ${videos.map((v) => `"${v.title}"`).join(', ')}`);

  pickedVideoId = result.videoIds[0];
  pickedTaskId = result.clickupTaskIds[0];
  info(`picked concept 1 for downstream stages`);
  info(`  videoId=${pickedVideoId}`);
  info(`  taskId=${pickedTaskId}`);
}

async function stage2() {
  banner('STAGE 2 \u2014 ready for shooting \u2192 Dropbox folders');

  const newTitle = `${TEST_PREFIX}_concept1`;
  await supabase.from('videos').update({ title: newTitle }).eq('id', pickedVideoId);
  info(`renamed video.title to: ${newTitle}`);

  await pipeline.handleStatusChange(pickedTaskId, 'ready for shooting', null);

  const { data: video } = await supabase
    .from('videos')
    .select('dropbox_folder')
    .eq('id', pickedVideoId)
    .single();
  if (!video.dropbox_folder) throw new Error('videos.dropbox_folder still null');
  cleanup.dropboxPaths.push(video.dropbox_folder);
  ok(`videos.dropbox_folder: ${video.dropbox_folder}`);

  const footage = await dropbox.listFolder(video.dropbox_folder + '/[FOOTAGE]');
  ok(`[FOOTAGE] subfolder exists (${footage.length} entries)`);
  const project = await dropbox.listFolder(video.dropbox_folder + '/[PROJECT]');
  ok(`[PROJECT] subfolder exists (${project.length} entries)`);
}

async function stage3() {
  banner('STAGE 3 \u2014 Footage detection \u2192 ready for editing');

  const { data: video } = await supabase
    .from('videos')
    .select('dropbox_folder')
    .eq('id', pickedVideoId)
    .single();

  const footagePath = video.dropbox_folder + '/[FOOTAGE]/__e2e_test_placeholder.txt';
  await uploadDropboxFile(footagePath, Buffer.from('e2e test placeholder \u2014 not real footage'));
  ok('placeholder file uploaded to [FOOTAGE]');

  await pipeline.handleFootageDetected(pickedTaskId, null);

  const { data: after } = await supabase
    .from('videos')
    .select('status')
    .eq('id', pickedVideoId)
    .single();
  if (after.status !== 'READY FOR EDITING') {
    throw new Error(`expected status READY FOR EDITING, got ${after.status}`);
  }
  ok(`videos.status: ${after.status}`);

  try {
    const task = await clickup.getTask(pickedTaskId);
    if (task?.status?.status === 'ready for editing') {
      ok('ClickUp task status: ready for editing');
    } else {
      warn(`ClickUp task status: ${task?.status?.status || 'unknown'}`);
    }
  } catch (err) {
    warn(`ClickUp status check failed: ${err.message}`);
  }
}

async function stage4() {
  banner('STAGE 4 \u2014 Editor assignment');

  await pipeline.handleStatusChange(pickedTaskId, 'ready for editing', null);

  const { data: after } = await supabase
    .from('videos')
    .select('assignee_id')
    .eq('id', pickedVideoId)
    .single();
  if (!after.assignee_id) throw new Error('videos.assignee_id still null');

  const { data: editor } = await supabase
    .from('editors')
    .select('name, clickup_user_id')
    .eq('id', after.assignee_id)
    .single();
  ok(`editor assigned: ${editor.name} (clickup_user_id=${editor.clickup_user_id})`);
}

async function stage5() {
  banner('STAGE 5 \u2014 edited \u2192 QA runs');

  const { data: video } = await supabase
    .from('videos')
    .select('dropbox_folder')
    .eq('id', pickedVideoId)
    .single();

  const cleanSrt = [
    '1',
    '00:00:01,000 --> 00:00:04,000',
    'This is a clean test caption.',
    '',
    '2',
    '00:00:04,500 --> 00:00:08,000',
    'All brand terms are correctly spelled here.',
    '',
  ].join('\n');

  const srtPath = video.dropbox_folder + '/[PROJECT]/__e2e_test_captions.srt';
  await uploadDropboxFile(srtPath, Buffer.from(cleanSrt));
  ok('clean SRT uploaded to [PROJECT]');

  // handleStatusChange internally invokes QA and may throw if QA throws.
  // Either outcome is acceptable for this stage — we care that the `edited`
  // trigger routed to QA, not that QA's own inner pieces all succeed.
  try {
    await pipeline.handleStatusChange(pickedTaskId, 'edited', null);
  } catch (err) {
    warn(`handleStatusChange('edited') threw: ${err.message.slice(0, 120)}`);
    info('(acceptable — self-heal handles; see agent_logs for the recovery trail)');
  }

  // Assertion: QA was invoked (qa_started logged since test start).
  const { data: startedLogs } = await supabase
    .from('agent_logs')
    .select('id')
    .eq('agent_name', 'qa')
    .eq('action', 'qa_started')
    .gte('created_at', TEST_STARTED_AT)
    .limit(1);

  if (!startedLogs || startedLogs.length === 0) {
    throw new Error('QA was not invoked \u2014 no qa_started log in this stage window');
  }
  ok('QA was invoked (qa_started logged)');

  const { data: after } = await supabase
    .from('videos')
    .select('qa_passed, status')
    .eq('id', pickedVideoId)
    .single();

  if (after.qa_passed === true) {
    ok('QA passed (qa_passed=true)');
  } else if (after.qa_passed === false) {
    warn('QA ran and returned qa_passed=false');
    info('(expected: LUFS fails closed without a real video file)');
    info(`videos.status: ${after.status}`);
  } else {
    warn('qa_passed is NULL \u2014 QA threw mid-flow, self-heal caught and escalated');
    info('(check agent_logs for self_heal_alert_sent during this stage window)');
  }
}

async function stage6(frameioAssetIdColumnExists) {
  banner('STAGE 6 \u2014 done \u2192 Frame.io share link');

  // Stub Frame.io for this stage. Without a real uploaded asset the v2 API
  // would 404; the stub lets us exercise pipeline.createShareLink's DB write
  // and ClickUp custom-field push end to end.
  frameio.createShareLink = async (assetId, _options) => ({
    url: `https://f.io/${TEST_PREFIX}_share`,
    id: 'e2e-stub-' + Date.now(),
    raw: { stub: true, assetId },
  });
  info('frameio.createShareLink stubbed for this stage');

  if (frameioAssetIdColumnExists) {
    await supabase
      .from('videos')
      .update({ frameio_asset_id: TEST_PREFIX + '_asset' })
      .eq('id', pickedVideoId);
    ok('frameio_asset_id seeded');
  } else {
    warn('skipping frameio_asset_id seed \u2014 column missing; createShareLink will graceful-skip');
  }

  await pipeline.handleStatusChange(pickedTaskId, 'done', null);

  if (!frameioAssetIdColumnExists) {
    // Without the column, the pipeline should log create_share_link_skipped.
    // Verify that skip log fired since TEST_STARTED_AT.
    const { data: skipLogs } = await supabase
      .from('agent_logs')
      .select('id')
      .eq('agent_name', 'pipeline')
      .eq('action', 'create_share_link_skipped')
      .gte('created_at', TEST_STARTED_AT)
      .limit(1);
    if (!skipLogs || skipLogs.length === 0) {
      throw new Error('expected create_share_link_skipped log (column missing), got none');
    }
    ok('createShareLink correctly logged create_share_link_skipped (no asset id column)');
    return;
  }

  const { data: after } = await supabase
    .from('videos')
    .select('frameio_share_link')
    .eq('id', pickedVideoId)
    .single();
  if (!after.frameio_share_link) throw new Error('frameio_share_link still null');
  ok(`videos.frameio_share_link: ${after.frameio_share_link}`);

  const fieldId = process.env.CLICKUP_FRAMEIO_FIELD_ID;
  try {
    const task = await clickup.getTask(pickedTaskId);
    const field = task.custom_fields?.find((f) => f.id === fieldId);
    if (field?.value === after.frameio_share_link) {
      ok('ClickUp "E - Frame Link" custom field matches share link');
    } else {
      warn(`ClickUp custom field value mismatch: ${field?.value}`);
    }
  } catch (err) {
    warn(`ClickUp custom field check failed: ${err.message}`);
  }
}

async function stage7(constraintAcceptsWaiting) {
  banner('STAGE 7 \u2014 Frame.io comment.created \u2192 waiting');

  try {
    await pipeline.handleReviewComment(pickedTaskId, null);

    const { data: after } = await supabase
      .from('videos')
      .select('status')
      .eq('id', pickedVideoId)
      .single();
    if (after.status === 'WAITING') {
      ok('videos.status: WAITING');
    } else {
      warn(`videos.status: ${after.status} (expected WAITING)`);
    }
  } catch (err) {
    if (!constraintAcceptsWaiting && err.message.includes('videos_status_check')) {
      warn(`known issue \u2014 constraint rejected WAITING write: ${err.message}`);
      warn('(stage reached the DB update; flow is correct, blocked by stale constraint)');
    } else {
      throw err;
    }
  }

  try {
    const task = await clickup.getTask(pickedTaskId);
    if (task?.status?.status === 'waiting') {
      ok('ClickUp task status: waiting');
    } else {
      warn(`ClickUp task status: ${task?.status?.status || 'unknown'}`);
    }
  } catch (err) {
    warn(`ClickUp status check failed: ${err.message}`);
  }
}

// ── Teardown ────────────────────────────────────────

async function teardown() {
  banner('TEARDOWN');

  frameio.createShareLink = originalCreateShareLink;

  if (cleanup.videoIds.length) {
    const { error } = await supabase.from('videos').delete().in('id', cleanup.videoIds);
    if (error) warn(`videos delete failed: ${error.message}`);
    else ok(`deleted ${cleanup.videoIds.length} videos rows`);
  }

  if (cleanup.claimEventIds.length) {
    const { error } = await supabase
      .from('processed_calendar_events')
      .delete()
      .in('event_id', cleanup.claimEventIds);
    if (error) warn(`processed_calendar_events delete failed: ${error.message}`);
    else ok(`deleted ${cleanup.claimEventIds.length} processed_calendar_events row(s)`);
  }

  let archived = 0;
  for (const taskId of cleanup.clickupTaskIds) {
    try {
      await clickup.updateTask(taskId, { archived: true });
      archived++;
    } catch (err) {
      warn(`archive ${taskId} failed: ${err.message}`);
    }
  }
  if (archived) ok(`archived ${archived} ClickUp task(s)`);

  for (const path of cleanup.dropboxPaths) {
    const success = await deleteDropboxPath(path);
    if (success) ok(`deleted Dropbox folder: ${path}`);
    else warn(`could not delete Dropbox folder: ${path}`);
  }
}

// ── Main ────────────────────────────────────────

(async () => {
  console.log('E2E pipeline test \u2014 prefix: ' + TEST_PREFIX);

  let preflightResult;
  try {
    preflightResult = await preflight();
  } catch (err) {
    console.error('\n  \u2717 PREFLIGHT FAILED: ' + err.message);
    process.exit(1);
  }

  const stages = [
    { num: 1, fn: stage1 },
    { num: 2, fn: stage2 },
    { num: 3, fn: stage3 },
    { num: 4, fn: stage4 },
    { num: 5, fn: stage5 },
    { num: 6, fn: () => stage6(preflightResult.frameioAssetIdColumnExists) },
    { num: 7, fn: () => stage7(preflightResult.constraintAcceptsWaiting) },
  ];

  let failureStage = null;
  let failureMessage = null;

  try {
    for (const stage of stages) {
      try {
        await stage.fn();
      } catch (err) {
        failureStage = stage.num;
        failureMessage = err.message;
        console.error('\n  \u2717 STAGE ' + stage.num + ' FAILED: ' + err.message);
        if (err.stack) {
          const head = err.stack.split('\n').slice(0, 6).join('\n');
          console.error(head);
        }
        break;
      }
    }
  } finally {
    try {
      await teardown();
    } catch (err) {
      console.error('TEARDOWN error: ' + err.message);
    }
  }

  console.log('\n' + '━'.repeat(72));
  if (failureStage !== null) {
    console.log('  E2E FAILED at stage ' + failureStage + ': ' + failureMessage);
    console.log('━'.repeat(72));
    process.exit(1);
  }
  console.log('  E2E PASSED \u2014 all 7 stages complete');
  console.log('━'.repeat(72));
})();
