#!/usr/bin/env node
/**
 * Seed editors table for Austin campus.
 * Confirmed by Scott on 2026-04-03.
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');

const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';

const EDITORS = [
  {
    campus_id: AUSTIN_CAMPUS_ID,
    name: 'Charles Williams',
    clickup_user_id: '95229910',
    email: 'charles@limitlessyt.com',
    active: true,
  },
  {
    campus_id: AUSTIN_CAMPUS_ID,
    name: 'Tipra',
    clickup_user_id: '95272148',
    email: 'arpitv.tip@gmail.com',
    active: true,
  },
];

async function run() {
  console.log('Seeding editors for Austin campus...\n');

  for (const editor of EDITORS) {
    // Check if editor already exists by email
    const { data: existing } = await supabase
      .from('editors')
      .select('id, name, email')
      .eq('email', editor.email)
      .maybeSingle();

    if (existing) {
      console.log(`  SKIP: ${existing.name} (${existing.email}) — already exists (id: ${existing.id})`);
      continue;
    }

    const { data, error } = await supabase
      .from('editors')
      .insert(editor)
      .select('id, name, email')
      .single();

    if (error) {
      console.error(`  FAIL: ${editor.name} — ${error.message}`);
    } else {
      console.log(`  OK: ${data.name} (${data.email}) — id: ${data.id}`);
    }
  }

  console.log('\nDone.');
}

run();
