# Sheet Sync — Build Spec (TWO-WAY)

Ship target: this weekend, ships together with the Profile-views
URL-based refactor (Fix 11 in `iteration-3-fixes.md`). The two
components are coupled — Profile-views reads its work list from the
sheet (since Frame.io isn't available to auto-detect new posts) AND
writes weekly deltas back to the sheet.

This spec is the source of truth — read end-to-end before implementing.
The Sheet structure is non-trivial (10 tabs, weekly columns that grow
over time) and the sync now runs in both directions, so the logic
deserves careful attention.

**Direction 1 — Sheet → Supabase (new):** Detect new post URLs Scott
adds to student tabs and create `videos` rows so Profile-views can
track them. Replaces the Frame.io "new post detection" role we lost
to the v4 OAuth license blocker. Scott is already in the sheet
weekly (Comment #5: *"for my easy reading and math"*), so this fits
his existing workflow.

**Direction 2 — Supabase → Sheet (was the original spec):** After
Profile-views runs, push weekly deltas back to the matching weekly
column in each student's tab. Updates the `Last Updated M/D` cell at
A1 of each tab.

---

## Sequence — coupled with Fix 11

This spec ships together with the Profile-views URL-based refactor
(Fix 11). The combined build order:

1. **Inside one Profile-views run cycle:**
   - Step A: Sheet → Supabase (Direction 1). Read each student tab's
     Post Link column, create new `videos` rows for any URL not yet
     in the videos table.
   - Step B: Profile-views runs (Fix 11 logic). Iterates over all
     URLs in `videos.post_url_*` columns, scrapes per platform,
     computes deltas against prior cumulative.
   - Step C: Supabase → Sheet (Direction 2). After scraping
     completes, push the weekly deltas to the current week's column
     in each tab. Update Last Updated A1.

2. **Cadence:** Daily (per Fix 2), 9 AM. Replaces the original
   Thursday-weekly cadence once Scott's Apify account is wired in.

3. **Frame.io reintegration (future):** when v4 OAuth license is
   resolved (Fix 9 revival), the new-post-detection role transfers
   back to Frame.io. Direction 1 (sheet → Supabase) becomes a backup
   path rather than the primary one. No spec changes needed at that
   point — the same URL detection logic works whether Scott pasted
   the URL or Frame.io did.

---

## Goal

After each Profile-views agent run completes, push the latest week's
view-count deltas into the Content Performance Tracker Sheet:

- Sheet ID: `1B2SQciMMUh2nq_hUSKS9EwJHEKqJDnbel0z3IdTVnd0`
- Service account: `limitless-agent@limitless-automation-492715.iam.gserviceaccount.com`
  (already granted Editor access; verified via `scripts/test-sheet-access.js`)

The agent must continue to succeed even if the Sheet sync fails.
Sync errors are logged and non-fatal.

---

## Sheet structure

### Tabs

`ALL`, `Alpha High`, `Alex Mathews`, `Jackson Price`, `Cruce Sanders`,
`Reuben Runacres`, `Maddie Price`, `Geetesh Parelly`, `Stella Grams`,
`Austin Way`

The 9 non-`ALL` tabs map 1:1 to students by name. Use the student's
`name` field in Supabase to match the tab.

### `ALL` tab schema

Row 1, column A: `Last Updated M/D` (top-level timestamp)

Row 2: header row
- A: Student
- B: Account Type (`Brand` or `Personal`)
- C: Platform (`TikTok`, `Instagram`, `YouTube`, `Twitter`)
- D: Handle
- E: Link (profile URL)
- F: Limitless Posts (manual count, do not modify)
- G onward: weekly date columns, e.g. `?-2/6`, `2/6-2/13`, `2/13-2/20`,
  `2/20-2/27`, `2/27-3/6`, `3/6-3/13`, ...

Row 3 onward: data rows. One row per `(Student × Platform)` combination.
Existing rows must be preserved; do not reorder.

Each cell in the weekly columns holds the sum of view-count deltas across
all posts for that (student × platform) within that week.

### Per-student tab schema

Row 1, column A: `Last Updated M/D`

Row 2 or row 3: header row (varies by tab — Alex Mathews uses row 3;
Maddie Price uses row 2). Detect dynamically by scanning rows 1–3 for
the header `Platform` in column A.

Header row:
- A: Platform
- B: Post Link
- C onward: weekly date columns

Subsequent rows: one row per post URL. Each weekly column holds the
view-count delta for that post within that week.

### Weekly column format

Columns are named `M/D-M/D` (e.g. `4/9-4/16`). The earliest column may
have a different format like `1/1/-2/6` or `?-2/6` for the historical
backfill — leave that column alone.

The week in `performance.week_of` is stored as a date (the week's start
or end date — verify by querying one row). To convert to the column
header format, render as `M/D-M/D` where the first date is the week
start and the second is the week start + 7 days.

Important: Sheets currently in the file end at `4/16` or `4/30`
(varies by tab). Tomorrow's first scheduled run will produce data for
the week containing May 7, 2026. The sync needs to:

1. Detect whether a column for the current week already exists
2. If not, append a new column at the end with the correct header
3. Populate the new (or existing) column with the latest deltas

---

## Supabase data source

Profile-views writes to the `performance` table. Verify the exact
schema before implementing — but expected columns are:

- `video_id` (FK to `videos.id`)
- `platform` (`tiktok`, `instagram`, etc.)
- `week_of` (date — the start of the week)
- `delta` or `view_count_delta` (the new views gained that week)
- `cumulative` or `view_count` (running total, optional for sync)
- `campus_id`

To get the URL for each row, join with `videos.url` (or whatever the URL
field is — confirm by querying one row).

To get the student name and handle for each row, join through `videos`
to `students`. The exact join path needs verification — `videos` likely
has `student_id`, and `students` has `name`, `handle_tiktok`,
`handle_instagram`.

**Verify all of this with one query before writing the sync logic.**
After tomorrow's first scheduled run, the `performance` table will
have a fresh week of real production rows from the agent. Run a
SELECT against the latest `week_of` to inspect actual column names,
NULL behavior, and join shapes. This is the test fixture for the build.

---

## Pre-build checklist (do before writing code)

Run through this list after tomorrow's 9 AM Profile-views run completes
successfully. If any step fails, pause and resolve before continuing.

1. **Confirm tomorrow's run wrote data.** Query:
   ```sql
   select count(*), week_of
   from performance
   where week_of >= '2026-05-04'
   group by week_of
   order by week_of desc;
   ```
   Should show a non-zero count for the week containing May 7.

2. **Inspect one full row.** Query:
   ```sql
   select *
   from performance
   where week_of = (select max(week_of) from performance)
   limit 1;
   ```
   Confirm column names match what this spec assumes (`video_id`,
   `platform`, `week_of`, delta field). Update spec if reality differs.

3. **Verify the join.** Query:
   ```sql
   select p.video_id, p.platform, p.week_of, v.url, s.name
   from performance p
   join videos v on v.id = p.video_id
   left join students s on s.id = v.student_id
   where p.week_of = (select max(week_of) from performance)
   limit 5;
   ```
   Confirm video URL and student name come back populated. Update
   the join logic in this spec if column names differ.

4. **Show Scott the current Sheet structure** and confirm he wants the
   sync to populate it as-is (vs restructuring the Sheet first).

5. **Spot-check Scott's expectations** for the new weekly column. The
   header format is `M/D-M/D` per the existing tabs — confirm with him
   that's still the convention he wants for new columns going forward.

Once all five checks pass, proceed to implementation.

---

## Implementation

### File 1: `tools/sheet-sync.js` (new)

Exports two functions, one per direction:

```javascript
// Direction 1: read new URLs from student tabs, create videos rows
async function pullNewUrlsFromSheet({ campusId } = {}) {
  // Returns { videosCreated: number, urlsScanned: number, skipped: number }
  // Throws on fatal errors; caller wraps in try/catch.
}

// Direction 2: write weekly deltas back to the sheet
async function pushDeltasToSheet({ campusId, weekOf } = {}) {
  // Returns { tabsUpdated: number, rowsWritten: number, columnAdded: boolean }
  // Throws on fatal errors; caller wraps in try/catch.
}
```

The Profile-views agent calls them in order: `pullNewUrlsFromSheet`
BEFORE scraping (so new URLs are in the videos table for the run),
`pushDeltasToSheet` AFTER scraping completes.

### Direction 1 implementation outline (`pullNewUrlsFromSheet`)

1. Load Sheet credentials (same setup as Direction 2).

2. For each per-student tab (9 of them, plus ALL skip):
   - Read column B (Post Link) and column A (Platform) for rows
     3 onward
   - For each non-empty (Platform, Post Link) pair:
     - Detect platform from the URL host (`tiktok.com` → tiktok,
       `instagram.com` → instagram, `youtube.com` → youtube,
       `x.com`/`twitter.com` → twitter). Sanity-check this matches
       the Platform column value.
     - Look up `videos` table: any row where
       `post_url_<platform> = thisUrl`?
     - If yes: skip (already tracked).
     - If no: create a new `videos` row with:
       - `campus_id` (look up by mapping tab name → campus, default
         to Austin campus for now)
       - `student_id` (look up by matching tab name to `students.name`)
       - `post_url_<platform> = thisUrl`
       - `status = 'POSTED BY CLIENT'` (since it's already live)
       - `title = first 60 chars of URL or "Auto-added from sheet"`
       - `created_at = now`
     - Log to `agent_logs` as `video_auto_added_from_sheet` with
       payload `{ student, platform, url, videoId }`

3. Edge cases:
   - Tab name doesn't match any student in Supabase: log warning
     `sheet_tab_unmapped`, skip that tab entirely
   - Platform column says "TikTok" but URL is an Instagram URL:
     log mismatch, prefer the URL-derived platform, continue
   - Same URL appears in multiple tabs (shouldn't happen but
     possible if Scott pastes the same post under two students):
     create one videos row, log duplicate to `agent_logs`
   - URL canonicalization: strip query strings before comparison
     (TikTok URLs often carry `?is_from_webapp=...`). Use
     `canonicalizePostUrl` from `agents/profile-views.js` for
     consistency.

4. Return `{ videosCreated, urlsScanned, skipped }`.

### Direction 2 implementation outline (`pushDeltasToSheet`)

1. Load Sheet credentials from `GOOGLE_CALENDAR_CREDENTIALS_PATH`.
   Use the `googleapis` package (already a dep). Add the
   `https://www.googleapis.com/auth/spreadsheets` scope alongside the
   existing calendar scope. Pattern matches `lib/gcal.js`.

2. Query Supabase `performance` table joined with `videos` and
   `students`. Get all rows for the latest `week_of` (or `weekOf` if
   passed). Returns array of:
   ```
   { studentName, accountType, platform, handle, profileUrl,
     postUrl, weekOfStart, weekOfEnd, delta }
   ```

3. Compute the weekly column header for the current week:
   `M/D-M/D` (e.g. `5/1-5/8`). Use date-fns or built-in Date math.

4. For each per-student tab (9 of them):
   - Read the tab to find the header row (scan A1:A3 for "Platform")
   - Find or append the column matching the current week header
   - For each post URL belonging to this student:
     - Find the row matching the URL (column B)
     - If found: write the delta to the current week's column
     - If not found: append a new row with platform, URL, and the delta
       in the current week's column
   - Update A1: `Last Updated M/D`

5. For the `ALL` tab:
   - Find the header row (row 2)
   - Find or append the column matching the current week header
   - For each (student × platform) row in the data:
     - Sum deltas across all posts for that combo (from step 2 data)
     - Write the sum to the current week's column
   - Update A1: `Last Updated M/D`

6. Return `{ tabsUpdated, rowsWritten, columnAdded }`.

**Sheets API patterns:**

- Read range: `sheets.spreadsheets.values.get({ spreadsheetId, range: 'TabName!A1:Z100' })`
- Write range: `sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: [[...]] } })`
- Append row: `sheets.spreadsheets.values.append({ spreadsheetId, range: 'TabName!A:Z', valueInputOption: 'RAW', requestBody: { values: [[...]] } })`
- For appending a column, you write to the next empty column position — read the header row, count existing columns, write to column `index + 1`.

**Performance:** batch reads where possible. Reading 10 tabs sequentially
is acceptable but slow; `spreadsheets.values.batchGet` reads multiple
ranges in one API call. For writes, `batchUpdate` does the same. Aim for
<5 API calls per tab (read header, read URLs, write column, update A1).

### File 2: hook in `agents/profile-views.js`

At the end of `runAll()`, after the existing success log, call the sync:

```javascript
// At the bottom of runAll, after the existing for-loop:
try {
  const { syncProfileViewsToSheet } = require('../tools/sheet-sync');
  const result = await syncProfileViewsToSheet({ weekOf: currentWeekOf });
  await log({
    agent: AGENT_NAME,
    action: 'sheet_sync_complete',
    payload: result,
  });
} catch (err) {
  await log({
    agent: AGENT_NAME,
    action: 'sheet_sync_failed',
    status: 'warning',
    errorMessage: err.message,
    payload: { stack: err.stack?.slice(0, 500) },
  });
}
```

The try/catch is non-negotiable. A Sheet sync failure must never cause
the Profile-views run to be reported as failed — agent_logs must show
`profile_views_run_complete` regardless.

### File 3: `.env` (both MacBook and Mac Mini)

Add:
```
GOOGLE_SHEET_ID_CONTENT_TRACKER=1B2SQciMMUh2nq_hUSKS9EwJHEKqJDnbel0z3IdTVnd0
```

### File 4: `.env.example`

Add the same line so future developers see the expected variable.

---

## Edge cases to handle

1. **Tab not found.** A student in Supabase may not have a tab in the
   Sheet (e.g., new student added after the Sheet was last updated by
   hand). Log warning, skip that student's per-student sync, but still
   include them in the ALL tab. Do not throw.

2. **URL not in tab yet.** A new post that wasn't in the Sheet last
   week — append a new row. Detect by checking column B for the URL.

3. **URL canonicalization.** Apify and the Sheet may have slightly
   different URL formats (trailing query params, `?is_from_webapp=...`,
   etc.). Use the same canonicalization logic the agent already uses
   (`canonicalizePostUrl` in `agents/profile-views.js`) when comparing.

4. **Multiple posts per row check.** The header row may not be exactly
   row 2 or row 3 — scan rows 1–3 looking for `Platform` in column A
   to detect.

5. **Empty / missing handles.** Students without a handle for a
   platform get skipped per the agent. Do not write a row for them on
   that platform.

6. **Sheet API rate limits.** The default quota is 60 read requests
   per minute per project. The sync should comfortably fit within this
   if batched.

7. **Concurrent run safety.** If somehow the sync runs twice
   simultaneously, the second run will overwrite the first. Acceptable
   for now; the agent's cron prevents this in practice.

---

## Testing

Test against the real `performance` rows from tomorrow's verified
production run. No synthetic data, no mocks. The build sequence makes
this possible: by the time you're writing the sync, the `performance`
table will already contain a full week of real deltas for all students
who have handles populated.

**Step 1 — Dry-run mode (no Sheet writes).** Modify the sync function
to accept a `{ dryRun: true }` flag that prints what it would write
without actually calling the Sheets API. Run:

```javascript
// scripts/test-sheet-sync.js
require('dotenv').config();
const { syncProfileViewsToSheet } = require('../tools/sheet-sync');

(async () => {
  const result = await syncProfileViewsToSheet({ dryRun: true });
  console.log('Dry-run result:', result);
  process.exit(0);
})();
```

Inspect the printed plan: do the per-tab + per-row writes look
correct? Are deltas reasonable (positive numbers, in the right ballpark
vs the existing weekly columns in the Sheet)?

**Step 2 — Write to a temporary test tab.** Before pointing the sync
at production tabs, create a throwaway tab in the same Sheet (e.g.,
`__sync_test_tab__`) and have the sync write there first. Verify the
column-find-or-append, row-find-or-append, and Last-Updated logic all
work without touching the production tabs Scott looks at.

**Step 3 — Live write to production tabs.** Once steps 1 and 2 are
clean, drop the dryRun flag and let it write to the real tabs.

Acceptance for step 3:
- Open the Sheet in browser
- Verify a new column appears at the right edge of each tab with the
  current week's date range (`5/1-5/8` or `5/4-5/11` depending on
  Scott's week-start convention — confirm in pre-build step 5)
- Spot-check 2-3 cells: do the values match what the agent wrote to
  Supabase for the current week?
- Verify A1 in each tab now reads `Last Updated M/D` for today's date
- Verify the ALL tab's row for (Alex Mathews × TikTok) sums correctly
  against the per-post deltas in the Alex Mathews tab

If step 3 passes, the change is ready to deploy:
1. Commit + push
2. Deploy via `~/deploy-limitless.sh`
3. The next scheduled Profile-views run (Thursday May 14, 9 AM) will
   auto-populate the Sheet. No manual trigger needed.

**Why we don't manually trigger the agent + sync as a same-day
verification** — the agent already wrote this week's data; running it
again would either no-op (if `processed_calendar_events` style dedup
exists for Profile-views) or double-write deltas. Cleaner to wait for
the next scheduled run as the verification.

---

## Out of scope (do not build tonight)

- Two-way sync (Sheet edits → Supabase). The Sheet is a read view; treat
  Supabase as canonical.
- Column reordering or formatting changes. Just write values; preserve
  any existing styles.
- Adding new tabs for new students automatically. If a student exists
  in Supabase but not in the Sheet, log warning and skip — operator
  can add the tab manually for now.
- Brand-account separation. The Sheet's `Account Type` column is
  populated manually for now; the sync writes deltas regardless of
  whether the account is Brand or Personal.

---

## Estimated time

Tight 2–3 hour build for someone working straight through. Most of the
time is in testing the column/row matching logic against the live
Sheet, not in writing the API calls themselves.
