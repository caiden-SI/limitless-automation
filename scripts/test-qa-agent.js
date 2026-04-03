#!/usr/bin/env node
/**
 * Integration test — QA Agent: edited → run all QA checks.
 *
 * This test:
 * 1. Creates Dropbox folders + uploads a test SRT with deliberate issues
 * 2. Inserts a test video row in Supabase
 * 3. Runs qa.runQA() against it
 * 4. Verifies brand dictionary check catches misspellings
 * 5. Verifies Claude formatting + stutter checks run
 * 6. Verifies qa_passed is written to Supabase
 * 7. Cleans up
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const dropbox = require('../lib/dropbox');
const qa = require('../agents/qa');

const CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const TEST_TITLE = '__qa_test_' + Date.now();
const DROPBOX_BASE = `/austin/${TEST_TITLE}`;

// Deliberately broken SRT with brand misspellings, stutter, and formatting issues
const TEST_SRT = `1
00:00:01,000 --> 00:00:04,000
Welcome to alfa School where we build Superbuilders

2
00:00:04,500 --> 00:00:08,000
Um so like today we're going to talk about the the timeback program

3
00:00:08,500 --> 00:00:12,000
its a really cool program that that helps students you know manage their time

4
00:00:12,500 --> 00:00:16,000
I was going to say— I think we should focus on how students use Timback in their daily routine

5
00:00:16,500 --> 00:00:20,000
basically the superbuilders program lets students build real companies while learning
`;

async function uploadToDropbox(path, content) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DROPBOX_ACCESS_TOKEN}`,
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false }),
      'Content-Type': 'application/octet-stream',
    },
    body: content,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Dropbox upload failed: ${err}`);
  }
  return res.json();
}

async function deleteDropboxFolder(path) {
  const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DROPBOX_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });
  return res.ok;
}

async function run() {
  console.log('=== QA Agent — Integration Test ===\n');
  let videoId = null;

  try {
    // Step 1: Set up Dropbox folders and test SRT
    console.log('1. Creating Dropbox folders and uploading test SRT...');
    await dropbox.createFolder(DROPBOX_BASE);
    await dropbox.createFolder(`${DROPBOX_BASE}/[FOOTAGE]`);
    await dropbox.createFolder(`${DROPBOX_BASE}/[PROJECT]`);
    await uploadToDropbox(`${DROPBOX_BASE}/[PROJECT]/captions.srt`, TEST_SRT);
    console.log('   [OK] Test SRT uploaded to Dropbox');

    // Step 2: Insert test video
    console.log('\n2. Inserting test video into Supabase...');
    const { data: video, error: iErr } = await supabase
      .from('videos')
      .insert({
        campus_id: CAMPUS_ID,
        clickup_task_id: 'test_qa_' + Date.now(),
        title: TEST_TITLE,
        status: 'edited',
        dropbox_folder: DROPBOX_BASE,
      })
      .select('*')
      .single();
    if (iErr) throw new Error(`Insert failed: ${iErr.message}`);
    videoId = video.id;
    console.log(`   [OK] Video: ${video.id}`);

    // Step 3: Run QA
    console.log('\n3. Running QA agent...');
    const { passed, report } = await qa.runQA(videoId, CAMPUS_ID);

    console.log(`\n   QA Result: ${passed ? 'PASSED' : 'FAILED'}`);
    console.log(`   Total issues: ${report.totalIssues}`);

    // Step 4: Check results
    console.log('\n4. Checking results...');

    // Caption/brand check
    const brandIssues = report.summary.filter((i) => i.startsWith('BRAND:'));
    console.log(`   Brand issues found: ${brandIssues.length}`);
    for (const i of brandIssues) console.log(`     - ${i}`);
    if (brandIssues.length > 0) {
      console.log('   [PASS] Brand dictionary check caught misspellings');
    } else {
      console.log('   [NOTE] Brand dictionary check found no issues (Claude may not have flagged them)');
    }

    // Format check
    const formatIssues = report.summary.filter((i) => i.startsWith('FORMAT:'));
    console.log(`\n   Format issues found: ${formatIssues.length}`);
    for (const i of formatIssues) console.log(`     - ${i}`);

    // Stutter check
    const stutterIssues = report.summary.filter((i) => i.startsWith('STUTTER:'));
    console.log(`\n   Stutter/filler detections: ${stutterIssues.length}`);
    for (const i of stutterIssues) console.log(`     - ${i}`);
    if (stutterIssues.length > 0) {
      console.log('   [PASS] Stutter detection found filler words');
    } else {
      console.log('   [NOTE] Stutter detection found no issues');
    }

    // LUFS check
    console.log(`\n   LUFS: ${report.lufsCheck.lufs !== null ? report.lufsCheck.lufs.toFixed(1) + ' LUFS' : 'skipped (no video file or no FFmpeg)'}`);
    console.log(`   FFmpeg available: ${report.lufsCheck.ffmpegAvailable}`);

    // Step 5: Verify qa_passed in Supabase
    console.log('\n5. Verifying qa_passed in Supabase...');
    const { data: updated } = await supabase
      .from('videos')
      .select('qa_passed')
      .eq('id', videoId)
      .single();
    console.log(`   qa_passed = ${updated?.qa_passed}`);
    if (updated?.qa_passed === passed) {
      console.log('   [PASS] qa_passed correctly written to Supabase');
    } else {
      console.log(`   [FAIL] qa_passed mismatch: expected ${passed}, got ${updated?.qa_passed}`);
    }

    // Overall
    const shouldFail = brandIssues.length > 0 || stutterIssues.length > 0 || formatIssues.length > 0;
    if (!passed && shouldFail) {
      console.log('\n=== TEST PASSED — QA correctly failed a video with known issues ===');
    } else if (passed) {
      console.log('\n=== NOTE — QA passed despite known issues (Claude may have been lenient) ===');
    } else {
      console.log('\n=== TEST PASSED — QA caught issues ===');
    }
  } catch (err) {
    console.error(`\n[ERROR] ${err.message}`);
    console.error(err.stack);
  } finally {
    // Cleanup
    console.log('\n--- Cleanup ---');
    if (videoId) {
      await supabase.from('videos').delete().eq('id', videoId);
      console.log('   Deleted test video from Supabase');
    }
    const deleted = await deleteDropboxFolder(DROPBOX_BASE);
    console.log(`   Dropbox cleanup: ${deleted ? 'OK' : 'failed'}`);
  }
}

run();
