#!/usr/bin/env node
/**
 * One-off recovery: synthesize anchor rows from the Content Performance
 * Tracker's historic weekly columns.
 *
 * Why this exists: the rebuild's first agent run left ~74 URLs as fresh
 * anchors (weekly_delta = 0) because the broken May 8 run only captured
 * priors for 31 of the 120 tracked URLs. Without a prior cumulative, the
 * agent has nothing to delta against, so the next push to the sheet's
 * 5/8-5/15 column lands as 0 for those 74 — visible to Scott as missing
 * data.
 *
 * Spec: docs/recovery-anchor-backfill-spec.md.
 *
 * Per-tab logic, for each non-Twitter (Platform, Post Link) row:
 *   1. Sum the integer values across every weekly column whose END date
 *      is before 2026-05-08 (i.e., everything Scott has filled in for
 *      completed weeks before the agent's current bucket).
 *   2. Look up the matching `videos.id` via `post_url_<platform>`.
 *   3. UPSERT a `performance` row at week_of='2026-05-01' with
 *      source='sheet_synth' and view_count = the sum.
 *
 * The agent's prior-cumulative lookup includes 'sheet_synth' (see
 * agents/profile-views.js), so the next run finds these anchors as the
 * delta basis for those 74 URLs.
 *
 * Idempotent via ON CONFLICT (video_id, platform, week_of) DO UPDATE.
 *
 * Usage:
 *   node scripts/backfill-anchors-from-sheet.js
 *   node scripts/backfill-anchors-from-sheet.js <campus_uuid>
 */

require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const { getSheets } = require('../lib/google');
const { canonicalizePostUrl, detectPlatformFromUrl } = require('../tools/scraper');

const AGENT_NAME = 'anchor-backfill';
const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const ANCHOR_WEEK_OF = '2026-05-01';
const ANCHOR_SOURCE = 'sheet_synth';

// Skip any column whose END date is at-or-after this Friday. The agent's
// `mostRecentFriday()` returns 2026-05-08 for runs in the week of May 11,
// so the agent's "current" bucket is `5/8-5/15`. Summing only completed
// columns (those ending strictly before 5/8) gives us the cumulative as of
// the start of that bucket — exactly what we want as the prior basis.
const CUTOFF_YEAR = 2026;
const CUTOFF_MONTH = 5;
const CUTOFF_DAY = 8;
const CUTOFF_DATE = new Date(Date.UTC(CUTOFF_YEAR, CUTOFF_MONTH - 1, CUTOFF_DAY));

const STUDENT_TABS = [
  'Alpha High',
  'Alex Mathews',
  'Austin Way',
  'Cruce Sanders',
  'Geetesh Parelly',
  'Jackson Price',
  'Maddie Price',
  'Reuben Runacres',
  'Stella Grams',
];

const PLATFORM_COLUMN = {
  tiktok: 'post_url_tiktok',
  instagram: 'post_url_instagram',
  youtube: 'post_url_youtube',
};

function getSheetId() {
  const id = process.env.GOOGLE_SHEET_ID_CONTENT_TRACKER;
  if (!id) throw new Error('GOOGLE_SHEET_ID_CONTENT_TRACKER not set in .env');
  return id;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const a = String(rows[i]?.[0] || '').toLowerCase().trim();
    if (a === 'platform') return i;
  }
  return -1;
}

/**
 * Parse the END date of a "M/D-M/D" weekly header into a UTC Date for
 * comparison against CUTOFF_DATE.
 *
 * Handles the irregular forms observed in the tracker:
 *   "1/1/-2/6"   → end = 2/6 (the extra slash before the dash is collapsed)
 *   "2/27-3/6\t" → end = 3/6 (trailing whitespace trimmed)
 *   "?-2/6"      → null (unparseable; caller skips)
 *
 * Year is hardcoded to CUTOFF_YEAR; the only spread observed in the
 * tracker is within a single calendar year (no Dec/Jan wraparounds in
 * the data we're summing).
 */
function parseEndDate(header) {
  if (!header) return null;
  const cleaned = String(header).trim().replace(/\s+/g, '').replace(/\/{2,}/g, '/');
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/?-(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const endMonth = parseInt(m[3], 10);
  const endDay = parseInt(m[4], 10);
  if (endMonth < 1 || endMonth > 12 || endDay < 1 || endDay > 31) return null;
  return new Date(Date.UTC(CUTOFF_YEAR, endMonth - 1, endDay));
}

/**
 * Build a map: post_url_<platform> canonical → video.id, for fast lookup.
 * One query per campus, then in-memory matching.
 */
async function loadVideoIndex(campusId) {
  const { data, error } = await supabase
    .from('videos')
    .select('id, post_url_tiktok, post_url_instagram, post_url_youtube')
    .eq('campus_id', campusId);
  if (error) throw new Error(`videos query failed: ${error.message}`);
  const index = { tiktok: new Map(), instagram: new Map(), youtube: new Map() };
  for (const v of data || []) {
    if (v.post_url_tiktok) {
      const c = canonicalizePostUrl(v.post_url_tiktok, 'tiktok');
      if (c && !index.tiktok.has(c)) index.tiktok.set(c, v.id);
    }
    if (v.post_url_instagram) {
      const c = canonicalizePostUrl(v.post_url_instagram, 'instagram');
      if (c && !index.instagram.has(c)) index.instagram.set(c, v.id);
    }
    if (v.post_url_youtube) {
      const c = canonicalizePostUrl(v.post_url_youtube, 'youtube');
      if (c && !index.youtube.has(c)) index.youtube.set(c, v.id);
    }
  }
  return index;
}

async function processTab({ sheets, sheetId, tabName, videoIndex, campusId }) {
  const escaped = tabName.replace(/'/g, "''");
  const range = `'${escaped}'!A1:ZZ500`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values || [];

  const tabResult = {
    tab: tabName,
    rowsRead: 0,
    anchored: 0,
    unmatched: 0,
    twitterSkipped: 0,
    nonIntegerCells: 0,
    skippedColumns: 0,
    includedColumns: 0,
  };

  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    console.warn(`[backfill] ${tabName}: no Platform header — skipped`);
    return tabResult;
  }
  const header = rows[headerIdx] || [];

  // Pre-compute which weekly columns to sum. Columns 0,1 are
  // Platform/Post Link; weekly columns start at column 2.
  const includeCol = new Array(header.length).fill(false);
  for (let c = 2; c < header.length; c++) {
    const end = parseEndDate(header[c]);
    if (end && end < CUTOFF_DATE) {
      includeCol[c] = true;
      tabResult.includedColumns++;
    } else {
      tabResult.skippedColumns++;
    }
  }

  const upserts = [];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const platformLabel = String(row[0] || '').trim();
    const urlRaw = String(row[1] || '').trim();
    if (!platformLabel || !urlRaw) continue;
    tabResult.rowsRead++;

    const platform = detectPlatformFromUrl(urlRaw);
    if (platform === 'twitter') {
      tabResult.twitterSkipped++;
      continue;
    }
    if (!platform || !PLATFORM_COLUMN[platform]) {
      tabResult.unmatched++;
      continue;
    }

    const canonical = canonicalizePostUrl(urlRaw, platform);
    if (!canonical) {
      tabResult.unmatched++;
      continue;
    }

    const videoId = videoIndex[platform].get(canonical);
    if (!videoId) {
      tabResult.unmatched++;
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'anchor_unmatched_url',
        status: 'warning',
        payload: { tab: tabName, platform, url: canonical },
      });
      continue;
    }

    let sum = 0;
    for (let c = 2; c < header.length; c++) {
      if (!includeCol[c]) continue;
      const v = row[c];
      if (v == null || v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        tabResult.nonIntegerCells++;
        continue;
      }
      sum += Math.round(n);
    }

    upserts.push({
      campus_id: campusId,
      video_id: videoId,
      platform,
      view_count: Math.max(0, sum),
      week_of: ANCHOR_WEEK_OF,
      source: ANCHOR_SOURCE,
    });
    tabResult.anchored++;
  }

  if (upserts.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < upserts.length; i += CHUNK) {
      const chunk = upserts.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('performance')
        .upsert(chunk, { onConflict: 'video_id,platform,week_of' });
      if (error) throw new Error(`${tabName}: anchor upsert failed: ${error.message}`);
    }
  }

  return tabResult;
}

async function run(campusId) {
  const sheetId = getSheetId();
  const sheets = getSheets({ readWrite: false });
  console.log(
    `[backfill] sheet=${sheetId.slice(0, 12)}... campus=${campusId} ` +
      `anchor_week_of=${ANCHOR_WEEK_OF} cutoff=${CUTOFF_DATE.toISOString().slice(0, 10)}`
  );

  const videoIndex = await loadVideoIndex(campusId);
  console.log(
    `[backfill] indexed videos by per-platform URL: ` +
      `tiktok=${videoIndex.tiktok.size} ` +
      `instagram=${videoIndex.instagram.size} ` +
      `youtube=${videoIndex.youtube.size}`
  );

  const totals = {
    tabs: 0,
    rowsRead: 0,
    anchored: 0,
    unmatched: 0,
    twitterSkipped: 0,
    nonIntegerCells: 0,
  };
  const perTab = [];

  for (const tab of STUDENT_TABS) {
    try {
      const r = await processTab({ sheets, sheetId, tabName: tab, videoIndex, campusId });
      perTab.push(r);
      totals.tabs++;
      totals.rowsRead += r.rowsRead;
      totals.anchored += r.anchored;
      totals.unmatched += r.unmatched;
      totals.twitterSkipped += r.twitterSkipped;
      totals.nonIntegerCells += r.nonIntegerCells;
      console.log(
        `[backfill] ${tab.padEnd(20)} rows=${String(r.rowsRead).padStart(3)} ` +
          `anchored=${String(r.anchored).padStart(3)} unmatched=${r.unmatched} ` +
          `twitter=${r.twitterSkipped} cols(in/skip)=${r.includedColumns}/${r.skippedColumns}`
      );
    } catch (err) {
      console.error(`[backfill] ${tab} FAILED: ${err.message}`);
    }
  }

  console.log(
    `\n[backfill] DONE  tabs=${totals.tabs}  rowsRead=${totals.rowsRead}  ` +
      `anchored=${totals.anchored}  unmatched=${totals.unmatched}  ` +
      `twitter=${totals.twitterSkipped}  nonInteger=${totals.nonIntegerCells}`
  );

  await log({
    campusId,
    agent: AGENT_NAME,
    action: 'anchor_backfill_complete',
    payload: totals,
  });

  return totals;
}

if (require.main === module) {
  const campusId = process.argv[2] || AUSTIN_CAMPUS_ID;
  run(campusId)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[backfill] FATAL: ${err.message}`);
      if (err.stack) console.error(err.stack);
      process.exit(1);
    });
}

module.exports = { run, parseEndDate, processTab, loadVideoIndex };
