// Profile Views Agent — daily scrape of every tracked post URL.
// Trigger: Cron job, Thursday 9 AM (`0 9 * * 4`). Registered in server.js
// behind APIFY_API_TOKEN env-gate. (Cadence flips to daily once Scott's
// Apify token replaces Caiden's free-tier token in `.env` — see
// `iteration-3-fixes.md` Fix 2.)
//
// Spec: docs/profile-views-rebuild-spec.md (source of truth — do not deviate
// without updating it first).
//
// One-line summary: pull any new post URLs Scott added to the Content
// Performance Tracker into `videos.post_url_<platform>`, then scrape every
// such URL via Apify per-platform actors, compute the week-over-week
// delta against the most recent prior apify-lineage row, upsert one
// performance row per (video × platform × week_of), and push the deltas
// back into the matching weekly column on the sheet.
//
// The pre-rebuild architecture (channel-level scraping via
// `scrapeProfileVideos`) had four failure modes — pinned-video distortion,
// partial coverage, no delta math, no URL plumbing. All four are
// addressed here. Scrape input is now URL-keyed via
// `scrapeVideosByUrls`, prior-cumulative subtraction handles delta
// math, and the sheet sync handles URL plumbing.

const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const selfHeal = require('../lib/self-heal');
const {
  scrapeVideosByUrls,
  canonicalizePostUrl,
} = require('../tools/scraper');
const { pullNewUrlsFromSheet, pushDeltasToSheet } = require('../tools/sheet-sync');

const AGENT_NAME = 'profile-views';

// Platforms whose URLs the agent scrapes. Twitter is intentionally absent —
// no working view-count actor (see scrapeVideosByUrls) and no
// `videos.post_url_twitter` column. Twitter weekly counts stay manual in
// the sheet until that gap closes.
const SCRAPE_PLATFORMS = ['tiktok', 'instagram', 'youtube'];

const PLATFORM_COLUMN = {
  tiktok: 'post_url_tiktok',
  instagram: 'post_url_instagram',
  youtube: 'post_url_youtube',
};

/**
 * Most recent Friday on or before `now`, formatted YYYY-MM-DD UTC.
 *
 * The sheet uses Friday as the start-of-week anchor (header `M/D-M/D`
 * where the first M/D is a Friday). Both the agent and the sheet sync
 * share this convention so a row's week_of cleanly maps to a column.
 */
function mostRecentFriday(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const diff = (day - 5 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

async function run(campusId) {
  const weekOf = mostRecentFriday();
  const counters = {
    weekOf,
    sheetPullCreated: 0,
    sheetPullUpdated: 0,
    sheetPullSkipped: 0,
    sheetPullWarnings: 0,
    videosWithUrls: 0,
    urlsScraped: 0,
    scrapeErrors: 0,
    notFound: 0,
    imagePosts: 0,
    perfRowsWritten: 0,
    anchorsPlanted: 0,
    deltasWritten: 0,
    sheetPushTabsUpdated: 0,
    sheetPushRowsWritten: 0,
    sheetPushColumnsAdded: 0,
    sheetPushWarnings: 0,
  };

  try {
    await log({ campusId, agent: AGENT_NAME, action: 'profile_views_run_started', payload: { weekOf } });

    // Step 1: Pull any new URLs from the Sheet into videos rows. Wrapped
    // separately so a sheet outage logs a warning but doesn't block the
    // scrape — the agent can still refresh whatever URLs are already
    // tracked. Numbers feed into the run-complete payload either way.
    try {
      const sheetPull = await pullNewUrlsFromSheet({ campusId });
      counters.sheetPullCreated = sheetPull.videosCreated;
      counters.sheetPullUpdated = sheetPull.videosUpdated;
      counters.sheetPullSkipped = sheetPull.skipped;
      counters.sheetPullWarnings = sheetPull.warnings.length;
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'sheet_pull_complete',
        payload: {
          videosCreated: sheetPull.videosCreated,
          videosUpdated: sheetPull.videosUpdated,
          urlsScanned: sheetPull.urlsScanned,
          skipped: sheetPull.skipped,
          twitterSkipped: sheetPull.twitterSkipped,
          warnings: sheetPull.warnings.slice(0, 10),
        },
      });
    } catch (err) {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'sheet_pull_failed',
        status: 'warning',
        errorMessage: err.message,
      });
    }

    // Step 2: Load every videos row that has at least one per-platform URL.
    const { data: videos, error: vErr } = await supabase
      .from('videos')
      .select('id, student_id, post_url_tiktok, post_url_instagram, post_url_youtube')
      .eq('campus_id', campusId)
      .or('post_url_tiktok.not.is.null,post_url_instagram.not.is.null,post_url_youtube.not.is.null');
    if (vErr) throw new Error(`videos query failed: ${vErr.message}`);
    counters.videosWithUrls = (videos || []).length;

    // Group by platform → list of {videoId, url}. A single videos row can
    // contribute to multiple platforms if it carries URLs for several.
    const byPlatform = { tiktok: [], instagram: [], youtube: [] };
    for (const v of videos || []) {
      for (const platform of SCRAPE_PLATFORMS) {
        const url = v[PLATFORM_COLUMN[platform]];
        if (url) byPlatform[platform].push({ videoId: v.id, url });
      }
    }

    // Step 3: Scrape per platform, build the upsert list with delta math.
    const upserts = [];
    for (const platform of SCRAPE_PLATFORMS) {
      const list = byPlatform[platform];
      if (list.length === 0) continue;

      let scraped;
      try {
        scraped = await scrapeVideosByUrls(list.map((x) => x.url), platform);
      } catch (err) {
        counters.scrapeErrors++;
        await log({
          campusId,
          agent: AGENT_NAME,
          action: 'profile_views_scrape_error',
          status: 'error',
          errorMessage: err.message,
          payload: { platform, urlCount: list.length },
        });
        continue;
      }

      const byCanonical = new Map();
      for (const s of scraped) {
        if (s.canonicalUrl) byCanonical.set(s.canonicalUrl, s);
      }

      for (const { videoId, url } of list) {
        const canonical = canonicalizePostUrl(url, platform);
        const result = canonical ? byCanonical.get(canonical) : null;

        if (!result || result.error === 'not_found') {
          counters.notFound++;
          await log({
            campusId,
            agent: AGENT_NAME,
            action: 'scrape_url_not_returned',
            status: 'warning',
            payload: { videoId, platform, url },
          });
          continue;
        }
        if (result.error === 'image_post_no_view_count') {
          counters.imagePosts++;
          await log({
            campusId,
            agent: AGENT_NAME,
            action: 'image_post_no_view_count',
            payload: { videoId, platform, url },
          });
          continue;
        }
        if (result.viewCount == null) continue;

        // Basis: the most recent prior cumulative-semantic row's view_count.
        // Three sources qualify:
        //   apify         — steady-state weekly scrape (cumulative)
        //   apify_anchor  — first scrape of a (video, platform) (cumulative)
        //   sheet_synth   — anchor synthesized from summed sheet history
        //                   (docs/recovery-anchor-backfill-spec.md), used to
        //                   close the 74-URL gap left by the May 8 broken run
        // Plain `'sheet'` rows from sync-performance-tracker are excluded —
        // their view_count carries the OLD weekly semantic and would
        // inflate the delta. See migrations/2026-05-04-performance-source.sql
        // and docs/profile-views-rebuild-spec.md §1.
        //
        // ORDER BY week_of DESC LIMIT 1 means the newest qualifying row
        // wins. A video with both a sheet_synth at 2026-05-01 AND a real
        // apify scrape at a later week_of correctly prefers the apify row.
        const { data: prior, error: pErr } = await supabase
          .from('performance')
          .select('view_count')
          .eq('video_id', videoId)
          .eq('platform', platform)
          .in('source', ['apify', 'apify_anchor', 'sheet_synth'])
          .lt('week_of', weekOf)
          .order('week_of', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (pErr) throw new Error(`prior performance query failed: ${pErr.message}`);

        const isAnchor = !prior;
        const delta = isAnchor ? 0 : Math.max(0, result.viewCount - (prior.view_count || 0));
        upserts.push({
          campus_id: campusId,
          video_id: videoId,
          platform,
          view_count: result.viewCount,
          weekly_delta: delta,
          week_of: weekOf,
          source: isAnchor ? 'apify_anchor' : 'apify',
        });
        counters.urlsScraped++;
        if (isAnchor) counters.anchorsPlanted++;
        else counters.deltasWritten++;
      }
    }

    // Step 4: Upsert the performance rows. Dedup defensively on the
    // unique key in case the scraper returned duplicates (shouldn't, but
    // a postgres "ON CONFLICT DO UPDATE command cannot affect row a
    // second time" error from one duplicate would lose the whole batch).
    const dedup = new Map();
    for (const u of upserts) {
      dedup.set(`${u.video_id}|${u.platform}|${u.week_of}`, u);
    }
    const finalUpserts = [...dedup.values()];

    const CHUNK = 500;
    for (let i = 0; i < finalUpserts.length; i += CHUNK) {
      const chunk = finalUpserts.slice(i, i + CHUNK);
      const { error: uErr } = await supabase
        .from('performance')
        .upsert(chunk, { onConflict: 'video_id,platform,week_of' });
      if (uErr) throw new Error(`performance upsert failed: ${uErr.message}`);
      counters.perfRowsWritten += chunk.length;
    }

    // Step 5: Push deltas back to the sheet. Same try/catch pattern as
    // step 1 — a sheet outage logs and continues; the scrape data is
    // already safely in performance.
    try {
      const sheetPush = await pushDeltasToSheet({ campusId, weekOf });
      counters.sheetPushTabsUpdated = sheetPush.tabsUpdated;
      counters.sheetPushRowsWritten = sheetPush.rowsWritten;
      counters.sheetPushColumnsAdded = sheetPush.columnsAdded;
      counters.sheetPushWarnings = sheetPush.warnings.length;
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'sheet_push_complete',
        payload: {
          tabsUpdated: sheetPush.tabsUpdated,
          rowsWritten: sheetPush.rowsWritten,
          columnsAdded: sheetPush.columnsAdded,
          warnings: sheetPush.warnings.slice(0, 10),
        },
      });
    } catch (err) {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'sheet_push_failed',
        status: 'warning',
        errorMessage: err.message,
      });
    }

    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'profile_views_run_complete',
      payload: counters,
    });

    return counters;
  } catch (err) {
    // Cron-invoked; swallow after self-heal so runAll continues to next
    // campus. self-heal logs the original error per CLAUDE.md rule 1
    // before any recovery. retryFn lets a transient 5xx re-invoke run().
    await selfHeal.handle(err, {
      agent: AGENT_NAME,
      action: 'run',
      campusId,
      retryFn: () => run(campusId),
    });
    return null;
  }
}

async function runAll() {
  const { data: campuses, error } = await supabase
    .from('campuses')
    .select('id, name')
    .eq('active', true);
  if (error) {
    await log({ agent: AGENT_NAME, action: 'run_all_error', status: 'error', errorMessage: error.message });
    return;
  }
  for (const campus of campuses || []) {
    try {
      await run(campus.id);
    } catch {
      // Already logged inside run(); continue to next campus.
    }
  }
}

module.exports = {
  run,
  runAll,
  mostRecentFriday,
};
