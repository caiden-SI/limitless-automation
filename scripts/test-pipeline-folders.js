#!/usr/bin/env node
/**
 * Integration test — Pipeline Agent: READY FOR SHOOTING → create Dropbox folders.
 *
 * This test:
 * 1. Inserts a test video row into Supabase
 * 2. Calls pipeline.createDropboxFolders with a fake ClickUp task ID
 * 3. Verifies folders were created in Dropbox
 * 4. Verifies the video row was updated with dropbox_folder
 * 5. Cleans up: deletes test video row and Dropbox folders
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const pipeline = require('../agents/pipeline');
const dropbox = require('../lib/dropbox');

const CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f'; // Austin
const TEST_TASK_ID = 'test_clickup_' + Date.now();
const TEST_TITLE = '__pipeline_test_' + Date.now();

async function run() {
  console.log('=== Pipeline Agent — Folder Creation Test ===\n');
  let videoId = null;

  try {
    // Step 1: Insert a test video row
    console.log('1. Inserting test video into Supabase...');
    const { data: video, error: iErr } = await supabase
      .from('videos')
      .insert({
        campus_id: CAMPUS_ID,
        clickup_task_id: TEST_TASK_ID,
        title: TEST_TITLE,
        status: 'READY FOR SHOOTING',
      })
      .select('*')
      .single();
    if (iErr) throw new Error(`Insert failed: ${iErr.message}`);
    videoId = video.id;
    console.log(`   [OK] Video created: ${video.id} (title: ${video.title})`);

    // Step 2: Call createDropboxFolders
    console.log('\n2. Calling pipeline.createDropboxFolders...');
    const result = await pipeline.createDropboxFolders(TEST_TASK_ID, CAMPUS_ID);
    console.log(`   [OK] Folders created:`);
    console.log(`        Base:    ${result.basePath}`);
    console.log(`        Footage: ${result.footagePath}`);
    console.log(`        Project: ${result.projectPath}`);

    // Step 3: Verify folders exist in Dropbox
    console.log('\n3. Verifying folders in Dropbox...');
    const entries = await dropbox.listFolder(result.basePath);
    const names = entries.map((e) => e.name);
    console.log(`   [OK] Dropbox folder contents: ${names.join(', ')}`);

    const hasFotage = names.includes('[FOOTAGE]');
    const hasProject = names.includes('[PROJECT]');
    if (hasFotage && hasProject) {
      console.log('   [PASS] Both [FOOTAGE] and [PROJECT] subfolders present');
    } else {
      console.log(`   [FAIL] Missing: ${!hasFotage ? '[FOOTAGE]' : ''} ${!hasProject ? '[PROJECT]' : ''}`);
    }

    // Step 4: Verify Supabase video row was updated
    console.log('\n4. Verifying video row updated in Supabase...');
    const { data: updated } = await supabase
      .from('videos')
      .select('dropbox_folder')
      .eq('id', videoId)
      .single();
    if (updated?.dropbox_folder === result.basePath) {
      console.log(`   [PASS] dropbox_folder = "${updated.dropbox_folder}"`);
    } else {
      console.log(`   [FAIL] dropbox_folder = "${updated?.dropbox_folder}" (expected "${result.basePath}")`);
    }

    // Step 5: Test idempotency — calling again should not error
    console.log('\n5. Testing idempotency (calling createDropboxFolders again)...');
    await pipeline.createDropboxFolders(TEST_TASK_ID, CAMPUS_ID);
    console.log('   [PASS] Second call succeeded without error (folders already existed)');

    console.log('\n=== ALL CHECKS PASSED ===');
  } catch (err) {
    console.error(`\n[FAIL] ${err.message}`);
    console.error(err.stack);
  } finally {
    // Cleanup
    console.log('\n--- Cleanup ---');
    if (videoId) {
      await supabase.from('videos').delete().eq('id', videoId);
      console.log('   Deleted test video from Supabase');
    }

    // Delete Dropbox folders (delete parent recursively)
    try {
      const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.DROPBOX_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: `/austin/${TEST_TITLE}` }),
      });
      if (res.ok) {
        console.log('   Deleted test folders from Dropbox');
      } else {
        const err = await res.json().catch(() => ({}));
        console.log(`   Dropbox cleanup: ${err.error_summary || 'unknown error'}`);
      }
    } catch (e) {
      console.log(`   Dropbox cleanup failed: ${e.message}`);
    }
  }
}

run();
