#!/usr/bin/env node
/**
 * Seed the 7 Austin students who already have published content but
 * never came through the onboarding flow. Backfilled videos rows
 * (Session 21) carry their `student_name` but `student_id = null`,
 * so per-student dashboard rollups don't surface them.
 *
 * After insert, this script also patches existing `videos` rows by
 * matching `student_name` and filling `student_id`. Idempotent — both
 * the student insert (skip-on-exists by name) and the videos update
 * (only fills NULL) are safe to re-run.
 *
 * "Alpha High" is intentionally excluded — it's a brand account, not a
 * student. Its videos legitimately stay at `student_id = null`.
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');

const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';

const STUDENT_NAMES = [
  'Jackson Price',
  'Cruce Sanders',
  'Reuben Runacres',
  'Maddie Price',
  'Geetesh Parelly',
  'Stella Grams',
  'Austin Way',
];

async function seedStudents() {
  const inserted = [];
  const skipped = [];

  for (const name of STUDENT_NAMES) {
    const { data: existing } = await supabase
      .from('students')
      .select('id, name')
      .eq('campus_id', AUSTIN_CAMPUS_ID)
      .eq('name', name)
      .maybeSingle();

    if (existing) {
      skipped.push({ id: existing.id, name: existing.name });
      console.log(`  SKIP: ${name} (already exists, id: ${existing.id})`);
      continue;
    }

    const { data, error } = await supabase
      .from('students')
      .insert({ campus_id: AUSTIN_CAMPUS_ID, name })
      .select('id, name')
      .single();

    if (error) {
      console.error(`  FAIL: ${name} — ${error.message}`);
      throw new Error(`students insert failed for "${name}": ${error.message}`);
    }
    inserted.push(data);
    console.log(`  OK:   ${data.name} — id: ${data.id}`);
  }

  return { inserted, skipped };
}

/**
 * For each seeded (or pre-existing) student, link any backfilled videos
 * that match by `student_name` and currently have `student_id = null`.
 *
 * Why scoped to NULL: never overwrite a student_id already set elsewhere
 * (e.g., by the pipeline). The match is exact-name, campus-scoped.
 */
async function linkVideos() {
  const { data: students, error: sErr } = await supabase
    .from('students')
    .select('id, name')
    .eq('campus_id', AUSTIN_CAMPUS_ID)
    .in('name', STUDENT_NAMES);
  if (sErr) throw new Error(`students lookup failed: ${sErr.message}`);

  const totals = { matched: 0, byStudent: {} };

  for (const s of students || []) {
    const { data, error } = await supabase
      .from('videos')
      .update({ student_id: s.id, updated_at: new Date().toISOString() })
      .eq('campus_id', AUSTIN_CAMPUS_ID)
      .eq('student_name', s.name)
      .is('student_id', null)
      .select('id');
    if (error) throw new Error(`videos update failed for "${s.name}": ${error.message}`);

    const n = data?.length || 0;
    totals.matched += n;
    totals.byStudent[s.name] = n;
    console.log(`  ${s.name.padEnd(20)} videos linked: ${n}`);
  }

  return totals;
}

async function run() {
  console.log(`Seeding ${STUDENT_NAMES.length} students for Austin campus...\n`);
  const { inserted, skipped } = await seedStudents();
  console.log(`\n  inserted: ${inserted.length}, skipped: ${skipped.length}`);

  console.log(`\nLinking backfilled videos by student_name...\n`);
  const totals = await linkVideos();
  console.log(`\n  total videos linked: ${totals.matched}`);

  console.log(`\nDone.`);
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Fatal:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { run, STUDENT_NAMES };
