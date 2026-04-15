# Architecture

## System Summary

Limitless Automation is a Node.js webhook server (`server.js`) backed by Supabase Postgres that runs five domain agents and a React dashboard to automate the Alpha School student video production pipeline. Inbound ClickUp, Dropbox, and Frame.io webhooks land on an Express server managed by PM2, route to agent functions that read and write a shared database, and fan out side effects to external services through thin library clients. A small React app on `localhost:5173` reads the same database via the Supabase anon key (RLS-scoped) so Scott can watch pipeline state without touching ClickUp. As of Session 4 (2026-04-05), the system runs on a Windows 11 desktop with an ngrok tunnel, with a planned cutover to a Mac Mini described in `workflows/mac-mini-deployment.md`.

## Component map

### Infrastructure

| File | What it does |
|---|---|
| `server.js` | Express app on port 3000. Registers three webhook routes and the Dropbox GET challenge. Starts the cron scheduler on boot. Catches unhandled route errors and promise rejections and logs them. |
| `ecosystem.config.js` | PM2 process definition. Auto-restart, exponential backoff, 512MB memory cap, log file paths, merged stdout/stderr with timestamps. |
| `package.json` | Four runtime dependencies: `@anthropic-ai/sdk`, `@supabase/supabase-js`, `express`, `dotenv`, `node-cron`. Node >= 20. |
| `.env` / `.env.example` | Loaded by `dotenv` in `server.js`. Credentials per `docs/integrations.md`. |

### Agents

| File | What it does | Status |
|---|---|---|
| `agents/pipeline.js` | Deterministic ClickUp status router. Handles `ready for shooting` (Dropbox folder creation), `ready for editing` (editor assignment), `edited` (QA gate), and `done` (noop). Also exposes `handleFootageDetected` called when footage lands in Dropbox. | Live, 3 triggers active, `done` is a `done_received_noop` pending `workflows/frame-io-share-link.md`. |
| `agents/qa.js` | LLM-powered quality gate on the `edited` trigger. Runs brand-term spell check against `brand_dictionary`, caption formatting via Claude, FFmpeg LUFS at -14 ±1, and Claude-based stutter/filler detection. Writes `qa_passed` to `videos`. Posts failure reports to the ClickUp task as a comment. | Live. LUFS gracefully skips if FFmpeg is missing. |
| `agents/research.js` | Scrapes TikTok and Instagram via Apify, classifies each video (`hook_type`, `format`, `topic_tags`) with Claude, deduplicates against `research_library` by `source_url`, and inserts new rows. Called per-campus by `runAll()`. | Built. Needs `APIFY_API_TOKEN` to actually scrape. |
| `agents/performance.js` | Weekly Claude-driven pattern recognition over the last 4 weeks of `performance` data plus `research_library` benchmarks. Writes structured signals to `performance_signals`. Hedges confidence when fewer than 50 videos. | Live. |
| `agents/scripting.js` | Intended to generate 3 concept scripts per filming event. | Stub. Blocked on student context collection per `docs/decisions.md` 2026-04-02. Full spec in `workflows/scripting-agent.md`. |

### Handlers

| File | What it does |
|---|---|
| `handlers/clickup.js` | Verifies `X-Signature` HMAC-SHA256, acknowledges with 200 immediately (fixes Session 4 retry storm), then routes `taskStatusUpdated` to `pipeline.handleStatusChange(taskId, newStatus, null)`. `taskCreated` is a noop. |
| `handlers/dropbox.js` | Verifies `X-Dropbox-Signature` HMAC-SHA256. Logs the inbound event. File-to-pipeline routing is a TODO. File detection is currently invoked directly by tests (`pipeline.handleFootageDetected`) rather than triggered by this webhook. |
| `handlers/frameio.js` | Verifies `X-Frameio-Signature` HMAC-SHA256. Handles `comment.created` events but routing to a `waiting` status change is a TODO. |

### Libraries

| File | What it does |
|---|---|
| `lib/supabase.js` | Server-side Supabase client using `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). Single instance shared across agents. |
| `lib/claude.js` | Anthropic SDK wrapper pinned to `claude-sonnet-4-20250514`. Exposes `ask()` and `askJson()` (strips ```json fences before parse). |
| `lib/logger.js` | Dual output: console (for PM2) and `agent_logs` table. Never lets Supabase write failures crash the caller. This is the implementation of CLAUDE.md error handling rule 1 (log before recovery). |
| `lib/clickup.js` | REST v2 client. Methods: `getTask`, `getTasks`, `updateTask`, `addComment`, `createTask`, `setCustomField`, `getCustomFields`. |
| `lib/dropbox.js` | REST client with automatic token refresh on 401 using `DROPBOX_REFRESH_TOKEN` + app key/secret. Methods: `createFolder`, `listFolder`, `downloadFile`, `getTemporaryLink`. Refresh logic added in Session 4 to fix the expired-access-token cascade. |
| `lib/scheduler.js` | `node-cron` wrapper. `register(name, schedule, fn)` with automatic `agent_logs` entries at job start, complete, and error. |

### Tools

| File | What it does |
|---|---|
| `tools/srt-parser.js` | Deterministic SRT parser returning `{ index, startTime, endTime, startMs, endMs, text }`. Used by `agents/qa.js`. |
| `tools/scraper.js` | Apify REST client for `clockworks/free-tiktok-scraper` and `apify/instagram-scraper`. Returns normalized video objects. |

### Dashboard

| File | What it does |
|---|---|
| `dashboard/src/main.jsx` | React entry point. |
| `dashboard/src/App.jsx` | Tab navigation, campus selector. Uses `useEffect` + `initialized` guard to auto-select first campus only on first load (Codex fix 2026-04-03). |
| `dashboard/src/lib/supabase.js` | Browser Supabase client using `VITE_SUPABASE_ANON_KEY`. Subject to RLS. |
| `dashboard/src/lib/hooks.js` | Seven polling hooks: `useCampuses`, `useVideos`, `useAgentLogs`, `useQAQueue`, `useEditors`, `useEditorCounts`, `usePerformanceSignals`. Refresh intervals 10 to 60 seconds. |
| `dashboard/src/components/PipelineView.jsx` | 11-column kanban: idea, ready for shooting, ready for editing, in editing, edited, uploaded to dropbox, sent to client, revised, posted by client, done, waiting. |
| `dashboard/src/components/AgentActivityFeed.jsx` | Real-time log feed with color-coded agent badges. |
| `dashboard/src/components/QAQueue.jsx` | Two sections: "Awaiting QA" (status=edited, qa_passed=null) and "QA Failed / Waiting". |
| `dashboard/src/components/EditorCapacity.jsx` | Editor cards with active-task counts (status = `in editing`). |
| `dashboard/src/components/PerformanceSignals.jsx` | Weekly signal cards with summary, top hooks/formats/topics, recommendations, underperforming patterns. |

### Scripts

| File | What it does |
|---|---|
| `scripts/verify-integrations.js` | Live smoke tests against Supabase (service + anon), Anthropic, Dropbox, Frame.io v2 and v4. |
| `scripts/verify-clickup.js` | Tests ClickUp API access against the Austin list and retrieves custom field IDs. |
| `scripts/test-pipeline-folders.js` | End-to-end Dropbox folder creation test. |
| `scripts/test-qa-agent.js` | End-to-end QA agent test with a seeded SRT. |
| `scripts/test-research-agent.js` | End-to-end research agent test with synthetic video data. |
| `scripts/test-performance-agent.js` | End-to-end performance agent test with seeded synthetic performance rows. |
| `scripts/seed-editors.js` | Inserts Charles Williams and Tipra into the `editors` table for Austin campus (Session 3). |
| `scripts/get-dropbox-token.js` | One-off OAuth flow to obtain `DROPBOX_REFRESH_TOKEN` (Session 4). |
| `scripts/setup-dashboard-rls.sql` | RLS policies for anon read access scoped by `campus_id IS NOT NULL` (Codex fix 2026-04-03). Also includes the `research_library` unique index. |

### Workflow SOPs

`workflows/scripting-agent.md`, `workflows/frame-io-share-link.md`, `workflows/self-healing-handler.md`, `workflows/openclaw-integration.md`, `workflows/fireflies-integration.md`, `workflows/mac-mini-deployment.md`, `workflows/e2e-test.md`, `workflows/handoff.md`. Each SOP is the source of truth for building or refactoring that component.

## Data flow: calendar event to delivered share link

The happy path for a single concept. Agent layer steps in brackets.

1. **Filming event appears on Google Calendar.** External: Google Calendar. Tables: none. *Current state: Scripting Agent is a stub, so this step does not fire automatically yet.*
2. **Scripting Agent would generate 3 concepts.** Agent: `agents/scripting.js` (stub). External: Anthropic. Tables written: `videos` (status `IDEA`), `processed_calendar_events` (per `workflows/scripting-agent.md`). Tables read: `students`, `performance_signals`, `research_library`. *Today Scott creates the ClickUp task manually in `idea` status.*
3. **Scott moves the task to `ready for shooting` in ClickUp.** External: ClickUp UI.
4. **ClickUp webhook fires `taskStatusUpdated`.** Handler: `handlers/clickup.js` verifies signature, acknowledges 200, calls `pipeline.handleStatusChange(taskId, 'ready for shooting', null)`.
5. **Pipeline Agent creates Dropbox folders.** Agent: `agents/pipeline.js` → `createDropboxFolders()`. External: Dropbox. Tables read: `videos` (via `resolveTask`), `campuses`. Tables written: `videos.dropbox_folder`, `agent_logs`.
6. **Videographer uploads footage to the `[FOOTAGE]` subfolder.** External: Dropbox (manual).
7. **Footage detected and status bumped to `ready for editing`.** Agent: `agents/pipeline.js` → `handleFootageDetected()`. External: Dropbox (listFolder), ClickUp (updateTask). Tables: `videos.status`. *Note: the Dropbox webhook handler has not yet wired this call; today the trigger is invoked manually or via test scripts. 1-hour post-upload delay per `docs/decisions.md` 2026-04-01.*
8. **Pipeline Agent assigns an editor.** Agent: `agents/pipeline.js` → `assignEditor()`. External: ClickUp (updateTask with `assignees.add`). Tables read: `editors` (active for campus), `videos` (count of `in editing` per editor). Tables written: `videos.assignee_id`, `agent_logs`.
9. **Editor edits, exports, uploads to Frame.io, pastes the internal link into the ClickUp "E - Frame Link" field, and moves the task to `edited`.** External: Premiere Pro, Frame.io, ClickUp (all manual).
10. **QA Agent runs.** Agent: `agents/qa.js` → `runQA()`. External: Dropbox (SRT download, video temp link), Anthropic, FFmpeg (local), ClickUp (addComment on failure). Tables read: `videos`, `brand_dictionary`. Tables written: `videos.qa_passed`, `agent_logs`.
11. **If QA fails, status goes to `waiting` and a comment is posted.** The editor fixes and re-submits `edited` to re-trigger QA.
12. **Scott reviews on Frame.io, approves, moves ClickUp to `done`.** External: Frame.io, ClickUp (manual).
13. **Pipeline Agent should create the client share link.** Agent: `agents/pipeline.js` → `case 'done'`. *Currently logs `done_received_noop` (Codex fix 2026-04-03). Spec for enabling this is `workflows/frame-io-share-link.md`.* Target tables: `videos.frameio_share_link`, ClickUp custom field "E - Frame Link".

## Topology: Supabase-only agent communication

Rule from CLAUDE.md: agents never call each other; they communicate through Supabase rows. The matrix below lists what each agent reads and writes.

| Agent | Reads | Writes |
|---|---|---|
| Pipeline | `videos`, `campuses`, `editors` | `videos` (status, dropbox_folder, assignee_id), `agent_logs` |
| QA | `videos`, `brand_dictionary` | `videos.qa_passed`, `agent_logs` |
| Research | `campuses` (active), `research_library` (dedup check) | `research_library`, `agent_logs` |
| Performance | `campuses` (active), `performance`, `videos` (for transcripts via `script` column), `research_library` | `performance_signals`, `agent_logs` |
| Scripting (stub) | `students`, `performance_signals`, `research_library` (planned) | `videos`, `processed_calendar_events` (planned) |

Every `videos` row is written by Pipeline and Scripting only. QA updates the single `qa_passed` column. No agent calls another agent's function directly. The Pipeline Agent calls `qa.runQA` inline from its `edited` case, which is the one internal exception (same process, not via database).

## Cron schedule

Registered inside `server.js` via `lib/scheduler.js` on server boot.

| Job name | Cron | What it does | Registered in |
|---|---|---|---|
| `research-agent` | `0 6 * * *` | Daily at 6 AM. Calls `research.runAll()` which iterates active campuses and scrapes TikTok + Instagram. | `server.js` line 68 |
| `performance-agent` | `0 7 * * 1` | Every Monday at 7 AM. Calls `performance.runAll()` which analyzes the last 4 weeks of performance data per campus. | `server.js` line 70 |

No Scripting Agent, Fireflies, or OpenClaw cron is registered yet. Those are planned in their respective workflow specs.

## Webhook map

Inbound webhooks. All signature verification uses HMAC-SHA256 over the raw body with timing-safe comparison and length-mismatch guards (Session 1 hardening).

| Route | Method | Signature header | Handler | Routes to |
|---|---|---|---|---|
| `/webhooks/clickup` | POST | `X-Signature` (secret: `CLICKUP_WEBHOOK_SECRET`) | `handlers/clickup.js` | `pipeline.handleStatusChange(taskId, newStatus, null)` |
| `/webhooks/dropbox` | POST | `X-Dropbox-Signature` (secret: `DROPBOX_APP_SECRET`) | `handlers/dropbox.js` | Logs only. Routing to `pipeline.handleFootageDetected` is a TODO. |
| `/webhooks/dropbox` | GET | n/a (challenge parameter) | `server.js` inline | Echoes `challenge` query param as text. |
| `/webhooks/frameio` | POST | `X-Frameio-Signature` (secret: `FRAMEIO_WEBHOOK_SECRET`) | `handlers/frameio.js` | Logs `comment.created` but does not yet trigger ClickUp `waiting`. |

Outbound: `/health` GET returns JSON status for PM2 monitoring. The orchestrator endpoint `/orchestrator/trigger` described in `workflows/openclaw-integration.md` is not yet built.

## Error handling topology

Per CLAUDE.md rules, layered from inside to outside.

1. **Per-agent try/catch.** Every top-level agent function (`handleStatusChange`, `runQA`, `run`, `runAll`) wraps its body in try/catch and calls `logger.log` with status `error` BEFORE rethrowing. This is rule 1 from CLAUDE.md: log full error context before any recovery. Confirmed present in `agents/pipeline.js`, `agents/qa.js`, `agents/research.js`, `agents/performance.js`, and the `agents/scripting.js` stub.
2. **Logger failure isolation.** `lib/logger.js` wraps the Supabase insert in its own try/catch so a DB write failure never crashes the agent that called it.
3. **Webhook handler isolation.** `handlers/clickup.js` returns 200 immediately after signature verification, then runs processing asynchronously. Processing errors are logged but never become HTTP errors back to ClickUp (Session 4 fix to stop retry storms).
4. **Express route error middleware.** `server.js` has a 4-argument `app.use((err, _req, res, _next) => ...)` that logs and returns 500. Catches synchronous throws.
5. **`process.on('unhandledRejection')`.** `server.js` catches orphan async rejections and logs them.
6. **Self-healing handler (planned).** CLAUDE.md specifies a Claude-driven diagnose-and-retry-once layer that escalates to a ClickUp comment on failure. Not yet built. Full spec in `workflows/self-healing-handler.md`.
7. **PM2 last line of defense.** `ecosystem.config.js` restarts the process with exponential backoff on crash, capped at 10 restarts and a 512MB memory limit.

The Dropbox-specific auto-refresh in `lib/dropbox.js` is a localized version of step 6 that predates the global handler. It retries a single API call once with a fresh token on 401, so Dropbox token expiry never reaches the logger.

## Multi-tenant design

`campus_id` is on every domain table and every agent query filters by it. The enforcement layers:

1. **Column constraint.** Every row in `videos`, `agent_logs`, `editors`, `performance`, `performance_signals`, `research_library`, `brand_dictionary`, `students`, `processed_calendar_events` (planned) carries a `campus_id uuid references campuses(id)`. No row exists without one.
2. **RLS policies (anon key).** `scripts/setup-dashboard-rls.sql` grants the `anon` role `SELECT` on the dashboard-visible tables only when `campus_id IS NOT NULL`. The dashboard must include a `campus_id` filter for rows to come back. Blanket `USING (true)` policies were removed in the 2026-04-03 Codex review. `campuses` and `editors` also require `active = true`.
3. **Service role bypass (agents).** `lib/supabase.js` uses the service role key, which bypasses RLS, so agents are responsible for correct filtering themselves. Every agent query includes `.eq('campus_id', campusId)`.
4. **Pipeline `resolveTask` guardrail.** `agents/pipeline.js` `resolveTask()` looks up the campus by `campuses.clickup_list_id` matching the incoming ClickUp task's list ID. If no campus maps, the function logs the error and throws. The earlier fallback to `SELECT id FROM campuses LIMIT 1` was removed in the 2026-04-03 Codex review to prevent cross-tenant data corruption. The thrown message names the unmapped list ID so the operator knows which `clickup_list_id` to configure.
5. **Dropbox path scoping.** Folders are always created under `campuses.dropbox_root` to keep campus footage physically separated in Dropbox.

Austin is currently the only active campus. Its `clickup_list_id` is `901707767654`, confirmed in Session 3.

## Out of scope for Phase 1

Per `docs/architecture.md` prior "Out of Scope" note and the SOW's "Out of Scope" signals in the Post-Production agents list:

- **Premiere Pro agent chain.** Project creation, footage ingestion, timeline assembly, base editing, color transform (SLog3 to Rec.709), auto-transcription, audio processing. All remain manual in Phase 1.
- **Music recommendation automation.** Out of scope until a tagged approved library exists per the SOW's Music Recommendation roadblocks.
- **Premiere export + Frame.io upload.** The editor performs these manually; the QA gate runs against the exported product in Dropbox.
- **Multi-campus rollout.** Architecture supports it via `campus_id` everywhere, but only Austin is seeded.
- **Fireflies integration, OpenClaw orchestrator, Mac Mini cutover, Frame.io share link on done, self-healing handler, end-to-end recorded walkthrough, handoff.** All specified, none built. See the corresponding workflow SOPs for each.

## Known gotchas (from CLAUDE.md)

- `videos.qa_passed` column was missing from the original schema. Added during initial migration per `docs/decisions.md` 2026-04-01. Default `null` distinguishes "not yet checked" from "checked and failed".
- Frame.io v4 API requires Adobe OAuth Server-to-Server. The current developer token only authenticates against v2. Decision 2026-04-02 commits to v2 for all agent integrations until v4 prerequisites are met. Migration steps are documented inline in `docs/decisions.md`.
- Scott runs an existing `fireflies_sync.py` at 9 PM nightly. The planned integration in `workflows/fireflies-integration.md` runs at 10 PM and writes to a new `meeting_transcripts` table, never overlapping Scott's ClickUp action-item flow.
- Dropbox desktop sync is live for the team. The agent code only uses the Dropbox API and never touches local sync state.
- ClickUp statuses are lowercase everywhere the API is concerned (`idea`, `ready for shooting`, and so on). Supabase `videos.status` stores uppercase for historical constraint reasons. `agents/pipeline.js` line 20 exposes `dbStatus(s) => s.toUpperCase()` and all Supabase reads and writes funnel through it. ClickUp writes use lowercase. See `docs/decisions.md` 2026-04-03 for the full status list and the Session 4 bug that motivated the helper.
- Google Calendar event format is not yet confirmed with Scott. The Scripting Agent is blocked on this plus the student context approach.
- ClickUp custom field IDs were discovered via API in Session 3: "E - Frame Link" `53590f25-d850-4c19-8c7a-7b005904e04a`, "Dropbox Link" `d818eb86-41ce-416f-98aa-b1d92f13459f`, "Internal Video Name" `6e3fde3f-250f-470a-b88f-b382c599e998`, "Project Description" `8799f3b7-3385-4f9f-9a1b-b8872ecc78f4`, "Editor" `62642aae-d92d-49e9-a4fc-a17c137cdbe0`. If a new ClickUp list is added for a second campus, these must be re-retrieved since ClickUp field IDs are list-scoped.

## TODOs

- **SOW reference.** The prompt cites `docs/sow.pdf` but no PDF exists in `docs/` as of this rewrite. The informal scope document at the repo root (`Agency Automation Scope .md`) is the only in-repo proxy. TODO: verify whether a signed SOW PDF should be committed to `docs/`, and re-check any SOW Section references once the authoritative document is in place.
- **Delivered-beyond-scope additions.** `workflows/handoff.md` lists a Student Onboarding Agent, a Content Performance Agent (distinct from the existing Performance Analysis Agent), a Pipeline Age Dashboard View, and a Webhook Inbox Table as "delivered beyond scope" items. None of these exist in the current codebase. TODO: verify with Caiden whether these are built elsewhere, planned but unbuilt, or should be removed from the handoff list before the acceptance email is sent.
- **Dropbox webhook → Pipeline wiring.** `handlers/dropbox.js` logs inbound events but does not yet call `pipeline.handleFootageDetected`. TODO: verify when this wiring lands and update this doc.
- **Frame.io comment webhook → `waiting` routing.** `handlers/frameio.js` `comment.created` case is a TODO stub. Until wired, the `waiting` status change from a Frame.io comment is manual.

---

Word count: 2819
