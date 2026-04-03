#!/usr/bin/env node
/**
 * Verify ClickUp API access and retrieve custom field IDs.
 *
 * 1. GET tasks from Austin list (901707767654)
 * 2. GET a single task by ID
 * 3. GET custom fields — find Frame.io link field ID
 */

require('dotenv').config();

const clickup = require('../lib/clickup');

const AUSTIN_LIST_ID = '901707767654';

async function run() {
  console.log('=== ClickUp API Verification ===\n');

  // Step 1: Fetch tasks from Austin list
  console.log('1. Fetching tasks from list', AUSTIN_LIST_ID, '...');
  const { tasks } = await clickup.getTasks(AUSTIN_LIST_ID, { page: 0 });
  console.log(`   [OK] ${tasks.length} task(s) returned`);
  if (tasks.length > 0) {
    console.log(`   First task: "${tasks[0].name}" (id: ${tasks[0].id}, status: ${tasks[0].status?.status})`);
  }

  // Step 2: Fetch a single task
  if (tasks.length > 0) {
    const taskId = tasks[0].id;
    console.log(`\n2. Fetching single task ${taskId} ...`);
    const task = await clickup.getTask(taskId);
    console.log(`   [OK] Task: "${task.name}"`);
    console.log(`   Status: ${task.status?.status}`);
    console.log(`   Assignees: ${task.assignees?.map((a) => `${a.username} (${a.id})`).join(', ') || 'none'}`);
    console.log(`   List: ${task.list?.name} (${task.list?.id})`);

    // Show all custom field values on this task
    if (task.custom_fields?.length) {
      console.log(`   Custom fields on task:`);
      for (const f of task.custom_fields) {
        const val = f.value !== undefined && f.value !== null ? JSON.stringify(f.value) : '(empty)';
        console.log(`     - "${f.name}" [${f.type}] id=${f.id} value=${val}`);
      }
    }
  }

  // Step 3: Retrieve custom fields for the list
  console.log(`\n3. Fetching custom fields for list ${AUSTIN_LIST_ID} ...`);
  const fields = await clickup.getCustomFields(AUSTIN_LIST_ID);
  console.log(`   [OK] ${fields.length} custom field(s):`);

  let frameioFieldId = null;
  for (const f of fields) {
    console.log(`   - "${f.name}" [${f.type}] id=${f.id}`);
    // Look for Frame.io link field by name (case-insensitive partial match)
    if (f.name.toLowerCase().includes('frame') || f.name.toLowerCase().includes('link')) {
      frameioFieldId = f.id;
      console.log(`     ^^^ Likely Frame.io link field`);
    }
  }

  if (frameioFieldId) {
    console.log(`\n   Frame.io link field ID: ${frameioFieldId}`);
    console.log(`   Add to .env: CLICKUP_FRAMEIO_FIELD_ID=${frameioFieldId}`);
  } else {
    console.log(`\n   [NOTE] No obvious Frame.io link field found. Check field names above.`);
  }

  // Show all statuses from tasks
  const statuses = [...new Set(tasks.map((t) => t.status?.status).filter(Boolean))];
  console.log(`\n4. Statuses seen across ${tasks.length} tasks: ${statuses.join(', ') || '(none)'}`);

  console.log('\n=== Verification Complete ===');
}

run().catch((err) => {
  console.error(`\n[FAIL] ${err.message}`);
  process.exit(1);
});
