#!/usr/bin/env node
/**
 * Fix 13 verification — when the [PROJECT] folder exists but is empty
 * (editor hasn't uploaded final video + .srt yet), QA must treat the
 * run as SKIPPED rather than FAILED:
 *   - videos.qa_passed = NULL (not false)
 *   - exactly one short ClickUp comment (no multi-issue report)
 *   - agent_logs row: qa_skipped_preconditions (status=warning)
 *   - NO qa_failed row
 *   - NO qa_gate_blocked row from pipeline.triggerQA
 *   - NO status flip on the videos row
 *
 * Sister to test-qa-advisory.js, which covers the real-quality-failure
 * path (broken SRT present). This one covers the no-files-yet path.
 */
require('dotenv').config();

const { supabase } = require('../lib/supabase');
const clickup = require('../lib/clickup');
const dropbox = require('../lib/dropbox');
const pipeline = require('../agents/pipeline');

const CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const TEST_TITLE = '__qa_preconditions_' + Date.now();
const DROPBOX_BASE = `/austin/${TEST_TITLE}`;
const TASK_ID = 'test_qa_preconditions_' + Date.now();

let freshToken = null;

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
  console.log('=== QA Preconditions — Fix 13 Verification ===\n');

  const origAddComment = clickup.addComment;
  const origUpdateTask = clickup.updateTask;
  let addCommentCalls = [];
  let updateTaskCalls = [];
  clickup.addComment = async (taskId, text) => {
    addCommentCalls.push({ taskId, textLength: text.length, text });
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

    console.log('\n1. Creating Dropbox folders with EMPTY [PROJECT]…');
    await dropbox.createFolder(DROPBOX_BASE);
    await dropbox.createFolder(`${DROPBOX_BASE}/[FOOTAGE]`);
    await dropbox.createFolder(`${DROPBOX_BASE}/[PROJECT]`);
    dropboxCreated = true;
    console.log('   [OK] [PROJECT] exists but no .srt or video file');

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
    console.log(`   QA result: passed=${passed} report.skipped=${report?.skipped}`);

    console.log('\n4. Assertions:');

    // A. qa_passed=null on the videos row
    const { data: after } = await supabase
      .from('videos')
      .select('status, qa_passed')
      .eq('id', videoId)
      .single();
    console.log(`   videos.qa_passed: ${after.qa_passed}`);
    if (after.qa_passed === null) {
      console.log('   [PASS] qa_passed=NULL (skipped, not failed)');
    } else {
      console.log(`   [FAIL] qa_passed=${after.qa_passed}, expected null`);
      failures++;
    }

    // B. status did not flip
    if (after.status === 'EDITED') {
      console.log('   [PASS] videos.status stayed at EDITED');
    } else {
      console.log(`   [FAIL] videos.status flipped to ${after.status}`);
      failures++;
    }

    // C. Exactly one ClickUp comment, short, mentions [PROJECT]
    if (addCommentCalls.length === 1) {
      const c = addCommentCalls[0];
      if (c.text.includes('[PROJECT]') && c.text.toLowerCase().includes('skipped')) {
        console.log(`   [PASS] one short ClickUp comment (${c.textLength} chars)`);
      } else {
        console.log(`   [FAIL] unexpected comment body: ${c.text.slice(0, 120)}…`);
        failures++;
      }
    } else {
      console.log(`   [FAIL] expected 1 ClickUp comment, got ${addCommentCalls.length}`);
      failures++;
    }

    // D. clickup.updateTask must NOT have been called
    if (updateTaskCalls.length === 0) {
      console.log('   [PASS] clickup.updateTask not called');
    } else {
      console.log(`   [FAIL] clickup.updateTask called ${updateTaskCalls.length}×`);
      failures++;
    }

    // E. agent_logs has qa_skipped_preconditions for this videoId
    const { data: skipLogs } = await supabase
      .from('agent_logs')
      .select('action, status, payload')
      .eq('agent_name', 'qa')
      .eq('action', 'qa_skipped_preconditions')
      .filter('payload->>videoId', 'eq', videoId)
      .limit(1);
    if (skipLogs && skipLogs.length > 0) {
      console.log(`   [PASS] qa_skipped_preconditions row exists (status=${skipLogs[0].status})`);
    } else {
      console.log('   [FAIL] no qa_skipped_preconditions row in agent_logs');
      failures++;
    }

    // F. NO qa_failed log row
    const { data: failLogs } = await supabase
      .from('agent_logs')
      .select('id')
      .eq('agent_name', 'qa')
      .eq('action', 'qa_failed')
      .filter('payload->>videoId', 'eq', videoId)
      .limit(1);
    if (!failLogs || failLogs.length === 0) {
      console.log('   [PASS] no qa_failed row in agent_logs');
    } else {
      console.log('   [FAIL] qa_failed row written — preconditions misclassified as failure');
      failures++;
    }

    // G. NO qa_gate_blocked log from pipeline.triggerQA
    const { data: blockedLogs } = await supabase
      .from('agent_logs')
      .select('id')
      .eq('agent_name', 'pipeline')
      .eq('action', 'qa_gate_blocked')
      .filter('payload->>taskId', 'eq', TASK_ID)
      .limit(1);
    if (!blockedLogs || blockedLogs.length === 0) {
      console.log('   [PASS] no qa_gate_blocked row from pipeline.triggerQA');
    } else {
      console.log('   [FAIL] pipeline logged qa_gate_blocked for a skipped run');
      failures++;
    }

    console.log('');
    if (failures === 0) {
      console.log('=== ALL ASSERTIONS PASSED — preconditions-missing is now SKIPPED, not FAILED ===');
    } else {
      console.log(`=== ${failures} ASSERTION(S) FAILED ===`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`\n[ERROR] ${err.message}`);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    clickup.addComment = origAddComment;
    clickup.updateTask = origUpdateTask;

    console.log('\n--- Cleanup ---');
    if (videoId) {
      await supabase.from('videos').delete().eq('id', videoId);
      console.log('   Deleted test video');
    }
    if (dropboxCreated && freshToken) {
      const ok = await deleteDropboxFolder(DROPBOX_BASE);
      console.log(`   Dropbox cleanup: ${ok ? 'OK' : 'failed'}`);
    }
  }
}

run();
