// Sheet sync tool — two-way bridge between the Content Performance Tracker
// (Google Sheet) and Supabase.
//
// Direction 1 — pullNewUrlsFromSheet:
//   For each per-student tab, scan column B for post URLs not yet tracked
//   in `videos.post_url_<platform>`. Either backfill the column on an
//   existing row (preferred) or insert a new row. Replaces the lost
//   Frame.io v4 "new post detection" path until OAuth is restored.
//
// Direction 2 — pushDeltasToSheet:
//   Pull the latest `performance.weekly_delta` rows out of Supabase, write
//   them into the matching weekly column on each per-student tab, and
//   compute the (student × platform) sums for the ALL tab.
//
// Both directions use the same Google service account as `lib/gcal.js`,
// requested with the writable `spreadsheets` scope (configured in
// `lib/google.getSheets({ readWrite: true })`). The Profile Views Agent
// run() flow calls Direction 1 BEFORE scraping (so new URLs are scraped
// in the same run) and Direction 2 AFTER scraping completes.
//
// Failure semantics: both directions surface fatal errors via thrown
// exceptions; the agent wraps each in a try/catch that logs a warning and
// keeps the run going. A sheet outage must never block the scrape from
// landing in the performance table.

const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const { getSheets } = require('../lib/google');
const { canonicalizePostUrl, detectPlatformFromUrl } = require('./scraper');

const AGENT_NAME = 'sheet-sync';

// Per-platform column on the videos table. Twitter has no column —
// pullNewUrlsFromSheet logs and skips Twitter rows; pushDeltasToSheet
// reads it from the ALL tab as zero (the column stays manual until a
// view-count actor exists).
const PLATFORM_COLUMN = {
  tiktok: 'post_url_tiktok',
  instagram: 'post_url_instagram',
  youtube: 'post_url_youtube',
};

// Tabs that are NOT per-student per-post. ALL is the rollup; pull-direction
// skips it entirely.
const NON_STUDENT_TABS = new Set(['ALL']);

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

function getSheetId() {
  const id = process.env.GOOGLE_SHEET_ID_CONTENT_TRACKER;
  if (!id) throw new Error('GOOGLE_SHEET_ID_CONTENT_TRACKER not set in .env');
  return id;
}

// ── Generic helpers ────────────────────────────────────────────────────────

/**
 * Locate the header row by scanning the first 8 rows for cell A == "Platform".
 * Per-student tabs have the header at row 2 or 3 depending on whether row 2
 * is empty. The ALL tab has a different header shape (Student in column A);
 * call findAllTabHeader for that one instead.
 */
function findStudentTabHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const a = String(rows[i]?.[0] || '').toLowerCase().trim();
    if (a === 'platform') return i;
  }
  return -1;
}

function findAllTabHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const a = String(rows[i]?.[0] || '').toLowerCase().trim();
    if (a === 'student') return i;
  }
  return -1;
}

/**
 * Render a YYYY-MM-DD date (Friday = start of bucket) into the sheet's
 * `M/D-M/D` weekly column header. The end date is the next Friday
 * (start + 7 days), matching the existing tracker convention.
 */
function formatWeekHeader(weekOf) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) {
    throw new Error(`formatWeekHeader: expected YYYY-MM-DD, got ${weekOf}`);
  }
  const start = new Date(`${weekOf}T00:00:00Z`);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const m1 = start.getUTCMonth() + 1;
  const d1 = start.getUTCDate();
  const m2 = end.getUTCMonth() + 1;
  const d2 = end.getUTCDate();
  return `${m1}/${d1}-${m2}/${d2}`;
}

function formatLastUpdated(date = new Date()) {
  return `Last Updated ${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 0-based column index → A1 letter (A, B, ..., Z, AA, AB, ...). Used when
 * writing to a specific column of an existing row.
 */
function columnLetter(index) {
  let n = index;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function escapeTabName(name) {
  return name.replace(/'/g, "''");
}

// ── Direction 1: Sheet → Supabase ──────────────────────────────────────────

/**
 * Read each per-student tab's Post Link column and ensure every URL is
 * tracked in the `videos` table with the platform-specific URL column
 * populated. Idempotent and safe to re-run; the second run produces
 * 0 inserts / 0 updates.
 *
 * For each (student, URL) pair:
 *   1. If a row already exists with the matching `post_url_<platform>`,
 *      skip (idempotent path).
 *   2. Else, look for a row whose legacy `post_url` (the single-column
 *      written by the pipeline.recordPostUrl path) canonicalizes to the
 *      same URL. If found, fill in `post_url_<platform>` on THAT row —
 *      preserving the existing video_id so any prior performance anchors
 *      stay linked to the correct post.
 *   3. Else, insert a new videos row with `post_url_<platform>` set,
 *      `status = 'POSTED BY CLIENT'`, title derived from the URL.
 *
 * NOTE on deviation from spec §4.2: the published spec suggests step 2 be
 * "find any null fillable row" (oldest videos row with NULL
 * post_url_<platform>). That pattern arbitrarily attaches sheet URLs to
 * unrelated videos rows and would scramble video_id ↔ URL mappings
 * established by the pre-rebuild pipeline. Matching against legacy
 * `post_url` first preserves the 2026-05-07 anchor row alignment — the
 * spec's spot-check (§6 step 4) implicitly requires this.
 *
 * @returns {Promise<{
 *   videosCreated: number, videosUpdated: number, urlsScanned: number,
 *   skipped: number, twitterSkipped: number, warnings: string[]
 * }>}
 */
async function pullNewUrlsFromSheet({ campusId, sheetId } = {}) {
  if (!campusId) throw new Error('pullNewUrlsFromSheet: campusId required');
  const id = sheetId || getSheetId();
  const sheets = getSheets({ readWrite: true });

  const counters = {
    videosCreated: 0,
    videosUpdated: 0,
    urlsScanned: 0,
    skipped: 0,
    twitterSkipped: 0,
    warnings: [],
  };

  // Load students once. Tab name must match students.name exactly.
  const { data: students, error: sErr } = await supabase
    .from('students')
    .select('id, name')
    .eq('campus_id', campusId);
  if (sErr) throw new Error(`students query failed: ${sErr.message}`);
  const studentByName = new Map(students.map((s) => [s.name, s]));

  // Cache the legacy `videos.post_url` → row index ONCE per call.
  // Without the cache, each URL we look up triggers a fresh full-table
  // scan of every videos row with post_url set — N*M sequential queries.
  // Build a Map keyed by canonicalized post_url so the per-URL lookup
  // becomes O(1). Per-platform canonical keys (one per platform we
  // might encounter) so /reel/ vs /p/ Instagram normalization plays out
  // identically on both sides.
  const { data: legacyRows, error: lErr } = await supabase
    .from('videos')
    .select('id, post_url')
    .eq('campus_id', campusId)
    .not('post_url', 'is', null);
  if (lErr) throw new Error(`videos legacy preload failed: ${lErr.message}`);
  const legacyIndex = {
    tiktok: new Map(),
    instagram: new Map(),
    youtube: new Map(),
  };
  for (const v of legacyRows || []) {
    for (const platform of Object.keys(legacyIndex)) {
      const c = canonicalizePostUrl(v.post_url, platform);
      if (c && !legacyIndex[platform].has(c)) legacyIndex[platform].set(c, v.id);
    }
  }

  // Batched read across all tabs is cheaper than N round-trips. Each
  // tab's Platform + Post Link live in columns A and B; weekly columns
  // are irrelevant to this direction.
  const ranges = STUDENT_TABS.map((tab) => `'${escapeTabName(tab)}'!A1:B500`);
  const batchRes = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges,
  });
  const valueRanges = batchRes.data.valueRanges || [];

  for (let t = 0; t < STUDENT_TABS.length; t++) {
    const tabName = STUDENT_TABS[t];
    const student = studentByName.get(tabName);
    if (!student) {
      counters.warnings.push(`sheet_tab_unmapped:${tabName}`);
      continue;
    }

    const rows = valueRanges[t]?.values || [];
    const headerIdx = findStudentTabHeader(rows);
    if (headerIdx === -1) {
      counters.warnings.push(`no_header:${tabName}`);
      continue;
    }

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const platformLabel = String(row[0] || '').trim();
      const urlRaw = String(row[1] || '').trim();
      if (!platformLabel || !urlRaw) continue;

      counters.urlsScanned++;

      const detected = detectPlatformFromUrl(urlRaw);
      if (!detected) {
        counters.warnings.push(`unparseable_url:${tabName}:${urlRaw.slice(0, 60)}`);
        continue;
      }
      if (detected.toLowerCase() !== platformLabel.toLowerCase()) {
        counters.warnings.push(
          `platform_label_mismatch:${tabName}:label=${platformLabel} host=${detected}`
        );
      }

      if (detected === 'twitter') {
        counters.twitterSkipped++;
        continue;
      }

      const column = PLATFORM_COLUMN[detected];
      if (!column) {
        counters.warnings.push(`unsupported_platform:${tabName}:${detected}`);
        continue;
      }

      const canonical = canonicalizePostUrl(urlRaw, detected);
      if (!canonical) {
        counters.warnings.push(`canonicalize_failed:${tabName}:${urlRaw.slice(0, 60)}`);
        continue;
      }

      // Step 1: already tracked under the per-platform column?
      const { data: alreadyTracked, error: e1 } = await supabase
        .from('videos')
        .select('id')
        .eq('campus_id', campusId)
        .eq(column, canonical)
        .limit(1);
      if (e1) throw new Error(`videos lookup (${column}) failed: ${e1.message}`);
      if (alreadyTracked && alreadyTracked.length > 0) {
        counters.skipped++;
        continue;
      }

      // Step 2: existing row whose legacy post_url matches? (preserves video_id)
      const legacyVideoId = legacyIndex[detected].get(canonical);
      if (legacyVideoId) {
        const { error: uErr } = await supabase
          .from('videos')
          .update({ [column]: canonical, updated_at: new Date().toISOString() })
          .eq('id', legacyVideoId);
        if (uErr) throw new Error(`videos update (${column}) failed: ${uErr.message}`);
        counters.videosUpdated++;
        await log({
          campusId,
          agent: AGENT_NAME,
          action: 'video_url_backfilled',
          payload: { videoId: legacyVideoId, platform: detected, url: canonical },
        });
        continue;
      }

      // Step 3: insert a new row.
      const { data: inserted, error: iErr } = await supabase
        .from('videos')
        .insert({
          campus_id: campusId,
          student_id: student.id,
          student_name: student.name,
          [column]: canonical,
          status: 'POSTED BY CLIENT',
          title: `${student.name} - ${detected}`,
        })
        .select('id')
        .single();
      if (iErr) throw new Error(`videos insert failed: ${iErr.message}`);
      counters.videosCreated++;
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'video_auto_added_from_sheet',
        payload: {
          videoId: inserted.id,
          studentId: student.id,
          studentName: student.name,
          platform: detected,
          url: canonical,
        },
      });
    }
  }

  return counters;
}

// ── Direction 2: Supabase → Sheet ──────────────────────────────────────────

/**
 * Push the current week's `weekly_delta` values from `performance` into the
 * Content Performance Tracker. For each per-student tab, find the row whose
 * column-B URL matches the post and write the delta to the column matching
 * the current week header (`M/D-M/D`). Append a new column or row when
 * needed. The ALL tab gets one cell per (Student × Platform) populated
 * with the sum of that combo's per-post deltas.
 *
 * @returns {Promise<{
 *   tabsUpdated: number, rowsWritten: number, columnsAdded: number,
 *   warnings: string[]
 * }>}
 */
async function pushDeltasToSheet({ campusId, weekOf, sheetId } = {}) {
  if (!campusId) throw new Error('pushDeltasToSheet: campusId required');
  if (!weekOf) throw new Error('pushDeltasToSheet: weekOf required');
  const id = sheetId || getSheetId();
  const sheets = getSheets({ readWrite: true });
  const weekHeader = formatWeekHeader(weekOf);
  const lastUpdated = formatLastUpdated();

  const counters = { tabsUpdated: 0, rowsWritten: 0, columnsAdded: 0, warnings: [] };

  // Grid metadata for auto-expansion. When the sheet's column grid is at
  // its declared limit (the ALL tab in the production layout caps at 26
  // columns; per-student tabs at 22), appending a new weekly column
  // requires a `appendDimension` request first or the values.* API
  // rejects with "Range exceeds grid limits". Cache the metadata once
  // here so each tab's writer can issue the expansion without re-reading.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const tabMeta = new Map();
  for (const s of meta.data.sheets || []) {
    const p = s.properties;
    tabMeta.set(p.title, {
      sheetId: p.sheetId,
      columnCount: p.gridProperties.columnCount,
      rowCount: p.gridProperties.rowCount,
    });
  }

  // 1. Pull this week's deltas joined to videos + students. We need:
  //    - studentName (to pick the tab)
  //    - platform (to pick which post_url_<platform> column on videos)
  //    - postUrl (to match against column B)
  //    - weeklyDelta (the value we're writing)
  //    - isBrandAccount (for ALL tab Account Type — though we don't write
  //      that column; we just read tabs as-is)
  const { data: perfRows, error: perfErr } = await supabase
    .from('performance')
    .select(
      'video_id, platform, view_count, weekly_delta, week_of, ' +
        'videos!inner(id, post_url_tiktok, post_url_instagram, post_url_youtube, ' +
        'student_id, students:student_id(name, is_brand_account))'
    )
    .eq('campus_id', campusId)
    .eq('week_of', weekOf);
  if (perfErr) throw new Error(`performance query failed: ${perfErr.message}`);

  if (!perfRows || perfRows.length === 0) {
    counters.warnings.push(`no_performance_rows_for_week:${weekOf}`);
    return counters;
  }

  // Group by student name → platform → list of {postUrl, delta}
  const byStudent = new Map();
  for (const p of perfRows) {
    const v = p.videos;
    if (!v) continue;
    const studentName = v.students?.name;
    if (!studentName) continue;
    const platform = p.platform;
    const postUrl =
      platform === 'tiktok'
        ? v.post_url_tiktok
        : platform === 'instagram'
        ? v.post_url_instagram
        : platform === 'youtube'
        ? v.post_url_youtube
        : null;
    if (!postUrl) {
      counters.warnings.push(`no_post_url:${studentName}:${platform}:video=${v.id}`);
      continue;
    }
    if (!byStudent.has(studentName)) byStudent.set(studentName, new Map());
    const platformMap = byStudent.get(studentName);
    if (!platformMap.has(platform)) platformMap.set(platform, []);
    platformMap.get(platform).push({
      postUrl,
      canonical: canonicalizePostUrl(postUrl, platform),
      delta: p.weekly_delta ?? 0,
    });
  }

  // 2. Per-student tabs.
  for (const tabName of STUDENT_TABS) {
    const platformMap = byStudent.get(tabName);
    if (!platformMap || platformMap.size === 0) continue;
    try {
      const wrote = await writeStudentTab({
        sheets,
        sheetId: id,
        tabName,
        platformMap,
        weekHeader,
        lastUpdated,
        tabMeta,
      });
      counters.tabsUpdated++;
      counters.rowsWritten += wrote.rowsWritten;
      if (wrote.columnAdded) counters.columnsAdded++;
    } catch (err) {
      counters.warnings.push(`tab_failed:${tabName}:${err.message}`);
    }
  }

  // 3. ALL tab.
  try {
    const wrote = await writeAllTab({
      sheets,
      sheetId: id,
      byStudent,
      weekHeader,
      lastUpdated,
      tabMeta,
    });
    counters.tabsUpdated++;
    counters.rowsWritten += wrote.rowsWritten;
    if (wrote.columnAdded) counters.columnsAdded++;
  } catch (err) {
    counters.warnings.push(`all_tab_failed:${err.message}`);
  }

  return counters;
}

/**
 * If `weekColIdx` would land outside the tab's current grid, append enough
 * columns to fit it (plus a small buffer to avoid one-tick-at-a-time
 * expansion when several future weeks are added in a row). No-op if the
 * grid is already wide enough or if we don't have metadata for this tab.
 */
async function ensureColumnFits({ sheets, sheetId, tabName, tabMeta, columnIdx }) {
  const m = tabMeta?.get(tabName);
  if (!m) return;
  if (columnIdx < m.columnCount) return;
  const additional = columnIdx - m.columnCount + 4;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          appendDimension: {
            sheetId: m.sheetId,
            dimension: 'COLUMNS',
            length: additional,
          },
        },
      ],
    },
  });
  m.columnCount += additional;
}

/**
 * Write one per-student tab. Strategy:
 *   - Fetch the tab in one read (range A1:ZZ500).
 *   - Locate the header row + the column matching `weekHeader`. Append a
 *     new column at the next empty position if not present.
 *   - For each (postUrl, delta) for this tab's student, find the data row
 *     whose column-B URL canonicalizes to the post URL. If found, write the
 *     delta to the target column. If not, append a new row at the bottom
 *     with Platform + Post Link + delta in the right column.
 *   - Update A1 with `Last Updated M/D`.
 *
 * Writes are batched into one `values.batchUpdate` call so a single tab's
 * sync hits the API roughly twice (one read, one batch write).
 */
async function writeStudentTab({
  sheets, sheetId, tabName, platformMap, weekHeader, lastUpdated, tabMeta,
}) {
  const escaped = escapeTabName(tabName);
  const readRange = `'${escaped}'!A1:ZZ500`;
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: readRange,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = readRes.data.values || [];
  const headerIdx = findStudentTabHeader(rows);
  if (headerIdx === -1) throw new Error('no Platform header row');
  const header = rows[headerIdx] || [];

  // Locate or plan-to-append the week column.
  let weekColIdx = header.findIndex((h) => String(h || '').trim() === weekHeader);
  let columnAdded = false;
  if (weekColIdx === -1) {
    weekColIdx = header.length;
    columnAdded = true;
  }
  await ensureColumnFits({ sheets, sheetId, tabName, tabMeta, columnIdx: weekColIdx });

  // Index existing data rows by canonical URL → 0-based row index.
  const dataRowByCanonical = new Map();
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const platformLabel = String(row[0] || '').trim().toLowerCase();
    const url = String(row[1] || '').trim();
    if (!url) continue;
    const platform = detectPlatformFromUrl(url) || platformLabel;
    const canon = canonicalizePostUrl(url, platform);
    if (!canon) continue;
    dataRowByCanonical.set(canon, r);
  }

  // Build a list of write requests:
  //   - Header cell (if columnAdded)
  //   - Updated A1 ("Last Updated M/D")
  //   - For each post: either set existing row's column or append new row
  const dataUpdates = []; // [{ range, values: [[v]] }]
  const appendsByCanon = new Map(); // canon -> { platform, postUrl, delta } to append

  if (columnAdded) {
    const headerCellRange = `'${escaped}'!${columnLetter(weekColIdx)}${headerIdx + 1}`;
    dataUpdates.push({ range: headerCellRange, values: [[weekHeader]] });
  }
  dataUpdates.push({ range: `'${escaped}'!A1`, values: [[lastUpdated]] });

  let rowsWritten = 0;
  for (const [platform, posts] of platformMap.entries()) {
    for (const { postUrl, canonical, delta } of posts) {
      if (!canonical) continue;
      const existingRowIdx = dataRowByCanonical.get(canonical);
      if (existingRowIdx != null) {
        const cellRange = `'${escaped}'!${columnLetter(weekColIdx)}${existingRowIdx + 1}`;
        dataUpdates.push({ range: cellRange, values: [[delta]] });
        rowsWritten++;
      } else {
        // Will be appended below; collect uniquely (the same canon should
        // never appear twice but guard anyway).
        if (!appendsByCanon.has(canonical)) {
          appendsByCanon.set(canonical, { platform, postUrl, delta });
        }
      }
    }
  }

  if (dataUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: dataUpdates },
    });
  }

  // Append new rows for posts not already in the sheet. Rows go in via
  // values.append into A:ZZ; we pre-pad to put the delta in the right
  // column.
  for (const { platform, postUrl, delta } of appendsByCanon.values()) {
    const padding = new Array(weekColIdx + 1).fill('');
    padding[0] = platformDisplayName(platform);
    padding[1] = postUrl;
    padding[weekColIdx] = delta;
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `'${escaped}'!A:ZZ`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [padding] },
    });
    rowsWritten++;
  }

  return { rowsWritten, columnAdded };
}

/**
 * Write the ALL tab. Same column find-or-append logic; data rows are
 * matched by (Student name, Platform) instead of by URL since each row
 * is a per-(student × platform) rollup. The cell value is the SUM of the
 * student's per-post deltas for that platform.
 */
async function writeAllTab({ sheets, sheetId, byStudent, weekHeader, lastUpdated, tabMeta }) {
  const tabName = 'ALL';
  const escaped = escapeTabName(tabName);
  const readRange = `'${escaped}'!A1:ZZ500`;
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: readRange,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = readRes.data.values || [];
  const headerIdx = findAllTabHeader(rows);
  if (headerIdx === -1) throw new Error('no Student header row in ALL tab');
  const header = rows[headerIdx] || [];

  // ALL tab columns: A=Student, B=AccountType, C=Platform, D=Handle,
  // E=Link, F=Limitless Posts, G+=weekly columns. We only write to a
  // weekly column; leave the rest alone.
  let weekColIdx = header.findIndex((h) => String(h || '').trim() === weekHeader);
  let columnAdded = false;
  if (weekColIdx === -1) {
    weekColIdx = header.length;
    columnAdded = true;
  }
  await ensureColumnFits({ sheets, sheetId, tabName, tabMeta, columnIdx: weekColIdx });

  // Index existing rows by (studentName-lower, platform-lower) → row idx
  const rowByKey = new Map();
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const sn = String(row[0] || '').trim().toLowerCase();
    const pl = String(row[2] || '').trim().toLowerCase();
    if (!sn || !pl) continue;
    rowByKey.set(`${sn}|${pl}`, r);
  }

  const dataUpdates = [];
  if (columnAdded) {
    dataUpdates.push({
      range: `'${escaped}'!${columnLetter(weekColIdx)}${headerIdx + 1}`,
      values: [[weekHeader]],
    });
  }
  dataUpdates.push({ range: `'${escaped}'!A1`, values: [[lastUpdated]] });

  let rowsWritten = 0;
  for (const [studentName, platformMap] of byStudent.entries()) {
    for (const [platform, posts] of platformMap.entries()) {
      const sum = posts.reduce((acc, p) => acc + (Number(p.delta) || 0), 0);
      const key = `${studentName.toLowerCase()}|${platform.toLowerCase()}`;
      const existingRowIdx = rowByKey.get(key);
      if (existingRowIdx == null) {
        // Not in ALL tab — operator maintains those rows manually
        // (Account Type, Handle, Link cells need their input). Log via
        // the caller's warnings array isn't reachable here, so we
        // silently skip; the per-student tab still got the data.
        continue;
      }
      const cellRange = `'${escaped}'!${columnLetter(weekColIdx)}${existingRowIdx + 1}`;
      dataUpdates.push({ range: cellRange, values: [[sum]] });
      rowsWritten++;
    }
  }

  if (dataUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: dataUpdates },
    });
  }

  return { rowsWritten, columnAdded };
}

function platformDisplayName(p) {
  if (p === 'tiktok') return 'TikTok';
  if (p === 'instagram') return 'Instagram';
  if (p === 'youtube') return 'YouTube';
  if (p === 'twitter') return 'Twitter';
  return p;
}

module.exports = {
  pullNewUrlsFromSheet,
  pushDeltasToSheet,
  // exported for tests / scripts
  formatWeekHeader,
  formatLastUpdated,
  findStudentTabHeader,
  findAllTabHeader,
  columnLetter,
};
