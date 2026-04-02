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
