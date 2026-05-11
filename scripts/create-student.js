#!/usr/bin/env node
/**
 * Create a new student row in Supabase and print the onboarding URL
 * ready to share. Replaces the manual three-step flow of (1) inserting
 * a row in the Supabase UI, (2) copying the generated UUID, (3)
 * composing the URL by hand.
 *
 * Usage:
 *   node scripts/create-student.js \
 *     --name "Sarah Johnson" \
 *     --tt sarahjohnson \
 *     --ig sarah.johnson \
 *     --campus austin
 *
 * Flags:
 *   --name      (required) Student's full name. Used by Scripting's
 *               calendar matcher, so it must exactly match how the name
 *               appears on filming events.
 *   --tt        (optional) TikTok handle without the @ prefix.
 *   --ig        (optional) Instagram handle without the @ prefix.
 *   --campus    (optional) Campus slug. Defaults to "austin". Resolved
 *               to a UUID by querying the campuses table.
 *   --base-url  (optional) Public dashboard URL for composing the
 *               onboarding URL. Defaults to PUBLIC_DASHBOARD_URL env
 *               var, then to the production tunnel URL.
 *
 * Exits 0 on success and prints the onboarding URL on the last line
 * (so you can pipe to `pbcopy` if you want).
 */

require('dotenv').config();
const { supabase } = require('../lib/supabase');

const KNOWN_CAMPUS_SLUGS = {
  austin: '0ba4268f-f010-43c5-906c-41509bc9612f',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function usage() {
  console.error('Usage: node scripts/create-student.js --name "Full Name" [--tt handle] [--ig handle] [--campus austin]');
  console.error('');
  console.error('Required: --name');
  console.error('Optional: --tt, --ig, --campus (default: austin), --base-url');
  process.exit(1);
}

async function resolveCampusId(campusInput) {
  // If it looks like a UUID, use it directly.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campusInput)) {
    return campusInput;
  }

  // Check known slug shortcuts first.
  const lower = campusInput.toLowerCase();
  if (KNOWN_CAMPUS_SLUGS[lower]) return KNOWN_CAMPUS_SLUGS[lower];

  // Fall back to a Supabase lookup by name (case-insensitive).
  const { data, error } = await supabase
    .from('campuses')
    .select('id, name')
    .ilike('name', `%${campusInput}%`)
    .limit(2);

  if (error) throw new Error(`campuses query failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`No campus found matching "${campusInput}". Add it via Supabase or pass a UUID directly.`);
  }
  if (data.length > 1) {
    throw new Error(`Multiple campuses match "${campusInput}": ${data.map((c) => c.name).join(', ')}. Be more specific or pass a UUID.`);
  }
  return data[0].id;
}

function normalizeHandle(h) {
  if (!h || typeof h !== 'string') return null;
  return h.trim().replace(/^@/, '');
}

(async () => {
  const args = parseArgs(process.argv);
  if (!args.name || args.name === true) usage();

  const name = String(args.name).trim();
  const tiktok = normalizeHandle(args.tt);
  const instagram = normalizeHandle(args.ig);
  const campusInput = args.campus || 'austin';

  const baseUrl =
    args['base-url'] ||
    process.env.PUBLIC_DASHBOARD_URL ||
    'https://limitless-automations-mac-mini.tailnet.ts.net';

  const campusId = await resolveCampusId(campusInput);
  console.log(`Campus: ${campusInput} → ${campusId}`);
  console.log(`Name:    ${name}`);
  console.log(`TikTok:  ${tiktok || '(none)'}`);
  console.log(`Insta:   ${instagram || '(none)'}`);
  console.log('');

  // Duplicate-name guard. Scripting's parseStudentFromEvent matches by
  // whole-word name match, so two students with the same name in the
  // same campus would always trigger an "ambiguous" rejection.
  const { data: existing, error: dupErr } = await supabase
    .from('students')
    .select('id, name')
    .eq('campus_id', campusId)
    .ilike('name', name);

  if (dupErr) throw new Error(`duplicate-check query failed: ${dupErr.message}`);
  if (existing && existing.length > 0) {
    console.error(`Student named "${name}" already exists in this campus (id ${existing[0].id}).`);
    console.error('Use a distinguishing suffix or middle name to avoid Scripting matcher collisions.');
    process.exit(2);
  }

  // Insert.
  const insertRow = {
    campus_id: campusId,
    name,
  };
  if (tiktok) insertRow.handle_tiktok = tiktok;
  if (instagram) insertRow.handle_instagram = instagram;

  const { data: inserted, error: insErr } = await supabase
    .from('students')
    .insert(insertRow)
    .select('id, name, handle_tiktok, handle_instagram, campus_id')
    .single();

  if (insErr) throw new Error(`students insert failed: ${insErr.message}`);

  console.log('Created:');
  console.log(`  id:       ${inserted.id}`);
  console.log(`  name:     ${inserted.name}`);
  console.log(`  tiktok:   ${inserted.handle_tiktok || '(none)'}`);
  console.log(`  insta:    ${inserted.handle_instagram || '(none)'}`);
  console.log('');

  const onboardUrl = `${baseUrl.replace(/\/$/, '')}/onboard?student=${inserted.id}&campus=${inserted.campus_id}`;

  console.log('Onboarding URL (send to student):');
  console.log(onboardUrl);

  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(3);
});
