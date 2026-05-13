#!/usr/bin/env node
/**
 * Hotfix verification — pipeline.triggerQA must NOT flip a failing
 * video's status to "waiting" anymore. QA is advisory.
 *
 * Mirrors scripts/test-qa-agent.js's fixture (Dropbox folder + a
 * deliberately broken SRT) but drives pipeline.triggerQA instead of
 * qa.runQA directly, since the auto-flip lived in triggerQA's else
 * branch.
 *
 * Stubs clickup.addComment + clickup.updateTask so the test runs
 * against a fake clickup_task_id without creating real ClickUp
 * clutter. The stubs also let us assert what was and wasn't called.
 *
 * Cleans up the test video row and Dropbox folder on exit.
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const clickup = require('../lib/clickup');
const dropbox = require('../lib/dropbox');
const pipeline = require('../agents/pipeline');

const CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const TEST_TITLE = '__qa_advisory_' + Date.now();
const DROPBOX_BASE = `/austin/${TEST_TITLE}`;
const TASK_ID = 'test_qa_advisory_' + Date.now();

// Same broken SRT shape as test-qa-agent.js — brand misspellings + stutter +
// formatting issues. Guarantees a QA fail without depending on external state.
const TEST_SRT = `1
00:00:01,000 --> 00:00:04,000
Welcome to alfa School where we build Superbuilders

2
00:00:04,500 --> 00:00:08,000
Um so like today we're going to talk about the the timeback program

3
00:00:08,500 --> 00:00:12,000
its a really cool program that that helps students you know manage their time
`;

// Local Dropbox token may be expired — refresh once at startup and reuse.
// lib/dropbox auto-refreshes inside its own helpers but not for the raw
// upload/delete calls below, so we cache a fresh token here.
let freshToken = null;

async function uploadToDropbox(path, content) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${freshToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false }),
      'Content-Type': 'application/octet-stream',
    },
    body: content,
  });
  if (!res.ok) throw new Error(`Dropbox upload failed: ${await res.text()}`);
  return res.json();
}

async function deleteDropboxFolder(path) {
  const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${freshToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });
  return res.ok;
}

async function run() {
  console.log('=== Pipeline.triggerQA — Advisory Hotfix Verification ===\n');

  // Stubs — replace the real clickup functions for the duration of the run.
  // pipeline.js + qa.js share the same require cache entry, so swapping on
  // the exports object intercepts both call paths.
  const origAddComment = clickup.addComment;
  const origUpdateTask = clickup.updateTask;
  let addCommentCall = null;
  let updateTaskCalls = [];
  clickup.addComment = async (taskId, text) => {
    addCommentCall = { taskId, textLength: text.length, textFirst80: text.slice(0, 80) };
    return { id: 'stubbed-comment-id' };
  };
  clickup.updateTask = async (taskId, updates) => {
    updateTaskCalls.push({ taskId, updates });
    return { id: taskId };
  };

  let videoId = null;
  let dropboxCreated = false;
  let failures = 0;

  try {
    console.log('0. Refreshing Dropbox access token…');
    freshToken = await dropbox.refreshAccessToken();
    console.log('   [OK] token refreshed');

    console.log('\n1. Setting up Dropbox folders + broken SRT…');
    await dropbox.createFolder(DROPBOX_BASE);
    await dropbox.createFolder(`${DROPBOX_BASE}/[FOOTAGE]`);
    await dropbox.createFolder(`${DROPBOX_BASE}/[PROJECT]`);
    await uploadToDropbox(`${DROPBOX_BASE}/[PROJECT]/captions.srt`, TEST_SRT);
    dropboxCreated = true;
    console.log('   [OK]');

    console.log('\n2. Inserting test video at status=EDITED…');
    const { data: video, error: iErr } = await supabase
      .from('videos')
      .insert({
        campus_id: CAMPUS_ID,
        clickup_task_id: TASK_ID,
        title: TEST_TITLE,
        status: 'EDITED',
        dropbox_folder: DROPBOX_BASE,
      })
      .select('*')
      .single();
    if (iErr) throw new Error(`Insert failed: ${iErr.message}`);
    videoId = video.id;
    console.log(`   [OK] videoId=${videoId} clickup_task_id=${TASK_ID}`);

    console.log('\n3. Calling pipeline.triggerQA…');
    const { passed, report } = await pipeline.triggerQA(TASK_ID, CAMPUS_ID);
    console.log(`   QA result: passed=${passed}, totalIssues=${report?.totalIssues ?? 'n/a'}`);

    console.log('\n4. Assertions:');

    // A. Video status must NOT have flipped to WAITING — THE KEY ASSERTION
    const { data: after } = await supabase
      .from('videos')
      .select('status, qa_passed')
      .eq('id', videoId)
      .single();
    console.log(`   videos.status after triggerQA: ${after.status}`);
    if (after.status === 'EDITED') {
      console.log('   [PASS] status stayed at EDITED (advisory behavior)');
    } else {
      console.log(`   [FAIL] status flipped to ${after.status} — auto-flip regressed`);
      failures++;
    }

    // B. qa_passed=false written by qa.runQA
    console.log(`   videos.qa_passed: ${after.qa_passed}`);
    if (after.qa_passed === false) {
      console.log('   [PASS] qa_passed=false persisted');
    } else {
      console.log(`   [FAIL] qa_passed=${after.qa_passed}, expected false`);
      failures++;
    }

    // C. QA report posted to ClickUp comments
    if (addCommentCall) {
      console.log(`   [PASS] clickup.addComment called (${addCommentCall.textLength} chars)`);
    } else {
      console.log('   [FAIL] clickup.addComment was NOT called — report not posted');
      failures++;
    }

    // D. clickup.updateTask must NOT have been called by triggerQA
    if (updateTaskCalls.length === 0) {
      console.log('   [PASS] clickup.updateTask not called — no auto-flip to waiting');
    } else {
      console.log(`   [FAIL] clickup.updateTask called ${updateTaskCalls.length}× — auto-flip regressed`);
      for (const c of updateTaskCalls) console.log(`     - ${JSON.stringify(c)}`);
      failures++;
    }

    // E. qa_gate_blocked log row exists
    const { data: logs } = await supabase
      .from('agent_logs')
      .select('action, payload')
      .eq('agent_name', 'pipeline')
      .eq('action', 'qa_gate_blocked')
      .filter('payload->>taskId', 'eq', TASK_ID)
      .limit(1);
    if (logs && logs.length > 0) {
      console.log(`   [PASS] agent_logs.qa_gate_blocked row exists: ${JSON.stringify(logs[0].payload)}`);
    } else {
      console.log('   [FAIL] no qa_gate_blocked row in agent_logs');
      failures++;
    }

    console.log('');
    if (failures === 0) {
      console.log('=== ALL ASSERTIONS PASSED — QA is advisory, status stays at EDITED ===');
    } else {
      console.log(`=== ${failures} ASSERTION(S) FAILED ===`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`\n[ERROR] ${err.message}`);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    // Restore stubs
    clickup.addComment = origAddComment;
    clickup.updateTask = origUpdateTask;

    console.log('\n--- Cleanup ---');
    if (videoId) {
      await supabase.from('videos').delete().eq('id', videoId);
      console.log('   Deleted test video');
    }
    if (dropboxCreated) {
      const ok = await deleteDropboxFolder(DROPBOX_BASE);
      console.log(`   Dropbox cleanup: ${ok ? 'OK' : 'failed'}`);
    }
  }
}

run();
