// Profile Views Agent — weekly Apify scrape of student + brand profiles.
// Trigger: Cron job, Thursday 9 AM (`0 9 * * 4`). Registered in server.js
// behind APIFY_API_TOKEN env-gate.
//
// Spec: workflows/profile-views.md (source of truth — do not deviate
// without updating it first).
//
// One-line summary: for each student-or-brand row in the campus that has
// a TikTok or Instagram handle, scrape up to 20 of their most recent
// videos, match those URLs against `videos.post_url`, and write a
// `performance` row per match. The first scrape per (video, platform)
// plants an `apify_anchor` row carrying the lifetime cumulative; every
// subsequent week writes an `apify` delta computed against the running
// sum of prior Apify-lineage rows. Sheet rows from the tracker sync are
// excluded from the agent's delta math by source.

const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const selfHeal = require('../lib/self-heal');
const { scrapeProfileVideos } = require('../tools/scraper');

const AGENT_NAME = 'profile-views';

// ── Helpers (exported for tests) ───────────────────────────────────────────

/**
 * Most recent Friday on or before `now`, formatted YYYY-MM-DD UTC.
 *
 * The agent's cron runs Thursday 9 AM, so the produced `weekOf` is always
 * the Friday at the end of the previous full content week. The tracker
 * sync writes the same Friday-aligned format, so the two writers' rows
 * land on the same `(video_id, platform, week_of)` unique key.
 */
function mostRecentFriday(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  // 5 = Friday in JS getUTCDay() (0=Sun … 6=Sat)
  const day = d.getUTCDay();
  const diff = (day - 5 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Same canonicalization rule as `agents/pipeline.canonicalizePostUrl` and
 * `scripts/sync-performance-tracker.canonicalizeUrl`. Drop query/hash,
 * lowercase host, strip trailing slash. A scraped URL canonicalizes
 * identically to a stored `videos.post_url`, which is what the lookup
 * Map indexes on.
 */
function canonicalizePostUrl(url) {
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
 * Build the public profile URL for an Apify scrape from a stored handle.
 * Defensive `^@` strip — the brand-voice validator already does this when
 * reading the same fields, and seeded handles vary in whether they carry
 * the leading `@`.
 */
function buildProfileUrl(platform, handle) {
  const clean = String(handle || '').replace(/^@+/, '').trim();
  if (!clean) throw new Error('empty handle');
  if (platform === 'tiktok') return `https://www.tiktok.com/@${clean}`;
  if (platform === 'instagram') return `https://www.instagram.com/${clean}/`;
  throw new Error(`unsupported platform: ${platform}`);
}

// ── DB readers ─────────────────────────────────────────────────────────────

async function loadStudentsWithHandles(campusId) {
  // Loads everyone for the campus and filters in JS. PostgREST's `.or()`
  // string syntax is fragile around `not.is.null` — keeping the filter in
  // application code is more robust and the result set is tiny (≪100).
  const { data, error } = await supabase
    .from('students')
    .select('id, name, handle_tiktok, handle_instagram')
    .eq('campus_id', campusId);
  if (error) throw new Error(`students query failed: ${error.message}`);
  return (data || []).filter((s) => s.handle_tiktok || s.handle_instagram);
}

/**
 * Students with no handles AT ALL. The actionable case is when one of
 * these students also has at least one `videos.post_url` row — we have
 * post URLs but no way to refresh them. Run-level warning lets the
 * operator find and fill those handles.
 */
async function loadHandlelessStudents(campusId) {
  const { data, error } = await supabase
    .from('students')
    .select('id, name')
    .eq('campus_id', campusId)
    .is('handle_tiktok', null)
    .is('handle_instagram', null);
  if (error) throw new Error(`handleless students query failed: ${error.message}`);
  return data || [];
}

async function loadVideoUrlIndex(campusId) {
  const { data, error } = await supabase
    .from('videos')
    .select('id, post_url, student_id')
    .eq('campus_id', campusId)
    .not('post_url', 'is', null);
  if (error) throw new Error(`videos query failed: ${error.message}`);

  // First-loaded wins on canonical-URL collision so subsequent runs are
  // deterministic regardless of supabase's row order. Collisions are
  // logged as warnings — the unique partial index on
  // `(campus_id, post_url) WHERE post_url IS NOT NULL` is still a carry
  // item, so silent overwrites would mean cross-student misattribution
  // until that constraint lands. See Codex review fix 2.
  const m = new Map();
  const collisions = [];
  for (const v of data || []) {
    const c = canonicalizePostUrl(v.post_url);
    if (!c) continue;
    if (m.has(c)) {
      collisions.push({ url: c, kept_id: m.get(c).id, dropped_id: v.id });
      continue;
    }
    m.set(c, v);
  }

  if (collisions.length > 0) {
    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'duplicate_post_urls_detected',
      status: 'warning',
      payload: {
        count: collisions.length,
        sample: collisions.slice(0, 5),
      },
    });
  }

  return m;
}

/**
 * Sum of Apify-lineage view_count for (video_id, platform) over all rows
 * with `week_of < weekOf`. Used as the delta basis on steady-state weeks.
 *
 * Sheet rows are intentionally excluded — the agent's anchor row absorbs
 * pre-Apify cumulative (including any sheet history); re-counting sheet
 * rows here would double-count. See spec § "Sheet → Apify boundary".
 *
 * The strict `<` filter is what makes same-day re-runs idempotent: a row
 * already written today at `week_of == weekOf` is excluded from the
 * basis, so the next run produces the same delta.
 *
 * TODO (anchor-reset): when `current_cumulative < sumApifyPrior` persists
 * for ≥2 consecutive weeks, the agent should plant a new anchor row at
 * the new (lower) cumulative instead of writing zeros forever. Until
 * implemented, the negative-delta event surfaces as an `error`-status
 * agent_log so an operator can manually delete the stale anchor and
 * let cold-start re-plant. See spec §"Operator runbook: negative-delta
 * recovery". Tracked by Codex review fix 3.
 */
async function getDeltaBasis(videoId, platform, weekOf) {
  const { data, error } = await supabase
    .from('performance')
    .select('view_count')
    .eq('video_id', videoId)
    .eq('platform', platform)
    .in('source', ['apify', 'apify_anchor'])
    .lt('week_of', weekOf);
  if (error) throw new Error(`delta basis query failed: ${error.message}`);
  let sum = 0;
  for (const r of data || []) sum += r.view_count || 0;
  return { sumApifyPrior: sum, hasPriorApify: (data || []).length > 0 };
}

// ── Match + upsert assembly ────────────────────────────────────────────────

/**
 * Filter scraped items to those matching `videos.post_url` in the index.
 * Items missing a usable URL or with a non-coercible `viewCount` are
 * dropped into `invalid` with a reason string and a sample of the bad
 * shape — the caller logs them per profile so a scraper-contract drift
 * (e.g. Apify ships `viewCount` as a string of garbage one day) is
 * obvious in `agent_logs` instead of looking like a low-activity week.
 *
 * Coercion: numeric strings (e.g. Apify returning `"1234"` instead of
 * `1234`) are accepted via `Number(rawViewCount)` after a typeof guard
 * that rejects null/undefined/empty-string explicitly, since `Number(null)`
 * is `0` (a valid view count we don't want to fabricate).
 *
 * @returns {{
 *   matches: Array<{videoId: string, currentCumulative: number}>,
 *   unmatched: string[],
 *   invalid: Array<{url: string|null, viewCount: any, reason: string}>
 * }}
 */
function matchScrapedItems(items, videoIndex) {
  const matches = [];
  const unmatched = [];
  const invalid = [];
  for (const item of items || []) {
    const url = item && item.url;
    const rawViewCount = item && item.viewCount;

    let viewCount = NaN;
    if (typeof rawViewCount === 'number') {
      viewCount = rawViewCount;
    } else if (typeof rawViewCount === 'string' && rawViewCount.trim() !== '') {
      viewCount = Number(rawViewCount);
    }

    if (!url || typeof url !== 'string' || url.trim() === '') {
      invalid.push({ url: typeof url === 'string' ? url : null, viewCount: rawViewCount, reason: 'missing_url' });
      continue;
    }
    if (!Number.isFinite(viewCount) || viewCount < 0) {
      invalid.push({ url, viewCount: rawViewCount, reason: 'invalid_viewCount' });
      continue;
    }
    const canon = canonicalizePostUrl(url);
    const video = canon ? videoIndex.get(canon) : null;
    if (!video) {
      unmatched.push(url);
      continue;
    }
    matches.push({ videoId: video.id, currentCumulative: Math.round(viewCount) });
  }
  return { matches, unmatched, invalid };
}

/**
 * Compute the upsert row for one (video, platform) match given a current
 * cumulative scrape and a target weekOf.
 *
 *   Cold-start  → write 'apify_anchor' carrying the lifetime cumulative.
 *   Steady-state → write 'apify' with `current_cumulative - sum_apify_prior`,
 *                  floored at 0.
 *
 * Exported so the test harness can drive each path with forced inputs.
 */
async function buildUpsertRowForMatch({ campusId, videoId, platform, currentCumulative, weekOf }) {
  const { sumApifyPrior, hasPriorApify } = await getDeltaBasis(videoId, platform, weekOf);
  if (!hasPriorApify) {
    return {
      row: {
        campus_id: campusId,
        video_id: videoId,
        platform,
        view_count: Math.max(0, Math.round(currentCumulative)),
        week_of: weekOf,
        source: 'apify_anchor',
      },
      sumApifyPrior,
      hasPriorApify,
      flooredNegative: false,
    };
  }
  const raw = Math.round(currentCumulative) - sumApifyPrior;
  const flooredNegative = raw < 0;
  return {
    row: {
      campus_id: campusId,
      video_id: videoId,
      platform,
      view_count: Math.max(0, raw),
      week_of: weekOf,
      source: 'apify',
    },
    sumApifyPrior,
    hasPriorApify,
    flooredNegative,
  };
}

// ── Run ────────────────────────────────────────────────────────────────────

async function run(campusId) {
  const weekOf = mostRecentFriday();
  const counters = {
    studentsScanned: 0,
    profilesScraped: 0,
    scrapeErrors: 0,
    scrapedVideos: 0,
    invalidItems: 0,
    matched: 0,
    unmatched: [],
    written: 0,
    anchorsPlanted: 0,
    deltasWritten: 0,
    // Array of {videoId, platform, currentCumulative, sumApifyPrior} so
    // the operator-facing log can surface samples (Codex review fix 3).
    negativeDeltaFloored: [],
  };

  try {
    await log({ campusId, agent: AGENT_NAME, action: 'profile_views_run_started', payload: { weekOf } });

    const [students, videoIndex] = await Promise.all([
      loadStudentsWithHandles(campusId),
      loadVideoUrlIndex(campusId),
    ]);
    counters.studentsScanned = students.length;

    // Surface the actionable handleless-with-videos case so the operator
    // can fill the missing handles. Cheap two-query check; bounded by the
    // small number of campus students.
    await warnHandlelessWithVideos(campusId);

    const matches = []; // { videoId, platform, currentCumulative }

    for (const student of students) {
      for (const platform of ['tiktok', 'instagram']) {
        const handleField = platform === 'tiktok' ? 'handle_tiktok' : 'handle_instagram';
        const handle = student[handleField];
        if (!handle || !String(handle).trim()) continue;

        let profileUrl;
        try {
          profileUrl = buildProfileUrl(platform, handle);
        } catch (err) {
          await log({
            campusId,
            agent: AGENT_NAME,
            action: 'profile_views_handle_invalid',
            status: 'warning',
            payload: { studentId: student.id, platform, handle, reason: err.message },
          });
          continue;
        }

        let items;
        try {
          items = await scrapeProfileVideos(profileUrl, platform, 20);
          if (!Array.isArray(items)) {
            throw new Error(`scrapeProfileVideos returned non-array: ${typeof items}`);
          }
          counters.profilesScraped++;
          await log({
            campusId,
            agent: AGENT_NAME,
            action: `${platform}_scrape_complete`,
            payload: { studentId: student.id, profileUrl, count: items.length },
          });
        } catch (err) {
          counters.scrapeErrors++;
          await log({
            campusId,
            agent: AGENT_NAME,
            action: 'profile_views_scrape_error',
            status: 'error',
            errorMessage: err.message,
            payload: { studentId: student.id, profileUrl, platform },
          });
          continue;
        }

        counters.scrapedVideos += items.length;

        const { matches: m, unmatched: u, invalid: inv } = matchScrapedItems(items, videoIndex);
        counters.matched += m.length;
        counters.unmatched.push(...u);
        if (inv.length > 0) {
          counters.invalidItems += inv.length;
          // Per-profile log: which student × platform produced the bad
          // items, with a small sample of the bad shape so contract drift
          // is debuggable from agent_logs alone. Codex review fix 4.
          await log({
            campusId,
            agent: AGENT_NAME,
            action: 'profile_views_invalid_items',
            status: 'warning',
            payload: {
              studentId: student.id,
              profileUrl,
              platform,
              count: inv.length,
              sample: inv.slice(0, 3),
            },
          });
        }
        for (const mr of m) {
          matches.push({ videoId: mr.videoId, platform, currentCumulative: mr.currentCumulative });
        }
      }
    }

    // One delta-basis query per (video_id, platform). The match list can
    // have multiple entries for the same pair if the scraper returns the
    // same URL twice; the dedup below handles the upsert side, but for
    // efficiency we cache the basis per pair too.
    const basisCache = new Map();
    const upserts = [];
    for (const m of matches) {
      const key = `${m.videoId}|${m.platform}`;
      if (!basisCache.has(key)) {
        basisCache.set(key, await getDeltaBasis(m.videoId, m.platform, weekOf));
      }
      const { sumApifyPrior, hasPriorApify } = basisCache.get(key);

      let row;
      if (!hasPriorApify) {
        row = {
          campus_id: campusId,
          video_id: m.videoId,
          platform: m.platform,
          view_count: Math.max(0, m.currentCumulative),
          week_of: weekOf,
          source: 'apify_anchor',
        };
        counters.anchorsPlanted++;
      } else {
        const raw = m.currentCumulative - sumApifyPrior;
        if (raw < 0) {
          counters.negativeDeltaFloored.push({
            videoId: m.videoId,
            platform: m.platform,
            currentCumulative: m.currentCumulative,
            sumApifyPrior,
          });
        }
        row = {
          campus_id: campusId,
          video_id: m.videoId,
          platform: m.platform,
          view_count: Math.max(0, raw),
          week_of: weekOf,
          source: 'apify',
        };
        counters.deltasWritten++;
      }
      upserts.push(row);
    }

    // Dedup before chunking — defends against the scraper returning the
    // same URL twice in one run, which would otherwise trip Postgres's
    // "ON CONFLICT DO UPDATE command cannot affect row a second time".
    // Last-write-wins; equal duplicates collapse to one.
    const deduped = new Map();
    for (const u of upserts) {
      deduped.set(`${u.video_id}|${u.platform}|${u.week_of}`, u);
    }
    const finalUpserts = [...deduped.values()];

    const CHUNK = 500;
    for (let i = 0; i < finalUpserts.length; i += CHUNK) {
      const chunk = finalUpserts.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('performance')
        .upsert(chunk, { onConflict: 'video_id,platform,week_of' });
      if (error) throw new Error(`performance upsert failed: ${error.message}`);
      counters.written += chunk.length;
    }

    if (counters.unmatched.length > 0) {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'profile_views_unmatched',
        status: 'warning',
        payload: { count: counters.unmatched.length, sample: counters.unmatched.slice(0, 10) },
      });
    }

    if (counters.negativeDeltaFloored.length > 0) {
      // Status `error` (not `warning`): a negative delta means the stored
      // basis is now permanently inflated relative to reality. Every
      // subsequent week will produce a 0 delta until the cumulative
      // climbs back above the stale sum — which may never happen if the
      // missing views came from a deleted post. Treat as state
      // corruption that requires operator action. Recovery procedure:
      // workflows/profile-views.md §"Operator runbook: negative-delta
      // recovery". Codex review fix 3.
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'profile_views_negative_delta_floored',
        status: 'error',
        payload: {
          count: counters.negativeDeltaFloored.length,
          samples: counters.negativeDeltaFloored.slice(0, 5),
        },
      });
    }

    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'profile_views_run_complete',
      payload: {
        weekOf,
        studentsScanned: counters.studentsScanned,
        profilesScraped: counters.profilesScraped,
        scrapeErrors: counters.scrapeErrors,
        scrapedVideos: counters.scrapedVideos,
        invalidItems: counters.invalidItems,
        matched: counters.matched,
        unmatched: counters.unmatched.length,
        written: counters.written,
        anchorsPlanted: counters.anchorsPlanted,
        deltasWritten: counters.deltasWritten,
        negativeDeltaFloored: counters.negativeDeltaFloored.length,
      },
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

/**
 * Per-run check: are there any students with NO handles set who already
 * have `videos.post_url` rows? That's the actionable case — we have URLs
 * but no path to refresh their view counts. Two queries, batched by
 * student_id.
 */
async function warnHandlelessWithVideos(campusId) {
  const handleless = await loadHandlelessStudents(campusId);
  if (handleless.length === 0) return;

  const ids = handleless.map((s) => s.id);
  const { data: videos, error } = await supabase
    .from('videos')
    .select('student_id')
    .eq('campus_id', campusId)
    .in('student_id', ids)
    .not('post_url', 'is', null);
  if (error) {
    await log({
      campusId,
      agent: AGENT_NAME,
      action: 'handleless_check_failed',
      status: 'warning',
      errorMessage: error.message,
    });
    return;
  }

  const counts = new Map();
  for (const v of videos || []) {
    counts.set(v.student_id, (counts.get(v.student_id) || 0) + 1);
  }
  for (const s of handleless) {
    const c = counts.get(s.id) || 0;
    if (c > 0) {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'profile_views_handleless_with_videos',
        status: 'warning',
        payload: { studentId: s.id, name: s.name, postUrlCount: c },
      });
    }
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
  // helpers exported for tests + parity with sibling agents
  mostRecentFriday,
  canonicalizePostUrl,
  buildProfileUrl,
  matchScrapedItems,
  buildUpsertRowForMatch,
  loadStudentsWithHandles,
  loadHandlelessStudents,
  loadVideoUrlIndex,
  getDeltaBasis,
};
