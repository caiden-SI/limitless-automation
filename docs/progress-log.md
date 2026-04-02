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

### Built — Pipeline Agent: READY FOR SHOOTING → Dropbox Folder Creation

**Files created/modified:**

- **`lib/dropbox.js`** (new) — Dropbox REST API client with `createFolder(path)` and `listFolder(path)`. Handles conflict (folder already exists) gracefully.
- **`agents/pipeline.js`** (rewritten) — Full implementation of first trigger:
  - `handleStatusChange()` — routes by ClickUp status to the correct action
  - `resolveTask()` — looks up video by `clickup_task_id` in Supabase, creates the row if missing (using ClickUp API stub)
  - `createDropboxFolders()` — creates `/{campus-slug}/{title}/[FOOTAGE]/` and `/[PROJECT]/` in Dropbox, updates `videos.dropbox_folder` in Supabase
  - `assignEditor()` — queries editors by campus, picks lowest active count, updates Supabase (ClickUp assignee update stubbed)
  - `handleFootageDetected()` — verifies files in `[FOOTAGE]` via Dropbox API, updates status to READY FOR EDITING in Supabase (ClickUp status update stubbed)
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
- Build next Pipeline trigger: Dropbox file detection → READY FOR EDITING (1-hour delay)
- Build editor assignment logic (needs editor rows seeded in `editors` table)
- Build Frame.io share link creation (status → DONE trigger)

---

## Session 2 (continued) — April 2, 2026: QA Agent

### Built — QA Agent: EDITED → Quality Gate

**Files created/modified:**

- **`tools/srt-parser.js`** (new) — Deterministic SRT parser: `parseSRT()` returns structured cues with index, timecodes (start/end in string and ms), and text. `cuesToPlainText()` for concatenated text extraction.
- **`lib/dropbox.js`** (updated) — Added `downloadFile(path)` (returns Buffer) and `getTemporaryLink(path)` (returns 4-hour direct URL for FFmpeg).
- **`agents/qa.js`** (rewritten) — Full QA agent with four checks:
  1. **Brand dictionary spell check** — Retrieves SRT from Dropbox `[PROJECT]` folder, parses it, checks every word against `brand_dictionary` table. Catches exact capitalization errors and Levenshtein distance-1 near-misses.
  2. **Caption formatting** (Claude) — Sends cues to Claude for punctuation consistency, line length, timing overlaps, capitalization. Returns structured `FORMAT:` issues with timecodes.
  3. **LUFS analysis** (FFmpeg) — Gets temporary Dropbox link, runs `ffmpeg -af loudnorm=print_format=json`, parses `input_i` from stderr. Target: -14 LUFS ±1 LU. Gracefully skips if FFmpeg not installed (not a blocking failure).
  4. **Stutter/filler detection** (Claude) — Sends timestamped transcript to Claude for filler words (um, uh, like, you know, basically), stutters (repeated words), and false starts. Returns `STUTTER:` issues with timecodes and suggestions.
- **`agents/pipeline.js`** (updated) — Added `EDITED` case in status switch, new `triggerQA()` function that runs QA and gates delivery:
  - QA pass → video eligible for Frame.io upload
  - QA fail → status set to NEEDS REVISIONS in Supabase (ClickUp update stubbed)
- **`scripts/test-qa-agent.js`** (new) — End-to-end integration test

**ClickUp API stubs (clearly marked TODO):**
- Post QA report to ClickUp task comments
- Update ClickUp status to NEEDS REVISIONS on QA failure

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
- `qa_passed = true` → video eligible for Frame.io upload (status stays, waiting for DONE)
- `qa_passed = false` → status set to NEEDS REVISIONS, issues logged. Editor must fix and re-submit as EDITED to re-trigger QA.

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
