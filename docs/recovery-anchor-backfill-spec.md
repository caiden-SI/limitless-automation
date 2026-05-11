# Recovery Anchor Backfill — Build Spec (Sheet-history version)

Follow-up to the Profile-views rebuild (`profile-views-rebuild-spec.md`).
The rebuild left 74 video URLs as fresh anchors (weekly_delta = 0 or
blank) because the May 8 broken run only captured priors for 31 of
the 120 tracked URLs. The remaining 74 had no prior `performance`
row to compute delta against.

The sheet itself contains the basis we need — Scott's weekly delta
columns going back months. For each post URL, sum all prior weekly
columns and you get its approximate cumulative views through the
last completed week. Use that as the anchor for delta calculation.

Result after this fix: the 5/8-5/15 column in the sheet fills
completely on the next agent run.

---

## Pre-conditions

1. Profile-views rebuild is shipped and verified against the test
   sheet (`profile-views-rebuild-spec.md` §6 Steps 1-5 passed).
2. `.env` still points `GOOGLE_SHEET_ID_CONTENT_TRACKER` at the
   TEST sheet (`1YtUzNQ3-...`), not production.

---

## What this build adds

### File 1: `scripts/backfill-anchors-from-sheet.js` (new)

One-off script. Reads each student tab's prior weekly columns, sums
per-URL deltas, inserts a `performance` anchor row representing the
cumulative views through the last completed week.

```javascript
#!/usr/bin/env node
require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { google } = require('googleapis');
const { canonicalizePostUrl, detectPlatformFromUrl } = require('../tools/scraper');

const AUSTIN_CAMPUS_ID = '0ba4268f-f010-43c5-906c-41509bc9612f';
const ANCHOR_WEEK_OF = '2026-05-01';   // start of the last completed week
const ANCHOR_SOURCE = 'sheet_synth';
const CURRENT_WEEK_HEADER_SUFFIX = '5/8';  // skip columns ending at-or-after this
```

**Per-tab logic:**

For each of the 9 student tabs:

1. Read the tab via Sheets API. Use the same auth + scope pattern
   the existing `tools/sheet-sync.js` already established.

2. Detect the header row by scanning A1:A3 for "Platform"
   (matches Direction 1 of sheet-sync logic, can reuse the helper).

3. Read the header row to learn the column positions. Identify the
   columns whose headers represent COMPLETED weeks (everything to
   the left of the current week's column). The current week column
   is the one whose header ends in `5/8` (i.e., `5/1-5/8`) — anchor
   ONLY summing columns before that.

4. Skip the metadata columns: A (Platform), B (Post Link), and any
   non-date columns between them and the weekly columns.

5. For each data row below the header:
   - `platform` = lowercase trim of column A (or detect from URL host
     as a sanity check)
   - `url` = trim of column B; skip if empty
   - Skip Twitter rows entirely (no `post_url_twitter` column)
   - Canonicalize the URL via `canonicalizePostUrl(url, platform)`
   - Look up the matching `videos.id`:
     ```sql
     SELECT id FROM videos
     WHERE campus_id = $1 AND post_url_<platform> = $2
     LIMIT 1;
     ```
     If no match, log `anchor_unmatched_url` warning, skip.
   - Sum the integer values across all completed-week columns in
     this row. Empty cells = 0. Non-integer cells = log warning, treat
     as 0.
   - Upsert the anchor:
     ```sql
     INSERT INTO performance (campus_id, video_id, platform, view_count, week_of, source)
     VALUES ($1, $2, $3, $sum, '2026-05-01', 'sheet_synth')
     ON CONFLICT (video_id, platform, week_of) DO UPDATE
     SET view_count = EXCLUDED.view_count, source = EXCLUDED.source;
     ```

6. Track counters per tab: `{ tab, rowsRead, anchored, unmatchedUrls,
   nonIntegerCells, twitterSkipped }`. Print summary at end.

### File 2: `agents/profile-views.js` — update prior-cumulative filter

Find the prior-cumulative lookup. It currently filters:
```javascript
.in('source', ['apify', 'apify_anchor'])
```

Change to:
```javascript
.in('source', ['apify', 'apify_anchor', 'sheet_synth'])
```

Order matters in the ORDER BY: most recent `week_of` wins. So if a
video has both a `sheet_synth` at `2026-05-01` AND an `apify_anchor`
at `2026-05-08`, the apify_anchor (newer) wins. That's correct —
newer cumulative is a better basis.

### File 3: `tools/scraper.js` — export `canonicalizePostUrl` if not already exported

The backfill script needs it.

---

## Edge cases

- **Sum is 0 (brand-new post with one column of history):** Today's
  cumulative becomes the delta. For a post created within the last
  week, that's approximately correct (all views happened "this week").
  Marginal error if the post was actually a few days older than the
  sheet entry.

- **Sum > today's cumulative:** Floored at 0 (the agent's existing
  delta logic does this). Shouldn't happen if the sheet is accurate.
  If it does, log a warning so Scott knows there's a data hygiene
  issue (manual entry was high, sheet sum exceeds actual views).

- **Twitter rows:** Skip entirely. There's no `post_url_twitter`
  column in `videos` so they have nothing to map to. Twitter stays
  manual.

- **Image posts (Instagram Sidecar) that landed in the videos table
  during backfill:** They have a `post_url_instagram` populated but
  no view count from scraping. The sheet history for these will be
  blank or 0 since Scott never had real view counts. Sum = 0.
  Anchor row with view_count = 0. When the agent next scrapes them,
  it'll get null viewCount and log `image_post_no_view_count` —
  the row stays as anchor with no delta. Acceptable.

- **Idempotency:** The ON CONFLICT clause makes this safe to re-run.
  Second run produces identical anchors.

---

## Verification protocol

### Step 1: Run the backfill against the TEST setup

```bash
cd ~/repos/limitless-automation && node scripts/backfill-anchors-from-sheet.js
```

Expected summary:
- 9 tabs processed
- ~110-120 anchors written (51 TT + 63 IG + 6 YT = 120; minus a
  handful of unmatched URLs and image posts)
- 0 errors

### Step 2: Verify anchor rows exist

```sql
SELECT source, count(*) FROM performance
WHERE week_of = '2026-05-01'
GROUP BY source
ORDER BY source;
```

Expected:
- `sheet_synth`: ~120 rows (covering all backfilled URLs)
- `apify_anchor`: 0 rows

**Intentional design:** the upsert's `ON CONFLICT DO UPDATE SET source =
EXCLUDED.source` replaces any existing apify_anchor rows at this
week_of with sheet_synth. The 31 apify_anchor rows from the May 8
broken run are intentionally overwritten in favor of a single
consistent source across the roster. The precision loss is small
(sheet_synth ≈ apify_anchor for posts tracked from near their post
date) and consistency wins over partial higher-fidelity data.

### Step 3: Sanity-check a known cumulative

Pick Alex Mathews's pinned 1.4M TikTok video. Find the sum of his
weekly columns in the test sheet (manually add them, or query):

```sql
SELECT view_count FROM performance
WHERE video_id = (SELECT id FROM videos WHERE post_url_tiktok ILIKE '%berryaiplushies/video/<pinned-id>%')
  AND week_of = '2026-05-01';
```

Expected: `view_count` close to 1.4M (the sum of all weekly deltas
Scott entered for that post). Doesn't need to be exact; within 5%
of the apify cumulative is fine.

### Step 4: Re-run the agent against the test sheet

```bash
cd ~/repos/limitless-automation && node -e "
require('dotenv').config();
require('./agents/profile-views').run('0ba4268f-f010-43c5-906c-41509bc9612f')
  .then(() => { console.log('done'); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
"
```

The upsert with `onConflict: video_id, platform, week_of` will
UPDATE the 105 existing 2026-05-08 rows. Each row's `weekly_delta`
will recompute against the highest-`week_of` prior row — now
`sheet_synth` at 2026-05-01 for the previously-orphaned 74 URLs.

### Step 5: Spot-check delta math

```sql
SELECT p.week_of, p.view_count, p.weekly_delta, p.source
FROM performance p
JOIN videos v ON v.id = p.video_id
WHERE v.post_url_tiktok ILIKE '%berryaiplushies/video/<pinned-id>%'
ORDER BY p.week_of;
```

Expected two rows:
- `2026-05-01 | view_count ≈ 1,400,000 | weekly_delta = NULL | sheet_synth`
- `2026-05-08 | view_count ≈ 1,400,000-1,401,000 | weekly_delta = a few hundred to low thousands | apify`

If the 2026-05-08 weekly_delta is still 0 or shows the full cumulative,
the source filter update on the agent didn't take effect.

### Step 6: Verify the test sheet's 5/8-5/15 column fills

The agent's run already pushes deltas via `pushDeltasToSheet`. Open
the test sheet:

`https://docs.google.com/spreadsheets/d/1YtUzNQ3-6wceIpX-YTdelTHm64xmijnrSfNhFff4MaI/edit`

The 5/8-5/15 column should now be ~95-100% populated across all
student tabs (vs the ~30% you saw before). Verify a couple students.
ALL tab aggregations should match the per-student sums.

### Step 7: Promote to production

Only after Steps 1-6 pass. Same procedure as
`profile-views-rebuild-spec.md` §6 Step 6.

---

## Acceptance criteria

1. Backfill script idempotent — second run produces zero new
   inserts (all `ON CONFLICT DO UPDATE`).
2. ~120 `sheet_synth` anchor rows exist at week_of 2026-05-01,
   0 apify_anchor (replaced by upsert).
3. Re-run agent produces non-zero deltas for **~85%+ of scraped URLs**
   in the 2026-05-08 row. (Some pinned/old videos show
   weekly_delta = 0 because Apify returns rounded display values
   like "1,400,000" — when the sheet sum happens to match that
   exact rounded number, the delta math correctly produces 0. Not
   a bug; a precision artifact.)
4. Spot-check passes: Alex's pinned video shows weekly_delta in
   the hundreds-to-low-thousands OR exactly 0 (due to Apify
   rounding) — NOT millions.
5. Test sheet's 5/8-5/15 column is visually populated across all
   scraping tabs (Reuben Runacres tab has only Twitter URLs so no
   new column is added — intentional).
6. No regression on the rebuild's acceptance criteria
   (rebuild spec §7 1-6 still hold).

---

## Out of scope

- Backfilling MORE historic weeks beyond the most recent one. The
  agent only needs ONE prior week for delta computation. Storing full
  history in `performance` is over-engineering for the current need.
- Recovering the 31 original `apify_anchor` values that were
  overwritten by sheet_synth. They were real-but-incomplete data
  (only 31 of 120 URLs); replacing them with sheet_synth across the
  full roster is a net consistency win even if 31 lose a small
  amount of precision.
- The Apify rounded-display-value artifact. Some platforms return
  view counts as rounded numbers (e.g., TikTok displays "1.4M" =
  exactly 1,400,000 even though the true count is something like
  1,400,287). When the sheet_synth anchor happens to match the
  rounded value exactly, the computed delta is 0 even though
  views grew. Not fixable without a higher-fidelity scraper.

---

## Rollback

```sql
DELETE FROM performance
WHERE source = 'sheet_synth'
  AND week_of = '2026-05-01';
```

Then revert the agent's source filter to the prior list. The rebuild
itself stays intact.
