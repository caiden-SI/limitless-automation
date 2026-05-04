#!/usr/bin/env node
/**
 * Content Performance Tracker → `performance` table sync.
 *
 * Reads a multi-tab Google Sheet where each per-student tab holds one row
 * per posted video and one column per weekly bucket of view counts. For
 * each row, resolves the public post URL to a `videos.id` and upserts one
 * `performance` row per non-empty weekly bucket.
 *
 * Sheet layout (per "Content Performance Tracker (1).xlsx"):
 *   Tab "ALL"          — account-level rollup (skipped by this sync).
 *   Tab "<Student>"    — header row (Platform, Post Link, "1/1/-2/6",
 *                         "2/6-2/13", ...), then one data row per video.
 *
 * Required env:
 *   PERFORMANCE_TRACKER_SHEET_ID    — Google Sheets file ID
 *   PERFORMANCE_TRACKER_CAMPUS_ID   — campus_id all rows attribute to
 *   GOOGLE_CALENDAR_CREDENTIALS_PATH — service account JSON (Viewer on the
 *                                     sheet; same one used by lib/gcal.js)
 *
 * Optional env:
 *   PERFORMANCE_TRACKER_TABS — CSV of tabs to sync. Default: every tab
 *     except `ALL`.
 *   PERFORMANCE_TRACKER_YEAR — calendar year for the M/D headers. Default:
 *     current year.
 *   PERFORMANCE_TRACKER_DRY_RUN=true — print what would be written without
 *     touching Supabase. Equivalent to passing --dry-run.
 *
 * Schema preconditions (run scripts/migrations/2026-05-04-videos-post-url.sql
 * once before the first real sync):
 *   - `videos.post_url text` exists.
 *   - `performance` has UNIQUE (video_id, platform, week_of) so the
 *     idempotent upsert resolves.
 *
 * Until `videos.post_url` is populated for posted videos, every tracker row
 * will report unmatched. The script prints unmatched URLs at the end so the
 * backfill is mechanical: paste each into the matching `videos` row's
 * `post_url`, re-run the sync.
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { listTabs, getSheetValues } = require('../lib/google');
const { log } = require('../lib/logger');

const AGENT_NAME = 'performance-tracker-sync';

// Tabs that exist in the spreadsheet but are not per-student per-video.
// "ALL" is the account-level rollup that lives in `videos` views, not in
// the `performance` table.
const NON_STUDENT_TABS = new Set(['ALL']);

const PLATFORM_MAP = {
  tiktok: 'tiktok',
  instagram: 'instagram',
  youtube: 'youtube',
  twitter: 'twitter',
  x: 'twitter',
  facebook: 'facebook',
};

/**
 * Normalize the Platform cell ("TikTok", "Instagram", "X") into the
 * lowercase identifier used by `performance.platform` and `research_library`.
 */
function normalizePlatform(s) {
  if (!s) return null;
  const k = String(s).toLowerCase().trim();
  return PLATFORM_MAP[k] || k.replace(/\s+/g, '');
}

/**
 * Strip query strings, fragments, and trailing slashes; lowercase host.
 * Tracker rows often carry `?is_from_webapp=1&sender_device=pc&web_id=...`
 * suffixes that vary per share. Two URLs that point at the same post must
 * canonicalize identically so the lookup against `videos.post_url` is stable.
 */
function canonicalizeUrl(url) {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.search = '';
    u.hash = '';
    let s = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
    return s.replace(/\/+$/, '');
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

/**
 * Parse a weekly-bucket header into the start date as YYYY-MM-DD.
 *
 * Accepted forms (observed in the tracker):
 *   "2/6-2/13"     → start "2/6"
 *   "2/27-3/6"     → start "2/27"
 *   "1/1/-2/6"     → start "1/1" (extra slash collapsed)
 *   "2/27-3/6\t"   → trailing whitespace tolerated
 *
 * Rejected forms (returns null — caller skips the column):
 *   "?-2/6"        → unattributable baseline; the tracker uses this for the
 *                    pre-tracking lump sum and we cannot pin it to a Monday.
 *
 * @param {string} header
 * @param {number} year - the calendar year these M/D pairs belong to
 * @returns {string|null} YYYY-MM-DD start of the bucket, or null
 */
function parseWeekHeader(header, year) {
  if (!header) return null;
  // Strip whitespace and collapse runs of `/` so "1/1//-2/6" parses normally.
  // The trailing-slash form "1/1/-2/6" is handled by the optional `/?` in the
  // regex below — collapsing alone doesn't catch a lone slash before `-`.
  const cleaned = String(header).replace(/\s+/g, '').replace(/\/{2,}/g, '/');
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/?-/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Find the index of the row whose first two cells are "Platform" and
 * "Post Link" (case-insensitive). Per-student tabs put the header at row
 * 2 or 3 depending on whether row 2 is empty.
 *
 * @param {Array<Array<any>>} rows
 * @returns {number} 0-based index, or -1 if not found
 */
function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 8);
  for (let i = 0; i < limit; i++) {
    const r = rows[i] || [];
    const a = String(r[0] || '').toLowerCase().trim();
    const b = String(r[1] || '').toLowerCase().trim();
    if (a === 'platform' && b.includes('post link')) return i;
  }
  return -1;
}

/**
 * Build a map of canonicalUrl → video record for every video in the campus
 * that has a `post_url` set. The script later does in-memory lookups
 * against this index — one query, many resolutions.
 */
async function loadVideoUrlIndex(campusId) {
  const { data, error } = await supabase
    .from('videos')
    .select('id, post_url, student_id, student_name, title')
    .eq('campus_id', campusId)
    .not('post_url', 'is', null);
  if (error) {
    // Surface a clear error if `post_url` does not exist yet — this is the
    // single most common first-run failure mode.
    if (/post_url/i.test(error.message)) {
      throw new Error(
        'videos.post_url column does not exist. ' +
          'Run scripts/migrations/2026-05-04-videos-post-url.sql in the Supabase SQL Editor first.'
      );
    }
    throw new Error(`videos query failed: ${error.message}`);
  }
  const index = new Map();
  for (const v of data || []) {
    const c = canonicalizeUrl(v.post_url);
    if (c) index.set(c, v);
  }
  return index;
}

/**
 * Sync one tab.
 * @returns {Promise<{tab:string, dataRows:number, matched:number, written:number, unmatched:Array, skipped?:string}>}
 */
async function syncTab({ tabName, sheetId, year, campusId, videoIndex, dryRun }) {
  // A1 range escapes a single-quoted tab title by doubling internal quotes.
  const escaped = tabName.replace(/'/g, "''");
  const range = `'${escaped}'!A1:Z2000`;

  const rows = await getSheetValues(sheetId, range);
  const result = { tab: tabName, dataRows: 0, matched: 0, written: 0, unmatched: [] };

  if (!rows || rows.length === 0) {
    result.skipped = 'tab is empty';
    return result;
  }

  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    result.skipped = 'no Platform/Post Link header row found';
    return result;
  }

  const header = rows[headerIdx];
  // Columns 0,1 are Platform + Post Link; columns 2..N are weekly buckets.
  const weekDates = header.slice(2).map((h) => parseWeekHeader(h, year));

  const upserts = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const platformRaw = row[0];
    const linkRaw = row[1];
    if (!platformRaw || !linkRaw) continue;

    result.dataRows++;
    const platform = normalizePlatform(platformRaw);
    const canon = canonicalizeUrl(linkRaw);
    const video = canon ? videoIndex.get(canon) : null;

    if (!video) {
      result.unmatched.push({ tab: tabName, platform, url: String(linkRaw) });
      continue;
    }
    result.matched++;

    for (let c = 2; c < row.length; c++) {
      const week = weekDates[c - 2];
      if (!week) continue; // unparseable header (e.g. "?-2/6") or trailing blank
      const v = row[c];
      if (v === null || v === undefined || v === '') continue;
      const n = Number(v);
      // Skip non-numeric markers like "combined above". Negative views are
      // impossible — treat as a tracker typo and skip.
      if (!Number.isFinite(n) || n < 0) continue;
      upserts.push({
        campus_id: campusId,
        video_id: video.id,
        platform,
        view_count: Math.round(n),
        week_of: week,
      });
    }
  }

  if (upserts.length === 0) return result;

  // Dedupe by the conflict key. The tracker occasionally repeats a weekly
  // header (observed: Reuben Runacres tab has "4/16-4/23" twice), which
  // would otherwise produce two upserts with the same (video_id, platform,
  // week_of) in one statement and trip Postgres's "ON CONFLICT DO UPDATE
  // command cannot affect row a second time" error. Last write wins —
  // duplicated columns hold equal snapshots in observed data, and even
  // when they diverge, the rightmost column is the most recently filled.
  const deduped = new Map();
  for (const u of upserts) {
    deduped.set(`${u.video_id}|${u.platform}|${u.week_of}`, u);
  }
  const finalUpserts = [...deduped.values()];
  result.collapsedDupKeys = upserts.length - finalUpserts.length;

  if (dryRun) {
    result.written = finalUpserts.length;
    return result;
  }

  // Upsert in chunks; PostgREST's single-request payload limit is generous
  // but we keep chunks small so a single tab failure doesn't lose progress
  // from earlier chunks in the same tab.
  const CHUNK = 500;
  for (let i = 0; i < finalUpserts.length; i += CHUNK) {
    const chunk = finalUpserts.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('performance')
      .upsert(chunk, { onConflict: 'video_id,platform,week_of' });
    if (error) throw new Error(`performance upsert failed: ${error.message}`);
    result.written += chunk.length;
  }
  return result;
}

async function run() {
  const sheetId = process.env.PERFORMANCE_TRACKER_SHEET_ID;
  const campusId = process.env.PERFORMANCE_TRACKER_CAMPUS_ID;
  const yearEnv = process.env.PERFORMANCE_TRACKER_YEAR;
  const year = yearEnv ? parseInt(yearEnv, 10) : new Date().getFullYear();
  const dryRun =
    String(process.env.PERFORMANCE_TRACKER_DRY_RUN || '').toLowerCase() === 'true' ||
    process.argv.includes('--dry-run');

  if (!sheetId) throw new Error('PERFORMANCE_TRACKER_SHEET_ID is required in .env');
  if (!campusId) throw new Error('PERFORMANCE_TRACKER_CAMPUS_ID is required in .env');

  const explicitTabs = (process.env.PERFORMANCE_TRACKER_TABS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const tabs =
    explicitTabs.length > 0
      ? explicitTabs
      : (await listTabs(sheetId)).filter((t) => !NON_STUDENT_TABS.has(t));

  console.log(`[sync] sheet=${sheetId} campus=${campusId} year=${year} dry_run=${dryRun}`);
  console.log(`[sync] tabs (${tabs.length}): ${tabs.join(', ')}`);

  const videoIndex = await loadVideoUrlIndex(campusId);
  console.log(`[sync] indexed ${videoIndex.size} videos with post_url set\n`);

  const allUnmatched = [];
  let totalMatched = 0;
  let totalWritten = 0;
  let totalDataRows = 0;

  for (const tab of tabs) {
    try {
      const r = await syncTab({ tabName: tab, sheetId, year, campusId, videoIndex, dryRun });
      const skip = r.skipped ? ` [skipped: ${r.skipped}]` : '';
      console.log(
        `[sync] ${tab.padEnd(20)} rows=${String(r.dataRows).padStart(3)} ` +
          `matched=${String(r.matched).padStart(3)} written=${String(r.written).padStart(4)}${skip}`
      );
      totalDataRows += r.dataRows;
      totalMatched += r.matched;
      totalWritten += r.written;
      allUnmatched.push(...r.unmatched);
    } catch (err) {
      console.error(`[sync] ${tab} FAILED: ${err.message}`);
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'tab_failed',
        status: 'error',
        errorMessage: err.message,
        payload: { tab },
      });
    }
  }

  if (allUnmatched.length > 0) {
    console.log(
      `\n[sync] UNMATCHED (${allUnmatched.length}) — these post URLs are not in any videos.post_url for this campus:`
    );
    for (const u of allUnmatched) {
      console.log(`  ${u.tab.padEnd(20)} ${(u.platform || '').padEnd(10)} ${u.url}`);
    }
    console.log(
      `\n  Backfill: paste each URL into the matching videos row's post_url ` +
        `(or set it when an editor marks the video as posted), then re-run.`
    );
  }

  await log({
    campusId,
    agent: AGENT_NAME,
    action: dryRun ? 'sync_dry_run_complete' : 'sync_complete',
    payload: {
      tabs: tabs.length,
      dataRows: totalDataRows,
      matched: totalMatched,
      written: totalWritten,
      unmatched: allUnmatched.length,
    },
  });

  console.log(
    `\n[sync] DONE  rows=${totalDataRows}  matched=${totalMatched}  ` +
      `written=${totalWritten}  unmatched=${allUnmatched.length}  dry_run=${dryRun}`
  );
}

if (require.main === module) {
  run().catch((err) => {
    console.error(`[sync] FATAL: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = {
  run,
  parseWeekHeader,
  canonicalizeUrl,
  normalizePlatform,
  findHeaderRow,
};
