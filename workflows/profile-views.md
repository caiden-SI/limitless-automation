# Profile Views Agent

SOP for building and maintaining the Profile Views Agent. Source of truth for any build or refactor of this agent. Do not deviate from this spec without updating it first.

## Objective

Replace Scott's manual weekly sheet updates with an automated Thursday scrape of every Austin student's primary TikTok and Instagram profiles. For each scraped video, match the URL back to a `videos` row by `post_url` and write one `performance` row per (video, platform) keyed on a Friday-aligned `week_of`. Brand accounts (Alpha High) are scraped alongside human students using the same per-`students.handle_*` lookup.

The agent is the live counterpart to `scripts/sync-performance-tracker.js`: the sync ingests Scott's hand-maintained Google Sheet, this agent ingests Apify scrapes. Both write to the same `performance` table with the same `(video_id, platform, week_of)` unique key, so the Performance Agent's Monday 7 AM analysis sees one consistent dataset.

## Trigger

Cron job, weekly, Thursday at 9 AM. Registered in `server.js` via `lib/scheduler.js`. Schedule string: `0 9 * * 4`.

Why Thursday morning: it puts the snapshot one day before the Friday that anchors `week_of`, captures the bulk of a week's view accumulation, and lands in time for Scott's Friday review. The Performance Agent runs Monday 7 AM, so this scrape is in well before the next analysis window.

## Inputs

From Supabase (`students` table for the campus):
- `id`, `name`, `campus_id`
- `handle_tiktok` (primary TikTok handle, e.g. `alphahigh.school`)
- `handle_instagram` (primary Instagram handle, e.g. `alphahigh.school`)
- `is_brand_account` (informational only — both human and brand students with handles are scraped the same way)

From Apify (per profile, capped at 20 most recent videos):
- Public video URL
- View count

From Supabase (`videos` table) for URL-to-video matching:
- `id`, `post_url`, `student_id`, `campus_id`

From Supabase (`performance` table) for cumulative-to-delta arithmetic:
- All existing rows for `(video_id, platform)` with `source IN ('apify','apify_anchor')` and `week_of < this Friday` — these form the agent's own lineage; sheet rows are excluded from the delta math by design (see "Sheet→Apify boundary" below).

## Tools used

Existing:
- `lib/supabase.js` — service role client for all DB reads and writes
- `lib/logger.js` — writes to `agent_logs` with `agent_name = "profile-views"`
- `lib/scheduler.js` — cron registration
- `lib/self-heal.js` — top-level error handler (mirrors `agents/research.js`, `agents/fireflies.js`)
- `tools/scraper.js` → `scrapeProfileVideos(profileUrl, platform, maxResults)` — Apify wrapper. Already used by the Onboarding Agent's Section 3.

New (single new file expected):
- `agents/profile-views.js` — orchestration. Per-campus iteration, per-student × per-platform scrape, URL-to-video match, delta computation, upsert.

## Data model additions

`performance.source text NOT NULL DEFAULT 'sheet'` — added by `scripts/migrations/2026-05-04-performance-source.sql`. Three values in use:

- `'sheet'`     — written by `scripts/sync-performance-tracker.js`. Weekly deltas from Scott's hand-maintained Google Sheet. No cumulative baseline.
- `'apify_anchor'` — written by this agent on cold-start (first ever Apify scrape per `(video_id, platform)`). Stores the cumulative lifetime view count at cold-start time. Used as the baseline for all subsequent delta computation. Excluded from the Performance Agent's pattern-recognition aggregation.
- `'apify'`    — written by this agent on steady-state weeks. Pure weekly deltas relative to the anchor + previous Apify rows.

```
id, campus_id, video_id, platform, view_count, week_of, source, created_at
unique (video_id, platform, week_of)              -- from 2026-05-04-videos-post-url.sql
index  (video_id, platform, source)               -- from 2026-05-04-performance-source.sql
```

Why an explicit anchor: the sheet writes weekly deltas without a cumulative baseline. For any video with sheet history, the agent cannot derive "lifetime cumulative as of this Thursday" from the sheet rows alone — it only knows the deltas the sheet captured, which started mid-life of the video. The first Apify scrape captures true cumulative; recording it as an anchor row makes every subsequent week's delta (`current_cumulative - sum(apify-lineage prior rows)`) mathematically exact.

## Process flow

For each active campus:

1. **Cron fires Thursday 9 AM.** Compute `weekOf` = ISO date of the most recent Friday on or before today (e.g., Thursday 2026-05-07 → `2026-05-01`). Helper: `mostRecentFriday(now)`. Same date format as `sync-performance-tracker.js` writes, same Friday alignment as Scott's sheet headers.
2. **Load students with handles.** Query `students` for the campus where `handle_tiktok IS NOT NULL OR handle_instagram IS NOT NULL`. Brand and human students are loaded the same way.
3. **Load video URL index.** Query `videos` for the campus, filtered to `post_url IS NOT NULL`. Build a `Map<canonicalUrl, video>` keyed by the canonicalized URL. Use the same canonicalization rule as `agents/pipeline.js canonicalizePostUrl` (drop query/hash, lowercase host, strip trailing slash) so a scraped URL hashes identically to a stored `post_url`.
4. **For each student, for each platform** (`tiktok` if `handle_tiktok` set, `instagram` if `handle_instagram` set):
   - Build the profile URL: `https://www.tiktok.com/@<handle>` or `https://www.instagram.com/<handle>/`. Strip any leading `@` from the handle field defensively (the brand-voice validator already does this).
   - Call `tools/scraper.scrapeProfileVideos(profileUrl, platform, 20)`. On scraper error, log with status `error` and continue to the next platform — one bad profile must not abort the run.
   - For each scraped video, canonicalize its URL and look it up in the video index. **No match → skip with a single per-run aggregated log entry** listing unmatched URLs (mirroring `sync-performance-tracker.js`'s tail-of-run `unmatched` block).
5. **Pre-compute delta basis per matched (video_id, platform).** For each unique pair the scrape resolved, run a single query:

   ```sql
   SELECT COALESCE(SUM(view_count), 0) AS sum_apify_prior,
          COUNT(*)                       AS apify_row_count
     FROM performance
    WHERE video_id = $1
      AND platform = $2
      AND source IN ('apify', 'apify_anchor')
      AND week_of < $3   -- weekOf for this run, strictly less than
   ```

   Cache the result in a `Map<(video_id,platform), {sumApifyPrior, hasPriorApify}>` keyed by `${video_id}|${platform}`. Sheet rows are intentionally excluded from `sum_apify_prior` — the anchor row written on cold-start represents the absorbed pre-Apify cumulative (including whatever the sheet had captured); sheet rows therefore must not be re-counted in the agent's running sum.

6. **Compute and upsert.** For each scraped `(video_id, platform, current_cumulative_views)`:

   - **Cold start** (`hasPriorApify === false` — no `'apify'` or `'apify_anchor'` row exists for this `(video_id, platform)`):
     - Write `{week_of: weekOf, view_count: current_cumulative_views, source: 'apify_anchor'}`.
     - This row records lifetime cumulative as of the first scrape and is the baseline for every subsequent delta. The Performance Agent excludes `source = 'apify_anchor'` from its aggregation (see "Performance Agent prerequisite" below), so the anchor's value does not show up as a viral-week spike.
     - **Important:** any sheet rows for this `(video_id, platform)` remain in the table with `source = 'sheet'` and continue to feed the Performance Agent's last-4-weeks analysis as weekly deltas. They are not deleted, not migrated, not re-counted — the anchor sits alongside them.

   - **Steady state** (`hasPriorApify === true`):
     - `view_count = max(0, current_cumulative_views - sum_apify_prior)` — the delta since the most recent Apify-lineage observation. Floor at 0 because creators can delete posts, which would otherwise produce negative deltas.
     - Write `{week_of: weekOf, view_count, source: 'apify'}`.

   - **Same-week re-run** (a row with this exact `(video_id, platform, week_of)` already exists from an earlier run today): `ON CONFLICT (video_id, platform, week_of) DO UPDATE`. The strict `<` filter on `week_of` in step 5 means `sum_apify_prior` excludes today's prior write, so re-computing produces the same value. Re-running the cron is idempotent. The conflict update preserves whatever `source` was first written — cold-start re-runs stay `'apify_anchor'`, steady-state re-runs stay `'apify'`.

7. **Per-batch dedup before chunking.** Mirror `sync-performance-tracker.js`'s Session 21 defense: dedupe the upsert array by `(video_id, platform, week_of)` last-write-wins before sending to Postgres, in case the scraper returns the same URL twice in one run.

8. **Log summary.** One `agent_logs` row per campus with `payload: { studentsScanned, profilesScraped, scrapeErrors, scrapedVideos, matched, unmatched, written, anchorsPlanted, deltasWritten, weekOf }`. `anchorsPlanted` and `deltasWritten` together equal `written`; tracking them separately makes the cold-start cutover observable in the dashboard.

### Sheet → Apify boundary (why anchors exist)

Without an explicit anchor, the first Apify scrape against a video that already has sheet history would compute `current_cumulative_lifetime - sum(sheet_weekly_deltas)`. The result is "all lifetime views minus the sliver the sheet captured" — i.e. it absorbs the entire pre-sheet history into one week's delta. With ~184 videos already carrying sheet rows at the time the cron first fires, this would produce 184 phantom viral weeks visible to the Monday Performance Agent run.

The anchor row sidesteps the math problem (its `view_count` IS the absorbed lifetime, not a delta) and the Performance Agent prerequisite filter sidesteps the analytics problem (the anchor never enters pattern recognition). After the first Thursday, every subsequent week is a clean Apify-lineage delta computed only against `'apify'` and `'apify_anchor'` rows.

### Performance Agent prerequisite

`agents/performance.js` must be updated in the same session as this build — one-line change to its `performance` query:

```js
// BEFORE
const { data: perfData, error: pErr } = await supabase
  .from('performance')
  .select('video_id, platform, view_count, week_of')
  .eq('campus_id', campusId)
  .gte('created_at', fourWeeksAgo.toISOString())
  .order('view_count', { ascending: false });

// AFTER
const { data: perfData, error: pErr } = await supabase
  .from('performance')
  .select('video_id, platform, view_count, week_of, source')
  .eq('campus_id', campusId)
  .in('source', ['sheet', 'apify'])    // exclude 'apify_anchor' — not a weekly delta
  .gte('created_at', fourWeeksAgo.toISOString())
  .order('view_count', { ascending: false });
```

Existing `performance` rows have `source = 'sheet'` (default), so this filter is no-op until the first Profile Views cron writes `'apify_anchor'` rows. Add a brief test in `scripts/test-performance-agent.js` that seeds one `'apify_anchor'` row alongside synthetic `'sheet'` rows and asserts the anchor is not in the aggregated top-performers list.

## Outputs

Per cron fire:
- N new (or updated) `performance` rows, one per scraped video that resolved to a `videos.post_url`. N is bounded by `students × 2 platforms × 20 maxResults` per campus.
- One `agent_logs` summary row per campus with `agent_name = "profile-views"`, `action = "profile_views_run_complete"`.
- Per-step `agent_logs` entries: `profile_views_run_started`, `tiktok_scrape_complete` / `instagram_scrape_complete` (per profile), unmatched URL list, write completion.

## Validation

- `students.handle_tiktok` and `handle_instagram`, if non-null, must be non-empty strings after trim. Empty/whitespace handles are skipped with a `warning` log so the operator can fix the value.
- `scrapeProfileVideos` return must be an array. If not an array, treat as a scrape error (caller continues to next platform).
- Each scraped item must have a parseable URL and a non-negative integer `viewCount`. Items failing either check are skipped with a single aggregated debug log per profile. (The `viewCount` field is supplied by `tools/scraper.js scrapeProfileVideos` per the Session 24 update; tests must assert its presence to catch a future regression.)
- `current_cumulative_views` must be `>= 0` and `<= sum_apify_prior + reasonable_growth_ceiling`. The agent does not enforce a growth ceiling — extreme jumps are real (a video going viral) and signal-rich for the Performance Agent.
- `source` written by this agent must be one of `'apify'` or `'apify_anchor'`. Never `'sheet'` (that value is reserved for the tracker sync). Asserted in tests.
- Friday alignment: `weekOf` must be a Friday. `mostRecentFriday()` is unit-tested against Mon/Tue/Wed/Thu/Fri/Sat/Sun inputs.

## Edge cases

- **No handles for a student.** Skip the student. No log unless `handle_tiktok` and `handle_instagram` are both null AND the student has any `videos.post_url` rows — that's the actionable case (we have URLs but can't refresh them) and warrants a `warning` log per run.
- **Apify rate limit / outage.** `scrapeProfileVideos` throws. Log `profile_views_scrape_error` with the profile URL and platform, continue to next student × platform. The run is not aborted; partial coverage is better than no coverage. The next Thursday will retry.
- **Scraped URL doesn't match any `videos.post_url`.** This is the most common case — the profile has older posts that predate the backfill, or new posts that haven't flipped to "posted by client" yet. Record in the per-run unmatched list, do not log per-video. The `Pipeline Agent recordPostUrl` (Session 22) is the canonical path for adding new URLs; profile-views does not insert `videos` rows.
- **`current_cumulative_views < sum_apify_prior`.** Floor at 0. Logs `profile_views_negative_delta_floored` at `warning` once per run, with the count of affected videos. Implies a deleted post or platform metric reset. Only applies on the steady-state path; cold-start writes the cumulative directly so the inequality cannot trigger.
- **Cron fires on a Thursday that is also the day Scott updated the sheet.** Sheet rows carry `source = 'sheet'`; Apify rows carry `source = 'apify'` or `'apify_anchor'`. They share the same `(video_id, platform, week_of)` unique key, so **last write wins by source**: a same-week Apify scrape after the sheet sync overwrites the sheet row at that week. This is acceptable during cutover (sheet sync is being retired anyway). Once the sheet sync is decommissioned, this collision goes away.
- **Sheet history coexisting with the new anchor.** When a video has prior sheet rows AND the agent plants an anchor today, both stay in the table. The Performance Agent's `source IN ('sheet', 'apify')` filter (anchor excluded) yields a clean weekly-delta view across the boundary: pre-anchor sheet deltas + post-anchor Apify deltas, none double-counted, no spike. The anchor's `view_count` is invisible to the Performance Agent and is only consulted by this agent's own `sum_apify_prior` query.
- **Brand account vs human student.** The agent does not branch on `is_brand_account`. The discriminator only matters to dashboard rollups. The pipeline produces `videos` rows for brand-account content the same way it does for human content (post URL written on `posted by client`), and those rows match against the scraped URLs identically.
- **Multiple handles per platform per student.** Out of scope for v1 (per the build decision: "primary handle only for now"). If a student adds a second TikTok account, future schema work adds `students.handles_tiktok jsonb` (or sibling table) — until then, the agent reads the singular field and ignores anything else.
- **Existing sheet row at the same `week_of`.** Detected via `ON CONFLICT`, overwritten by the agent's value. Acceptable because both observations describe the same week's reality; the more recent write wins.

## Error handling

Per CLAUDE.md rule 1: log full error to `agent_logs` with status `"error"` BEFORE any recovery attempt. The agent's outer try/catch hands to `lib/self-heal.handle` with a single retry, mirroring `agents/research.js` and `agents/fireflies.js`.

Sub-failures (one student's TikTok scrape fails) do not bubble — they are logged at `warning` and the loop continues. The outer try/catch only catches infrastructure failures (`videos` index load, the supabase client itself).

## Operator runbook: negative-delta recovery

When the scrape's current cumulative drops below `sumApifyPrior` (the running sum of all prior Apify-lineage rows for `(video, platform)`), the agent floors the new delta at 0 and emits an `error`-status log `profile_views_negative_delta_floored`. Payload includes `count` plus up to 5 sample rows with `videoId, platform, currentCumulative, sumApifyPrior`.

Common causes: the creator deleted a high-view post; the platform reset its public counter; or the post was unpublished and re-published with a fresh count. The 0-floor is correct for that one week — but every subsequent week will also produce a 0 delta until the new cumulative climbs back above the stale sum, which may never happen if the deleted post was the bulk of the views. Treat the log as state corruption that requires action.

### Manual recovery (until anchor-reset is implemented)

For each affected `(video_id, platform)` from the log payload:

1. Verify the platform-side state — confirm whether a major post was deleted, the cumulative reset, or some other event explains the drop.
2. Delete the stale Apify-lineage rows for that pair:

   ```sql
   DELETE FROM performance
    WHERE video_id = $1
      AND platform = $2
      AND source IN ('apify','apify_anchor');
   ```

   Sheet rows (`source='sheet'`) stay — they remain valid pre-Apify history and continue to feed the Performance Agent's last-4-weeks window.
3. The next Thursday cron re-anchors at the current cumulative. The cold-start path writes a fresh `apify_anchor` and steady-state resumes from there. Until then, the dropped Apify-lineage history is rebuildable from future scrapes; this manual reset just unblocks delta math going forward.

The longer-term fix is anchor-reset-on-sustained-negative — when the condition persists for ≥2 weeks, the agent should auto-plant a new anchor at the new cumulative. Tracked as a TODO in `agents/profile-views.js` near `getDeltaBasis`. Until then, this manual procedure is the documented path.

## Sheet sync decommission gate

Once the Profile Views Agent has written even one `(apify | apify_anchor)` row for a campus, `scripts/sync-performance-tracker.js` is decommissioned for that campus. The two writers share the unique key `(video_id, platform, week_of)`, so a sheet upsert at the same week would clobber an Apify anchor or delta and silently break every subsequent week's delta math. The sync script enforces this with a preflight query (`assertNoApifyLineage`) that throws before any tab is read:

```
Apify-lineage rows detected — sheet sync is decommissioned. Remove the
cron and delete this script's invocation, or contact the Profile Views
Agent owner before re-running.
```

The cleaner architectural fix — including `source` in the conflict key, or partitioning sheet vs Apify into separate tables — is on the carry list. Until then, the gate is the only thing keeping the lineage clean.

## Test requirements

New file `scripts/test-profile-views-agent.js`. Must:

1. **Friday alignment unit cases.** Assert `mostRecentFriday()` returns the expected ISO date for one input per weekday (Sun → most recent Fri; Fri → that Fri; Sat → the Fri before).
2. **Real Apify scrape, real Supabase, no ClickUp.** Use Alpha High's `alphahigh.school` handle on TikTok (high volume of public posts, good signal). Assert ≥ 1 scraped item, ≥ 1 URL match against the 58 backfilled Alpha High videos, ≥ 1 `performance` row written for `weekOf`.
3. **Cold-start vs steady-state path.** For one matched (video_id, platform) pair:
   - **Cold-start:** pre-clean any existing `performance` rows for the pair, run the agent with a forced cumulative input of e.g. `5000`, assert exactly one row is written with `view_count == 5000` and `source == 'apify_anchor'`.
   - **Sheet→Apify boundary:** pre-clean as above, then seed a `source='sheet'` row with `view_count = 1500` at a `week_of` one week prior. Run the agent with a forced cumulative input of `5000`. Assert: (a) the sheet row is **untouched** (still `source='sheet'`, `view_count=1500`); (b) a new `'apify_anchor'` row is written this week with `view_count = 5000` (cumulative, NOT 5000 - 1500); (c) the `Performance Agent prerequisite` filter excludes the anchor — query with `.in('source', ['sheet','apify'])` returns the sheet row only.
   - **Steady-state:** with the anchor row from cold-start in place, re-run the agent with a forced cumulative of `7500`. Assert exactly one new row is written with `view_count == 2500` (= 7500 − 5000) and `source == 'apify'`. The anchor row is unchanged.
   - Use `agents/profile-views._test_runOneMatch()` or similar test seam.
4. **`viewCount` field present on `scrapeProfileVideos` return.** Mock or call the scraper, assert each returned item has a numeric `viewCount`. Catches the Session 24 regression class — the agent silently writing zeros if the scraper's return shape ever loses the field.
5. **Unmatched URL aggregation.** Run with a synthetic scrape that returns one matchable URL and one unmatchable URL, assert exactly one matched write and exactly one entry in the run summary's `unmatched` array.
6. **Negative delta floor.** With the anchor row in place at `view_count=5000`, force `currentCumulative=4000`, assert written `view_count == 0` and a single `warning` log line with the floored count.
7. **Cron registration smoke test.** Refactor `server.js` to expose its registration list as a function the test can call (e.g. `function registerScheduledJobs(scheduler) {...}` invoked from `app.listen`'s callback). Test calls it with a stub scheduler, asserts `'profile-views-agent'` is registered with the `0 9 * * 4` schedule when `APIFY_API_TOKEN` is set.
8. **Teardown.** Delete any test rows the harness inserted; do not delete real `performance` data created by Scott or by this agent in earlier runs. Identify test rows via a sentinel like the test campus_id or a `__perf_views_test_` title prefix on the seed video.

Test must be runnable standalone via `node scripts/test-profile-views-agent.js`. Must skip gracefully (with a clear `SKIP` log line) if `APIFY_API_TOKEN` is unset.

## Dependencies

Before the agent can run in production:

- `APIFY_API_TOKEN` set in `.env`. Without it, `tools/scraper.runActor` throws a clear preflight error and the cron is not registered.
- `students.handle_tiktok` and `students.handle_instagram` populated for every student whose content should be tracked. As of Session 23: Alpha High has both handles set. The 7 human students seeded in Session 22 have null handles and therefore won't be scraped until those are populated (either via the existing onboarding flow's handle-extraction or a one-shot UPDATE).
- `videos.post_url` populated for every video the agent should match. Session 21 backfill (126 rows) + Session 22 pipeline write on `posted by client` cover the existing inventory + the live flow. Newly posted content is automatic.
- `performance` unique constraint `(video_id, platform, week_of)` — from `scripts/migrations/2026-05-04-videos-post-url.sql`.
- `performance.source` column with default `'sheet'` and supporting index — from `scripts/migrations/2026-05-04-performance-source.sql`. Without this column the cold-start detection query has nothing to filter on and the anchor/delta semantics collapse.
- `tools/scraper.js scrapeProfileVideos` returning `viewCount` (and `likes`, `shares`) — Session 24 update. The agent treats a missing `viewCount` as a hard failure on the scraped item, but the test in §4 above guards against the regression at build time.
- `agents/performance.js` updated with `.in('source', ['sheet', 'apify'])` filter — see "Performance Agent prerequisite" above. Without it, anchor rows pollute the Monday 7 AM analysis for the 4 weeks following cutover.

## Out of scope for this workflow

- **Multiple handles per platform per student.** v1 reads only the primary `handle_tiktok` / `handle_instagram` field.
- **YouTube Shorts.** No `handle_youtube` column on `students` is consumed today; the Apify scraper supports YouTube but the v1 cron does not invoke it. Add when Scott's roster has any student doing serious YouTube volume.
- **Backfilling historical weekly buckets.** The agent only writes the current week's `weekOf`. Pre-pipeline performance history lives in Scott's sheet and is owned by `scripts/sync-performance-tracker.js`.
- **Cross-account migration / handle changes.** When a student changes their TikTok handle, the agent simply scrapes the new URL and writes new rows. Old `videos.post_url` values continue to point at the old handle's URLs, which is correct — they are the same posts.
- **Dashboard rollups for brand vs human accounts.** The `is_brand_account` flag is informational here; the dashboard owns the rollup logic.
- **Performance Agent integration.** Already exists as a Monday 7 AM cron that reads `performance`. Profile-views writes into the same table on Thursday, three days before the next analysis run, by design.

## Acceptance criteria

The agent is complete when:

- Integration test passes end-to-end against real Apify, real Supabase.
- One full Thursday cron run completes for the Austin campus and produces ≥ 1 `performance` row for at least one (video_id, platform) pair, and the run summary log shows non-zero `matched` and a defined `weekOf`.
- The cron is registered in `server.js` behind an `APIFY_API_TOKEN` env-gate, and a clean boot log shows it (or its DISABLED variant) on startup.
- `scripts/migrations/` carries no new migration (the existing schema is sufficient — confirm in commit message).
- `workflows/profile-views.md` matches the implementation. If behavior intentionally diverges, update this spec first.
- `docs/progress-log.md` entry added for the session.
- `docs/architecture.md` agent matrix and cron schedule table updated with the new row.
