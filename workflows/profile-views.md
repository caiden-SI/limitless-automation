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
- All existing rows for `(video_id, platform)` with `week_of < this Friday`

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

None. The existing `performance` table is sufficient:

```
id, campus_id, video_id, platform, view_count, week_of, created_at
unique (video_id, platform, week_of)  -- from 2026-05-04-videos-post-url.sql
```

The `view_count` column carries weekly deltas to match Scott's sheet semantics — see "Process flow" step 6 for the cumulative-vs-delta rule.

## Process flow

For each active campus:

1. **Cron fires Thursday 9 AM.** Compute `weekOf` = ISO date of the most recent Friday on or before today (e.g., Thursday 2026-05-07 → `2026-05-01`). Helper: `mostRecentFriday(now)`. Same date format as `sync-performance-tracker.js` writes, same Friday alignment as Scott's sheet headers.
2. **Load students with handles.** Query `students` for the campus where `handle_tiktok IS NOT NULL OR handle_instagram IS NOT NULL`. Brand and human students are loaded the same way.
3. **Load video URL index.** Query `videos` for the campus, filtered to `post_url IS NOT NULL`. Build a `Map<canonicalUrl, video>` keyed by the canonicalized URL. Use the same canonicalization rule as `agents/pipeline.js canonicalizePostUrl` (drop query/hash, lowercase host, strip trailing slash) so a scraped URL hashes identically to a stored `post_url`.
4. **For each student, for each platform** (`tiktok` if `handle_tiktok` set, `instagram` if `handle_instagram` set):
   - Build the profile URL: `https://www.tiktok.com/@<handle>` or `https://www.instagram.com/<handle>/`. Strip any leading `@` from the handle field defensively (the brand-voice validator already does this).
   - Call `tools/scraper.scrapeProfileVideos(profileUrl, platform, 20)`. On scraper error, log with status `error` and continue to the next platform — one bad profile must not abort the run.
   - For each scraped video, canonicalize its URL and look it up in the video index. **No match → skip with a single per-run aggregated log entry** listing unmatched URLs (mirroring `sync-performance-tracker.js`'s tail-of-run `unmatched` block).
5. **Pre-compute delta basis per matched (video_id, platform).** For each unique pair the scrape resolved, query `performance.view_count` summed over all rows where `week_of < weekOf`. This sum equals the cumulative-to-date as of the last recorded snapshot (since week 1 is cumulative and every subsequent week is a delta — `sum(deltas) + first_cumulative = current_cumulative`). One query per video × platform pair; cache in a `Map`.
6. **Compute and upsert.** For each scraped (video_id, platform, current_cumulative_views):
   - **First week** (`sum_prior == 0`): `view_count = current_cumulative_views` — this is the first observation, write it cumulative so step 5's running sum starts working next week.
   - **Subsequent weeks** (`sum_prior > 0`): `view_count = max(0, current_cumulative_views - sum_prior)` — the delta since the most recent recorded total. Floor at 0 because a creator can delete videos, which would otherwise produce negative weekly counts; better to record 0 than to pretend views regressed.
   - **Same week re-run** (a row already exists with this exact `week_of`): the upsert's `ON CONFLICT (video_id, platform, week_of)` updates the existing row. Re-running the cron a second time on the same Thursday is therefore safe and produces the same result (idempotent).
7. **Per-tab dedup before chunking.** Same defense as `sync-performance-tracker.js` Session 21: dedupe the upsert array by `(video_id, platform, week_of)` last-write-wins before sending to Postgres, in case the scraper returns the same URL twice in one run.
8. **Log summary.** One `agent_logs` row per campus with `payload: { studentsScanned, profilesScraped, scrapeErrors, scrapedVideos, matched, unmatched, written, weekOf }`.

The clarifying note on step 6: the user instruction "scrape current count, subtract last row, write delta" is correct for the Week 1 → Week 2 transition (last row IS the cumulative). Beyond that, "last row" must mean "the running sum of all prior delta rows", which equals the last-known cumulative. Querying via `SUM(view_count)` rather than reading just the most recent row is what makes deltas mathematically consistent across many weeks.

## Outputs

Per cron fire:
- N new (or updated) `performance` rows, one per scraped video that resolved to a `videos.post_url`. N is bounded by `students × 2 platforms × 20 maxResults` per campus.
- One `agent_logs` summary row per campus with `agent_name = "profile-views"`, `action = "profile_views_run_complete"`.
- Per-step `agent_logs` entries: `profile_views_run_started`, `tiktok_scrape_complete` / `instagram_scrape_complete` (per profile), unmatched URL list, write completion.

## Validation

- `students.handle_tiktok` and `handle_instagram`, if non-null, must be non-empty strings after trim. Empty/whitespace handles are skipped with a `warning` log so the operator can fix the value.
- `scrapeProfileVideos` return must be an array. If not an array, treat as a scrape error (caller continues to next platform).
- Each scraped item must have a parseable URL and a non-negative integer `viewCount`. Items failing either check are skipped with a single aggregated debug log per profile.
- `current_cumulative_views` must be `>= 0` and `<= sum_prior + reasonable_growth_ceiling`. The agent does not enforce a growth ceiling — extreme jumps are real (a video going viral) and signal-rich for the Performance Agent.
- Friday alignment: `weekOf` must be a Friday. `mostRecentFriday()` is unit-tested against Mon/Tue/Wed/Thu/Fri/Sat/Sun inputs.

## Edge cases

- **No handles for a student.** Skip the student. No log unless `handle_tiktok` and `handle_instagram` are both null AND the student has any `videos.post_url` rows — that's the actionable case (we have URLs but can't refresh them) and warrants a `warning` log per run.
- **Apify rate limit / outage.** `scrapeProfileVideos` throws. Log `profile_views_scrape_error` with the profile URL and platform, continue to next student × platform. The run is not aborted; partial coverage is better than no coverage. The next Thursday will retry.
- **Scraped URL doesn't match any `videos.post_url`.** This is the most common case — the profile has older posts that predate the backfill, or new posts that haven't flipped to "posted by client" yet. Record in the per-run unmatched list, do not log per-video. The `Pipeline Agent recordPostUrl` (Session 22) is the canonical path for adding new URLs; profile-views does not insert `videos` rows.
- **`current_cumulative_views < sum_prior`.** Floor at 0. Logs `profile_views_negative_delta_floored` at `warning` once per run, with the count of affected videos. Implies a deleted post or platform metric reset.
- **Cron fires on a Thursday that is also the day Scott updated the sheet.** Both writes target the same `(video_id, platform, week_of)`. Last write wins. Order is non-deterministic across systems, but the values should be close — if they differ, the agent's Apify scrape is more recent than Scott's manual sheet entry.
- **Brand account vs human student.** The agent does not branch on `is_brand_account`. The discriminator only matters to dashboard rollups. The pipeline produces `videos` rows for brand-account content the same way it does for human content (post URL written on `posted by client`), and those rows match against the scraped URLs identically.
- **Multiple handles per platform per student.** Out of scope for v1 (per the build decision: "primary handle only for now"). If a student adds a second TikTok account, future schema work adds `students.handles_tiktok jsonb` (or sibling table) — until then, the agent reads the singular field and ignores anything else.
- **Existing sheet row at the same `week_of`.** Detected via `ON CONFLICT`, overwritten by the agent's value. Acceptable because both observations describe the same week's reality; the more recent write wins.

## Error handling

Per CLAUDE.md rule 1: log full error to `agent_logs` with status `"error"` BEFORE any recovery attempt. The agent's outer try/catch hands to `lib/self-heal.handle` with a single retry, mirroring `agents/research.js` and `agents/fireflies.js`.

Sub-failures (one student's TikTok scrape fails) do not bubble — they are logged at `warning` and the loop continues. The outer try/catch only catches infrastructure failures (`videos` index load, the supabase client itself).

## Test requirements

New file `scripts/test-profile-views-agent.js`. Must:

1. **Friday alignment unit cases.** Assert `mostRecentFriday()` returns the expected ISO date for one input per weekday (Sun → most recent Fri; Fri → that Fri; Sat → the Fri before).
2. **Real Apify scrape, real Supabase, no ClickUp.** Use Alpha High's `alphahigh.school` handle on TikTok (high volume of public posts, good signal). Assert ≥ 1 scraped item, ≥ 1 URL match against the 58 backfilled Alpha High videos, ≥ 1 `performance` row written for `weekOf`.
3. **First-week vs delta path.** For one matched (video_id, platform) pair: pre-clean any existing `performance` rows, run the agent, assert the written `view_count` equals the scraped cumulative (first-week path). Then mutate that row's `view_count` to a sentinel like `1000`, re-run with a forced higher cumulative input, assert the new row's `view_count` equals `currentCumulative - 1000` (delta path). Use `agents/profile-views._test_runOneMatch()` or similar test seam.
4. **Unmatched URL aggregation.** Run with a synthetic scrape that returns one matchable URL and one unmatchable URL, assert exactly one matched write and exactly one entry in the run summary's `unmatched` array.
5. **Negative delta floor.** Force `currentCumulative < sum_prior`, assert written `view_count == 0` and a single `warning` log line with the floored count.
6. **Cron registration smoke test.** Import `server.js`'s scheduler registration list (or call `scheduler.list()` after a server boot) and assert `'profile-views-agent'` is registered with the `0 9 * * 4` schedule when `APIFY_API_TOKEN` is set.
7. **Teardown.** Delete any test rows the harness inserted; do not delete real `performance` data created by Scott or by this agent in earlier runs.

Test must be runnable standalone via `node scripts/test-profile-views-agent.js`. Must skip gracefully (with a clear `SKIP` log line) if `APIFY_API_TOKEN` is unset.

## Dependencies

Before the agent can run in production:

- `APIFY_API_TOKEN` set in `.env`. Without it, `tools/scraper.runActor` throws a clear preflight error and the cron is not registered.
- `students.handle_tiktok` and `students.handle_instagram` populated for every student whose content should be tracked. As of Session 23: Alpha High has both handles set. The 7 human students seeded in Session 22 have null handles and therefore won't be scraped until those are populated (either via the existing onboarding flow's handle-extraction or a one-shot UPDATE).
- `videos.post_url` populated for every video the agent should match. Session 21 backfill (126 rows) + Session 22 pipeline write on `posted by client` cover the existing inventory + the live flow. Newly posted content is automatic.
- The `performance` unique constraint `(video_id, platform, week_of)` from `scripts/migrations/2026-05-04-videos-post-url.sql` must be present.

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
