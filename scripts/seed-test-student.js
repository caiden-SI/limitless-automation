#!/usr/bin/env node
// Seed a test student row for onboarding flow testing.
// Usage: node scripts/seed-test-student.js

require('dotenv').config();
const { supabase } = require('../lib/supabase');

const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';

async function run() {
  console.log('Seeding test student for Austin campus...\n');

  // Check if already exists
  const { data: existing } = await supabase
    .from('students')
    .select('id, name')
    .eq('campus_id', AUSTIN_CAMPUS_ID)
    .eq('name', 'Alex Mathews')
    .maybeSingle();

  if (existing) {
    console.log(`  Already exists: ${existing.name} — id: ${existing.id}`);
    printUrl(existing.id);
    return;
  }

  const { data: student, error } = await supabase
    .from('students')
    .insert({
      campus_id: AUSTIN_CAMPUS_ID,
      name: 'Alex Mathews',
    })
    .select('id, name')
    .single();

  if (error) {
    console.error('  Insert failed:', error.message);
    process.exit(1);
  }

  console.log(`  Created: ${student.name} — id: ${student.id}`);
  printUrl(student.id);
}

function printUrl(studentId) {
  console.log('\n=== Onboarding URL ===\n');
  console.log(`  http://localhost:5173/onboard?student=${studentId}&campus=${AUSTIN_CAMPUS_ID}`);
  console.log();
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
