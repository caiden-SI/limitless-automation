#!/usr/bin/env node
/**
 * Create a new student row in Supabase and print the onboarding URL
 * ready to share. CLI wrapper around lib/students.createStudent — the
 * /admin/students/create HTTP route uses the same helper.
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
 *   --tt        (optional) TikTok handle (leading @ stripped if present).
 *   --ig        (optional) Instagram handle (leading @ stripped if present).
 *   --campus    (optional) Campus slug. Defaults to "austin". Resolved
 *               to a UUID by querying the campuses table.
 *
 * Exits 0 on success and prints the onboarding URL on the last line
 * (so you can pipe to `pbcopy` if you want).
 *
 * PUBLIC_DASHBOARD_URL must be set in .env — the helper throws if it
 * isn't, on purpose. No placeholder fallback.
 */

require('dotenv').config();

const {
  DuplicateStudentNameError,
  resolveCampusId,
  normalizeHandle,
  createStudent,
} = require('../lib/students');

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
  console.error('Optional: --tt, --ig, --campus (default: austin)');
  process.exit(1);
}

(async () => {
  const args = parseArgs(process.argv);
  if (!args.name || args.name === true) usage();

  const name = String(args.name).trim();
  const tiktok = normalizeHandle(args.tt);
  const instagram = normalizeHandle(args.ig);
  const campusInput = args.campus || 'austin';

  const campusId = await resolveCampusId(campusInput);
  console.log(`Campus: ${campusInput} → ${campusId}`);
  console.log(`Name:    ${name}`);
  console.log(`TikTok:  ${tiktok || '(none)'}`);
  console.log(`Insta:   ${instagram || '(none)'}`);
  console.log('');

  const { studentId, name: createdName, url } = await createStudent({
    name,
    tiktokHandle: tiktok,
    instagramHandle: instagram,
    campusId,
  });

  console.log('Created:');
  console.log(`  id:       ${studentId}`);
  console.log(`  name:     ${createdName}`);
  console.log(`  tiktok:   ${tiktok || '(none)'}`);
  console.log(`  insta:    ${instagram || '(none)'}`);
  console.log('');
  console.log('Onboarding URL (send to student):');
  console.log(url);

  process.exit(0);
})().catch((err) => {
  if (err instanceof DuplicateStudentNameError) {
    console.error(`Student named "${err.message.match(/"([^"]+)"/)?.[1] || ''}" already exists on this campus.`);
    console.error(`Existing student id: ${err.existingStudentId}`);
    console.error(`Existing onboarding URL:`);
    console.error(err.existingUrl);
    console.error('');
    console.error('Use a distinguishing suffix or middle name to avoid Scripting matcher collisions.');
    process.exit(2);
  }
  console.error('ERROR:', err.message);
  process.exit(3);
});
