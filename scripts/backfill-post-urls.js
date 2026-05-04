#!/usr/bin/env node
/**
 * Backfill `videos` rows for posts that predate the pipeline.
 *
 * Reads `scripts/unmatched-urls.txt` (produced by a dry run of
 * `scripts/sync-performance-tracker.js`) and inserts one `videos` row per
 * URL with `post_url` set so the next sync resolves cleanly.
 *
 * Source line format (whitespace-padded, 3 columns):
 *   "  StudentName   platform   https://url"
 *
 * Per-row logic:
 *   - Canonicalize URL (strip query/hash/trailing slash) — same rule as
 *     sync-performance-tracker.js so lookups match.
 *   - Match `student_name` to `students.name` for the campus. Null is
 *     accepted (brand accounts like "Alpha High" are not students; other
 *     pre-pipeline students may simply not be seeded yet).
 *   - Title placeholder: "{handle} - {Platform}" where handle is extracted
 *     from the URL (TikTok @handle, X handle, IG/YouTube post slug).
 *   - Status: 'POSTED BY CLIENT' via `dbStatus('posted by client')`.
 *
 * Idempotency: pre-loads existing canonical post_urls in this campus and
 * skips matches in-app, equivalent to upsert behavior. The migration's
 * `videos_post_url_idx` is non-unique (a partial unique would be needed
 * for a true ON CONFLICT upsert), so this pre-query pattern is the right
 * shape — re-running the script never duplicates rows.
 *
 * Usage: node scripts/backfill-post-urls.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');

const AGENT_NAME = 'backfill-post-urls';
const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const URL_FILE = path.resolve(__dirname, 'unmatched-urls.txt');

// Mirror of pipeline.js dbStatus — one-liner, not worth a circular import.
const dbStatus = (s) => s.toUpperCase();

// Display casing for the title placeholder. Tracker rows use lowercase
// platform tokens; the title looks better with conventional casing.
const PLATFORM_DISPLAY = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  twitter: 'X',
  x: 'X',
  facebook: 'Facebook',
};

/**
 * Strip query string, fragment, trailing slash; lowercase host.
 * Identical canonicalization to sync-performance-tracker.js so the same
 * URL produces the same key on both sides.
 */
function canonicalizeUrl(url) {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.search = '';
    u.hash = '';
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

/**
 * Pull the most distinctive identifier out of the URL for the title placeholder.
 * Per platform:
 *   tiktok    → @handle (without leading @)
 *   x/twitter → handle from /<handle>/status/...
 *   instagram → post slug from /reel/<id> or /p/<id> (no handle in URL)
 *   youtube   → video id from /shorts/<id>
 * Falls back to null; caller substitutes a slug of the student name.
 */
function extractHandle(platform, url) {
  try {
    const u = new URL(url);
    const p = u.pathname;
    if (platform === 'tiktok') {
      const m = p.match(/^\/@([^/]+)/);
      if (m) return m[1];
    } else if (platform === 'twitter' || platform === 'x') {
      const m = p.match(/^\/([^/]+)\/(?:status|photo)/);
      if (m) return m[1];
    } else if (platform === 'instagram') {
      const m = p.match(/^\/(?:reel|p)\/([^/]+)/);
      if (m) return m[1];
    } else if (platform === 'youtube') {
      const m = p.match(/^\/shorts\/([^/]+)/);
      if (m) return m[1];
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Parse a single line from unmatched-urls.txt.
 * The file is space-padded with multi-space gaps between columns; the
 * student name itself can contain a single internal space ("Alex Mathews",
 * "Alpha High"), so splitting on 2+ whitespace gives a clean 3-column split.
 *
 * @returns {{studentName: string, platform: string, url: string} | null}
 */
function parseLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s{2,}/);
  if (parts.length < 3) return null;
  const [studentName, platformRaw, url] = parts;
  return {
    studentName: studentName.trim(),
    platform: platformRaw.trim().toLowerCase(),
    url: url.trim(),
  };
}

async function loadStudentMap(campusId) {
  const { data, error } = await supabase
    .from('students')
    .select('id, name')
    .eq('campus_id', campusId);
  if (error) throw new Error(`students query failed: ${error.message}`);
  const m = new Map();
  for (const s of data || []) m.set(s.name, s.id);
  return m;
}

async function loadExistingPostUrls(campusId) {
  const { data, error } = await supabase
    .from('videos')
    .select('post_url')
    .eq('campus_id', campusId)
    .not('post_url', 'is', null);
  if (error) throw new Error(`videos query failed: ${error.message}`);
  const set = new Set();
  for (const v of data || []) {
    const c = canonicalizeUrl(v.post_url);
    if (c) set.add(c);
  }
  return set;
}

async function run() {
  if (!fs.existsSync(URL_FILE)) {
    throw new Error(
      `File not found: ${URL_FILE}. Run \`node scripts/sync-performance-tracker.js --dry-run\` first.`
    );
  }

  const text = fs.readFileSync(URL_FILE, 'utf8');
  const lines = text.split('\n');

  console.log(`[backfill] reading ${lines.length} lines from ${URL_FILE}`);

  const [studentMap, existing] = await Promise.all([
    loadStudentMap(AUSTIN_CAMPUS_ID),
    loadExistingPostUrls(AUSTIN_CAMPUS_ID),
  ]);

  console.log(
    `[backfill] indexed ${studentMap.size} students, ${existing.size} existing post_urls in this campus\n`
  );

  let skippedParse = 0;
  let skippedExisting = 0;
  const unmatchedStudents = new Set();
  const matchedStudents = new Set();
  const rows = [];
  const seenInBatch = new Set();

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const parsed = parseLine(raw);
    if (!parsed) {
      skippedParse++;
      console.warn(`[backfill] SKIP (parse) ${raw}`);
      continue;
    }
    const { studentName, platform, url } = parsed;
    const canon = canonicalizeUrl(url);
    if (!canon) {
      skippedParse++;
      console.warn(`[backfill] SKIP (bad url) ${url}`);
      continue;
    }

    if (existing.has(canon) || seenInBatch.has(canon)) {
      skippedExisting++;
      continue;
    }
    seenInBatch.add(canon);

    const studentId = studentMap.get(studentName) || null;
    if (studentId) {
      matchedStudents.add(studentName);
    } else {
      unmatchedStudents.add(studentName);
    }

    const handle =
      extractHandle(platform, url) || studentName.toLowerCase().replace(/\s+/g, '-');
    const platformDisplay = PLATFORM_DISPLAY[platform] || platform;
    const title = `${handle} - ${platformDisplay}`;

    rows.push({
      campus_id: AUSTIN_CAMPUS_ID,
      student_id: studentId,
      student_name: studentName,
      title,
      post_url: canon,
      status: dbStatus('posted by client'),
    });
  }

  console.log(
    `[backfill] prepared ${rows.length} rows; skipped ${skippedExisting} (already exist) + ${skippedParse} (unparseable)`
  );
  if (matchedStudents.size > 0) {
    console.log(`[backfill] matched students (${matchedStudents.size}): ${[...matchedStudents].join(', ')}`);
  }
  if (unmatchedStudents.size > 0) {
    console.log(
      `[backfill] no student match (${unmatchedStudents.size}, student_id=null): ${[...unmatchedStudents].join(', ')}`
    );
  }

  let inserted = 0;
  let errors = 0;
  if (rows.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from('videos').insert(chunk);
      if (error) {
        errors += chunk.length;
        console.error(`[backfill] chunk ${i}-${i + chunk.length} insert failed: ${error.message}`);
      } else {
        inserted += chunk.length;
      }
    }
  }

  await log({
    campusId: AUSTIN_CAMPUS_ID,
    agent: AGENT_NAME,
    action: 'backfill_complete',
    status: errors > 0 ? 'warning' : 'success',
    payload: {
      inserted,
      skippedExisting,
      skippedParse,
      errors,
      matchedStudents: [...matchedStudents],
      unmatchedStudents: [...unmatchedStudents],
    },
  });

  console.log(
    `\n[backfill] DONE  inserted=${inserted}  skipped=${skippedExisting}  unparseable=${skippedParse}  errors=${errors}`
  );
}

if (require.main === module) {
  run().catch((err) => {
    console.error(`[backfill] FATAL: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { run, parseLine, canonicalizeUrl, extractHandle };
