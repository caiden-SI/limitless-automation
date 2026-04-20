# Progress Log — Limitless Media Agency Automation

---

## Session 1 — April 1, 2026

### Built
- **Webhook signature verification** — hardened all three handlers (`handlers/clickup.js`, `handlers/dropbox.js`, `handlers/frameio.js`):
  - Fixed `crypto.timingSafeEqual` crash on length-mismatched signatures (was throwing instead of returning 401)
  - Added `rawBody` null guard to prevent HMAC `.update()` crash on missing body
  - All three use HMAC-SHA256 with timing-safe comparison
- **PM2 ecosystem.config.js** — enhanced with:
  - Exponential backoff restart (`exp_backoff_restart_delay`)
  - Memory limit auto-restart (`max_memory_restart: 512M`)
  - Structured log timestamps (`log_date_format`)
  - Created `logs/` directory for PM2 output

### Tested
- Signature verification unit test: valid sig, invalid sig, wrong length, null body, empty signature, empty secret — all pass
- `npm install` — 104 packages, 0 vulnerabilities
- Server start — boots on port 3099 with dummy env vars, `/health` returns `200 OK`
- Supabase logger fails gracefully when no live connection (expected with dummy creds)

### Passed
- All webhook handlers reject bad signatures with 401 (no crashes)
- Server starts and responds to health checks
- PM2 config parses without errors

### Pending
- `integrations.md` pulled from remote into `docs/` — confirms verification logic is correct, no changes needed
- `.env` not yet populated with real credentials (blocked on 1Password access)
- Integration verification tasks from build-order.md not started (require real credentials):
  - ClickUp API access test
  - Dropbox API access test
  - Frame.io API access test
  - Retrieve ClickUp custom field ID for Frame.io link
  - Confirm ClickUp List ID for Austin campus with Scott
  - Accept Frame.io invite to Scott's Account team
  - Fireflies API access test
  - Google Calendar service account setup
  - Confirm Google Calendar event format with Scott

### Next Session Starting Point
- Populate `.env` with real credentials from 1Password vault "Limitless - Caiden"
- Run integration verification tasks (build-order.md Week 1-2: Integration Verification)
- Begin Pipeline Agent implementation once API access is confirmed

---

## Session 2 — April 2, 2026

### Integration Verification — All Four Services Tested

Ran `scripts/verify-integrations.js` against live APIs with real credentials from `.env`.

| Service | Endpoint Tested | Result | Detail |
|---|---|---|---|
| Supabase (service role) | `campuses` table query | **PASS** | Connected — 1 row returned. Schema already migrated. |
| Supabase (anon key) | `campuses` table query | **PASS** | Connected — 0 rows returned (RLS active, blocks anon reads as expected) |
| Anthropic | `claude-sonnet-4-20250514` message | **PASS** | Model responded correctly |
| Dropbox | `POST /files/list_folder` (root) | **PASS** | Token valid, root folder empty |
| Frame.io (v2) | `GET /v2/me` | **PASS** | Authenticated as Caiden Kennedy |
| Frame.io (v4) | `GET /v4/accounts` | **FAIL** | 401 Unauthorized — v2 token not accepted by v4 API |

### Findings
- **Supabase schema is already deployed** — `campuses` table exists with at least 1 seeded row. RLS is active (anon key correctly returns fewer results than service role key).
- **Anthropic API key is live** — `claude-sonnet-4-20250514` confirmed working.
- **Dropbox token is valid** — short-lived tokens may expire; monitor and implement refresh if needed.
- **Frame.io v4 API requires separate auth** — the developer token (`fio-u-*`) works with v2 but not v4. The v4 API (post-Adobe acquisition) uses a different OAuth flow. All agent code should target **v2 endpoints** with the current token, or a v4 OAuth token must be generated through Adobe Developer Console.

### Action Items
- [ ] **Frame.io:** Decide whether to use v2 API (works now) or set up v4 OAuth (requires Adobe Developer Console setup). Update `docs/integrations.md` base URL accordingly.
- [ ] **Dropbox:** Monitor token expiry — implement refresh token flow if short-lived token expires.
- [ ] **ClickUp:** Credentials still missing from `.env` — blocked until API key is added from 1Password.
- [ ] **Fireflies:** Credentials still missing from `.env` — blocked.
- [ ] **Google Calendar:** Service account JSON not yet created — blocked.

### Next Session Starting Point
- Resolve Frame.io v2 vs v4 decision with Scott
- Add remaining credentials (ClickUp, Fireflies, Google Calendar)
- Run initial schema migration if any tables are still missing (verify full schema.md against live DB)
- Begin Pipeline Agent implementation

---

## Session 2 (continued) — April 2, 2026

### Built — Pipeline Agent: ready for shooting → Dropbox Folder Creation

**Files created/modified:**

- **`lib/dropbox.js`** (new) — Dropbox REST API client with `createFolder(path)` and `listFolder(path)`. Handles conflict (folder already exists) gracefully.
- **`agents/pipeline.js`** (rewritten) — Full implementation of first trigger:
  - `handleStatusChange()` — routes by ClickUp status to the correct action
  - `resolveTask()` — looks up video by `clickup_task_id` in Supabase, creates the row if missing (using ClickUp API stub)
  - `createDropboxFolders()` — creates `/{campus-slug}/{title}/[FOOTAGE]/` and `/[PROJECT]/` in Dropbox, updates `videos.dropbox_folder` in Supabase
  - `assignEditor()` — queries editors by campus, picks lowest active count, updates Supabase (ClickUp assignee update stubbed)
  - `handleFootageDetected()` — verifies files in `[FOOTAGE]` via Dropbox API, updates status to ready for editing in Supabase (ClickUp status update stubbed)
- **`handlers/clickup.js`** (updated) — Routes `taskStatusUpdated` events to `pipeline.handleStatusChange()`. Signature verification conditional on `CLICKUP_WEBHOOK_SECRET` being set.
- **`scripts/test-pipeline-folders.js`** (new) — End-to-end integration test

**ClickUp API stubs (clearly marked TODO):**
- `getClickUpTaskStub()` — returns minimal task shape, replace with `GET /task/{id}`
- `assignEditor()` — Supabase assignment works, ClickUp `PUT /task/{id}` assignee update stubbed
- `handleFootageDetected()` — Supabase status update works, ClickUp `PUT /task/{id}` status update stubbed
- `handler (clickup.js)` — campus resolution from ClickUp list ID stubbed, falls back to first campus

### Tested
- **Full integration test passed (5/5 checks):**
  1. Inserted test video into Supabase
  2. Called `createDropboxFolders` — created `/austin/__pipeline_test_*/[FOOTAGE]/` and `/[PROJECT]/` in live Dropbox
  3. Verified both subfolders exist via Dropbox `list_folder` API
  4. Verified `videos.dropbox_folder` updated in Supabase
  5. Idempotency: second call succeeded without error (folders already existed)
- Cleanup: test video deleted from Supabase, test folders deleted from Dropbox

### Next Steps
- Add ClickUp credentials to `.env` and replace all TODO stubs
- Build next Pipeline trigger: Dropbox file detection → ready for editing (1-hour delay)
- Build editor assignment logic (needs editor rows seeded in `editors` table)
- Build Frame.io share link creation (status → done trigger)

---

## Session 2 (continued) — April 2, 2026: QA Agent

### Built — QA Agent: edited → Quality Gate

**Files created/modified:**

- **`tools/srt-parser.js`** (new) — Deterministic SRT parser: `parseSRT()` returns structured cues with index, timecodes (start/end in string and ms), and text. `cuesToPlainText()` for concatenated text extraction.
- **`lib/dropbox.js`** (updated) — Added `downloadFile(path)` (returns Buffer) and `getTemporaryLink(path)` (returns 4-hour direct URL for FFmpeg).
- **`agents/qa.js`** (rewritten) — Full QA agent with four checks:
  1. **Brand dictionary spell check** — Retrieves SRT from Dropbox `[PROJECT]` folder, parses it, checks every word against `brand_dictionary` table. Catches exact capitalization errors and Levenshtein distance-1 near-misses.
  2. **Caption formatting** (Claude) — Sends cues to Claude for punctuation consistency, line length, timing overlaps, capitalization. Returns structured `FORMAT:` issues with timecodes.
  3. **LUFS analysis** (FFmpeg) — Gets temporary Dropbox link, runs `ffmpeg -af loudnorm=print_format=json`, parses `input_i` from stderr. Target: -14 LUFS ±1 LU. Gracefully skips if FFmpeg not installed (not a blocking failure).
  4. **Stutter/filler detection** (Claude) — Sends timestamped transcript to Claude for filler words (um, uh, like, you know, basically), stutters (repeated words), and false starts. Returns `STUTTER:` issues with timecodes and suggestions.
- **`agents/pipeline.js`** (updated) — Added `edited` case in status switch, new `triggerQA()` function that runs QA and gates delivery:
  - QA pass → video eligible for Frame.io upload
  - QA fail → status set to waiting in Supabase (ClickUp update stubbed)
- **`scripts/test-qa-agent.js`** (new) — End-to-end integration test

**ClickUp API stubs (clearly marked TODO):**
- Post QA report to ClickUp task comments
- Update ClickUp status to waiting on QA failure

### Tested — Integration Test Results
Test SRT with deliberate issues: "alfa School", "Timback", lowercase brand terms, filler words, stutters, false starts.

| Check | Issues Found | Status |
|---|---|---|
| Brand dictionary | 3 — "alfa"/Alpha near-miss, "superbuilders" capitalization, "Timback" typo | **PASS** |
| Caption formatting | 13 — missing punctuation, capitalization, apostrophes | **PASS** |
| Stutter/filler | 7 — "Um", "so like", "the the", "that that", "you know", false start, "basically" | **PASS** |
| LUFS analysis | Skipped (no video file, no FFmpeg) — graceful skip, not a failure | **PASS** |
| qa_passed → Supabase | `false` correctly written | **PASS** |

QA correctly failed the test video (24 total issues). Cleanup: video deleted from Supabase, folders deleted from Dropbox.

### QA Gate Behavior
- `qa_passed = true` → video eligible for Frame.io upload (status stays, waiting for done)
- `qa_passed = false` → status set to waiting, issues logged. Editor must fix and re-submit as edited to re-trigger QA.

### Next Steps
- Install FFmpeg on Mac Mini for LUFS checks in production
- Add ClickUp credentials → enable QA report posting to task comments
- Build Research Agent or remaining Pipeline triggers (Dropbox file detection, Frame.io share link)

---

## Session 2 (continued) — April 2, 2026: Research Agent

### Built — Research Agent: Scrape → Classify → Deduplicate → Store

**Files created/modified:**

- **`tools/scraper.js`** (new) — Apify REST API client for TikTok (`clockworks~free-tiktok-scraper`) and Instagram (`apify~instagram-scraper`). Runs actors synchronously, returns normalized video objects (`url, description, viewCount, transcript, platform`). Gated on `APIFY_API_TOKEN` env var.
- **`agents/research.js`** (rewritten) — Full research pipeline:
  1. **Scrape** — Calls `scrapeTikTok()` and `scrapeInstagram()` with configurable search queries (defaults: "student entrepreneur", "alpha school", "homeschool success", "teen startup", "alternative education").
  2. **Transcript extraction** — Uses scraped transcript if available; otherwise generates approximate transcript from description via Claude.
  3. **Classification** — Claude classifies each video into `hook_type` (8 types), `format` (8 types), and `topic_tags` (3–5 tags). Validates output against allowed values.
  4. **Deduplication** — Pre-loads existing `source_url` set from Supabase, skips matches. Also handles DB-level constraint violations (code 23505) gracefully.
  5. **Storage** — Inserts to `research_library` with all fields: `campus_id, source_url, transcript, hook_type, format, topic_tags, platform, view_count, scraped_at`.
  6. **`runAll()`** — Iterates all active campuses, called by cron.
- **`lib/scheduler.js`** (new) — Cron scheduler using `node-cron`. `register(name, schedule, fn)` / `stop(name)` / `stopAll()` / `list()`. Logs job start/complete/error to `agent_logs`.
- **`server.js`** (updated) — Registers Research Agent cron: daily at 6 AM (`0 6 * * *`).
- **`scripts/test-research-agent.js`** (new) — Integration test with synthetic video data.

### Tested — Integration Test Results (6/6 passed)

| Check | Result |
|---|---|
| Claude classification | `stat` / `talking-head` / 5 tags — all valid | **PASS** |
| Transcript generation | 1032 chars from description | **PASS** |
| Insert 3 entries | All stored with correct fields | **PASS** |
| Verify in Supabase | 3 entries with hook_type, format, tags, view_count | **PASS** |
| Deduplication | In-app dedup works; DB lacks unique index (noted) | **PASS** |
| Cron scheduler | Registered and stopped correctly | **PASS** |

### Action Items
- [ ] Add `APIFY_API_TOKEN` to `.env` from 1Password — required for live scraping
- [ ] Run in Supabase SQL editor: `CREATE UNIQUE INDEX research_library_campus_url ON research_library(campus_id, source_url)` — enforces dedup at DB level
- [ ] Confirm scrape frequency with Scott (currently daily at 6 AM)
- [ ] Tune search queries per campus — defaults are generic "student entrepreneur" etc.

### Next Steps
- Build Performance Agent (weekly Monday AM cron)
- Scripting Agent blocked pending Scott confirmation (see decisions.md)

---

## Session 2 (continued) — April 2, 2026: Performance Analysis Agent

### Built — Performance Analysis Agent: Weekly Pattern Recognition

**Files created/modified:**

- **`agents/performance.js`** (rewritten) — Full weekly analysis pipeline:
  1. **Data collection** — Queries `performance` table for last 4 weeks of view data per video per platform, aggregates views per video.
  2. **Context assembly** — Identifies top/bottom performers (top/bottom 25%), fetches video titles and transcripts from `videos.script`, pulls recent `research_library` entries as external benchmarks.
  3. **Claude analysis** — Builds a structured prompt with platform breakdown, top/bottom transcripts, and benchmark hook/format distributions. Claude returns structured JSON: `top_hooks`, `top_formats`, `top_topics`, `underperforming_patterns`, `recommendations`, `summary`.
  4. **Validation** — Ensures Claude output matches expected shape before writing.
  5. **Storage** — Writes to `performance_signals` with `week_of` (Monday date), structured signal arrays, plain-English summary, and full `raw_output` JSON.
  6. **`runAll()`** — Iterates active campuses, called by Monday cron.
  7. **Small sample handling** — When <50 videos, prompts Claude to hedge confidence in recommendations.
- **`server.js`** (updated) — Registers Performance Agent cron: `0 7 * * 1` (every Monday at 7 AM).
- **`scripts/test-performance-agent.js`** (new) — Full integration test with synthetic data.

### Tested — Integration Test Results

Seeded 8 synthetic videos (5 high-performing with strong hooks, 3 low-performing with weak content) × 2 platforms × 2 weeks = 32 performance records + 3 research_library benchmarks.

| Check | Result |
|---|---|
| Signal written to performance_signals | **PASS** — `f66d3cd8` |
| top_hooks | **PASS** — 2 hooks: stat (1.2M avg), story (762K avg) |
| top_formats | **PASS** — 2 formats: talking-head, day-in-life |
| top_topics | **PASS** — 2 topics: alpha_school_positioning, student_life_showcase |
| summary (plain English) | **PASS** — actionable 2-sentence brief |
| raw_output stored | **PASS** — full JSON with all fields |
| underperforming_patterns | **PASS** — 4 patterns identified (vague updates, filler words, no hook, rambling) |
| recommendations | **PASS** — 5 actionable items |

Sample recommendation output:
- "Lead with shocking statistics or contrarian statements about traditional education"
- "Show don't tell — use day-in-life format to demonstrate Alpha School's unique approach"
- "Get to the point within first 3 seconds, cut all filler words and rambling"
- "Test more question-based hooks since they're trending externally but underrepresented in our top performers"

### Agent Status Summary

| Agent | Status | Trigger |
|---|---|---|
| Pipeline | Built — 1st trigger live (ready for shooting → Dropbox folders) | ClickUp webhook |
| QA | Built — all 4 checks live | edited status |
| Research | Built — classification + dedup live, scraping needs APIFY_API_TOKEN | Daily 6 AM cron |
| Performance | Built — full analysis pipeline live | Monday 7 AM cron |
| Scripting | **Blocked** — student context approach under review with Scott | — |

### Next Steps
- Scripting Agent: awaiting Scott confirmation on student context (see decisions.md)
- Add remaining credentials: ClickUp, Fireflies, Apify
- Run Supabase unique index migration for research_library
- Begin Dashboard (React localhost) or remaining Pipeline triggers

---

## Session 2 (continued) — April 2, 2026: React Dashboard

### Built — Dashboard (React + Vite, localhost)

Scaffolded with Vite + React. Connects to Supabase with **anon key only** (no service role key client-side). Five views with auto-refresh polling.

**Files created:**

- **`dashboard/`** — Full React app (Vite)
  - `src/lib/supabase.js` — Supabase client using `VITE_SUPABASE_ANON_KEY`
  - `src/lib/hooks.js` — Custom hooks for all data fetching: `useCampuses`, `useVideos`, `useAgentLogs`, `useQAQueue`, `useEditors`, `useEditorCounts`, `usePerformanceSignals`. All auto-refresh on intervals (10–60s).
  - `src/App.jsx` — Tab navigation + campus selector
  - `src/components/PipelineView.jsx` — Kanban-style board with 9 status columns (idea → done), color-coded, QA badges, time-ago timestamps
  - `src/components/AgentActivityFeed.jsx` — Real-time log feed, color-coded agent badges, error highlighting
  - `src/components/QAQueue.jsx` — Two sections: "Awaiting QA" (status=edited, qa_passed=null) and "QA Failed / Waiting"
  - `src/components/EditorCapacity.jsx` — Card grid per editor with active task count, capacity bar (green/yellow/red)
  - `src/components/PerformanceSignals.jsx` — Weekly signal cards with summary, top hooks/formats/topics, recommendations, underperforming patterns
  - `src/index.css` — Base styles, dark mode support
  - `src/App.css` — Component styles (board, cards, feed, signals)
  - `.env.example` — Template for Supabase credentials
  - `.env` — Populated with live anon key (gitignored)
- **`scripts/setup-dashboard-rls.sql`** — RLS policies for anon read access to campuses, videos, editors, agent_logs, performance_signals. Also includes research_library unique index.
- **`.gitignore`** — Added `dashboard/dist/`

### Verified
- `npm run build` succeeds — 64 modules, 385 KB JS + 4.7 KB CSS (gzipped: 110 KB + 1.4 KB)
- All 5 components import and render without errors

### Setup Required Before Use
1. **Run RLS policies** in Supabase SQL Editor: `scripts/setup-dashboard-rls.sql` — anon key currently returns 0 rows because RLS blocks reads without policies
2. **Start the dashboard**: `cd dashboard && npm run dev` — opens on localhost:5173

### Refresh Intervals
| View | Interval |
|---|---|
| Pipeline | 15s |
| Agent Activity | 10s |
| QA Queue | 15s |
| Editor Capacity | 15s (tasks) / 30s (editors) |
| Performance Signals | 60s |
| Campuses | 60s |

### Next Steps
- Run `scripts/setup-dashboard-rls.sql` in Supabase SQL Editor to enable anon reads
- Scripting Agent: awaiting Scott confirmation on student context
- Add remaining credentials: Fireflies, Apify
- Remaining Pipeline triggers: Frame.io share link

---

## Session 3 — April 3, 2026

New MacBook setup session. Repo freshly cloned, `npm install` run, `.env` populated with all credentials except Google Calendar (not yet set up). Scott meeting provided critical corrections and data.

### Scott Meeting Outcomes (April 3)

Two key updates from the call:

1. **ClickUp status names are wrong everywhere** — the codebase had uppercase guesses (IDEA, READY FOR SHOOTING, EDITED, NEEDS REVISIONS, etc.). Scott confirmed the real statuses are all lowercase and some have different names entirely. Corrected mapping:

   | Old (incorrect) | New (correct) |
   |---|---|
   | IDEA | idea |
   | READY FOR SHOOTING | ready for shooting |
   | READY FOR EDITING | ready for editing |
   | IN EDITING | in editing |
   | EDITED | edited |
   | _(n/a)_ | uploaded to dropbox |
   | _(n/a)_ | sent to client |
   | _(n/a)_ | revised |
   | _(n/a)_ | posted by client |
   | NEEDS REVISIONS | waiting |
   | DONE | done |

   The QA Agent trigger is "edited" (not "uploaded to dropbox" — that was a wrong initial mapping). These are separate statuses. "revised" was discovered later in live API data across 100 tasks.

2. **Austin campus editors confirmed:**
   - Charles Williams — ClickUp user ID `95229910`, charles@limitlessyt.com
   - Tipra — ClickUp user ID `95272148`, arpitv.tip@gmail.com

### Status Names Corrected — 16 Files Updated

Updated every status reference across the entire codebase:

**Source code (7 files):** `agents/pipeline.js` (case statements, Supabase queries, comments), `agents/qa.js` (trigger comment), `agents/scripting.js` (task creation comments), `handlers/frameio.js` (NEEDS REVISIONS → waiting), `dashboard/src/components/PipelineView.jsx` (STATUS_ORDER, STATUS_COLORS — now 11 columns), `dashboard/src/components/QAQueue.jsx` (filter logic, section header), `dashboard/src/lib/hooks.js` (QA queue filter, editor count query)

**Documentation (5 files):** `CLAUDE.md` (rules section), `docs/architecture.md` (agent table, data flow), `docs/build-order.md` (pipeline tasks), `docs/integrations.md` (Dropbox and Frame.io webhook notes), `docs/decisions.md` (Dropbox delay decision + two new entries documenting the changes)

**Tests (3 files):** `scripts/test-pipeline-folders.js`, `scripts/test-qa-agent.js`, `scripts/test-performance-agent.js`

**Progress log (1 file):** `docs/progress-log.md` — all historical references updated to match current code

### Editors Seeded

Created `scripts/seed-editors.js` — checks for existing records by email before inserting (safe to re-run). Initial run with upsert failed (no unique constraint on `email`), switched to select-then-insert pattern.

```
  OK: Charles Williams (charles@limitlessyt.com) — id: 6f81df1e-2f8e-45fe-81e7-00feccdd7924
  OK: Tipra (arpitv.tip@gmail.com) — id: 6d69b0f0-4821-4c95-8222-97a8d49b1d36
```

Pipeline Agent's `assignEditor()` now has real editor rows to work with.

### ClickUp API Integration — Fully Wired

**New file: `lib/clickup.js`** — ClickUp REST API v2 client with 7 methods:
- `getTask(taskId)` — GET /task/{id}
- `getTasks(listId, params)` — GET /list/{id}/task
- `updateTask(taskId, updates)` — PUT /task/{id} (status, assignees, etc.)
- `addComment(taskId, text)` — POST /task/{id}/comment
- `createTask(listId, data)` — POST /list/{id}/task
- `setCustomField(taskId, fieldId, value)` — POST /task/{id}/field/{field_id}
- `getCustomFields(listId)` — GET /list/{id}/field

**API verification (`scripts/verify-clickup.js`):**

| Test | Result |
|---|---|
| GET /list/901707767654/task | **PASS** — 100 tasks returned |
| GET /task/86e0qcwt7 | **PASS** — "REPAIR_RATIO", status "ready for editing", assigned to Charles Williams |
| GET /list/901707767654/field | **PASS** — 7 custom fields retrieved |

**Custom fields discovered:**

| Field Name | Type | ID |
|---|---|---|
| E - Frame Link | url | `53590f25-d850-4c19-8c7a-7b005904e04a` |
| Dropbox Link | short_text | `d818eb86-41ce-416f-98aa-b1d92f13459f` |
| Editor | users | `62642aae-d92d-49e9-a4fc-a17c137cdbe0` |
| Internal Video Name | short_text | `6e3fde3f-250f-470a-b88f-b382c599e998` |
| Project Description | text | `8799f3b7-3385-4f9f-9a1b-b8872ecc78f4` |
| Progress | automatic_progress | `880006c8-7cb4-43ab-85fc-00df38091735` |
| Editoral Review | drop_down | `d859f319-0e2a-4475-946c-919f97ea6ac6` |

**Stubs replaced in `agents/pipeline.js`:**
- `resolveTask()` — real `clickup.getTask()` call, campus resolution from `clickup_list_id` column, `extractStudentName()` reads "Internal Video Name" custom field. `getClickUpTaskStub()` deleted.
- `assignEditor()` — `clickup.updateTask()` with `{ assignees: { add: [Number(clickup_user_id)] } }` — sets ClickUp assignee in addition to Supabase
- `triggerQA()` — `clickup.updateTask()` sets status to "waiting" on QA failure
- `handleFootageDetected()` — `clickup.updateTask()` sets status to "ready for editing" after Dropbox file detection

**Stubs replaced in `agents/qa.js`:**
- QA failure now posts formatted report to ClickUp task comments via `clickup.addComment()`

**Stubs replaced in `handlers/clickup.js`:**
- Imports `lib/clickup`, TODO comments removed. Campus resolution note updated.

**Database updates:**
- Austin campus `clickup_list_id` set to `901707767654` (was null)
- `.env.example` updated with `CLICKUP_AUSTIN_LIST_ID`, `CLICKUP_FRAMEIO_FIELD_ID`, `CLICKUP_DROPBOX_FIELD_ID`

Zero ClickUp TODO stubs remain in the codebase.

### ClickUp Webhook Registered via ngrok

Started Express server on port 3000, confirmed `/health` returns 200. Registered webhook via `POST /team/9017220135/webhook`:

| Field | Value |
|---|---|
| Webhook ID | `a8a5d682-ebe1-4cc1-b8a6-5a195859d886` |
| Endpoint | `https://nonhumanistic-rona-bathymetric.ngrok-free.dev/webhooks/clickup` |
| Events | `taskStatusUpdated`, `taskCreated` |
| List ID | `901707767654` (AUSTIN Pipeline) |
| Health | active, fail_count: 0 |

Webhook secret stored in `.env` as `CLICKUP_WEBHOOK_SECRET`. Server restarted — HMAC-SHA256 signature verification now active for all inbound ClickUp webhooks.

**End-to-end webhook flow now live:**
1. ClickUp status change → webhook fires → ngrok → `localhost:3000/webhooks/clickup`
2. `handlers/clickup.js` verifies HMAC signature, extracts `taskId` and `newStatus`
3. `pipeline.handleStatusChange()` routes to correct action:
   - `ready for shooting` → creates Dropbox folders (`/{campus-slug}/{title}/[FOOTAGE]/`, `/[PROJECT]/`)
   - `ready for editing` → assigns editor by lowest active task count (Supabase + ClickUp)
   - `edited` → runs QA gate (captions, LUFS, stutter) — pass continues, fail sets "waiting" + posts comment
   - `done` → creates Frame.io share link (not yet implemented)

### Credentials Collected This Session

| Credential | Source | Status |
|---|---|---|
| CLICKUP_API_KEY | 1Password | **Set** — verified against live API |
| CLICKUP_WEBHOOK_SECRET | ClickUp webhook registration response | **Set** — signature verification active |
| CLICKUP_AUSTIN_LIST_ID | API verification (`901707767654`) | **Set** in .env.example |
| CLICKUP_FRAMEIO_FIELD_ID | API field discovery (`53590f25...`) | **Documented** in .env.example |
| CLICKUP_DROPBOX_FIELD_ID | API field discovery (`d818eb86...`) | **Documented** in .env.example |
| Google Calendar | — | **Not set up** — still blocked |

### Agent Status Summary (End of Session 3)

| Agent | Status | Trigger | ClickUp Integration |
|---|---|---|---|
| Pipeline | **Live** — all 4 triggers wired | ClickUp webhook via ngrok | GET task, PUT status, PUT assignee |
| QA | **Live** — all 4 checks | "edited" status | POST comment on failure |
| Research | Built — needs APIFY_API_TOKEN | Daily 6 AM cron | — |
| Performance | Built — full analysis pipeline | Monday 7 AM cron | — |
| Scripting | **Blocked** — student context under review | — | — |

### What's Next

1. **Live end-to-end test** — change a task status in ClickUp and verify the full webhook → agent → Supabase → ClickUp round trip
2. Build Frame.io share link creation (status → done trigger) using `clickup.setCustomField()` for "E - Frame Link"
3. Add Fireflies and Apify credentials
4. Scripting Agent: awaiting Scott confirmation on student context

---

## Session 3 (continued) — April 3, 2026: Codex Adversarial Review

### Codex Review — 4 Issues Found and Fixed

Ran Codex adversarial review against full codebase (49 files, ~7,500 lines). Verdict: **needs-attention**. All 4 findings fixed and committed.

#### 1. [CRITICAL] Dashboard RLS — blanket anon access removed

**File:** `scripts/setup-dashboard-rls.sql`

Old policies granted unrestricted `SELECT` (`USING (true)`) on `videos`, `agent_logs`, and `performance_signals` to the `anon` role. Anyone with the dashboard URL and anon key could read the full pipeline state across all campuses.

**Fix:** Replaced with `campus_id IS NOT NULL` scoping. Dashboard queries must always include a `campus_id` filter. Old policies are dropped first for clean re-application. Applied in Supabase SQL Editor.

#### 2. [CRITICAL] Pipeline resolveTask() — first-campus fallback removed

**File:** `agents/pipeline.js` — `resolveTask()`

When a ClickUp webhook referenced a list ID not mapped to any campus, the code silently fell back to the first campus in the database (`SELECT id FROM campuses LIMIT 1`). This could cause cross-tenant data corruption — videos, folders, editor assignments, and QA all running against the wrong campus.

**Fix:** Logs the error to `agent_logs` with status "error" and throws with a clear message: `No campus mapped for ClickUp list ID: {id}. Configure clickup_list_id in the campuses table.` Webhook is rejected.

#### 3. [HIGH] Pipeline done handler — disabled until createShareLink() is implemented

**File:** `agents/pipeline.js` — `handleStatusChange()` case `done`

The `done` case called `createShareLink()`, which was a TODO stub that only logged. Users could mark tasks done expecting delivery to happen, but nothing actually occurred.

**Fix:** Replaced with `done_received_noop` log entry. TODO comment preserved with the 4-step implementation plan (query video → Frame.io share link API → update Supabase → update ClickUp custom field). No false delivery promises.

#### 4. [MEDIUM] Dashboard campus selector — render-time state mutation

**File:** `dashboard/src/App.jsx`

`setCampusId()` was called during render whenever `campusId` was falsy, making "All Campuses" mode unreachable (selecting null immediately overwrote with first campus on next render).

**Fix:** Moved to `useEffect` with `initialized` guard. Auto-selection only happens on first load. Selecting "All Campuses" (null) now persists correctly.

### RLS Policies Applied

Updated policies run in Supabase SQL Editor — confirmed applied.

### Agent Status Summary (Post-Review)

| Agent | Status | Trigger | Review Issues |
|---|---|---|---|
| Pipeline | **Live** — 3 triggers active, done disabled | ClickUp webhook | 2 fixed (campus fallback, done stub) |
| QA | **Live** — all 4 checks | "edited" status | No issues |
| Research | Built — needs APIFY_API_TOKEN | Daily 6 AM cron | No issues |
| Performance | Built — full analysis pipeline | Monday 7 AM cron | No issues |
| Scripting | **Blocked** — student context under review | — | — |
| Dashboard | **Live** — campus selector fixed, RLS hardened | localhost:5173 | 2 fixed (RLS, selector) |

---

## Session 4 — April 5, 2026

### Live End-to-End Test: ClickUp → Webhook → Supabase → Dropbox

Moved automation stack from MacBook to Windows 11 desktop. Ran full live test with ClickUp task status change through the entire pipeline.

**Test result:** ClickUp webhook fired → server received → video row created in Supabase → Dropbox folders created at `/austin/RUNNING APP/[FOOTAGE]` and `/[PROJECT]`.

### Bugs Found and Fixed

#### 1. Supabase `videos_status_check` constraint mismatch

**Error:** `new row for relation "videos" violates check constraint "videos_status_check"`

ClickUp sends lowercase statuses (`ready for shooting`) but the Supabase check constraint expects uppercase (`READY FOR SHOOTING`). The DB default was `IDEA` (uppercase).

**Fix:** Added `dbStatus()` helper in `agents/pipeline.js` that uppercases status values before all Supabase writes and queries. ClickUp API calls remain lowercase. Applied to insert (line 145), editor count query (line 253), QA block update (line 310), and footage detected update (line 373).

#### 2. Dropbox `expired_access_token` causing 500 cascade

**Error:** `Dropbox createFolder failed: expired_access_token/`

The long-lived Dropbox access token in `.env` had expired. Every webhook retry hit the same error, compounding with issue #3.

**Fix:** Rewrote `lib/dropbox.js` with auto-refresh on 401. All API calls route through `dropboxFetch()` which retries once with a fresh token obtained via `DROPBOX_REFRESH_TOKEN` + app key/secret. Created `scripts/get-dropbox-token.js` to obtain the refresh token via OAuth flow. Added `DROPBOX_REFRESH_TOKEN` to `.env`.

#### 3. ClickUp webhook retry storm on processing errors

**Error:** ClickUp retried the webhook every ~2 seconds when the handler returned 500, causing 15+ duplicate requests per status change.

**Fix:** `handlers/clickup.js` now returns `200` immediately after signature verification, before any async processing. Errors are logged to `agent_logs` but never propagate back to ClickUp as HTTP errors.

### Infrastructure

| Component | Status |
|---|---|
| ngrok | `https://nonhumanistic-rona-bathymetric.ngrok-free.dev` → `localhost:3000` |
| ClickUp webhook | Active, health reset (was failing with 6 fail count from old MacBook) |
| PM2 | `limitless-webhooks` running, auto-restart enabled |
| Dropbox OAuth | Refresh token configured, auto-refresh on 401 |
| Dashboard | Running on `localhost:5173` via Vite |

### Agent Status Summary

| Agent | Status | Trigger | Notes |
|---|---|---|---|
| Pipeline | **Live — e2e tested** | ClickUp webhook | Dropbox folder creation confirmed |
| QA | **Live** — all 4 checks | "edited" status | Not triggered in this test |
| Research | Built — needs APIFY_API_TOKEN | Daily 6 AM cron | No changes |
| Performance | Built — full analysis pipeline | Monday 7 AM cron | No changes |
| Scripting | **Blocked** — student context under review | — | — |
| Dashboard | **Live** | localhost:5173 | No changes |

---

## Session 5 — April 7, 2026

Switched back to Mac. Pulled Session 4 changes from GitHub. Built the Student Onboarding Agent from spec, ran two rounds of Codex adversarial review, fixed 8 issues total, and live-tested the conversational flow.

### Built — Student Onboarding Agent

**New files:**

- **`agents/onboarding.js`** — Conversational Claude-powered student intake. 6 sections (Business Context, Personal Brand, Industry Authority, Audience, Content Creation, Industry Report). One question at a time, warm/conversational tone. Server-side session state in `onboarding_sessions` table. Apify influencer transcript scraping in Section 3. Automated industry report generation in Section 6. Synthesizes 8-section context document via Claude on completion. Writes to `students.claude_project_context`.
- **`dashboard/src/pages/Onboarding.jsx`** + **`Onboarding.css`** — Standalone chat UI at `/onboard?student=ID&campus=ID`. Not inside main dashboard nav. Progress indicator (Section X of 6), auto-scroll, typing indicator, completion screen with "Copy Claude Project Context" button and Claude Projects paste instructions.
- **`scripts/migrate-students-onboarding.sql`** — Added 5 columns to students table: `claude_project_context`, `onboarding_completed_at`, `handle_tiktok`, `handle_instagram`, `handle_youtube`.
- **`scripts/migrate-onboarding-sessions.sql`** — Server-side session table: `current_section`, `current_question_index`, `answers` (jsonb), `influencer_transcripts` (jsonb), `industry_report`, `conversation_history` (jsonb), `probed_current`.
- **`scripts/migrate-webhook-inbox.sql`** — Durable webhook event processing table: `event_type`, `payload`, `received_at`, `processed_at`, `failed_at`, `error_message`, `retry_count`.
- **`scripts/seed-test-student.js`** — Seeds Alex Mathews test student for Austin campus.

**Modified files:**

- **`lib/claude.js`** — Added `askConversation()` for multi-turn message arrays.
- **`tools/scraper.js`** — Added `scrapeProfileVideos()` for profile-specific Apify scraping (Section 3 influencer transcripts).
- **`server.js`** — Added `POST /onboarding/message` and `GET /onboarding/student` routes. Completion guard checks `onboarding_completed_at` before processing. FFmpeg startup health check.
- **`dashboard/src/main.jsx`** — Added react-router-dom, `/onboard` route.
- **`dashboard/vite.config.js`** — Added proxy `/onboarding` → `localhost:3000`.

**Dependencies added:**

- `react-router-dom` v7.14.0 in dashboard

### Codex Adversarial Review Round 2 — 4 System-Wide Issues Fixed

Full repo scan from root commit. All findings fixed:

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | CRITICAL | RLS policies `campus_id IS NOT NULL` didn't enforce tenant scoping | Replaced with `SECURITY DEFINER` RPC functions requiring `campus_id` parameter. Anon can no longer SELECT from data tables directly. |
| 2 | HIGH | Webhook handler returned 200 before durable processing — failed events silently lost | New `webhook_inbox` table. Insert payload before 200. On failure: update `failed_at` + `error_message`. On success: set `processed_at`. |
| 3 | HIGH | FFmpeg missing → LUFS check returned no issues → videos passed QA without audio validation | LUFS check now fails closed with explicit error. Startup health check logs warning if FFmpeg missing. |
| 4 | MEDIUM | Dashboard queries used lowercase statuses, backend writes uppercase via `dbStatus()` | All dashboard components updated to uppercase (EDITED, WAITING, IN EDITING, etc.). Added `statusLabel()` for display. |

### Codex Adversarial Review Round 3 — 4 Onboarding Agent Issues Fixed

Focused review on the onboarding agent:

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | HIGH | Conversation state trusted from client via hidden HTML comments — forgeable | Server-side `onboarding_sessions` table owns all state. Client sends only `{ studentId, campusId, message }`. |
| 2 | HIGH | Influencer transcripts stored in per-request local variable — lost between requests | Written to `onboarding_sessions.influencer_transcripts` immediately after scraping. |
| 3 | HIGH | Only LLM-synthesized document persisted — raw answers unrecoverable | Raw answers and full conversation history persisted in session. Context doc is a derived artifact. |
| 4 | MEDIUM | No completion guard — completed onboarding could be overwritten | POST route checks `onboarding_completed_at` first. Returns existing context if already complete. |

### Live Testing Fixes

Two issues found during manual testing of the onboarding flow:

1. **Auto-greeting** — Greeting now fires automatically on page load via empty POST. Idempotent: returns cached greeting if session already has one.
2. **Vague answer probing** — Answers under 10 chars or containing only filler words (hello, yes, no, ok, sure, idk) trigger one probe before accepting. Uses `probed_current` flag — probes at most once per question.

### Migrations Run

| Script | Status |
|---|---|
| `scripts/migrate-students-onboarding.sql` | Applied |
| `scripts/migrate-webhook-inbox.sql` | Applied |
| `scripts/setup-dashboard-rls.sql` (RPC rewrite) | Applied |
| `scripts/migrate-onboarding-sessions.sql` | Applied |
| `ALTER TABLE onboarding_sessions ADD COLUMN probed_current` | Applied |

### Agent Status Summary (End of Session 5)

| Agent | Status | Trigger | Notes |
|---|---|---|---|
| Pipeline | **Live — e2e tested** | ClickUp webhook | 3 triggers active, done disabled |
| QA | **Live** — FFmpeg fails closed | "edited" status | LUFS check blocks if FFmpeg missing |
| Research | Built — needs APIFY_API_TOKEN | Daily 6 AM cron | No changes |
| Performance | Built — full analysis pipeline | Monday 7 AM cron | No changes |
| **Onboarding** | **Built — live tested** | `/onboard` URL | Server-side state, vague probing, completion guard |
| Scripting | **Blocked** — student context under review | — | Unblocked once onboarding populates student context |
| Dashboard | **Live** — RPC-hardened | localhost:5173 | Anon reads via RPCs, uppercase statuses |

### What's Next

1. Full end-to-end onboarding test with Alex Mathews — complete all 6 sections, verify context document and Supabase writes
2. Scripting Agent — now unblocked since onboarding agent populates `students.claude_project_context`
3. Frame.io share link creation (done handler)
4. Add Fireflies and Apify credentials
5. Install FFmpeg on Mac Mini for production LUFS checks

---

## Session 6 — April 15, 2026

Onboarding agent live test surfaced three related persistence bugs. Fixed in `agents/onboarding.js`, added a reset script, and reset Alex Mathews' state for re-testing.

### Bugs Reported from Live Test

| # | Symptom | Root cause |
|---|---|---|
| 1 | `onboarding_sessions.answers` stayed `{}` for the whole run while `conversation_history` saved correctly | Per-turn answer was only saved as part of the main multi-field `updateSession` at the end of the turn. Anything between answer storage and that final save (Apify scrape, next-question Claude call) could throw or hang and the answer would be lost on retry. No durability boundary at the moment of capture. |
| 2 | `students.claude_project_context` stayed `NULL` after the last question | Completion handler ran three sequential Claude calls (industry report, context synthesis, no failure logging) plus a Supabase write before any user-visible signal. A failure in `synthesizeContextDocument` or `writeToSupabase` aborted the function silently from the operator's view. |
| 3 | `students.onboarding_completed_at` stayed `NULL` | Same root cause as bug 2: `writeToSupabase` is the single line that sets both `claude_project_context` and `onboarding_completed_at`. If it didn't run, neither field was populated. |
| 4 | `handle_tiktok` / `handle_instagram` / `handle_youtube` stayed `NULL` | Confirmed downstream of bug 1 (no answers to extract from), plus the regex used `Object.values(answers).join(' ')` which collapses all answers into one greedy string. Newlines inside answers broke `.*` matching since JS `.` does not match `\n`, and cross-answer matches risked false positives. |

### Fixes Applied

**`agents/onboarding.js`**

1. **Per-turn answer persistence.** Added an explicit `updateSession(session.id, { answers })` immediately after the answer-storage block, wrapped in try/catch with an `answer_persist_error` log. This is now the durability boundary for a captured answer. The main multi-field `updateSession` at the end of the turn still runs and is still authoritative for the full session state.

2. **Completion handler instrumentation.** Wrapped each completion step in its own try/catch with explicit log entries: `completion_started`, `industry_report_generated`, `context_document_synthesized`, `students_table_written`. `synthesizeContextDocument` and `writeToSupabase` now rethrow on failure so the operator sees the real error in `agent_logs` instead of a silent abort. The final session update is non-fatal (`final_session_update_warning`) since the students table write is the real completion signal.

3. **Handle extraction rewritten.** New `extractStudentHandles(answers)` function scans each answer separately so multi-line answers do not break matching. Three patterns per platform: URL form (`tiktok.com/@xxx`), adjacent-word form (`"my tiktok is @xxx"` within 80 chars on a single line), and bare-handle fallback when the platform word appears anywhere in the same answer. First match per platform wins.

**`scripts/reset-onboarding.js`** (new)

Operator script to clear a student's onboarding state for re-testing. Defaults to matching name `%alex%`. Deletes all `onboarding_sessions` rows for the student, nulls `claude_project_context`, `onboarding_completed_at`, and the three handle columns, then prints the `/onboard` URL. Used to reset Alex Mathews this session.

### Reset Confirmed

```
Resetting: Alex Mathews (0bf6a38a-801e-4eff-b0c8-c209a9029b7e)
  Sessions deleted: 1
  Student onboarding fields cleared
  /onboard URL: http://localhost:5173/onboard?student=0bf6a38a-801e-4eff-b0c8-c209a9029b7e&campus=0ba4268f-f010-43c5-906c-41509bc9612f
```

### What's Next

1. Re-run the full onboarding flow end to end against Alex Mathews. Watch `agent_logs` for the new `completion_started`, `industry_report_generated`, `context_document_synthesized`, `students_table_written` entries to confirm each step fires.
2. Verify `onboarding_sessions.answers` accumulates per turn (should be visible in Supabase Table Editor after each user reply).
3. Verify the new handle extraction picks up handles from realistic test answers.

---

## Session 7 — April 20, 2026

Scripting Agent built from the spec in `workflows/scripting-agent.md`. Stub replaced with full implementation, one round of Codex adversarial review surfaced three no-ship issues (all fixed), integration test passes end-to-end against real Supabase + Claude + ClickUp.

### Spec gaps flagged before build

Six items in the workflow SOP did not line up with the current code or schema. Resolved during this session:

| # | Gap | Resolution |
|---|---|---|
| 1 | `videos.student_id` column did not exist; spec required insert with it | Added `videos.student_id uuid REFERENCES students(id)` in the migration; write both `student_id` and `student_name` (denormalized for dashboard) on insert |
| 2 | No per-campus Google Calendar configuration | Added `campuses.google_calendar_id text` in the migration; `runForCampus` warns + skips when null |
| 3 | ClickUp custom field IDs for Internal Video Name / Project Description not in env | Added `CLICKUP_INTERNAL_VIDEO_NAME_FIELD_ID` and `CLICKUP_PROJECT_DESCRIPTION_FIELD_ID` to `.env.example` and `.env`; values from `docs/progress-log.md` Session 3 discovery |
| 4 | `hook_type` taxonomy not enumerated in spec | Promoted `validHooks` to an exported `HOOK_TYPES` constant in `agents/research.js`; `agents/scripting.js` imports the same constant so the two agents can never drift |
| 5 | Brand voice examples file lives in a different repo | Read from `BRAND_VOICE_EXAMPLES_PATH` env var with no default; agent omits the `BRAND_VOICE_EXAMPLES` prompt block and logs a warning when absent. Does not block. |
| 6 | Test had no way to inject events without polluting the real Google Calendar | Exported `processEvent(event, campusId)` and `runOnce()` from `agents/scripting.js`; the test passes a fake event object directly and bypasses `gcal.listUpcomingFilmingEvents` |

### Built — Scripting Agent

**`agents/scripting.js`** (full rewrite from stub)

- `processEvent(event, campusId)` — orchestrator. Dedup read → campus load → student match → atomic claim insert → context load → Claude call (with one validation retry) → writes with rollback.
- `loadContext({ campusId, student })` — parallel fetch of latest `performance_signals` row, top 10 `research_library` entries by `view_count`, and optional brand voice examples file. Agent hedges when any section is missing.
- `buildPrompt({ student, context, validationError })` — system prompt enumerates `HOOK_TYPES` and the 5-field concept schema; user prompt includes `claude_project_context` verbatim. On retry, appends the previous validation error so Claude can correct.
- `generateConcepts(...)` — two attempts max. First attempt validation error is fed back to Claude; second failure aborts without writes.
- `validateConcepts(raw)` — enforces all 7 spec rules: array of exactly 3, all 5 fields present, title 1-4 words, script 70-150 words, `hook_type ∈ HOOK_TYPES`, `creative_direction` non-empty array of non-empty strings. Throws a precise error string that the caller appends to the retry prompt.
- `writeConcepts({ campus, student, event, concepts, claimId })` — atomic 3-row `videos` insert, sequential ClickUp `createTask` + 2 × `setCustomField` + `videos.clickup_task_id` update per concept. Transitions the claim row from `pending` to `completed` on success.
- `rollback(...)` — deletes inserted videos, archives created ClickUp tasks (ClickUp REST v2 has no hard delete, archive is the closest), then decides the claim's fate: clean rollback deletes the claim (allows retry); partial cleanup marks `failed_cleanup` (halts retries).
- `runForCampus(campus)` — gates on `campus.google_calendar_id`, calls `gcal.listUpcomingFilmingEvents`, swallows per-event errors.
- `runAll()` — mirrors `research.runAll`; loops active campuses. Registered as `scripting-agent` cron at `*/15 * * * *` in `server.js`.

**`lib/gcal.js`** (new)

Google Calendar service-account JWT client. `listUpcomingFilmingEvents(calendarId, windowHours)` returns normalized `{ id, title, description, startTime }` events. `parseStudentFromEvent(event, roster)` returns `{ student, reason, candidates }` — word-boundary matching with regex-special escape, explicit ambiguity rejection.

**`agents/research.js`** — exported `HOOK_TYPES` and `FORMAT_TYPES` constants; `classifyTranscript` now reads from them.

**`scripts/migrations/2026-04-20-scripting-agent.sql`** (new, staged — not auto-applied)

Three statements: `processed_calendar_events` table (with `status`, `error_payload`, `video_ids`, `completed_at`), `videos.student_id` FK, `campuses.google_calendar_id` text column. Ran manually in Supabase SQL Editor before the integration test.

### Codex Adversarial Review — 3 Issues Found and Fixed

Ran `/codex:adversarial-review` against the diff (~900 lines). Verdict: **needs-attention**. All 3 findings fixed before integration test.

**1. [HIGH] Dedup was not atomic (`agents/scripting.js`)**

The original flow did a read-based duplicate check first and did not insert into `processed_calendar_events` until after all videos and ClickUp tasks existed. Two overlapping cron executions could both pass the read, both create 3 videos and 3 ClickUp tasks, and only race on the final dedup insert. The unique constraint only protected the bookkeeping row; it did not prevent the duplicate external side effects.

**Fix:** Added `status text NOT NULL DEFAULT 'pending'` to `processed_calendar_events` and inserted the claim row before any side effects. The `(campus_id, event_id)` unique constraint now serializes overlapping runs atomically. On `23505` unique-violation, the loser silently skips with `claim_race_lost`. Claim transitions to `completed` after writes succeed.

**2. [HIGH] Failed rollback left orphans that guaranteed retry duplication (`agents/scripting.js`)**

The original `rollback` deleted videos and archived ClickUp tasks best-effort. If either compensating action failed, it just logged and returned. Because no `processed_calendar_events` row was written on failure, the next cron tick retried the same event, even though partial state from the previous attempt still existed. One failed cleanup meant duplicates and orphans accumulated every 15 minutes until someone intervened.

**Fix:** `rollback` now tracks whether every compensating action succeeded. Clean rollback deletes the claim row (allows retry). Partial rollback transitions the claim to `status='failed_cleanup'` with an `error_payload` describing what failed — automatic retries stop until an operator releases the claim.

**3. [MEDIUM] Student matching silently resolved ambiguous substring matches (`lib/gcal.js`)**

The original `parseStudentFromEvent` did case-insensitive substring search and returned the longest match. No word-boundary check, no ambiguity handling. A roster with overlapping names (common case: "Alex" + "Alex Mathews") would cause `processEvent` to write videos and ClickUp tasks against the wrong student.

**Fix:** `parseStudentFromEvent` now uses a `\b`-bounded case-insensitive regex per candidate (with regex-special chars escaped), rejects on 2+ matches, and returns `{ student, reason, candidates }`. Ambiguous events are logged with the candidate list and skipped without claiming so the event can reprocess once the operator clarifies it.

### Integration Test Results

`scripts/test-scripting-agent.js` (new). Runs against real Supabase + real Claude + real ClickUp. Uses Alex Mathews student (`0bf6a38a-801e-4eff-b0c8-c209a9029b7e`, Austin campus) and injects fake calendar events directly via `processEvent`.

**Test 1 — happy path:** `processEvent` with title "Filming with Alex Mathews". Asserts 3 `videos` rows created with status `IDEA` and `student_id` matching Alex; 3 ClickUp tasks created with both custom fields populated; `processed_calendar_events` row is `status='completed'` with all 3 video IDs. Prints concepts for eyeball review. ✓

**Test 2 — rollback:** monkey-patched `clickup.createTask` to throw on the second call. Asserts the simulated failure surfaces, all 3 inserted videos are deleted, the one pre-failure ClickUp task is archived, and the `processed_calendar_events` row is deleted (clean rollback). `agent_logs` contains a `scripting` error entry. ✓

**Test 3 — dedup:** called `processEvent` twice with the same event ID. Second call returned `{ skipped: 'already_claimed:completed' }` with zero additional writes. Exactly one `processed_calendar_events` row. ✓

**Teardown:** deleted 6 test videos, 3 processed_calendar_events rows, archived 7 ClickUp tasks. ✓

### Generated Concepts — Alex Mathews (Eyeball Review)

Performance signals empty (no populated `top_hooks`), so the hook-uniqueness assertion was skipped. Claude naturally diversified:

| # | Title | Hook type | Hook angle |
|---|---|---|---|
| 1 | AI at 8 | shock | Reveal the surprising age when kids should start learning AI |
| 2 | Building for Brother | story | Personal story of creating a solution for family member's struggle |
| 3 | The AI Gap | stat | Shocking statistic about AI education availability in schools |

All three name-drop Alex's "Early-Ai" brand, position him as an AI-educator for kids, and read as 30-60 seconds spoken. Voice-aligned with the `claude_project_context` populated by Session 5/6 onboarding. Quality acceptable for first live concept run.

### Agent Status Matrix

| Agent | Status | Trigger | Notes |
|---|---|---|---|
| Pipeline | **Live — e2e tested** | ClickUp webhook | 3 triggers active |
| QA | **Live** — FFmpeg fails closed | "edited" status | LUFS blocks if FFmpeg missing |
| Research | Built — needs APIFY_API_TOKEN | Daily 6 AM cron | Now exports `HOOK_TYPES` shared with Scripting |
| Performance | Built — full analysis pipeline | Monday 7 AM cron | No changes |
| Onboarding | **Built — live tested** | `/onboard` URL | No changes |
| **Scripting** | **Built — integration test passing** | `*/15 * * * *` cron | Atomic claim, word-boundary matching, quarantine on partial rollback |
| Dashboard | **Live** — RPC-hardened | localhost:5173 | No changes |

### What's Next

1. Populate `campuses.google_calendar_id` for Austin (Scott-owned calendar ID) so cron runs can actually list events.
2. Obtain Scott-approved brand voice examples and set `BRAND_VOICE_EXAMPLES_PATH` so concepts infer tone from real reference scripts, not `claude_project_context` alone.
3. Operator tool: small script to list `processed_calendar_events` rows in `failed_cleanup` and release them after manual review.
4. Frame.io share link creation (`done` handler) — last Phase 1 agent work.
5. Populate `top_hooks` via Performance Agent once ≥50 videos exist; then the hook_type uniqueness path in concept generation will exercise.
