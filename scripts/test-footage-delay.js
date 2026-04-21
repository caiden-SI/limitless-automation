#!/usr/bin/env node
// Integration test for the 1-hour Dropbox stabilization delay.
//
// Exercises pipeline.scanPendingFootage() against real Supabase with
// dropbox.listFolder and clickup.updateTask stubbed. Creates one test video,
// walks it through five state transitions, asserts Supabase + counter output,
// and tears down.
//
// Run: node scripts/test-footage-delay.js

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const pipeline = require('../agents/pipeline');
const dropbox = require('../lib/dropbox');
const clickup = require('../lib/clickup');

const PREFIX = `__footage_delay_test_${Date.now()}`;
const TEST_FOLDER = `/austin/${PREFIX}`;
const FOOTAGE_PATH = `${TEST_FOLDER}/[FOOTAGE]`;

let videoId = null;

function ok(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.log(`  ✗ ${msg}`); process.exitCode = 1; }
function banner(msg) { console.log(`\n━━━ ${msg}`); }

async function getVideo() {
  const { data, error } = await supabase
    .from('videos')
    .select('status, footage_detected_at')
    .eq('id', videoId)
    .single();
  if (error) throw error;
  return data;
}

async function setTimestamp(iso) {
  const { error } = await supabase
    .from('videos')
    .update({ footage_detected_at: iso })
    .eq('id', videoId);
  if (error) throw error;
}

async function resetStatus() {
  const { error } = await supabase
    .from('videos')
    .update({ status: 'READY FOR SHOOTING', footage_detected_at: null })
    .eq('id', videoId);
  if (error) throw error;
}

async function run() {
  // Preflight: confirm migration is applied.
  const probe = await supabase.from('videos').select('footage_detected_at').limit(1);
  if (probe.error) {
    console.error(`Migration not applied: ${probe.error.message}`);
    console.error('Run scripts/migrations/2026-04-21-footage-detected-at.sql in Supabase SQL Editor first.');
    process.exit(1);
  }

  // Pick any campus for the test row (campus_id is required NOT NULL).
  const { data: campus } = await supabase.from('campuses').select('id').limit(1).single();
  if (!campus) throw new Error('No campuses in DB');

  // Stub external side effects for the entire test.
  const realListFolder = dropbox.listFolder;
  const realUpdateTask = clickup.updateTask;
  let mockedFiles = [];
  dropbox.listFolder = async (path) => {
    // Only the test video's [FOOTAGE] path gets the mocked file list.
    // Any stray READY FOR SHOOTING videos in the DB return empty so they
    // don't perturb our test counters.
    if (path === FOOTAGE_PATH) return mockedFiles;
    return [];
  };
  clickup.updateTask = async (_taskId, _updates) => ({ stubbed: true });

  try {
    // Create test video.
    const { data: inserted, error: iErr } = await supabase
      .from('videos')
      .insert({
        campus_id: campus.id,
        clickup_task_id: `${PREFIX}_task`,
        title: PREFIX,
        status: 'READY FOR SHOOTING',
        dropbox_folder: TEST_FOLDER,
      })
      .select('id')
      .single();
    if (iErr) throw iErr;
    videoId = inserted.id;
    ok(`test video created: ${videoId}`);

    // Counts are sanity-checked with >= since stray fixtures in the DB
    // could add to totals; the authoritative assertion is the per-video
    // state read back from Supabase.

    // ---- Case 1: files absent, no existing timestamp → skip, no write.
    banner('Case 1: empty folder, no timestamp → skip');
    mockedFiles = [];
    let counts = await pipeline.scanPendingFootage(campus.id);
    let v = await getVideo();
    if (counts.skipped < 1) fail(`expected skipped>=1, got ${counts.skipped}`);
    else ok(`counts.skipped=${counts.skipped}`);
    if (v.footage_detected_at !== null) fail(`expected footage_detected_at null, got ${v.footage_detected_at}`);
    else ok('footage_detected_at stays null');
    if (v.status !== 'READY FOR SHOOTING') fail(`status drifted: ${v.status}`);
    else ok('status stays READY FOR SHOOTING');

    // ---- Case 2: files present, no timestamp → detect (stamp now), no advance.
    banner('Case 2: files present, no timestamp → stamp detection');
    mockedFiles = [{ tag: 'file', name: 'clip1.mp4' }];
    const beforeMs = Date.now();
    counts = await pipeline.scanPendingFootage(campus.id);
    v = await getVideo();
    if (counts.detected < 1) fail(`expected detected>=1, got ${counts.detected}`);
    else ok(`counts.detected=${counts.detected}`);
    if (v.footage_detected_at === null) fail('footage_detected_at still null');
    else {
      const stampMs = new Date(v.footage_detected_at).getTime();
      if (Math.abs(stampMs - beforeMs) > 10_000) fail(`timestamp drift: ${stampMs - beforeMs}ms from now`);
      else ok(`footage_detected_at set (drift ${stampMs - beforeMs}ms)`);
    }
    if (v.status !== 'READY FOR SHOOTING') fail(`status advanced too early: ${v.status}`);
    else ok('status stays READY FOR SHOOTING (still stabilizing)');

    // ---- Case 3: files present, timestamp 30min old → waiting, no advance.
    banner('Case 3: files present, timestamp 30min old → waiting');
    await setTimestamp(new Date(Date.now() - 30 * 60 * 1000).toISOString());
    counts = await pipeline.scanPendingFootage(campus.id);
    v = await getVideo();
    if (counts.waiting < 1) fail(`expected waiting>=1, got ${counts.waiting}`);
    else ok(`counts.waiting=${counts.waiting}`);
    if (v.status !== 'READY FOR SHOOTING') fail(`status advanced during wait window: ${v.status}`);
    else ok('status stays READY FOR SHOOTING');

    // ---- Case 4: files present, timestamp 2hr old → advance.
    banner('Case 4: files present, timestamp 2hr old → advance');
    await setTimestamp(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    counts = await pipeline.scanPendingFootage(campus.id);
    v = await getVideo();
    if (counts.advanced < 1) fail(`expected advanced>=1, got ${counts.advanced}`);
    else ok(`counts.advanced=${counts.advanced}`);
    if (v.status !== 'READY FOR EDITING') fail(`status did not advance: ${v.status}`);
    else ok('status flipped to READY FOR EDITING');
    if (v.footage_detected_at !== null) fail(`expected footage_detected_at cleared on advance, got ${v.footage_detected_at}`);
    else ok('footage_detected_at cleared on advance');

    // ---- Case 5: files absent, timestamp set → clear.
    banner('Case 5: files vanish after detection → clear timestamp');
    await resetStatus();
    await setTimestamp(new Date(Date.now() - 15 * 60 * 1000).toISOString());
    mockedFiles = [];
    counts = await pipeline.scanPendingFootage(campus.id);
    v = await getVideo();
    if (counts.cleared < 1) fail(`expected cleared>=1, got ${counts.cleared}`);
    else ok(`counts.cleared=${counts.cleared}`);
    if (v.footage_detected_at !== null) fail(`timestamp not cleared: ${v.footage_detected_at}`);
    else ok('footage_detected_at cleared back to null');

  } finally {
    // Restore stubs.
    dropbox.listFolder = realListFolder;
    clickup.updateTask = realUpdateTask;

    // Teardown.
    if (videoId) {
      await supabase.from('videos').delete().eq('id', videoId);
      ok(`teardown: video ${videoId} deleted`);
    }
  }

  console.log('\n' + (process.exitCode ? 'FAIL' : 'PASS'));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
