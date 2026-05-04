#!/usr/bin/env node
/**
 * Profile Views Agent integration test harness.
 * Spec: workflows/profile-views.md §"Test requirements".
 *
 * Tests:
 *   1. mostRecentFriday — Sun/Fri/Sat → expected ISO Friday.
 *   2. Real Apify scrape against Alpha High TikTok (skipped if no token).
 *   3. Cold-start / sheet-boundary / steady-state paths via synthetic videos.
 *   4. scrapeProfileVideos returns viewCount (source-level check + runtime).
 *   5. matchScrapedItems aggregates unmatched URLs correctly.
 *   6. Negative delta floors at 0 with the warning flag set.
 *   7. server.registerScheduledJobs registers profile-views-agent at 0 9 * * 4.
 *
 * All synthetic test rows carry `__perf_views_test_` in the title or are
 * inserted under `inserted.*` arrays so teardown can remove only what
 * this harness wrote — never sheet rows or production Apify rows.
 *
 * Run: node scripts/test-profile-views-agent.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { supabase } = require('../lib/supabase');
const profileViews = require('../agents/profile-views');
const {
  mostRecentFriday,
  canonicalizePostUrl,
  buildProfileUrl,
  buildUpsertRowForMatch,
  matchScrapedItems,
  loadVideoUrlIndex,
} = profileViews;
const { scrapeProfileVideos } = require('../tools/scraper');

const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const TEST_PREFIX = '__perf_views_test_';

// Track every row this harness inserts so teardown can drop them without
// risking sheet rows or production Apify writes.
const inserted = { videos: [], performance: [] };

async function teardown() {
  // Performance first — videos FK depends on it.
  if (inserted.performance.length > 0) {
    const { error } = await supabase.from('performance').delete().in('id', inserted.performance);
    if (error) console.error(`[teardown] performance delete failed: ${error.message}`);
  }
  if (inserted.videos.length > 0) {
    const { error } = await supabase.from('videos').delete().in('id', inserted.videos);
    if (error) console.error(`[teardown] videos delete failed: ${error.message}`);
  }
}

// ── Test seam ──────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
let skipped = 0;
const summary = [];

async function runTest(name, fn) {
  try {
    await fn();
    pass++;
    summary.push({ name, status: 'PASS' });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    if (err && err.__skip) {
      skipped++;
      summary.push({ name, status: 'SKIP', message: err.message });
      console.log(`  SKIP  ${name} — ${err.message}`);
      return;
    }
    fail++;
    summary.push({ name, status: 'FAIL', message: err.message });
    console.error(`  FAIL  ${name} — ${err.message}`);
    if (err && err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
  }
}

function skip(message) {
  const e = new Error(message);
  e.__skip = true;
  throw e;
}

async function seedTestVideo({ postUrl, titleSuffix }) {
  const title = `${TEST_PREFIX}${titleSuffix || 'video'}_${Date.now()}`;
  const { data, error } = await supabase
    .from('videos')
    .insert({
      campus_id: AUSTIN_CAMPUS_ID,
      title,
      post_url: postUrl,
      status: 'POSTED BY CLIENT',
      student_name: 'Profile Views Test',
    })
    .select('id')
    .single();
  if (error) throw new Error(`seed video failed: ${error.message}`);
  inserted.videos.push(data.id);
  return data.id;
}

async function seedPerformance({ videoId, platform, viewCount, weekOf, source }) {
  const { data, error } = await supabase
    .from('performance')
    .insert({
      campus_id: AUSTIN_CAMPUS_ID,
      video_id: videoId,
      platform,
      view_count: viewCount,
      week_of: weekOf,
      source,
    })
    .select('id')
    .single();
  if (error) throw new Error(`seed performance failed: ${error.message}`);
  inserted.performance.push(data.id);
  return data.id;
}

async function insertUpsertRow(row) {
  // Insert after capturing id so teardown removes it. The upsert path uses
  // ON CONFLICT, but for this harness's synthetic videos the row is always
  // new — so a plain insert returning id works.
  const { data, error } = await supabase
    .from('performance')
    .upsert(row, { onConflict: 'video_id,platform,week_of' })
    .select('id')
    .single();
  if (error) throw new Error(`insertUpsertRow failed: ${error.message}`);
  inserted.performance.push(data.id);
  return data.id;
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function test1_FridayAlignment() {
  // 2026-05-03 = Sunday → most recent Friday is 2026-05-01
  // 2026-05-08 = Friday → that Friday
  // 2026-05-09 = Saturday → 2026-05-08
  // 2026-05-07 = Thursday → 2026-05-01
  assert.strictEqual(mostRecentFriday(new Date('2026-05-03T13:00:00Z')), '2026-05-01', 'Sun');
  assert.strictEqual(mostRecentFriday(new Date('2026-05-08T13:00:00Z')), '2026-05-08', 'Fri');
  assert.strictEqual(mostRecentFriday(new Date('2026-05-09T13:00:00Z')), '2026-05-08', 'Sat');
  assert.strictEqual(mostRecentFriday(new Date('2026-05-07T13:00:00Z')), '2026-05-01', 'Thu (cron firing day)');
}

async function test2_RealApifyScrape() {
  if (!process.env.APIFY_API_TOKEN) skip('APIFY_API_TOKEN unset');

  const profileUrl = buildProfileUrl('tiktok', 'alphahigh.school');
  const items = await scrapeProfileVideos(profileUrl, 'tiktok', 20);
  assert(Array.isArray(items), 'scrapeProfileVideos must return an array');
  assert(items.length >= 1, `expected ≥1 scraped item, got ${items.length}`);

  // Inline §4 check — viewCount present + numeric on every returned item.
  for (const item of items) {
    assert(item && typeof item === 'object', 'item is not an object');
    assert(typeof item.url === 'string' && item.url.length > 0, `item missing url: ${JSON.stringify(item).slice(0, 200)}`);
    assert(
      typeof item.viewCount === 'number' && Number.isFinite(item.viewCount),
      `item missing numeric viewCount: ${JSON.stringify(item).slice(0, 200)}`
    );
  }

  // Match against the live videos.post_url index for Austin.
  const videoIndex = await loadVideoUrlIndex(AUSTIN_CAMPUS_ID);
  const { matches, unmatched } = matchScrapedItems(items, videoIndex);
  assert(matches.length >= 1, `expected ≥1 URL match against Alpha High videos, got ${matches.length}`);

  // Pick one match and run the full upsert path against the real Friday.
  // Note: this writes to the production performance table at the real
  // weekOf with real Apify data — the value is genuine, not synthetic, so
  // teardown does NOT delete this row. If the real Thursday cron also
  // runs, it will upsert the same (video, platform, weekOf) idempotently.
  const chosen = matches[0];
  const weekOf = mostRecentFriday();
  const { row, hasPriorApify, sumApifyPrior } = await buildUpsertRowForMatch({
    campusId: AUSTIN_CAMPUS_ID,
    videoId: chosen.videoId,
    platform: 'tiktok',
    currentCumulative: chosen.currentCumulative,
    weekOf,
  });
  // Sanity: source must be one of the agent's sources, never 'sheet'.
  assert(['apify', 'apify_anchor'].includes(row.source), `bad source: ${row.source}`);

  const { error: uErr } = await supabase
    .from('performance')
    .upsert([row], { onConflict: 'video_id,platform,week_of' });
  assert(!uErr, `upsert failed: ${uErr && uErr.message}`);

  // Verify the row is queryable.
  const { data: written, error: rErr } = await supabase
    .from('performance')
    .select('id, source, view_count, week_of')
    .eq('video_id', chosen.videoId)
    .eq('platform', 'tiktok')
    .eq('week_of', weekOf)
    .maybeSingle();
  assert(!rErr, `read-back failed: ${rErr && rErr.message}`);
  assert(written, 'no row written');
  console.log(
    `        scraped=${items.length} matched=${matches.length} unmatched=${unmatched.length} ` +
      `wrote ${written.source} view_count=${written.view_count} (cold_start=${!hasPriorApify}, sum_prior=${sumApifyPrior})`
  );
}

async function test3_PathsColdStartBoundarySteadyState() {
  const seedTime = Date.now();
  const weekOfPrior = '2026-04-24'; // Friday a week before the test weekOf
  const weekOf = '2026-05-01'; // Friday "this week" for the test
  const weekOfNext = '2026-05-08'; // for steady-state sub-step

  // ── Cold-start: a video with no prior performance rows ───────────
  const coldVidId = await seedTestVideo({
    postUrl: `https://test.example/cold-start/${seedTime}`,
    titleSuffix: 'cold',
  });

  const r1 = await buildUpsertRowForMatch({
    campusId: AUSTIN_CAMPUS_ID,
    videoId: coldVidId,
    platform: 'tiktok',
    currentCumulative: 5000,
    weekOf,
  });
  assert.strictEqual(r1.row.view_count, 5000, 'cold-start view_count must equal cumulative');
  assert.strictEqual(r1.row.source, 'apify_anchor', 'cold-start source');
  assert.strictEqual(r1.hasPriorApify, false, 'cold-start hasPriorApify');
  await insertUpsertRow(r1.row);

  // ── Sheet→Apify boundary: a video with prior sheet history ─────────
  const sheetVidId = await seedTestVideo({
    postUrl: `https://test.example/sheet-boundary/${seedTime}`,
    titleSuffix: 'sheet',
  });
  await seedPerformance({
    videoId: sheetVidId,
    platform: 'tiktok',
    viewCount: 1500,
    weekOf: weekOfPrior,
    source: 'sheet',
  });

  const r2 = await buildUpsertRowForMatch({
    campusId: AUSTIN_CAMPUS_ID,
    videoId: sheetVidId,
    platform: 'tiktok',
    currentCumulative: 5000,
    weekOf,
  });
  assert.strictEqual(r2.row.view_count, 5000, 'sheet boundary anchor must carry cumulative, NOT 5000-1500');
  assert.strictEqual(r2.row.source, 'apify_anchor', 'sheet boundary source');
  assert.strictEqual(r2.hasPriorApify, false, 'sheet rows must not count as prior Apify lineage');

  // The sheet row must be untouched.
  const { data: sheetRow } = await supabase
    .from('performance')
    .select('source, view_count')
    .eq('video_id', sheetVidId)
    .eq('week_of', weekOfPrior)
    .single();
  assert.strictEqual(sheetRow.source, 'sheet', 'sheet row source preserved');
  assert.strictEqual(sheetRow.view_count, 1500, 'sheet row view_count preserved');

  await insertUpsertRow(r2.row);

  // The Performance Agent prerequisite filter must yield only the sheet
  // row for this video — anchor excluded.
  const { data: filtered } = await supabase
    .from('performance')
    .select('source, view_count, week_of')
    .eq('video_id', sheetVidId)
    .in('source', ['sheet', 'apify']);
  assert.strictEqual(filtered.length, 1, `expected 1 row after filter, got ${filtered.length}`);
  assert.strictEqual(filtered[0].source, 'sheet', 'filter excluded the apify_anchor row');

  // ── Steady-state: the cold-start video at next week ────────────────
  const r3 = await buildUpsertRowForMatch({
    campusId: AUSTIN_CAMPUS_ID,
    videoId: coldVidId,
    platform: 'tiktok',
    currentCumulative: 7500,
    weekOf: weekOfNext,
  });
  assert.strictEqual(r3.row.view_count, 2500, 'steady-state delta = 7500 - 5000');
  assert.strictEqual(r3.row.source, 'apify', 'steady-state source');
  assert.strictEqual(r3.hasPriorApify, true, 'steady-state hasPriorApify');
  assert.strictEqual(r3.sumApifyPrior, 5000, 'sumApifyPrior matches the anchor');
  await insertUpsertRow(r3.row);
}

async function test4_ScrapeProfileVideosViewCount() {
  // Static source check — catches the regression class where a refactor
  // drops `viewCount` from the scrapeProfileVideos return mapping. Brittle
  // but precise; survives the absence of APIFY_API_TOKEN.
  const src = fs.readFileSync(path.resolve(__dirname, '../tools/scraper.js'), 'utf8');
  const fnIdx = src.indexOf('async function scrapeProfileVideos');
  assert(fnIdx >= 0, 'scrapeProfileVideos function not found in tools/scraper.js');
  const fnSlice = src.slice(fnIdx);
  assert(/viewCount\s*:/.test(fnSlice), 'scrapeProfileVideos return mapping no longer includes viewCount');

  // Runtime check is folded into test #2 when APIFY_API_TOKEN is set; the
  // assertion there iterates every returned item. No-op here when unset.
}

async function test5_UnmatchedAggregation() {
  const matchUrl = `https://test.example/match-${Date.now()}`;
  const noMatchUrl = `https://test.example/no-match-${Date.now()}`;

  // Build a video index containing the match URL only.
  const videoIndex = new Map();
  videoIndex.set(canonicalizePostUrl(matchUrl), { id: 'fake-uuid', post_url: matchUrl });

  const items = [
    { url: matchUrl + '/', viewCount: 100 }, // trailing slash; canonicalizes to matchUrl
    { url: noMatchUrl, viewCount: 50 },
  ];

  const { matches, unmatched, invalid } = matchScrapedItems(items, videoIndex);
  assert.strictEqual(matches.length, 1, `expected 1 match, got ${matches.length}`);
  assert.strictEqual(matches[0].videoId, 'fake-uuid', 'matched videoId');
  assert.strictEqual(matches[0].currentCumulative, 100, 'matched currentCumulative rounded from viewCount');
  assert.strictEqual(unmatched.length, 1, `expected 1 unmatched, got ${unmatched.length}`);
  assert.strictEqual(unmatched[0], noMatchUrl, 'unmatched URL captured verbatim');
  assert.strictEqual(invalid, 0, `expected 0 invalid, got ${invalid}`);
}

async function test6_NegativeDeltaFloor() {
  const seedTime = Date.now();
  const weekOfPrior = '2026-04-24';
  const weekOf = '2026-05-01';

  const vidId = await seedTestVideo({
    postUrl: `https://test.example/neg-delta/${seedTime}`,
    titleSuffix: 'neg',
  });

  // Seed an anchor at 5000 (prior week so the strict-< filter picks it up).
  await seedPerformance({
    videoId: vidId,
    platform: 'tiktok',
    viewCount: 5000,
    weekOf: weekOfPrior,
    source: 'apify_anchor',
  });

  const r = await buildUpsertRowForMatch({
    campusId: AUSTIN_CAMPUS_ID,
    videoId: vidId,
    platform: 'tiktok',
    currentCumulative: 4000, // below the anchor → negative raw delta
    weekOf,
  });
  assert.strictEqual(r.row.view_count, 0, 'view_count must floor at 0');
  assert.strictEqual(r.row.source, 'apify', 'steady-state source even when floored');
  assert.strictEqual(r.flooredNegative, true, 'flooredNegative flag set');
  assert.strictEqual(r.sumApifyPrior, 5000, 'basis sees the anchor');
}

async function test7_CronRegistration() {
  const { registerScheduledJobs } = require('../server');

  const stub = {
    registered: [],
    register(name, schedule, fn) {
      this.registered.push({ name, schedule, fn });
    },
  };

  // With APIFY_API_TOKEN set → profile-views-agent gets registered.
  const savedToken = process.env.APIFY_API_TOKEN;
  process.env.APIFY_API_TOKEN = 'test-token-for-registration';
  try {
    registerScheduledJobs(stub);
  } finally {
    if (savedToken === undefined) delete process.env.APIFY_API_TOKEN;
    else process.env.APIFY_API_TOKEN = savedToken;
  }

  const pv = stub.registered.find((r) => r.name === 'profile-views-agent');
  assert(pv, `profile-views-agent not registered (got: ${stub.registered.map((r) => r.name).join(', ')})`);
  assert.strictEqual(pv.schedule, '0 9 * * 4', `bad schedule: ${pv.schedule}`);
  assert.strictEqual(typeof pv.fn, 'function', 'fn is not a function');

  // Without APIFY_API_TOKEN → profile-views-agent is NOT registered.
  const stub2 = { registered: [], register(n, s, f) { this.registered.push({ name: n, schedule: s, fn: f }); } };
  const reset = process.env.APIFY_API_TOKEN;
  delete process.env.APIFY_API_TOKEN;
  try {
    registerScheduledJobs(stub2);
  } finally {
    if (reset !== undefined) process.env.APIFY_API_TOKEN = reset;
  }
  const pv2 = stub2.registered.find((r) => r.name === 'profile-views-agent');
  assert(!pv2, 'profile-views-agent should NOT register when APIFY_API_TOKEN is unset');
}

// ── Driver ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('Profile Views Agent — integration tests\n');

  await runTest('1. Friday alignment unit cases', test1_FridayAlignment);
  await runTest('2. Real Apify scrape against Alpha High TikTok', test2_RealApifyScrape);
  await runTest('3. Cold-start / sheet boundary / steady-state paths', test3_PathsColdStartBoundarySteadyState);
  await runTest('4. scrapeProfileVideos returns viewCount (source check)', test4_ScrapeProfileVideosViewCount);
  await runTest('5. matchScrapedItems unmatched aggregation', test5_UnmatchedAggregation);
  await runTest('6. Negative delta floors at 0', test6_NegativeDeltaFloor);
  await runTest('7. Cron registration smoke test', test7_CronRegistration);

  console.log(`\n${pass}/${pass + fail + skipped} ran  (passed=${pass}, failed=${fail}, skipped=${skipped})`);
  return fail === 0;
}

(async () => {
  let ok = false;
  try {
    ok = await main();
  } catch (err) {
    console.error('Fatal:', err.message);
    if (err.stack) console.error(err.stack);
  } finally {
    await teardown();
  }
  process.exit(ok ? 0 : 1);
})();
