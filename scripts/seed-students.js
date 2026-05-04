#!/usr/bin/env node
/**
 * Seed Austin student rows for accounts that already have published
 * content but never came through the onboarding flow. Backfilled
 * `videos` rows (Session 21) carry their `student_name` but
 * `student_id = null`, so per-student dashboard rollups don't surface
 * them.
 *
 * After insert, this script also patches existing `videos` rows by
 * exact `student_name` match scoped to `student_id IS NULL` so it never
 * overwrites a student_id already set elsewhere (e.g., by the pipeline).
 *
 * Brand accounts: Alpha High is the school's own social presence — it
 * publishes through the same pipeline but has no human owner. It carries
 * `is_brand_account = true` and the school's TikTok / Instagram handles
 * (alphahigh.school) so the future profile-views agent
 * (`workflows/profile-views.md`) can scrape it alongside the human
 * students.
 *
 * Both the insert (skip-on-exists by name) and the videos update (only
 * fills NULL) are idempotent.
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');

const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';

const STUDENTS = [
  { name: 'Jackson Price' },
  { name: 'Cruce Sanders' },
  { name: 'Reuben Runacres' },
  { name: 'Maddie Price' },
  { name: 'Geetesh Parelly' },
  { name: 'Stella Grams' },
  { name: 'Austin Way' },
  {
    name: 'Alpha High',
    handle_tiktok: 'alphahigh.school',
    handle_instagram: 'alphahigh.school',
    is_brand_account: true,
  },
];

const STUDENT_NAMES = STUDENTS.map((s) => s.name);

async function seedStudents() {
  const inserted = [];
  const skipped = [];

  for (const student of STUDENTS) {
    const { data: existing } = await supabase
      .from('students')
      .select('id, name')
      .eq('campus_id', AUSTIN_CAMPUS_ID)
      .eq('name', student.name)
      .maybeSingle();

    if (existing) {
      skipped.push({ id: existing.id, name: existing.name });
      console.log(`  SKIP: ${student.name} (already exists, id: ${existing.id})`);
      continue;
    }

    const row = { campus_id: AUSTIN_CAMPUS_ID, ...student };

    const { data, error } = await supabase
      .from('students')
      .insert(row)
      .select('id, name, is_brand_account')
      .single();

    if (error) {
      console.error(`  FAIL: ${student.name} — ${error.message}`);
      throw new Error(`students insert failed for "${student.name}": ${error.message}`);
    }
    inserted.push(data);
    const tag = data.is_brand_account ? ' [brand]' : '';
    console.log(`  OK:   ${data.name}${tag} — id: ${data.id}`);
  }

  return { inserted, skipped };
}

/**
 * For each seeded (or pre-existing) student, link any backfilled videos
 * that match by `student_name` and currently have `student_id = null`.
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
  console.log(`Seeding ${STUDENTS.length} students for Austin campus...\n`);
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

module.exports = { run, STUDENTS, STUDENT_NAMES };
