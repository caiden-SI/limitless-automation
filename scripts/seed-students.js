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

// Source of truth for the Austin student roster.
// Handles populated from the Content Performance Tracker (per-student tab
// post URLs revealed the @handles for TikTok and the username paths for
// X/YouTube). Instagram /p/ post URLs do not expose a handle; those were
// filled from external knowledge — Geetesh, Reuben, Stella, Maddie, and
// Austin Way (austinway_, corrected from the unconfirmed "austinway").
const STUDENTS = [
  { name: 'Alex Mathews',    handle_tiktok: 'berryaiplushies', handle_instagram: 'berryaiplushies' },
  { name: 'Jackson Price',   handle_tiktok: 'llimepcrepair1',  handle_instagram: 'llimecrepair' },
  { name: 'Cruce Sanders',   handle_tiktok: 'cruce.saunders',  handle_instagram: 'cruce_sanders' },
  { name: 'Reuben Runacres',                                   handle_instagram: 'reubenrunacres' },
  { name: 'Maddie Price',    handle_tiktok: '355themusical',   handle_instagram: '355themusical' },
  { name: 'Geetesh Parelly',                                   handle_instagram: 'geetesh.flowly' },
  { name: 'Stella Grams',    handle_tiktok: 'stella_makes_bank', handle_instagram: 'stellamakesbank' },
  { name: 'Austin Way',                                        handle_instagram: 'austinway_' },
  {
    name: 'Alpha High',
    handle_tiktok: 'alphahigh.school',
    handle_instagram: 'alphahigh.school',
    is_brand_account: true,
  },
];

// Fields whose values get filled on existing rows when the live row is
// NULL. Existing non-null values are never overwritten — if the live
// value differs, the script logs a skip so the operator can reconcile.
const FILLABLE_FIELDS = ['handle_tiktok', 'handle_instagram', 'handle_youtube', 'is_brand_account'];

const STUDENT_NAMES = STUDENTS.map((s) => s.name);

async function seedStudents() {
  const inserted = [];
  const filled = [];
  const noChange = [];
  const conflicts = [];

  for (const student of STUDENTS) {
    const selectCols = ['id', 'name', ...FILLABLE_FIELDS].join(', ');
    const { data: existing } = await supabase
      .from('students')
      .select(selectCols)
      .eq('campus_id', AUSTIN_CAMPUS_ID)
      .eq('name', student.name)
      .maybeSingle();

    if (!existing) {
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
      console.log(`  INS:  ${data.name}${tag} — id: ${data.id}`);
      continue;
    }

    // Existing row — diff fillable fields. Fill where live is NULL,
    // skip where live has a non-null value that differs from the seed.
    const patch = {};
    const conflictsForRow = [];
    for (const field of FILLABLE_FIELDS) {
      if (!(field in student)) continue;
      const seedVal = student[field];
      const liveVal = existing[field];
      if (liveVal === null || liveVal === undefined) {
        patch[field] = seedVal;
      } else if (liveVal !== seedVal) {
        conflictsForRow.push({ field, liveVal, seedVal });
      }
      // else liveVal === seedVal → no-op
    }

    if (conflictsForRow.length > 0) {
      conflicts.push({ name: student.name, fields: conflictsForRow });
      const summary = conflictsForRow.map((c) => `${c.field}: live="${c.liveVal}" seed="${c.seedVal}"`).join(', ');
      console.log(`  WARN: ${student.name} (${existing.id}) field conflicts — ${summary}`);
    }

    if (Object.keys(patch).length === 0) {
      noChange.push({ id: existing.id, name: existing.name });
      console.log(`  SAME: ${student.name} (${existing.id}) — no fillable fields differ`);
      continue;
    }

    const { error: uErr } = await supabase
      .from('students')
      .update(patch)
      .eq('id', existing.id);
    if (uErr) throw new Error(`students update failed for "${student.name}": ${uErr.message}`);

    filled.push({ id: existing.id, name: existing.name, patch });
    const summary = Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`  FILL: ${student.name} (${existing.id}) — ${summary}`);
  }

  return { inserted, filled, noChange, conflicts };
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
  console.log(`Reconciling ${STUDENTS.length} students for Austin campus...\n`);
  const { inserted, filled, noChange, conflicts } = await seedStudents();
  console.log(
    `\n  inserted: ${inserted.length}, filled: ${filled.length}, no-change: ${noChange.length}, conflicts: ${conflicts.length}`
  );

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
