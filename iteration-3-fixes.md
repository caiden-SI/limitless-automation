# Iteration 3 — Fix & Build Spec

Punch list of fixes and small features to apply after the May 6 Scott
handoff. Each block is self-contained and written to be acted on directly
by Claude Code without needing additional context.

Order is not strictly sequential, but Fix 1 should ship first because it
visibly contradicts the Dashboard Guide v6 already delivered to Scott.
Fix 2 is gated on Scott's Apify account being set up. Fixes 4–8 are
larger features that can be sequenced by impact.

Target branch convention: one branch per fix unless explicitly grouped.
Fix 1 should ship same-day as a hotfix.

Note: Fix 3 was the original "Friday move" cron change. It was merged
into Fix 2 (daily cadence) since Scott confirmed daily on 2026-05-07,
making Friday-vs-Thursday moot. Numbering of Fix 4–9 unchanged to
preserve cross-references.

---

## Fix 1 — Replace "stub mode" headline on the scripting agent card

**Status:** SHIPPED — `dashboard/src/lib/agents.js` line 363-366 has the
replacement string ("awaiting filming events · N scans this month")
verbatim per spec.

**Problem:** The scripting agent card on the dashboard renders a headline
that begins with `stub mode · N scans, 0 events triggered`. The agent is
fully built and live (1,054 lines in `agents/scripting.js`, atomic claim
logic, brand-voice validation, ClickUp + Supabase writes). The "stub
mode" prefix is a leftover label from when the agent actually was a stub
during early development. Scott has already received the corrected
Dashboard Guide v6 which explicitly states the agent is live, so the
contradiction between the doc and his on-screen panel is now visible.

**Fix:** In `dashboard/src/lib/agents.js`, replace the stub-default
branch of the scripting `headlineMetric` function so it conveys the
correct state: the agent is alive and scanning, but no qualifying
calendar events have appeared in the 48-hour lookahead window.

**File:** `dashboard/src/lib/agents.js`

**Current code (around line 363):**

```javascript
// Stub default.
return `stub mode · ${scans30d} scans, 0 events triggered`;
```

**Replace with:**

```javascript
// Live, awaiting qualifying events. The agent scans every 15 min
// against a 48-hour calendar lookahead — if no filming events
// appear in the window, scans continue but no concepts are staged.
return `awaiting filming events · ${scans30d} scans this month`;
```

The two surrounding branches (voice-abort active, concepts staged) are
correct and should not be touched. Only the final fallback string
changes.

**Also update:** `dashboard-agents-rebuild-spec.md` line 462 references
the old string in a code comment. Update the comment to match the new
copy so future reviewers don't get confused. Replace
`While stub: stub mode · <N> scans, 0 events triggered` with
`Default: awaiting filming events · <N> scans this month`.

**Acceptance:**
- The scripting card on the dashboard reads
  `awaiting filming events · 87 scans this month` (or the current
  scan count) instead of `stub mode · 87 scans, 0 events triggered`.
- After the first calendar event triggers a concept generation,
  the headline transitions to the post-stub branch
  (`N concepts staged this week · M events served`) — verify by
  watching `agent_logs` for a `campus_run_complete` row with
  `payload.concepts > 0`.
- No regression to the voice-abort branch — search the file for the
  voice-abort headline string and confirm it's untouched.

---

## Fix 2 — Switch Profile-views to daily cadence

**Problem:** Scott wants mid-week visibility into student view counts so
he can course-correct before his Friday update email. Going from weekly
(Thursday 9 AM) to daily costs roughly $20/month additional based on
Apify per-event pricing (8 students × 20 videos × $0.005/event × 6
extra runs/week).

**Status:** Approved by Scott on 2026-05-07: *"Yes this is completely
fine, lets have it run once per day."* This supersedes the original
Friday-move proposal — daily covers every day including Friday, so the
day-of-week choice is moot.

**Fix:** Change the cron expression in `server.js` to fire every day
at 9 AM.

**File:** `server.js`

**Current code (around line 204):**

```javascript
scheduler.register('profile-views-agent', '0 9 * * 4', profileViews.runAll);
```

**Replace with:**

```javascript
scheduler.register('profile-views-agent', '0 9 * * *', profileViews.runAll);
```

**Also update:**
- `server.js` line 206: the console-log message currently says
  "Thursday 9AM" — change to "daily 9AM".
- `agents/profile-views.js` line 2: the trigger comment says
  `Cron job, Thursday 9 AM (\`0 9 * * 4\`)` — update to
  `Cron job, daily 9 AM (\`0 9 * * *\`)`.
- `workflows/profile-views.md` if it references Thursday; replace
  with "daily 9 AM" throughout. Search for the word "Thursday".
- `dashboard/src/lib/agents.js` if the profile-views card includes
  a cadence label like `Thu · 9 AM` — change to `daily · 9 AM`.
- `docs/scott-system-overview.md` if it lists Thursday 9 AM under
  Profile-views, update.
- `docs/system-facts.md` if it lists Thursday under Profile-views,
  update.
- `docs/scott-questions-answered.md` Q7 currently confirms the move
  is pending — once shipped, replace with a confirmation that it
  shipped on date X.

**Sub-blocker:** Caiden's Apify free tier ($5/month) won't cover
daily cadence (~$35-40/month projected total bill). Switch the cron
ONLY after Scott's Apify account is set up and the API token is
swapped in `.env`. Until then, daily cadence will burn through
Caiden's free tier in ~3-4 days and start failing.

**Acceptance:**
- Cron expression in `server.js` reads `'0 9 * * *'`.
- Apify token in `.env` is Scott's, not Caiden's free-tier token.
- Cron fires once per day at 09:00 local time. Verify by watching
  `agent_logs` for 7 consecutive Profile-views runs across a week.
- Apify dashboard (Scott's account) shows daily Profile-views runs at
  ~$0.10/run × N students. Monthly bill should land in the $35–40
  range (Research ~$15 + Profile-views daily ~$20).
- No regression to the agent's per-student processing logic — each
  student's `performance` row should update once per day.

---

## Fix 4 — Self-serve student creation flow with auto-distribution

**Status:** SHIPPED 2026-05-12 as `/students` dashboard console
(spec: `docs/dashboard-consoles-spec.md` §5). Copy-paste URL UX; the
auto-distribute variant (SMS/email) is intentionally deferred to v1.5
per the consoles spec — Scott felt copy-paste cleared the friction
without the channel-routing complexity. Originally approved 2026-05-07.

**Starting point:** `scripts/create-student.js` already exists (built
2026-05-07). Wraps the row insertion + URL composition in a CLI. This
fix promotes that logic to a dashboard UI and adds optional
auto-distribution. Do not rebuild the row-creation logic from scratch
— extract from `scripts/create-student.js` into a shared helper.

**Problem:** Today, adding a new student is a manual three-step process:
(1) insert a row into Supabase `students` with name + handles + campus,
(2) grab the auto-generated UUID and the campus_id, (3) compose the
onboarding URL by hand and send it to the student. This is the highest-
leverage manual step that gets repeated for every new student.

**Fix:** Add a "Create Student" UI on the dashboard that takes the
student's name, TikTok handle, Instagram handle, and campus, creates
the Supabase row, and returns a copyable onboarding URL. Optionally,
auto-distribute via SMS or email.

**Files:**

- New endpoint: `server.js` — add `POST /students/create` that accepts
  `{ name, tiktokHandle, instagramHandle, campusId }`, inserts a row
  into `students`, and returns
  `{ studentId, campusId, onboardUrl }`. The onboardUrl format is
  `https://[host]/onboard?student=[studentId]&campus=[campusId]` —
  derive the host from `process.env.PUBLIC_URL` or the request's
  origin.

- New component: `dashboard/src/components/CreateStudentDialog.jsx` —
  a modal triggered from a button somewhere on the dashboard (suggested
  location: above the AGENTS grid, next to the existing student count
  display, or in a new "Roster" panel). Fields: name, TikTok handle,
  Instagram handle, campus dropdown, optional delivery method radio
  (Copy URL only / Send via SMS / Send via Email). On submit, calls
  the new endpoint and either shows the URL for copy or fires the
  selected delivery channel.

- Auto-distribute (Scott approved this in addition to URL copy):
  - SMS: use Twilio via `lib/twilio.js` (new file). Add
    `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
    to `.env`. Requires phone number on student row — extend the
    create endpoint to accept `phone` field.
  - Email: use Gmail API via the existing Google service account
    (already authenticated for Calendar + Sheets). Send from
    `automation@limitlessyt.com` or whichever shared inbox Scott
    designates. Requires email on student row — extend create
    endpoint to accept `email` field.
  - Both delivery methods use the same `onboardUrl` returned from
    the create endpoint. Body template: short greeting + URL +
    "Reply if you have any questions" line.

- Schema: confirm `students` table accepts the columns above without
  modification. If `tiktok_handle` / `instagram_handle` columns don't
  exist, add a migration: `ALTER TABLE students ADD COLUMN
  tiktok_handle text, ADD COLUMN instagram_handle text;`. Search for
  existing handle columns first — they may already exist with
  different names.

**Validation:**
- Reject if name is empty, both handles are empty, or campusId
  doesn't exist in `campuses` table.
- Reject if a student with the same name already exists in the same
  campus (collision risk for Scripting's `parseStudentFromEvent`
  matcher — two students with the same name would all match
  ambiguously). Surface this as a UI error: "A student named X
  already exists in this campus. Use a distinguishing suffix or
  middle name."

**Acceptance:**
- Clicking "Create Student" with valid inputs creates a Supabase row
  and returns a working URL. Opening the URL in a browser starts the
  onboarding chat for that student.
- Duplicate-name rejection works (test with two "Sarah" entries
  intentionally).
- The created student immediately appears in any roster view on the
  dashboard.

---

## Fix 5 — One-way Sheet sync for Profile-views data

**Status:** SHIPPED 2026-05-11 as **two-way** sync (commit `2b7ab06`,
"Iteration-3 batch: Profile-views rebuild + two-way sheet sync..."),
exceeding the original one-way spec. `tools/sheet-sync.js` exists;
`agents/profile-views.js` calls `sheet_pull_complete` (Sheet → Supabase,
pulls new post URLs Scott pastes into student tabs) and
`sheet_push_complete` (Supabase → Sheet, writes weekly deltas back) on
every Profile-views run. Verified live via pm2 logs and agent_logs.

**See `sheet-sync-spec.md` for the buildable spec.** That doc has the
full implementation outline: per-tab dynamic header detection,
column-find-or-append logic, dry-run mode, three-stage testing
procedure, the actual Sheet structure (10 tabs, weekly columns), and
the pre-build SQL checklist for verifying the `performance` table
schema. The block below is the high-level overview.

---

**Problem:** Profile-views writes view counts and growth metrics to
Supabase `student_profile_metrics`. Scott has a Google Sheet he uses
for the team-facing weekly performance review. Today the Sheet has to
be manually refreshed from Supabase numbers — error-prone and slow.

**Fix:** Add a one-way scheduled push from Supabase to the Sheet that
fires immediately after each Profile-views run completes. Supabase
remains canonical; the Sheet is the read-friendly view.

**Files:**

- New tool: `tools/sheet-sync.js` — Google Sheets API client that
  takes a Supabase query and writes results into a target Sheet/tab.
  Use the `googleapis` package (already a dependency for `lib/gcal.js`).
  Reuse the same service-account credentials path
  (`GOOGLE_CALENDAR_CREDENTIALS_PATH`) but request the
  `https://www.googleapis.com/auth/spreadsheets` scope as well.

- Hook into Profile-views: at the end of
  `agents/profile-views.js` `runAll()` (or `processStudent` if
  per-student is preferred), call `sheetSync.pushProfileMetrics()` to
  refresh the target Sheet with the latest data for all students.

- Config: add `GOOGLE_SHEET_ID_PROFILE_METRICS` to `.env` and
  document in `.env.example`. Scott already provided the Sheet — get
  its ID from the URL.

- Column mapping: ask Scott for the column structure he wants in the
  Sheet (likely: student name, TikTok handle, IG handle, view counts
  this week, view counts last week, week-over-week delta, growth
  percentage, last updated timestamp). Encode the mapping in
  `tools/sheet-sync.js` so it's easy to update.

**Edge cases:**
- If the Sheet sync fails, it must not block Profile-views from
  marking its run complete. Log the sync error to `agent_logs` with
  `status: 'warning'` and continue.
- If a student is removed from Supabase, the Sheet should reflect
  this — implement as a full overwrite of the target tab on each
  push, not append-only.

**Acceptance:**
- After a Profile-views run, the Sheet's target tab matches the
  Supabase `student_profile_metrics` table for the latest week.
- Removing a student from Supabase results in their row disappearing
  from the Sheet on the next sync.
- Sync failure does not break Profile-views; it logs a warning and
  the next run retries.

---

## Fix 6 — Manual scripting trigger

**Status:** SHIPPED 2026-05-13 as the `/scripting` dashboard console
(see `docs/dashboard-consoles-spec.md`). Per-card REFINE + PUSH TO
CLICKUP, voice-abort surfaced with Regenerate button. Routes:
`POST /admin/scripting/generate|refine|push` in `routes/admin-scripting.js`.
Auto-push deferred per Scott; review-then-push is the v1 contract.

**Problem:** Scripting fires only on Google Calendar events. There is
no path for "I have an idea right now, generate scripts for it" —
useful when Scott or Caiden wants to test a concept without booking
a filming event first.

**Fix:** Add a `/scripting/generate` endpoint and a dashboard UI that
accepts a free-text concept brief plus a student selector, runs the
existing `generateConcepts` flow, and either surfaces the resulting
scripts in the UI or writes them to ClickUp like the calendar-driven
flow does.

**Files:**

- New endpoint: `server.js` — add
  `POST /scripting/generate` that accepts
  `{ studentId, campusId, conceptBrief, writeToClickup: boolean }`.
  Build a synthetic event object (
  `{ id: \`manual-\${uuid}\`, title: conceptBrief, description: '', startTime: now }`),
  then call `scripting.processEvent(syntheticEvent, campusId)`.
  Return either the generated concepts (if `writeToClickup === false`)
  or the ClickUp task IDs (if `writeToClickup === true`).

- Important: `processEvent` does atomic claim insertion via
  `processed_calendar_events`. Manual events should use a synthetic
  event_id format (e.g., `manual-<uuid>`) that never collides with
  real Google Calendar event IDs. Verify the format does not violate
  the table's unique constraint.

- New component: `dashboard/src/components/ManualScriptingDialog.jsx`
  — modal with student dropdown, concept brief text area, "Generate"
  button, and a results panel showing the 3 returned concepts with
  options to "Send to ClickUp" or "Discard". Triggered from a button
  near the scripting card.

**Validator return contract (read before implementing):** Look at
`agents/scripting.js` `generateConcepts` (around line 417). It returns
either `{ concepts, validatorResults }` on success or
`{ aborted: true, issues, attempts }` on voice-validation gate
failure. The handler must branch on `result.aborted` and surface the
issues array to the UI. The `validatorResults` array on success has
per-concept `layer1_issues` and `layer2_notes` that may also be
worth surfacing for log-only mode warnings.

**Edge cases:**
- Brand-voice validation still runs on manual concepts. If the
  validator aborts (gate mode), return the abort detail to the UI
  rather than silently dropping the concepts. The user should see
  "Voice validation rejected these concepts: [issues]" and have the
  option to retry with a different brief.
- If `writeToClickup === false`, the videos rows still get inserted
  in Supabase (or skip the writeConcepts step entirely — preferred,
  since manual generation may be exploratory and shouldn't pollute
  the videos table). Decide: read-only preview mode that skips
  writeConcepts, vs full write mode that includes ClickUp + videos.

**Acceptance:**
- Submitting a concept brief returns 3 generated scripts within
  ~30 seconds.
- Voice validation aborts surface to the UI as readable error
  messages.
- Saving to ClickUp creates 3 tasks identical in shape to
  calendar-driven scripts.

---

## Fix 7 — Brand-account SIGNALS subsection

**Problem:** Scott has flagged that the brand-owned IG and TikTok
accounts (`alphahigh.school` handles) need to be tracked separately
from individual student accounts. Today, Performance and Profile-views
aggregate at the student level only.

**Fix:** Add a brand-account track in Supabase, run Profile-views and
Performance against it as a distinct entity, and surface a "Brand"
subsection on the dashboard SIGNALS panel.

**Files:**

- Schema: decide between two patterns:
  - Option A — `is_brand_account boolean` column on `students` and
    `student_profile_metrics`. Simpler, treats brand accounts as a
    flagged subset of the existing tables.
  - Option B — new `brand_accounts` and `brand_profile_metrics`
    tables that mirror the student equivalents. Cleaner separation,
    more migration work.
  - Recommended: Option A. Brand accounts behave like students
    structurally — they have handles, they get scraped, they have
    view-count history. The flag captures the semantic difference
    without doubling the schema.

- Migration: `migrations/2026-05-XX-brand-account-flag.sql`:
  ```sql
  ALTER TABLE students ADD COLUMN is_brand_account boolean DEFAULT false;
  ALTER TABLE student_profile_metrics ADD COLUMN is_brand_account boolean DEFAULT false;
  ```

- Profile-views: no agent-side change required if Option A — the
  existing scrape loop works for any row in `students`. Just insert
  the alphahigh.school accounts as students with
  `is_brand_account = true`.

- Performance: update `agents/performance.js` to compute two parallel
  signal sets — one filtered to `is_brand_account = false` (per-
  student rollup, current behavior) and one filtered to
  `is_brand_account = true` (brand rollup, new). Write both to
  `performance_signals` with a new `scope` column
  (`'student'` vs `'brand'`).

- Dashboard SIGNALS panel: split into two subsections — "Per-student"
  and "Brand" — sourced from the corresponding `performance_signals`
  rows.

**Acceptance:**
- Inserting an alphahigh.school account with `is_brand_account = true`
  causes Profile-views to scrape it on the next cron tick.
- Performance generates two distinct signal sets each Monday — one
  for students, one for brand. Both visible on the dashboard.
- Removing the brand flag returns the account to the per-student
  rollup without data loss.

---

## Fix 8 — Verify Profile-views Instagram path (DONE 2026-05-08)

**Status:** Verified. The Thursday 9 AM scheduled run on 2026-05-08
fired all 6 TikTok scrapes and all 9 Instagram scrapes successfully.
Instagram path works end-to-end. **However, that run also surfaced a
much bigger architectural issue with the agent — see Fix 11 below
(channel-level scraping coverage gap).** Fix 8 verifies "the IG code
path runs without error"; Fix 11 addresses "the agent captures the
right data."

---

## Fix 8 (original spec, preserved for reference)

**Problem:** All Profile-views runs to date have been on the TikTok side
only (per the Apify dashboard runs log: zero `apify/instagram-scraper`
runs at non-06:00 timestamps). The Instagram code path in
`agents/profile-views.js` exists but is unverified end-to-end.

**Fix:** Trigger one manual Profile-views run targeting a student with
both TikTok and Instagram handles populated. Verify both halves complete
successfully and write to `student_profile_metrics`.

**Files:** No code changes expected unless the test reveals a bug.

**Test procedure:**
1. Pick a student with both `tiktok_handle` and `instagram_handle` set.
2. Trigger Profile-views manually via `node scripts/run-profile-views.js`
   (or the equivalent test script — check `scripts/` for the right
   file).
3. Watch the Apify dashboard for two new runs: one TikTok scraper, one
   Instagram scraper. Both should succeed.
4. Query `student_profile_metrics` for that student and confirm both
   `tiktok_view_count` and `instagram_view_count` (or whatever the
   column names are — check the schema) are populated.

**If the test fails:**
- Check `agent_logs` for the Profile-views run's per-student events.
  Look for the Instagram-side error.
- Common failures: handle format mismatch (e.g., agent expects
  `@username` but stored as `username`), Apify actor input shape
  drift, missing env var.
- Once the failure mode is identified, file a separate fix in this
  doc.

**Acceptance:**
- One verified end-to-end Profile-views run that scrapes both TikTok
  and Instagram for the same student. Numbers land in Supabase. No
  errors in `agent_logs`.

---

## Fix 10 — Calendar attendee matching for Scripting

**Status:** SHIPPED 2026-05-12 (commit `1b9c8af`, "Scripting:
attendee-email event matching + drop deleted custom-field write").
`lib/gcal.js` `parseStudentFromEvent` now matches by attendee email
against `students.email`. `SCRIPTING_IGNORED_ATTENDEE_EMAILS` env var
filters scott@, charles@, jack.oremus@ before matching. Closes the
"calendar event format" open item in scott-questions-answered.md.

**Problem:** All filming events on the calendar share the same title
(`"Limitless Student Videos"`). The current `parseStudentFromEvent`
matcher in `lib/gcal.js` looks for student names in the event
title/description — useless when every event has the same title. As a
result, Scripting fires on the cron, finds events, but rejects them
all as `no_student_match`, so no scripts get generated. UPCOMING SHOOTS
on the dashboard stays empty.

**Inputs from Scott (his comment #4 on Build Document Q&A,
2026-05-07):**
- Event title: `"Limitless Student Videos"` (constant across all events)
- Attendees: students with `first.last@alpha.school` email syntax
- Ignored attendees: `scott@limitlessyt.com`, `charles@limitlessyt.com`,
  `jack.oremus@alpha.school`

**Fix:** Switch `parseStudentFromEvent` from name-in-title matching to
attendee-email matching.

**Files to change:**

1. **`lib/gcal.js` — `listUpcomingFilmingEvents`** (around line 42).
   The current return shape strips attendees:
   ```javascript
   return items.map((ev) => ({
     id: ev.id,
     title: ev.summary || '',
     description: ev.description || '',
     startTime: ev.start?.dateTime || ev.start?.date || null,
   }));
   ```
   Add `attendees: (ev.attendees || []).map((a) => a.email).filter(Boolean)`
   to the returned object.

2. **`lib/gcal.js` — `parseStudentFromEvent`** (around line 84).
   Rewrite to:
   - Read the ignored email list from
     `process.env.SCRIPTING_IGNORED_ATTENDEE_EMAILS` (comma-separated,
     case-insensitive).
   - For each attendee email not in the ignored list, look up the
     matching student by email in the `students` table.
   - Return `{ student, reason: 'matched' }` on exactly one match,
     `{ student: null, reason: 'ambiguous', candidates }` on multiple,
     `{ student: null, reason: 'no_student_match' }` on zero.

3. **Schema:** `students` table needs an `email` column. Migration:
   ```sql
   ALTER TABLE students ADD COLUMN email text;
   CREATE INDEX students_email_idx ON students (lower(email));
   ```
   Backfill: derive from `first.last@alpha.school` pattern using each
   student's `name` (`Geetesh Parelly` → `geetesh.parelly@alpha.school`).
   For Alpha High brand account, leave email NULL (it has no
   alpha.school email).

4. **`agents/scripting.js`** (around line 67-71). The student select
   now needs `email`:
   ```javascript
   const { data: students, error: sErr } = await supabase
     .from('students')
     .select('id, name, email, claude_project_context')
     .eq('campus_id', campusId);
   ```

5. **`.env`** and **`.env.example`** — add:
   ```
   SCRIPTING_IGNORED_ATTENDEE_EMAILS=scott@limitlessyt.com,charles@limitlessyt.com,jack.oremus@alpha.school
   ```

**Edge cases:**

- Student missing email in Supabase: log warning, skip the event
  rather than throwing. Scott can backfill later.
- Multiple students at the same event (group filming): currently
  returns `ambiguous`. Decide whether to support multi-student
  events. For now, keep ambiguous-rejection behavior — it's safer
  than guessing wrong, and Scott can split events into one-per-student
  if needed.
- Email casing: always normalize to lowercase before comparison
  (Google Calendar may return mixed case).
- Attendee list missing entirely: some calendar events don't have
  attendees set. Treat as `no_student_match` and skip.

**Acceptance:**

- Insert a test calendar event titled "Limitless Student Videos" with
  one student (e.g. `geetesh.parelly@alpha.school`) and one ignored
  attendee (e.g. `scott@limitlessyt.com`) within the next 48 hours.
- Wait for the next 15-minute cron tick (or trigger Scripting
  manually).
- Verify `agent_logs` shows `student_matched` with the correct
  student ID, then `event_processed` with concepts staged.
- UPCOMING SHOOTS panel on the dashboard reflects the event with
  "scripts ready" status.
- Verify ignored attendees don't trigger ambiguous rejection.

---

## Fix 11 — Profile-views URL-based scraping refactor

**Status:** SHIPPED 2026-05-11 as part of commit `2b7ab06`
("Iteration-3 batch: Profile-views rebuild + two-way sheet sync...").
`agents/profile-views.js` rewritten from channel-level scraping to
URL-based per-post scraping. Daily 9 AM runs verified producing
correct weekly deltas (not cumulative all-time totals). 11a/b/c/d/e
sub-changes all landed together. `scripts/backfill-post-urls.js`
exists for the one-time backfill from Sheet to Supabase. Original
problem statement preserved below for reference.

**Original problem context:** The first scheduled Profile-views run
on 2026-05-08 captured the wrong data — cumulative all-time view
counts labeled as weekly deltas, with pinned-video distortion blowing
up the numbers. Caiden manually rebuilt the data to hit Scott's
deadline by extracting URLs from the spreadsheet and scraping each
one individually. This fix institutionalized that recovery into the
agent.

**Problem (four architectural issues found in the May 8 run):**

1. **Channel-level scraping vs URL-level scraping.** The current
   `scrapeProfileVideos(profileUrl, platform, 20)` grabs whatever
   videos appear on the profile page. Different from the manual
   methodology which tracks specific post URLs registered in the
   spreadsheet. Channel-level grabs are inconsistent (TikTok algorithm
   shows different videos at different times), miss older tracked
   posts, and over-include unrelated content. Coverage:
   - TikTok: 28 of 51 expected (45% short)
   - Instagram: 3 of 59 expected (95% short)
   - YouTube: 0 of 6 (scraper failed entirely)
   - Twitter: 0 of 10 (scraper failed entirely)
2. **No delta calculation logic in pipeline.** The agent stored
   cumulative all-time view counts and labeled them as the current
   week's data. A video posted Feb 13 with 1.4M cumulative views
   looked like it generated 1.4M "weekly views" on May 1.
3. **Pinned video distortion.** TikTok pins old top performers to the
   top of profile pages. Channel scraper grabbed those first and
   counted their cumulative numbers as fresh weekly performance —
   Alex Mathews' pinned February video alone was inflating the May 1
   total by 1.4M views.
4. **No URL-to-video mapping.** `videos.post_url_*` columns exist but
   are all NULL. Even if scrapers returned data, joining to specific
   tracked posts was impossible.

**Fix (five sub-changes that ship together):**

### 11a — New URL-based scraper functions

**File:** `tools/scraper.js`

Add `scrapeVideosByUrls(urls, platform)` — accepts a list of post
URLs, returns scraped data per URL. Per-platform actor mappings
(verified during the May 8 manual recovery):
- TikTok: `clockworks/tiktok-scraper` (paid version, supports
  `postURLs` parameter; the free version we currently use only does
  channel scraping)
- Instagram: `apify/instagram-scraper` with `directUrls` parameter
- YouTube: `streamers/youtube-scraper` with URL list
- Twitter: SKIP for now — see 11d

The function signature:
```javascript
async function scrapeVideosByUrls(urls, platform) {
  // Returns: [{ url, viewCount, likes, shares, scrapedAt }]
  // One entry per URL. Failed URLs return { url, error: 'reason' }.
}
```

Keep the existing `scrapeProfileVideos` for now (still used by
Onboarding Section 3 for influencer transcript fetch).

### 11b — Refactor `agents/profile-views.js` `run()` to URL-iterate

**File:** `agents/profile-views.js` (around lines 301-410)

Old loop: `for student → for platform → scrapeProfileVideos → match against videoIndex`

New loop: `for video in videos table where post_url_* is set → scrape that URL → upsert performance row`

Pseudo-code:
```javascript
async function run(campusId) {
  const videos = await loadVideosWithPostUrls(campusId);
  const byPlatform = groupByPlatform(videos);

  for (const [platform, videoList] of Object.entries(byPlatform)) {
    const urls = videoList.map((v) => v[`post_url_${platform}`]).filter(Boolean);
    if (urls.length === 0) continue;

    const scraped = await scrapeVideosByUrls(urls, platform);
    for (const item of scraped) {
      const video = videoList.find((v) => v[`post_url_${platform}`] === item.url);
      if (!video || item.error) continue;

      const previousCumulative = await getPreviousCumulative(video.id, platform);
      const delta = Math.max(0, item.viewCount - previousCumulative);

      await upsertPerformance({
        videoId: video.id,
        platform,
        weekOf: mostRecentFriday(),
        cumulativeViews: item.viewCount,
        delta,
      });
    }
  }
}
```

The `getPreviousCumulative` lookup queries `performance` for the
most recent prior `cumulative_views` value for that
(video_id, platform) pair, defaulting to 0 if no prior row exists.

### 11c — Schema verification + delta column

Before writing the upsert, verify the `performance` table schema by
inspecting one row. The earlier spot-check failed because we assumed
a `delta` column that doesn't exist. Likely candidates for what does
exist: `view_count`, `cumulative_views`, `weekly_delta`. Pick names
that match reality, or add a migration:
```sql
ALTER TABLE performance ADD COLUMN IF NOT EXISTS cumulative_views bigint;
ALTER TABLE performance ADD COLUMN IF NOT EXISTS weekly_delta bigint;
```

### 11d — Stub Twitter (mark manual)

Twitter Lite scraper doesn't return view counts; V2 has limitations.
For now:
- `scrapeVideosByUrls` returns `{ error: 'twitter_manual' }` for all
  Twitter URLs without making any Apify call
- Skip Twitter URLs in the loop with a warning log
- Document in `workflows/profile-views.md` that Twitter view counts
  are entered manually by Scott in the spreadsheet until a working
  actor is found

Future work: research if `apify/twitter-url-scraper` or similar
returns view counts. Track as separate fix when picked up.

### 11e — Populate `post_url_*` columns from the Sheet (Direction 1 of Fix 5)

The agent depends on `videos.post_url_tiktok`, `post_url_instagram`,
`post_url_youtube`, `post_url_twitter` being populated. Today they're
all NULL. Frame.io was supposed to detect new posts and auto-populate
these columns, but Frame.io v4 is deferred (Fix 9). The workaround is
to make the Content Performance Tracker Sheet the canonical new-post
entry point. Scott already lives in this sheet weekly — adding URLs
there fits his existing workflow.

The data flow becomes:

1. Scott pastes a new post URL into the appropriate student's tab in
   the Content Performance Tracker Sheet (column B = Post Link).
2. On the next Profile-views run cycle, before scraping, the
   `pullNewUrlsFromSheet` function (Direction 1 of Fix 5 / Sheet
   Sync) reads each student tab's URL column and creates `videos`
   rows for any URL not already tracked.
3. Profile-views run scrapes the now-populated URL list.
4. `pushDeltasToSheet` (Direction 2 of Fix 5) writes the deltas back
   to the sheet's weekly column.

**Sub-tasks (now consolidated under Fix 5):**

- Implement `pullNewUrlsFromSheet` per `sheet-sync-spec.md` Direction
  1. Handles tab → student mapping, URL canonicalization, platform
  detection from URL host, video row creation.
- Wire `agents/profile-views.js` `run()` to call
  `pullNewUrlsFromSheet({ campusId })` before its loadVideos query
  so the new rows are visible to the scrape loop.
- One-time backfill from the existing Sheet's URL column. Write a
  one-off script `scripts/backfill-post-urls.js` that runs
  `pullNewUrlsFromSheet` once against the current Sheet contents.
  126 videos expected. After backfill, query
  `select count(*) from videos where post_url_tiktok is not null or post_url_instagram is not null or post_url_youtube is not null`
  to confirm.

**Future work (when Frame.io v4 is fixed):** Frame.io retakes the
new-post-detection role. It writes URLs directly to
`videos.post_url_*` from its webhook handler. The
`pullNewUrlsFromSheet` direction becomes a backup path rather than
the primary — same logic still works, just runs as a safety net
catching anything Scott pastes into the sheet that Frame.io missed.

**ClickUp custom field plumbing (optional, lower priority):** if
Scott reliably moves tasks to "posted by client" in ClickUp AND
pastes the post URL into the custom field, we could add a ClickUp
webhook → pipeline → videos.post_url_* path as a secondary entry
point. Not blocking. Sheet entry is the primary path until
Frame.io is fixed.

**Acceptance for the full Fix 11:**

- After backfill, query `select count(*) from videos where post_url_tiktok is not null or post_url_instagram is not null or post_url_youtube is not null` returns close to 126.
- Next Profile-views run fires `scrapeVideosByUrls` for each platform's
  URL list, not `scrapeProfileVideos`.
- Apify dashboard shows runs against `clockworks/tiktok-scraper` (the
  paid URL-based one), `apify/instagram-scraper` with directUrls,
  and `streamers/youtube-scraper`. Twitter shows zero runs.
- `performance` table gets one row per (video × platform × week_of)
  with `cumulative_views` AND `weekly_delta` populated.
- Spot-check a known-pinned video: its `weekly_delta` for the latest
  week should be small (a few hundred or thousand views, not millions).
- Scott's Sheet sync (Fix 5) reads from `weekly_delta`, not
  `cumulative_views`, when populating the weekly column.

**Out of scope (defer to future fix):**

- Frame.io verification filter (old tracker filtered non-Limitless
  content via frame matching; Apify has no equivalent quality filter).
  Accept lack of filter for now. Track as future work if false
  positives become a problem.

---

## Fix 9 — Frame.io v4 migration (DEFERRED 2026-05-08)

**Status:** Code is written and committed but NOT in use. Deferred until
the OAuth license blocker is resolved (see "Why deferred" below). The
files (`lib/frameio-oauth.js`, `lib/frameio.js`, `handlers/frameio.js`,
`scripts/register-frameio-webhook.js`) ship as-is so the work isn't
lost; they activate the moment OAuth credentials become available.

**Why deferred:** Frame.io v4 OAuth Server-to-Server credentials are
gated behind an Adobe Developer Console license. Both Caiden's Spur
Intel org AND Scott's limitlessyt.com org show "Your organization does
not have a license to access this credential type" when attempting to
create the credential. This is a Frame.io plan-tier limitation —
Server-to-Server OAuth typically requires Frame.io Enterprise, and
Scott is on a lower tier.

**What this blocks (the actual cost of deferring):**

1. **Flow 1 — Comment routing back to ClickUp.** When Scott (the
   reviewer) leaves a comment in Frame.io flagging a video for
   revision, the webhook fires successfully but our handler can't
   call back to `GET /v4/comments/{id}` to find which file the
   comment is on. Without that lookup, we can't update the matching
   ClickUp task to `waiting`. **Workaround:** Scott manually moves
   the ClickUp task to `waiting` after leaving a comment. One extra
   click. This was the manual process before automation.

2. **Flow 2 — Client share link on `done`.** When a task moves to
   `done`, pipeline should call `createShareLink(assetId)` to generate
   a client-facing Frame.io URL and write it to ClickUp's "E - Frame
   Link" custom field. Without API access, this fails. **Workaround:**
   Scott manually creates the share link in Frame.io and pastes it
   into ClickUp on `done`. This was also the manual process before
   automation.

Both workarounds are regressions vs. the planned automation but do
not block any other agent or workflow.

**What's already written (sitting dormant on disk):**

- `lib/frameio-oauth.js` — Adobe IMS OAuth client (cached, single-flight)
- `lib/frameio.js` — v4 REST client (webhook CRUD + share links)
- `handlers/frameio.js` — v4 signature verification + payload parsing
- `scripts/register-frameio-webhook.js` — one-time webhook registration

**To revive when OAuth becomes available:**

1. Scott obtains Frame.io Enterprise upgrade OR Adobe enables
   Server-to-Server OAuth on his existing plan
2. Scott creates the OAuth credential in his Adobe Developer Console
   (in his org, where the Frame.io license now lives)
3. Scott sends Caiden `client_id`, `client_secret`, `scopes`
4. Caiden adds the five env vars (`FRAMEIO_OAUTH_CLIENT_ID`,
   `FRAMEIO_OAUTH_CLIENT_SECRET`, `FRAMEIO_OAUTH_SCOPES`,
   `FRAMEIO_ACCOUNT_ID=f740e545-489d-4f31-88e0-dbb729642de3`,
   `FRAMEIO_WORKSPACE_ID=...`)
5. Verify OAuth: `node -e "require('dotenv').config(); require('./lib/frameio-oauth').getAccessToken().then(t => console.log('OK len=' + t.length))"`
6. Either run `scripts/register-frameio-webhook.js` to create webhook
   via API, OR continue using the v4 webhook UI Scott has access to
   (UI works; doesn't need OAuth — only the lookup callback does)
7. Add the signing secret returned by webhook creation as
   `FRAMEIO_WEBHOOK_SECRET` to `.env`
8. `pm2 restart limitless-webhooks`

**Alternative paths to revisit if Enterprise upgrade is off the table:**

- **Custom Actions** (UI-creatable, no OAuth needed): replace
  comment-based routing with a "Send back to editor" button Scott
  clicks. Webhook payload includes file context directly. Trades
  freeform comment text for a structured signal. See earlier chat
  discussion for full pros/cons.
- **Different webhook event** that includes file context in the
  payload (`file.versioned`, `metadata.value.updated`,
  `customfield.updated`). Loses comment-as-trigger semantic but
  works without OAuth.

**Action item:** Scott to contact Frame.io support and ask whether
his current plan SHOULD include Server-to-Server OAuth (the error
hover said "if you think this is an error, contact support"). Worth
5 minutes of Scott's time before accepting the plan-tier conclusion.

---

## Fix 9 (continued) — Original implementation outline

The body below is the original implementation spec from when we
expected to ship this. Preserved as historical reference + revival
playbook for when OAuth becomes available.

**Problem:** Scott's Frame.io account is on v4 (`next.frame.io`), but
the existing client + handler in this repo were built for v2. The v2
webhook UI at `developer.frame.io/app/webhooks` requires selecting a
"team" — but v4 reorganized teams into accounts/workspaces, and v4
accounts don't appear in the v2 team picker. Result: no webhook can be
registered, and even if it were, the existing handler's signature
verification and payload parsing would reject v4 payloads.

This blocked the entire Frame.io → ClickUp comment routing flow that QA
depends on for editor-rejection signaling.

**Fix:** Full v4 migration. Files written:

- `lib/frameio-oauth.js` (new) — Adobe IMS Server-to-Server token
  client. In-memory cache with 5-minute proactive refresh,
  single-flighted to prevent concurrent refresh storms, fails loud on
  4xx (bad creds), retries once on 5xx.

- `lib/frameio.js` (rewritten) — v4 base URL (`/v4`), OAuth bearer
  auth, webhook CRUD nested under `/accounts/{id}/workspaces/{id}/`.
  Preserves `createShareLink` (path may need verification under v4)
  and `extractAssetIdFromUrl` (works for both legacy and `next.frame.io`
  URL shapes).

- `handlers/frameio.js` (rewritten) — v4 signature scheme
  (`v0=` prefix + HMAC-SHA256 over `v0:{timestamp}:{body}`), 500-second
  timestamp drift check (replay guard), v4 payload shape
  (`body.resource.id` instead of `body.asset.id`). Comment.created flow
  now calls back to `GET /v4/comments/{id}` to find the parent file ID
  since v4 webhooks don't surface it directly in the payload.

- `scripts/register-frameio-webhook.js` (new) — one-time API call to
  register a webhook. Required because v4 has no UI for webhook
  registration. Prints the signing secret (returned ONLY on creation)
  with copy-paste instructions for `.env`.

- `.env.example` — added `FRAMEIO_OAUTH_CLIENT_ID`,
  `FRAMEIO_OAUTH_CLIENT_SECRET`, `FRAMEIO_OAUTH_SCOPES`,
  `FRAMEIO_ACCOUNT_ID`, `FRAMEIO_WORKSPACE_ID`. Marked
  `FRAMEIO_API_TOKEN` as deprecated/removable.

**Operator setup before this works:**

1. Set up OAuth Server-to-Server credential in Adobe Developer Console
   (`console.adobe.io`) for the Frame.io v4 product. Capture
   `client_id`, `client_secret`, and the exact scope string Adobe
   assigns.
2. Find account_id (visible in `next.frame.io/?a={uuid}`) and
   workspace_id (navigate within the v4 app or
   `GET /v4/accounts/{id}/workspaces`).
3. Add all five new env vars to `.env` on both MacBook and Mac Mini.
4. Run `node scripts/register-frameio-webhook.js --name "Limitless QA Comments" --url https://[your-tunnel-domain]/webhooks/frameio --events comment.created`
5. Copy the printed `FRAMEIO_WEBHOOK_SECRET` into `.env` on both
   machines.
6. `pm2 restart limitless-webhooks` on the Mac Mini.
7. Trigger a test comment in Frame.io to verify the handler fires.
   Check `webhook_inbox` table and `agent_logs` for the event.

**Verification checklist:**

- [ ] OAuth token fetch succeeds: `node -e "require('dotenv').config(); require('./lib/frameio-oauth').getAccessToken().then(t => console.log('OK len=' + t.length))"`
- [ ] Webhook list works: `node scripts/register-frameio-webhook.js --list`
- [ ] Webhook registration succeeds and returns a signing secret
- [ ] Test comment in Frame.io produces a row in `webhook_inbox` with
      `event_type = 'frameio:comment.created'`
- [ ] The associated `agent_logs` row shows `frameio_webhook_received`
      followed by either `frameio_comment_no_matching_video` (if the
      asset isn't tracked) or successful pipeline routing

**Open follow-ups (not blocking):**

- `createShareLink` v4 endpoint shape is preserved on faith. First call
  against a real file may 404 or 422 — update path/body if so.
- Existing v2 webhooks (if any) auto-disable on v4 migration per
  Frame.io docs. Nothing to delete; they're already dead.

---

## Fix 12 — Pipeline share-link write targets a removed ClickUp custom field

**Status:** Partial shipped 2026-05-12 (commit `1b9c8af`, "Scripting:
attendee-email event matching + drop deleted custom-field write").
The Fix 10 parallel work removed the `CLICKUP_INTERNAL_VIDEO_NAME_FIELD_ID`
write from `agents/scripting.js`. The `CLICKUP_FRAMEIO_FIELD_ID` write
in `agents/pipeline.js` `createShareLink` is still latent — gated
behind Fix 9 (Frame.io v4 OAuth deferred), so it won't fire in
production today. The moment Fix 9 unblocks, this dormant code path
needs a decision (option 1: re-add field; option 2: surface URL via
description/comment). Surfaced 2026-05-12 while resolving a
parallel `CLICKUP_INTERNAL_VIDEO_NAME_FIELD_ID` failure during the Fix 10
(calendar attendee matching) verification — the same ClickUp-list-cleanup
that removed the "Internal Video Name" field also removed "E - Frame Link".

**Problem:** `agents/pipeline.js` `createShareLink` (around line 506) does
`clickup.setCustomField(taskId, process.env.CLICKUP_FRAMEIO_FIELD_ID, shareUrl)`
on the `done` transition. The field no longer exists on the Austin list, so
the call will fail the moment this code path actually runs end-to-end.
Today it never reaches the setCustomField call because
`frameio.createShareLink(...)` (one line above) throws first when Fix 9's
OAuth isn't wired — but the moment Fix 9 unblocks, the latent breakage
surfaces as a `done`-transition rollback.

A second site reads the same env var: `syncFrameioLink` (around line 341)
reads the field on the `edited` transition. That path is graceful — if the
field is missing the read returns null and the function logs
`frameio_link_sync_skipped` and returns. Not a hard failure, but it means
the editor-side URL pickup is silently broken too: `videos.frameio_asset_id`
will never populate from ClickUp, so QA's asset-id-aware logic loses one
of its inputs.

**Fix options (pick one when Fix 9 unblocks):**

1. **Re-add the field to the ClickUp list.** Cheapest. Scott creates a
   "E - Frame Link" URL/text custom field on the Austin list, captures the
   new field ID, and updates `CLICKUP_FRAMEIO_FIELD_ID` in `.env` on both
   MacBook and Mac Mini. No code change. Both sites resume working.

2. **Drop the auto-write, surface the share URL elsewhere.** If Scott
   decided the field was clutter, mirror the Scripting fix from this
   session: stop writing to the deleted custom field, and instead either
   (a) include the share URL in the task description (visible inline), or
   (b) post a ClickUp comment on the task with the URL. Update
   `syncFrameioLink` to scan the task body/comments for a Frame.io URL
   instead of reading the field.

**Files to touch (whichever option):**

- `agents/pipeline.js` `createShareLink` — replace or drop the
  `setCustomField` call. If option 1, no code change.
- `agents/pipeline.js` `syncFrameioLink` — drop or rewrite the field-read.
  If option 1, no code change.
- `.env` and `.env.example` — either set `CLICKUP_FRAMEIO_FIELD_ID` to the
  new field ID (option 1), or mark it deprecated alongside
  `CLICKUP_INTERNAL_VIDEO_NAME_FIELD_ID` (option 2).

**Why this is filed separately:** This is dormant behind Fix 9. Bundling
the resolution with the Fix 9 revival playbook is more efficient than
shipping a speculative pipeline rewrite now. Documenting it ensures the
moment Fix 9 unblocks, this doesn't surface in production as a mystery
rollback on the first `done` transition.

**Acceptance:**

- After Fix 9 ships, a video moved to `done` produces a Frame.io share
  link and either (a) populates the re-added custom field, or (b) lands
  in the task description / comment as decided.
- `syncFrameioLink` on the `edited` transition either reads from the
  re-added field or from the new location (description / comment), and
  `videos.frameio_asset_id` populates as expected.
- No regression to `edited` → QA gating (QA already runs regardless of
  whether the asset ID resolved — current code handles this).

---

## Fix 13 — QA precondition awareness (no false-positive fails on missing files)

**Status:** Drafted 2026-05-13. Surfaced during the QA-advisory-hotfix
investigation. Independent of Fix 14/15 — can ship alone.

**Problem:** QA's two file-locating checks — `checkCaptions` (looks for
`.srt` in the `[PROJECT]` Dropbox subfolder) and `checkLUFS` (looks for
the final video file in the same folder) — currently report
`CAPTION: No .srt file found in [PROJECT] folder` and `LUFS: No video
file found in [PROJECT] folder` as quality issues. They aren't. They're
*preconditions* for QA to run at all. When the `[PROJECT]` folder is
empty (editor hasn't uploaded yet), QA returns "failed" with these
messages and `qa_passed = false` gets written to Supabase.

Before the QA-advisory hotfix (commit `3c58b6b`, 2026-05-13), this
auto-flipped the ClickUp task to `waiting` and created the recursive
loop Scott reported. The hotfix removed the auto-flip, but the
false-positive comments still post on every `edited` transition. On
Scott's `5_APS` task this manifested as 4 identical QA reports in his
ClickUp comments. The noise trains Scott to ignore QA reports entirely,
which defeats the point of QA in the first place.

**Fix:** Distinguish "preconditions missing" from "quality issues" in
`agents/qa.js`. If the `[PROJECT]` folder is empty (or contains no
`.srt`, or contains no video file), early-return a
`preconditions_missing` signal that `runQA` honors by:

- Posting one short comment instead of a multi-issue report:
  `QA skipped — final video and .srt not yet found in [PROJECT].
  Upload your export before review.`
- Writing `qa_passed = NULL` (not `false`) to Supabase so the dashboard
  can distinguish "QA hasn't run yet" from "QA ran and failed."
- Logging a new `qa_skipped_preconditions` action to `agent_logs` so
  the activity feed surfaces it without confusing it with real
  failures.

The fix is contained to `agents/qa.js`. ~30–40 lines. No schema
change required if `videos.qa_passed` already accepts NULL; verify
the column's nullable status before shipping.

**Files:** `agents/qa.js` (the two `check*` functions + `runQA` glue),
`dashboard/src/lib/agents.js` if the QA card's headline metric should
distinguish skipped-vs-failed (probably yes; check what `qa_passed`
counts surface today).

**Acceptance:**

- A task whose `[PROJECT]` folder is empty produces exactly one short
  comment on the `edited` transition, not a multi-issue report.
- `videos.qa_passed = NULL` on those rows. `qa_passed = false` is
  reserved for real quality issues only (audio loudness off-target,
  stutters detected, brand-term misspellings, etc.).
- Re-transitioning the task to `edited` after uploading the files
  results in QA running normally — finds the files, runs the checks,
  returns true or false based on actual quality.
- `agent_logs.qa_skipped_preconditions` rows appear for skipped runs.

---

## Fix 14 — Pipeline robustness for manually-created ClickUp tasks

**Status:** Drafted 2026-05-13. Shape depends on the Charles-workflow
open item (see bottom of this doc). Don't spec further until that's
answered.

**Problem:** Pipeline assumes every ClickUp task originates from
Scripting (calendar event → student match → ClickUp task at status
`idea` → editor transitions through `ready for shooting` which fires
Pipeline's folder-creation step). In production, editors create tasks
directly in ClickUp that skip this origination path. Verified
2026-05-13 against two examples:

| Task | student_id | dropbox_folder | What happened |
|---|---|---|---|
| 5_APS | null | `/austin/5_APS` (created) | Pipeline saw the `ready for shooting` transition and created folders; editor never uploaded to `[PROJECT]` |
| SHARK_TANK | null | null | Pipeline never saw a `ready for shooting` transition; Charles moved through statuses fast enough that folder creation never fired |

Both have `student_id: null` because `Pipeline.resolveTask`
auto-creates a stub `videos` row when ClickUp sends a webhook for an
unknown task, but the stub has no student association, no
performance-signal context, no scripting context.

**Fix:** Make Pipeline detect manually-created tasks and lazily
backfill the missing structure.

1. On any status transition, if `videos.dropbox_folder` is null,
   create the folders (`/{campus}/{title}/[FOOTAGE]/`,
   `/{campus}/{title}/[PROJECT]/`) before continuing the transition.
   Patches the SHARK_TANK class — folders exist by the time QA looks.
2. On the first `ready for editing` transition for a manually-created
   task (detected by `videos.student_id IS NULL` or some equivalent),
   post a ClickUp comment with the folder path so the editor knows
   where to upload: `Upload your final video and .srt to
   /{campus}/{title}/[PROJECT]/.`
3. Optionally: try to resolve `student_id` from the ClickUp task
   assignee (if assignee email matches a `students.email`) or from
   the task name pattern (e.g., parse `5_APS` as "video 5 for student
   whose handle is APS"). If unresolvable, leave null and downstream
   agents handle gracefully.

**Files:** `agents/pipeline.js` (`handleStatusChange`, `resolveTask`,
`createDropboxFolders`). Possibly a new helper `lib/clickup-task.js`
for assignee/name-based student resolution mirroring
`gcal.parseStudentFromEvent`.

**Edge cases:**

- **Test / admin / non-pipeline tasks.** What if Charles
  intentionally creates tasks that shouldn't go through the
  production pipeline? Need an opt-out — either a ClickUp custom
  field flag, a task-name prefix convention (e.g., `_test_*`,
  `_admin_*`), or a status that's outside the standard pipeline
  state machine.
- **Race against rapid status transitions.** SHARK_TANK suggests
  Charles can move through statuses fast enough that webhooks
  arrive out-of-order. The lazy-create on any transition handles
  this by being idempotent — if folders already exist, no-op.
- **Folder name from task title.** Special characters in titles
  (slashes, brackets) could break the Dropbox path. Need
  sanitization analogous to whatever Pipeline does today for
  Scripting-originated tasks.

**Acceptance:**

- Manually-created tasks like `5_APS` and `SHARK_TANK` get folders
  created on first webhook receipt (or first transition that
  surfaces the missing-folder state).
- Editor receives a comment pointing to the upload path on the
  first `ready for editing` transition.
- Fix 13's precondition comments now reference a real folder path,
  not a missing one — so when the editor uploads, they have a clear
  destination.
- A test/admin task with the opt-out marker is silently ignored by
  Pipeline (no folders, no QA, no comments).

---

## Fix 15 — Admin "create editorial task" surface (v1.5 polish)

**Status:** Drafted 2026-05-13. Lower priority — ships AFTER Fix 14.
Fix 14 is the safety net; Fix 15 is the happy path.

**Problem:** Even with Fix 14 in place, editors creating ClickUp tasks
manually is a brittle workflow. Every manual task is an opportunity
for the editor to forget to set the assignee, mis-type the title,
skip a status transition. The system *catches* these gracefully after
Fix 14, but the editor doesn't get the benefit of structured input.

**Fix:** Add a new admin dashboard surface (suggested route:
`/editorial` or `/tasks/new`) where editors can create a one-off
editorial task with structured input — pick student from a dropdown,
type concept title, optionally a description, hit Create. Behind the
scenes:

1. Insert a properly-shaped `videos` row with `student_id` and
   `student_name` populated.
2. Create the ClickUp task at status `idea` (or `ready for editing`
   if the editor opts to start there).
3. Create the `[FOOTAGE]` and `[PROJECT]` folders eagerly.
4. Return a confirmation with the folder paths so the editor knows
   exactly where to upload.

Mirrors the `/scripting` and `/students` console pattern from the
dashboard-consoles build. Same shell, same shape.

**Files:** `dashboard/src/pages/EditorialConsole.jsx` + .css;
`routes/admin-editorial.js`; `server.js` route wiring; possibly a new
`lib/editorial.js` helper that consolidates videos-row-creation +
ClickUp-task-creation + folder-creation into one transactional unit.
Add a third text link `+ /editorial` to the AGENTS section title row
on `/ops` next to `+ /scripting` and `+ /students`.

**Dependency:** Ship after Fix 14. Until Fix 14 is live, this surface
duplicates fragile code paths. Once Fix 14 is the safety net, this
becomes the happy path that most manual tasks flow through, and the
safety net catches whatever slips.

**Acceptance:**

- From the dashboard, an editor creates an editorial task in
  &lt;30 seconds with all metadata correct.
- The created task has identical downstream behavior to a
  Scripting-originated task — folders exist, student is associated,
  QA runs cleanly, Performance picks it up.
- Manual ClickUp task creation still works (Fix 14 safety net), but
  the dashboard surface produces cleaner data.

---

## Open items requiring Scott's input (not code fixes — Caiden's job to ask)

These block their corresponding fixes above and don't belong in a
PR:

1. **Calendar event format** for filming events. Title pattern,
   attendees, or another marker the Scripting matcher should look
   for. Until confirmed, UPCOMING SHOOTS will keep populating from
   whatever ad-hoc format Scott uses, and matches may be silently
   ambiguous-rejected.

2. **Profile-views cadence preference** — Friday vs daily. Pick one;
   they're mutually exclusive at the cron level (Fix 2 vs Fix 3).

3. **Sheet sync direction confirmation.** Read-only push (Fix 5 as
   spec'd) vs two-way edit-and-sync (would require redesign of Fix 5).

4. **Daily Apify approval** — confirm the ~$20/month additional cost
   is acceptable before flipping the cron to daily.

5. **Charles's manual-task workflow** (blocks Fix 14/15 scoping).
   What is Charles actually doing when he creates ClickUp tasks
   directly (verified: `5_APS`, `SHARK_TANK`, likely more)? Three
   possibilities and the right Fix 14/15 shape depends on which:

   - **Legitimate non-Scripting editorial work** — back-catalog
     re-edits, brand-account content, one-offs that don't need a
     calendar event. Fix 14 (Pipeline robustness) and Fix 15 (admin
     surface) are both warranted.
   - **Workaround for limitations** — Scripting is too cumbersome
     for one-offs, Frame.io being deferred is forcing manual
     revision tasks, calendar not being kept up to date. Fix the
     limitations; Fix 14 becomes a safety net for the residual.
   - **Test/admin tasks** — `5_APS` and `SHARK_TANK` are intentional
     non-pipeline tasks. Fix is filtering, not folder creation.
     Need an opt-out marker.

   Recommended action: ask Charles directly (or ask Scott about
   Charles's workflow). Without this answer, Fix 14/15 implementation
   could be built around the wrong assumptions.
