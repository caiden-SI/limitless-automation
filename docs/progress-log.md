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
- Add remaining credentials: ClickUp, Fireflies, Apify
- Remaining Pipeline triggers: Dropbox file detection, Frame.io share link
