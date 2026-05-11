#!/usr/bin/env node
/**
 * One-off: pull every post URL out of the Content Performance Tracker
 * and ensure each one is tracked in `videos.post_url_<platform>`.
 *
 * Replaces the old version of this script that read from
 * `scripts/unmatched-urls.txt`. That manual flow is obsolete now that
 * the sheet itself is the canonical source of new-post URLs (see
 * docs/profile-views-rebuild-spec.md §1 — Frame.io v4 OAuth blocker
 * means the Sheet replaces Frame.io's new-post-detection role).
 *
 * Idempotent: re-running produces 0 inserts / 0 updates once the videos
 * table has caught up to the sheet. Each run logs a `sheet_pull_complete`
 * row to `agent_logs` with the full counter payload.
 *
 * Usage:
 *   node scripts/backfill-post-urls.js                 # Austin campus
 *   node scripts/backfill-post-urls.js <campus_uuid>   # any campus
 */

require('dotenv').config();
const { pullNewUrlsFromSheet } = require('../tools/sheet-sync');

const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';

(async () => {
  const campusId = process.argv[2] || AUSTIN_CAMPUS_ID;
  console.log(`[backfill] pulling URLs from sheet into videos for campus ${campusId}`);
  const result = await pullNewUrlsFromSheet({ campusId });
  console.log('[backfill] result:');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error(`[backfill] FATAL: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
