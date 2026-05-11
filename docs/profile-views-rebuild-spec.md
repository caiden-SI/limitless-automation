# Profile-views Rebuild — Build Spec

Single source of truth for the Profile-views agent rewrite +
two-way sheet sync. Consolidates `iteration-3-fixes.md` Fix 5 + Fix 11
into a Claude Code-actionable spec. Read end-to-end before writing
any code. Every section has been verified against the live Supabase
schema, the Apify outputs from the 2026-05-08 manual recovery, and
Scott's confirmed sheet structure.

---

## 1. Why this rebuild

The 2026-05-08 scheduled run captured the wrong data. Three architectural
problems combined to produce 31 rows of cumulative all-time view counts
labeled as weekly deltas, with pinned-video distortion blowing up Alex
Mathews' May 1 number by 1.4M views:

1. **Channel-level scraping** — `scrapeProfileVideos(profileUrl, ...)`
   grabbed whatever videos appeared on each profile page. TikTok pins
   old top performers to the top, so the pinned February video looked
   like fresh weekly performance. Coverage was also incomplete (28/51
   TikTok, 3/59 Instagram, 0/6 YouTube, 0/10 Twitter).
2. **No delta calculation** — agent stored cumulative `view_count`
   labeled as the week's value. The `performance` table has no delta
   column.
3. **No URL plumbing** — `videos.post_url_*` columns existed but were
   all NULL. Even if scrapers returned URL-keyed data, joining back to
   tracked posts was impossible.

Plus a separate gap: Frame.io was supposed to detect new Limitless-made
posts and add their URLs to the videos table. Frame.io v4 is deferred
(license blocker, see `iteration-3-fixes.md` Fix 9). The Content
Performance Tracker Sheet becomes the canonical new-post entry point
until Frame.io is restored.

**Goal of this rebuild:** the next daily Profile-views run captures
the right data — per-URL scrapes, computed weekly deltas, all posts
Scott has tracked in the sheet (including new ones he adds going
forward).

---

## 2. Migration (run before any code change)

Single migration. Run in Supabase SQL Editor before the agent
refactor lands.

```sql
ALTER TABLE performance ADD COLUMN weekly_delta integer;

COMMENT ON COLUMN performance.view_count IS 'Cumulative all-time view count at time of scrape';
COMMENT ON COLUMN performance.weekly_delta IS 'Views gained during the week (current cumulative minus previous week cumulative, floored at 0)';
```

After the migration, every new performance row writes BOTH:
- `view_count` = current cumulative (the anchor basis for next week's delta)
- `weekly_delta` = max(0, current_cumulative - previous_week_cumulative)

The existing 2026-05-07 anchor row keeps its `view_count` as the
basis. `weekly_delta` for that anchor row stays NULL (no prior week
to compute against).

No other schema changes needed. `videos.post_url_*` columns already
exist (`post_url_tiktok`, `post_url_instagram`, `post_url_youtube`).
There is no `post_url_twitter` column — Twitter stays manual.

---

## 3. Verified inputs (do not re-discover; use these)

### 3.1 Apify actor configurations

| Platform | Actor | Input field | Output: view-count field | Output: URL field | Cost |
|---|---|---|---|---|---|
| TikTok | `clockworks/tiktok-scraper` | `postURLs: [url, ...]` | `playCount` | `webVideoUrl` | $3 / 1k results |
| Instagram | `apify/instagram-scraper` | `directUrls: [url, ...]` | `videoPlayCount` (Video) or `videoViewCount` fallback | `url` (canonical) | $2.70 / 1k results |
| YouTube | `streamers/youtube-scraper` | `startUrls: [{url}, ...]` | `viewCount` | `url` | $3 / 1k videos |
| Twitter | (none — manual) | n/a | n/a | n/a | n/a |

Notes:
- TikTok actor is the **paid** `clockworks/tiktok-scraper` ($3/1k),
  not `clockworks/free-tiktok-scraper`. The free one is
  channel-only. Verify the actor ID is correct before scraping; the
  free one was previously hardcoded in `tools/scraper.js` line 57
  for `scrapeTikTok` and line 119 for `scrapeProfileVideos`.
- Instagram URL normalization: input can be `/reel/<shortcode>/` or
  `/p/<shortcode>/` or `/p/<shortcode>/?img_index=...`. Apify
  normalizes the output `url` to `/p/<shortcode>/`. Match by
  normalized shortcode when reconciling scraped items to videos
  rows.
- Instagram image posts (`type: 'Sidecar'`) return `likesCount` and
  `commentsCount` but NO view count. Skip them gracefully — log
  `image_post_no_view_count` warning and continue.
- TikTok all 51 sample items had `playCount` populated. 100% coverage.
- YouTube 6/6 items had `viewCount`. Clean.
- Twitter lite returns `likeCount`, `retweetCount`, etc. but NO view
  count. The 10 tracked Twitter URLs stay manual until a better
  actor is identified.

### 3.2 Sheet structure (Content Performance Tracker)

- Sheet ID: `1B2SQciMMUh2nq_hUSKS9EwJHEKqJDnbel0z3IdTVnd0`
- Service account already has Editor access (verified via
  `scripts/test-sheet-access.js`)
- Add to `.env` on both machines:
  ```
  GOOGLE_SHEET_ID_CONTENT_TRACKER=1B2SQciMMUh2nq_hUSKS9EwJHEKqJDnbel0z3IdTVnd0
  ```

Tab inventory:
- `ALL` — aggregate, one row per (student × platform), weekly columns
- `Alpha High`, `Alex Mathews`, `Jackson Price`, `Cruce Sanders`,
  `Reuben Runacres`, `Maddie Price`, `Geetesh Parelly`, `Stella Grams`,
  `Austin Way` — one row per post, header row scan A1:A3 for
  "Platform" to detect (some tabs use row 2, some row 3)

Per-student tab columns (positions vary by tab; detect dynamically):
- A: Platform (e.g. "TikTok", "Instagram", "YouTube", "Twitter")
- B: Post Link (the URL)
- C onward: weekly date columns formatted `M/D-M/D` (e.g.
  `4/9-4/16`, `5/1-5/8`)

A1 in each tab: `Last Updated M/D` timestamp.

### 3.3 Tab-to-student mapping (confirmed)

All 9 student tabs map to `students.name` with exact string match.
No fuzzy matching needed. Use:

```sql
SELECT id, name, campus_id, handle_tiktok, handle_instagram, is_brand_account
FROM students
WHERE campus_id = '0ba4268f-f010-43c5-906c-41509bc9612f';
```

| Tab name | Supabase students.name | is_brand_account |
|---|---|---|
| `Alpha High` | `Alpha High` | true |
| `Alex Mathews` | `Alex Mathews` | false |
| `Austin Way` | `Austin Way` | false |
| `Cruce Sanders` | `Cruce Sanders` | false |
| `Geetesh Parelly` | `Geetesh Parelly` | false |
| `Jackson Price` | `Jackson Price` | false |
| `Maddie Price` | `Maddie Price` | false |
| `Reuben Runacres` | `Reuben Runacres` | false |
| `Stella Grams` | `Stella Grams` | false |

Austin campus_id: `0ba4268f-f010-43c5-906c-41509bc9612f`

### 3.4 Current state of videos table

- 135 rows total for the Austin campus
- 0 rows have any `post_url_*` populated
- Backfill expected: ~126 URLs from the Sheet to map to videos rows

### 3.5 Performance table schema (current)

```
id          uuid PK
campus_id   uuid NOT NULL
video_id    uuid NOT NULL   -- FK to videos.id
platform    text NOT NULL
view_count  integer         -- cumulative; was being treated as weekly
week_of     date
created_at  timestamptz NOT NULL DEFAULT now()
source      text NOT NULL DEFAULT 'sheet'   -- 'apify_anchor', 'apify', 'sheet'
weekly_delta integer        -- NEW after migration in §2
```

After this rebuild, agent writes:
- `view_count` = current cumulative scraped this run
- `weekly_delta` = max(0, view_count - previous_week_view_count)
- `source` = `'apify'` (not `'apify_anchor'` — anchor is only the
  very first scrape per (video, platform))

---

## 4. Implementation, file-by-file

### 4.1 `tools/scraper.js` — add `scrapeVideosByUrls`

Add a new exported function. Keep existing `scrapeTikTok`,
`scrapeInstagram`, `scrapeProfileVideos` for backward compat
(Onboarding Section 3 uses `scrapeProfileVideos` for influencer
transcript fetch).

```javascript
/**
 * Scrape per-URL view counts and engagement for a list of post URLs
 * on a single platform. Returns one item per input URL.
 *
 * @param {string[]} urls       List of post URLs (all same platform)
 * @param {'tiktok'|'instagram'|'youtube'|'twitter'} platform
 * @returns {Promise<Array<{
 *   url: string,            // input URL (for matching back to videos rows)
 *   canonicalUrl: string,   // normalized URL (strip query, /reel/ → /p/)
 *   viewCount: number|null, // null if no view count available (image posts, twitter)
 *   likes: number,
 *   shares: number,         // 0 if not exposed by platform
 *   scrapedAt: string,      // ISO timestamp
 *   error: string|null,     // 'image_post_no_view_count' | 'manual' | 'not_found' | null
 * }>>}
 */
async function scrapeVideosByUrls(urls, platform) { ... }
```

Per-platform implementation:

**TikTok:** Call `runActor('clockworks~tiktok-scraper', { postURLs: urls })`.
Map each output item by `webVideoUrl` → match input url. Extract
`playCount` → viewCount, `diggCount` → likes, `shareCount` → shares.

**Instagram:** Call `runActor('apify~instagram-scraper', { directUrls: urls, resultsType: 'posts' })`.
Match by canonicalized URL (strip query string; normalize
`/reel/<code>/` → `/p/<code>/` based on Apify's output `url`). For
each item:
- If `type === 'Video'`: viewCount = `videoPlayCount || videoViewCount`
- If `type === 'Sidecar'`: viewCount = null, error = 'image_post_no_view_count'
- likes = `likesCount`, shares = 0 (IG doesn't expose share count)

**YouTube:** Call `runActor('streamers~youtube-scraper', { startUrls: urls.map(u => ({ url: u })) })`.
Map by `url`. Extract `viewCount` → viewCount, `likes` → likes,
shares = 0.

**Twitter:** Return `urls.map(url => ({ url, canonicalUrl: url, viewCount: null, likes: 0, shares: 0, scrapedAt: now, error: 'manual' }))`. No Apify call.

**URL canonicalization helper** (export from `tools/scraper.js` or
extract from existing `canonicalizePostUrl` in `agents/profile-views.js`):
```javascript
function canonicalizePostUrl(url, platform) {
  if (!url) return null;
  // Strip query and hash
  const noQuery = url.split(/[?#]/)[0];
  // Normalize trailing slash
  let stripped = noQuery.replace(/\/$/, '');
  // Instagram: /reel/<code> → /p/<code>
  if (platform === 'instagram') {
    stripped = stripped.replace('/reel/', '/p/');
  }
  return stripped.toLowerCase();
}
```

### 4.2 `tools/sheet-sync.js` — new file with two directional functions

Set up Sheets API client (pattern from `scripts/test-sheet-access.js`,
which is already verified working). Use the existing
`GOOGLE_CALENDAR_CREDENTIALS_PATH` service account; add the
`https://www.googleapis.com/auth/spreadsheets` scope.

#### Direction 1: `pullNewUrlsFromSheet({ campusId })`

```javascript
/**
 * Read each student tab's Post Link column, create videos rows
 * for any URL not already tracked. Idempotent and safe to re-run.
 *
 * @returns {Promise<{
 *   videosCreated: number,
 *   videosUpdated: number,  // existing rows where post_url was null and we filled it
 *   urlsScanned: number,
 *   skipped: number,        // already had matching post_url
 *   warnings: string[]      // tab-name mismatch, platform-url mismatch, etc.
 * }>}
 */
```

Steps per call:

1. Load students for the campus: `id, name, is_brand_account` (skip
   ALL tab — it's aggregate, not source of truth for URLs).
2. For each student in the tab list (use the 9 tabs from §3.2):
   1. Read tab range `A1:C500` (Platform, Post Link, optional ALL-tab
      style columns we don't need)
   2. Detect header row by scanning A1:A3 for cell value "Platform"
      (case-insensitive trim)
   3. For each data row below the header:
      - `platform` = lowercase trim of column A
      - `url` = trim of column B
      - skip if either is empty
      - **Detect platform from URL host** (`tiktok.com` → tiktok,
        `instagram.com` → instagram, `youtube.com` → youtube,
        `x.com`/`twitter.com` → twitter). If column-A platform value
        and host-derived platform disagree, log warning, use the
        host-derived value (URL is the ground truth, the Platform
        column is just a label).
      - **Canonicalize** the URL via `canonicalizePostUrl(url, platform)`.
      - **Look up existing match** in videos:
        ```sql
        SELECT id, post_url_tiktok, post_url_instagram, post_url_youtube
        FROM videos
        WHERE campus_id = $1 AND student_id = $2
          AND post_url_<platform> = $3
        LIMIT 1;
        ```
        If found, skip (idempotent).
      - **Else find a fillable existing row:**
        ```sql
        SELECT id FROM videos
        WHERE campus_id = $1 AND student_id = $2
          AND post_url_<platform> IS NULL
        ORDER BY created_at ASC
        LIMIT 1;
        ```
        If exactly 0 rows or >1 row, fall through to insert.
        If exactly 1 row, UPDATE that row, set
        `post_url_<platform> = $url`. Counter: `videosUpdated++`.
      - **Else insert a new row:**
        ```sql
        INSERT INTO videos (campus_id, student_id, post_url_<platform>, status, title, created_at)
        VALUES ($1, $2, $3, 'POSTED BY CLIENT', $4, now())
        ```
        where `title` = first 60 chars of the URL or
        `"Auto-added from sheet"`. Counter: `videosCreated++`.
      - Log per-action to `agent_logs` with
        `action: 'video_auto_added_from_sheet'` or
        `'video_url_backfilled'`.
3. Twitter URLs: process them too (creates videos row with
   `post_url_twitter` — wait, that column doesn't exist).
   **Skip Twitter URLs entirely in Direction 1**. Log
   `twitter_url_skipped` and move on. The Sheet will continue to
   show Twitter view counts as Scott manually maintains them.

Edge cases:
- Tab name doesn't match any student in Supabase: log warning
  `sheet_tab_unmapped`, skip the tab entirely
- Tab is the brand account (Alpha High, `is_brand_account = true`):
  treat normally; brand has its own videos rows
- URL already exists in videos via a DIFFERENT student: log
  `cross_student_url_conflict` warning, do not update
- Sheets API rate limit hit: 60 reads/min/project. With 9 tabs at
  ~10-20 URLs each and 1 batch read per tab, comfortably within limit

#### Direction 2: `pushDeltasToSheet({ campusId, weekOf })`

This is the original sheet-sync-spec.md direction. Pulls latest week's
`weekly_delta` from `performance` joined to `videos` + `students`,
writes to the matching weekly column in each tab. Full implementation
already documented in `sheet-sync-spec.md` §"Direction 2 implementation
outline" — DO NOT duplicate that here; reference and implement what's
there. The only adjustment: read `weekly_delta` (not `view_count`)
from `performance`.

### 4.3 `agents/profile-views.js` — refactor `run()`

The current `run(campusId)` loops students × platforms × profile-scrape.
Replace its body with the URL-iteration pattern. Keep existing helpers
(`loadStudentsWithHandles`, `getDeltaBasis`, etc.) only where still
useful; most can be deleted.

New `run(campusId)` flow:

```javascript
async function run(campusId) {
  const weekOf = mostRecentFriday();  // existing helper, keep
  const counters = { urlsScraped: 0, deltasWritten: 0, errors: 0, ... };

  await log({ campusId, agent: AGENT_NAME, action: 'profile_views_run_started' });

  // Step 1: Pull new URLs from the Sheet
  const { syncSheetToVideos, syncDeltasToSheet } = require('../tools/sheet-sync');
  const sheetPull = await syncSheetToVideos({ campusId });
  await log({ campusId, agent: AGENT_NAME, action: 'sheet_pull_complete', payload: sheetPull });

  // Step 2: Load all videos with post_url_* populated, grouped by platform
  const { data: videos } = await supabase
    .from('videos')
    .select('id, student_id, post_url_tiktok, post_url_instagram, post_url_youtube')
    .eq('campus_id', campusId);

  const byPlatform = { tiktok: [], instagram: [], youtube: [] };
  for (const v of videos) {
    if (v.post_url_tiktok)    byPlatform.tiktok.push({ video: v, url: v.post_url_tiktok });
    if (v.post_url_instagram) byPlatform.instagram.push({ video: v, url: v.post_url_instagram });
    if (v.post_url_youtube)   byPlatform.youtube.push({ video: v, url: v.post_url_youtube });
  }

  // Step 3: Scrape per platform
  const { scrapeVideosByUrls } = require('../tools/scraper');
  const allUpserts = [];

  for (const platform of ['tiktok', 'instagram', 'youtube']) {
    const list = byPlatform[platform];
    if (list.length === 0) continue;

    const urls = list.map(x => x.url);
    const scraped = await scrapeVideosByUrls(urls, platform);

    // Build map: canonical URL → scraped result
    const canonByUrl = new Map();
    for (const s of scraped) {
      const canonical = canonicalizePostUrl(s.url, platform);
      canonByUrl.set(canonical, s);
    }

    for (const { video, url } of list) {
      const canonical = canonicalizePostUrl(url, platform);
      const result = canonByUrl.get(canonical);

      if (!result) {
        await log({ campusId, agent: AGENT_NAME, action: 'scrape_url_not_returned',
                   status: 'warning', payload: { videoId: video.id, platform, url } });
        continue;
      }
      if (result.error === 'image_post_no_view_count') {
        await log({ campusId, agent: AGENT_NAME, action: 'image_post_no_view_count',
                   payload: { videoId: video.id, platform, url } });
        continue;
      }
      if (result.viewCount == null) continue;

      // Compute delta against most recent prior performance row
      const { data: prior } = await supabase
        .from('performance')
        .select('view_count')
        .eq('video_id', video.id)
        .eq('platform', platform)
        .lt('week_of', weekOf)
        .order('week_of', { ascending: false })
        .limit(1)
        .maybeSingle();

      const priorCumulative = prior?.view_count ?? 0;
      const delta = Math.max(0, result.viewCount - priorCumulative);

      allUpserts.push({
        campus_id: campusId,
        video_id: video.id,
        platform,
        view_count: result.viewCount,
        weekly_delta: delta,
        week_of: weekOf,
        source: prior ? 'apify' : 'apify_anchor',
      });
      counters.urlsScraped++;
    }
  }

  // Step 4: Upsert performance rows
  if (allUpserts.length) {
    const { error } = await supabase
      .from('performance')
      .upsert(allUpserts, { onConflict: 'video_id,platform,week_of' });
    if (error) throw new Error(`performance upsert: ${error.message}`);
    counters.deltasWritten = allUpserts.length;
  }

  await log({ campusId, agent: AGENT_NAME, action: 'profile_views_scrape_complete', payload: counters });

  // Step 5: Push deltas back to the sheet
  const sheetPush = await syncDeltasToSheet({ campusId, weekOf });
  await log({ campusId, agent: AGENT_NAME, action: 'sheet_push_complete', payload: sheetPush });

  await log({ campusId, agent: AGENT_NAME, action: 'profile_views_run_complete',
              payload: { weekOf, ...counters, sheetPull, sheetPush } });
}
```

Each step is independently wrapped in try/catch in the actual
implementation (omitted above for brevity). A sheet sync failure on
either end should log a warning but NOT prevent the agent from
marking its scrape complete — the agent's job is scraping; sync is
a derived concern.

Functions to delete from `agents/profile-views.js`:
- `loadStudentsWithHandles` (no longer needed — we iterate videos with URLs)
- `loadVideoUrlIndex` (no longer needed — we have direct URLs)
- `matchScrapedItems` (no longer needed — direct URL match)
- `loadHandlelessStudents` (no longer relevant)
- `warnHandlelessWithVideos` (no longer relevant)

Functions to keep:
- `mostRecentFriday` (still used for week_of)
- `canonicalizePostUrl` (move to `tools/scraper.js` if cleaner)
- `runForCampus`, `runAll`, `run` (entry points; refactor `run`)

### 4.4 `scripts/backfill-post-urls.js` — one-off

Trivial wrapper: just run Direction 1 against the current Sheet state.

```javascript
#!/usr/bin/env node
require('dotenv').config();
const { syncSheetToVideos } = require('../tools/sheet-sync');

const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';

(async () => {
  const campusId = process.argv[2] || AUSTIN_CAMPUS_ID;
  console.log('Backfilling URLs from Sheet for campus', campusId);
  const result = await syncSheetToVideos({ campusId });
  console.log('Result:', JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
```

After running once, expected output: ~126 (videosCreated + videosUpdated),
~9 orphans remain (videos with NULL post_url_* not present in sheet —
these get reviewed manually after backfill).

### 4.5 `.env` and `.env.example` additions

```
GOOGLE_SHEET_ID_CONTENT_TRACKER=1B2SQciMMUh2nq_hUSKS9EwJHEKqJDnbel0z3IdTVnd0
```

No other env changes required. `APIFY_API_TOKEN` and Google service
account path already in place.

### 4.6 Cron flip to daily (ships in the same session, AFTER manual verification)

The cron stays Thursday until the manual verification in §6 passes.
Once verified, flip to daily as the final step of this session per
`iteration-3-fixes.md` Fix 2. We don't wait a week — the manual run
is the verification.

**Prerequisite for the daily flip:** Scott's Apify token must be in
`.env` (not Caiden's free-tier token). Daily cadence projects to
$35-40/month total Apify spend; that should land on Scott's account,
not Caiden's $5 free tier. If Scott's token isn't ready, ship
everything else and leave the cron at Thursday for one more cycle.

The cron change is a single-line edit in `server.js`:

```javascript
// before
scheduler.register('profile-views-agent', '0 9 * * 4', profileViews.runAll);
// after
scheduler.register('profile-views-agent', '0 9 * * *', profileViews.runAll);
```

Plus the cascading text updates listed in `iteration-3-fixes.md`
Fix 2 (console log, agent comment, dashboard cadence label, docs).

---

## 5. Edge cases and gotchas

Each one already mentioned inline above; collected here as a checklist
to verify during implementation.

- [ ] Instagram URL canonicalization: `/reel/<code>/` → `/p/<code>/`
- [ ] Instagram image posts (Sidecar): null view count, log warning, skip
- [ ] Instagram URL with query string (e.g. `?img_index=1`): stripped
      before matching
- [ ] TikTok actor swap: use `clockworks/tiktok-scraper` (paid),
      NOT `clockworks/free-tiktok-scraper`
- [ ] Twitter URLs: skip in Direction 1 (no post_url_twitter column),
      skip in scraper (no view count actor), Sheet column for Twitter
      stays manual
- [ ] Sheet header row position varies by tab (row 2 or row 3): scan
      A1:A3 for "Platform" to detect
- [ ] Tab name doesn't match a student: log warning, skip the tab
- [ ] Same URL appears in multiple tabs (shouldn't happen, but if):
      log conflict, do not create duplicates
- [ ] Sheets API rate limit: well within the 60 reads/min ceiling
      for 9 tabs + ALL tab
- [ ] Performance upsert conflict resolution: `onConflict: 'video_id,platform,week_of'`
      assumes a unique constraint exists. Verify before deploying;
      if missing, add migration
- [ ] Anchor vs delta: first scrape of any (video, platform) writes
      `source: 'apify_anchor'`, `weekly_delta: 0`. Subsequent
      scrapes write `source: 'apify'`, `weekly_delta` = computed.
- [ ] Sheet sync failure must not break the agent run: wrap
      `syncDeltasToSheet` in try/catch in the agent, log warning on
      failure, continue
- [ ] Backfill idempotency: running `scripts/backfill-post-urls.js`
      twice should produce zero new inserts/updates the second time

---

## 6. Verification protocol (run after Claude Code finishes building)

### Step 1: Verify migration ran

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'performance' AND column_name = 'weekly_delta';
```
Should return one row.

### Step 2: Run backfill

```bash
cd ~/repos/limitless-automation && node scripts/backfill-post-urls.js
```
Expected output: ~126 (created + updated), warnings only for the 9
orphan videos rows that aren't in the sheet.

Confirm:
```sql
SELECT count(*) FILTER (WHERE post_url_tiktok IS NOT NULL) AS tiktok,
       count(*) FILTER (WHERE post_url_instagram IS NOT NULL) AS ig,
       count(*) FILTER (WHERE post_url_youtube IS NOT NULL) AS yt,
       count(*) AS total
FROM videos
WHERE campus_id = '0ba4268f-f010-43c5-906c-41509bc9612f';
```
Expected: tiktok + ig + yt totals approximately match the per-platform
counts in the sheet. Total videos should be 135 + ~0 inserts if all
URLs match existing rows, or 135 + N if N URLs had no matching null
row.

### Step 3: Run the agent manually against one campus

```bash
cd ~/repos/limitless-automation && node -e "
require('dotenv').config();
require('./agents/profile-views').run('0ba4268f-f010-43c5-906c-41509bc9612f')
  .then(() => { console.log('done'); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
"
```

### Step 4: Spot-check delta math against the manual recovery

Pick Alex Mathews's pinned TikTok video (the one that inflated the
May 1 number by 1.4M). Query:

```sql
SELECT week_of, view_count, weekly_delta, source
FROM performance
WHERE video_id = (
  SELECT id FROM videos
  WHERE post_url_tiktok = 'https://www.tiktok.com/@berryaiplushies/video/<pinned-id>'
)
ORDER BY week_of DESC;
```

Expected:
- 2026-05-01 row: `view_count ≈ 1.4M`, `weekly_delta = 0` (anchor)
- 2026-05-15 row (after first new run): `view_count ≈ 1.4M + few thousand`,
  `weekly_delta = few thousand` (NOT 1.4M)

If the May 15 delta is anywhere near 1.4M again, the rebuild
failed — investigate before shipping.

### Step 5: Verify sheet got the right numbers

Open the Content Performance Tracker in browser. Latest weekly column
should show small-to-moderate weekly deltas, not cumulative all-time
view counts. Alex Mathews's pinned TikTok in his per-student tab
should show a number in the hundreds-to-thousands range, not millions.

ALL tab row for (Alex Mathews × TikTok) should equal the sum of his
per-student tab's TikTok rows for that week column.

### Step 6: If all five checks pass, flip the cron to daily

This is Fix 2 from `iteration-3-fixes.md`, executed in the same session.

**Pre-check:** confirm `.env` has Scott's Apify token, not Caiden's
free-tier token. Quick verify:
```bash
grep APIFY_API_TOKEN ~/repos/limitless-automation/.env | head -1
```
(The first 8-10 characters of Scott's token will differ from Caiden's.
If still on Caiden's, leave the cron at Thursday and circle back when
the token swap happens.)

Edit `server.js` around line 204:
```javascript
scheduler.register('profile-views-agent', '0 9 * * *', profileViews.runAll);
```

Cascading text updates (search-replace `Thursday 9 AM` →
`daily 9 AM` and `0 9 * * 4` → `0 9 * * *`):
- `server.js` console-log message
- `agents/profile-views.js` line 2 comment
- `workflows/profile-views.md` if present
- `dashboard/src/lib/agents.js` profile-views cadence label
- `docs/scott-system-overview.md`
- `docs/system-facts.md`
- `docs/scott-questions-answered.md` Q7

Commit + deploy via `~/deploy-limitless.sh`. The next 9 AM Central
will be the first daily run.

---

## 7. Acceptance criteria

The rebuild is complete when:

1. Migration applied; `performance.weekly_delta` column exists
2. `scripts/backfill-post-urls.js` runs idempotently; second run
   produces 0 inserts / 0 updates
3. Manual `run()` invocation produces:
   - One performance row per (video × platform) where the video has
     a populated `post_url_<platform>`
   - All rows have `view_count` AND `weekly_delta` populated
   - `source = 'apify_anchor'` for first scrape of a video, `'apify'`
     for subsequent scrapes
4. Spot-check passes: pinned TikTok video weekly_delta is small (not
   millions); Instagram image posts logged as
   `image_post_no_view_count`; no Twitter API calls made
5. Sheet's latest weekly column reflects the deltas (not cumulatives);
   ALL tab aggregates match per-student tab sums
6. Sheet sync failure does not break the agent (test by temporarily
   unsetting `GOOGLE_SHEET_ID_CONTENT_TRACKER` and re-running — agent
   should still write to performance and log a warning)
7. **Daily cadence flipped** as the final step, AFTER acceptance
   criteria 1-6 pass via the manual verification in §6. If Scott's
   Apify token isn't yet in `.env`, leave the cron at Thursday and
   circle back when the token swap happens — daily cadence on
   Caiden's $5 free-tier token would burn through in ~3-4 days.

---

## 8. Out of scope (defer to future)

- Frame.io v4 new-post detection (Fix 9 — license blocker)
- Twitter view count scraping (waiting on a viable actor)
- Brand-account SIGNALS subsection (Fix 7)
- Frame.io quality filter for "is this a Limitless-made post"
  (was performed by old tracker; not implemented in Apify pipeline)
- Two-way Sheet edit safety (e.g., what happens if Scott edits a
  weekly column the sync just wrote — the sync overwrites on next
  run, which is fine for now)

---

## 9. Rollback plan

If the rebuild produces wrong data again, rollback steps:

1. `git revert` the commit(s) introducing the rewritten `run()`,
   `tools/scraper.js` changes, and `tools/sheet-sync.js`
2. Re-deploy via `~/deploy-limitless.sh`
3. The `weekly_delta` column stays in the schema (no rollback needed
   — it's nullable, safe to leave). Already-written rows with
   weekly_delta populated stay; queries that don't use it ignore it.
4. Backfilled `post_url_*` values stay in `videos` rows — they're
   correct data even if the agent reverts to channel scraping
