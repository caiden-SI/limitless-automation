# Architecture

## System Summary

Limitless Automation is a Node.js webhook server (`server.js`) backed by Supabase Postgres that runs six domain agents and a React dashboard to automate the Alpha School student video production pipeline. Inbound ClickUp webhooks are durably persisted to a `webhook_inbox` table before processing, then routed to agent functions that read and write the shared database. Dashboard reads happen exclusively through `SECURITY DEFINER` RPC functions that require a `campus_id` parameter, replacing the earlier RLS-policy approach that could not enforce tenant scoping at the policy level. A standalone `/onboard` chat UI feeds the Student Onboarding Agent, which produces each student's Claude Project context document and writes it to `students.claude_project_context`. As of Session 5 (2026-04-07), the system runs on a Mac Mini setup target with the codebase live-tested on Caiden's macOS dev environment. The webhook server still hosts on the Windows 11 desktop with an ngrok tunnel pending the cutover described in `workflows/mac-mini-deployment.md`.

## Component map

### Infrastructure

| File | What it does |
|---|---|
| `server.js` | Express app on port 3000. Registers three webhook routes, the Dropbox GET challenge, two onboarding routes, and an FFmpeg startup health check. Boots two cron jobs and the unhandled-rejection trap. |
| `ecosystem.config.js` | PM2 process definition. Auto-restart, exponential backoff, 512MB memory cap, log file paths, merged stdout/stderr with timestamps. |
| `package.json` | Root: `@anthropic-ai/sdk`, `@supabase/supabase-js`, `express`, `dotenv`, `node-cron`, Node >= 20. Dashboard adds `react`, `react-dom`, `react-router-dom@7.14.0` (added Session 5). |
| `.env` / `.env.example` | Loaded by `dotenv` in `server.js`. Credentials per `docs/integrations.md`. |

### Agents (six)

| File | What it does | Status |
|---|---|---|
| `agents/pipeline.js` | Deterministic ClickUp status router. Handles `ready for shooting` (Dropbox folder creation), `ready for editing` (editor assignment), `edited` (QA gate), and `done` (noop). Exposes `handleFootageDetected` for Dropbox file detection. Owns `dbStatus(s) => s.toUpperCase()` (line 20) which all Supabase status reads and writes funnel through. | Live, 3 triggers active; `done` is `done_received_noop` pending `workflows/frame-io-share-link.md`. |
| `agents/qa.js` | LLM-powered quality gate on the `edited` trigger. Brand-term spell check, Claude-driven caption formatting, FFmpeg LUFS at -14 ±1, Claude stutter/filler detection. Writes `qa_passed`, posts failure reports as ClickUp comments. LUFS check now fails closed when FFmpeg is missing (Session 5 Codex Round 2 fix). | Live. Requires FFmpeg on the host. |
| `agents/research.js` | Scrapes TikTok and Instagram via Apify, classifies `hook_type`, `format`, `topic_tags` with Claude, deduplicates against `research_library` by `source_url`. Per-campus, called by `runAll()`. | Built. Needs `APIFY_API_TOKEN`. |
| `agents/performance.js` | Weekly Claude pattern recognition over the last 4 weeks of `performance` data plus `research_library` benchmarks. Writes `performance_signals`. Hedges confidence below 50 videos. | Live. |
| `agents/scripting.js` | Intended to generate 3 concept scripts per filming event. Body is a TODO. | Stub. Was blocked on student context per `docs/decisions.md` 2026-04-02. Unblocked by the Onboarding Agent (Session 5) but not yet implemented. Spec in `workflows/scripting-agent.md`. |
| `agents/onboarding.js` | Conversational Claude-powered student intake at `/onboard?student=ID&campus=ID`. 6 sections, 1 question at a time, vague-answer probing (one probe per question via `probed_current` flag). Section 3 scrapes influencer transcripts via Apify. Section 6 generates an industry report via Claude. On completion, synthesizes an 8-section context document and writes to `students.claude_project_context`. All conversation state lives server-side in `onboarding_sessions`. | Live. Tested manually with the Alex Mathews seed student. |

### Handlers

| File | What it does |
|---|---|
| `handlers/clickup.js` | Verifies `X-Signature` HMAC-SHA256, inserts the payload into `webhook_inbox`, returns 200, then processes asynchronously. On success: sets `processed_at`. On failure: sets `failed_at` + `error_message` + `retry_count = 1`. If the inbox insert itself fails, returns 500 so ClickUp retries. Routes `taskStatusUpdated` to `pipeline.handleStatusChange(taskId, newStatus, null)`. |
| `handlers/dropbox.js` | Verifies `X-Dropbox-Signature` HMAC-SHA256, logs the event. Does not yet write to `webhook_inbox`. Routing the file change to `pipeline.handleFootageDetected` is still a TODO. |
| `handlers/frameio.js` | Verifies `X-Frameio-Signature` HMAC-SHA256, logs `comment.created`. Does not yet write to `webhook_inbox`. Routing the comment to a `waiting` status change is still a TODO. |

### Libraries

| File | What it does |
|---|---|
| `lib/supabase.js` | Server-side Supabase client using `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). Single instance shared across agents. |
| `lib/claude.js` | Anthropic SDK wrapper pinned to `claude-sonnet-4-20250514`. Exposes `ask()`, `askJson()` (strips ```json fences), and `askConversation()` (multi-turn message arrays, added Session 5 for the Onboarding Agent). |
| `lib/logger.js` | Dual output: console (PM2) and `agent_logs` table. Wraps the Supabase insert in its own try/catch so DB write failure never crashes the caller. Implements CLAUDE.md error handling rule 1 (log before recovery). |
| `lib/clickup.js` | REST v2 client. Methods: `getTask`, `getTasks`, `updateTask`, `addComment`, `createTask`, `setCustomField`, `getCustomFields`. |
| `lib/dropbox.js` | REST client with automatic token refresh on 401 using `DROPBOX_REFRESH_TOKEN` + app key/secret. Methods: `createFolder`, `listFolder`, `downloadFile`, `getTemporaryLink`. Refresh added Session 4. |
| `lib/scheduler.js` | `node-cron` wrapper. `register(name, schedule, fn)` with automatic `agent_logs` entries at job start, complete, and error. |

### Tools

| File | What it does |
|---|---|
| `tools/srt-parser.js` | Deterministic SRT parser returning structured cue objects with millisecond timecodes. Used by `agents/qa.js`. |
| `tools/scraper.js` | Apify REST client for `clockworks/free-tiktok-scraper` and `apify/instagram-scraper`. Three exports: `scrapeTikTok(queries, max)`, `scrapeInstagram(queries, max)`, `scrapeProfileVideos(profileUrl, platform, max)` (added Session 5 for Onboarding Section 3). |

### Dashboard

| File | What it does |
|---|---|
| `dashboard/src/main.jsx` | React entry. Wraps in `BrowserRouter`. Routes: `/onboard` to `Onboarding`, `/*` to `App`. Added Session 5. |
| `dashboard/src/App.jsx` | Tab navigation, campus selector. `useEffect` + `initialized` guard auto-selects first campus on first load only (Codex Round 1 fix). |
| `dashboard/src/lib/supabase.js` | Browser Supabase client using `VITE_SUPABASE_ANON_KEY`. Anon role can no longer SELECT from data tables; reads must go through RPCs. |
| `dashboard/src/lib/hooks.js` | Polling hooks. `useCampuses` still uses `from('campuses').select(...)` (anon allowed). All other hooks (`useVideos`, `useAgentLogs`, `useQAQueue`, `useEditors`, `useEditorCounts`, `usePerformanceSignals`) call `sb.rpc('get_campus_*', { p_campus_id })`. Falsy `campusId` returns an empty result without an RPC call. |
| `dashboard/src/components/PipelineView.jsx` | 11-column kanban. Status array uses uppercase strings (`IDEA`, `READY FOR SHOOTING`, etc.) to match `dbStatus()` writes. `statusLabel(s) => s.toLowerCase()` renders display text. Updated Session 5 (Codex Round 2 fix). |
| `dashboard/src/components/QAQueue.jsx` | Two sections: "Awaiting QA" (`status === 'EDITED'`, `qa_passed === null`) and "QA Failed / Waiting" (`status === 'WAITING'` or `qa_passed === false`). Uppercase statuses (Session 5). |
| `dashboard/src/components/AgentActivityFeed.jsx` | Real-time log feed with color-coded agent badges. |
| `dashboard/src/components/EditorCapacity.jsx` | Editor cards with active-task counts. |
| `dashboard/src/components/PerformanceSignals.jsx` | Weekly signal cards: summary, top hooks/formats/topics, recommendations, underperforming patterns. |
| `dashboard/src/pages/Onboarding.jsx` + `Onboarding.css` | Standalone chat UI at `/onboard?student=ID&campus=ID`. Display only: server owns conversation state. Auto-greeting, typing indicator, progress chip, completion screen with "Copy Claude Project Context" button. Added Session 5. |
| `dashboard/vite.config.js` | Vite config with `/onboarding` proxy to `localhost:3000` so the dev server forwards onboarding API calls to the webhook server. Added Session 5. |

### Scripts

| File | What it does |
|---|---|
| `scripts/verify-integrations.js` | Live smoke tests against Supabase (service + anon), Anthropic, Dropbox, Frame.io v2 and v4. |
| `scripts/verify-clickup.js` | Tests ClickUp API access against the Austin list and retrieves custom field IDs. |
| `scripts/test-pipeline-folders.js` | End-to-end Dropbox folder creation test. |
| `scripts/test-qa-agent.js` | End-to-end QA test with a seeded SRT. |
| `scripts/test-research-agent.js` | End-to-end research test with synthetic video data. |
| `scripts/test-performance-agent.js` | End-to-end performance test with seeded synthetic rows. |
| `scripts/seed-editors.js` | Inserts Charles Williams and Tipra into `editors` for Austin (Session 3). |
| `scripts/seed-test-student.js` | Inserts Alex Mathews into `students` for Austin and prints the `/onboard` URL (Session 5). |
| `scripts/get-dropbox-token.js` | One-off OAuth flow to obtain `DROPBOX_REFRESH_TOKEN` (Session 4). |
| `scripts/setup-dashboard-rls.sql` | Drops anon SELECT policies on `videos`, `editors`, `agent_logs`, `performance_signals`. Creates four `SECURITY DEFINER STABLE` RPC functions and grants `EXECUTE` to anon. Keeps the `research_library` unique index. Rewritten Session 5 (Codex Round 2 fix). |
| `scripts/migrate-students-onboarding.sql` | Adds 5 columns to `students`: `claude_project_context`, `onboarding_completed_at`, `handle_tiktok`, `handle_instagram`, `handle_youtube`. Session 5. |
| `scripts/migrate-onboarding-sessions.sql` | Creates `onboarding_sessions` table with 12 columns including `current_section`, `current_question_index`, `answers` jsonb, `influencer_transcripts` jsonb, `industry_report`, `conversation_history` jsonb, `probed_current` bool. Unique on (`student_id`, `campus_id`). Session 5. |
| `scripts/migrate-webhook-inbox.sql` | Creates `webhook_inbox` table: `event_type`, `payload` jsonb, `received_at`, `processed_at`, `failed_at`, `error_message`, `retry_count`. Partial index on unprocessed rows. Session 5. |

### Workflow SOPs

`workflows/scripting-agent.md`, `workflows/frame-io-share-link.md`, `workflows/self-healing-handler.md`, `workflows/openclaw-integration.md`, `workflows/fireflies-integration.md`, `workflows/mac-mini-deployment.md`, `workflows/e2e-test.md`, `workflows/handoff.md`. Each SOP is the source of truth for building or refactoring that component.

## Data flow

Two distinct entry flows now coexist: the concept lifecycle (filming event to client share link) and the onboarding flow (intake to context document).

### Concept lifecycle

1. **Filming event appears on Google Calendar.** External: Google Calendar. *Scripting Agent is a stub, so this step does not fire automatically.*
2. **Scripting Agent would generate 3 concepts.** Agent: `agents/scripting.js` (stub). External: Anthropic. Tables read: `students` (specifically `claude_project_context` populated by the Onboarding Agent), `performance_signals`, `research_library`. Tables written: `videos` (status `IDEA`), `processed_calendar_events` (planned). *Today Scott creates the ClickUp task manually in `idea` status.*
3. **Scott moves the task to `ready for shooting` in ClickUp.** External: ClickUp UI.
4. **ClickUp webhook fires `taskStatusUpdated`.** Handler: `handlers/clickup.js` verifies signature, inserts the payload into `webhook_inbox`, returns 200, then asynchronously calls `pipeline.handleStatusChange(taskId, 'ready for shooting', null)`. On success the inbox row is marked `processed_at`; on failure `failed_at` + `error_message`.
5. **Pipeline Agent creates Dropbox folders.** Agent: `agents/pipeline.js` → `createDropboxFolders()`. External: Dropbox. Tables read: `videos` (via `resolveTask`), `campuses`. Tables written: `videos.dropbox_folder`, `agent_logs`.
6. **Videographer uploads footage to the `[FOOTAGE]` subfolder.** External: Dropbox (manual).
7. **Footage detected and status bumped to `ready for editing`.** Agent: `agents/pipeline.js` → `handleFootageDetected()`. External: Dropbox `listFolder`, ClickUp `updateTask`. Tables: `videos.status`. *The Dropbox webhook handler does not yet call this; it must be invoked manually or via tests. Per `docs/decisions.md` 2026-04-01, production should wait 1 hour after detection.*
8. **Pipeline Agent assigns an editor.** Agent: `agents/pipeline.js` → `assignEditor()`. External: ClickUp (`assignees.add`). Tables read: `editors` (active for campus), `videos` (count of `IN EDITING` per editor, queried via `dbStatus`). Tables written: `videos.assignee_id`, `agent_logs`.
9. **Editor edits, exports, uploads to Frame.io, pastes the internal link into the ClickUp "E - Frame Link" field, moves the task to `edited`.** External: Premiere Pro, Frame.io, ClickUp (manual).
10. **QA Agent runs.** Agent: `agents/qa.js` → `runQA()`. External: Dropbox (SRT download, video temp link), Anthropic, FFmpeg (local), ClickUp (`addComment` on failure). Tables read: `videos`, `brand_dictionary`. Tables written: `videos.qa_passed`, `agent_logs`. **If FFmpeg is missing, the LUFS check returns an issue and QA fails.**
11. **If QA fails, status goes to `waiting` and a comment is posted.** Editor fixes and re-submits `edited` to retrigger.
12. **Scott reviews on Frame.io, approves, moves ClickUp to `done`.** External: Frame.io, ClickUp (manual).
13. **Pipeline Agent should create the client share link.** Agent: `agents/pipeline.js` → `case 'done'`. *Currently logs `done_received_noop` (Codex Round 1 fix). Spec for enabling: `workflows/frame-io-share-link.md`.*

### Onboarding flow

1. **Caiden seeds a student row.** `node scripts/seed-test-student.js` inserts Alex Mathews into `students` and prints the URL. Tables written: `students`.
2. **Caiden shares the URL with the student.** Form: `https://{host}/onboard?student=UUID&campus=UUID`.
3. **Student opens the URL.** UI: `dashboard/src/pages/Onboarding.jsx`. The page calls `GET /onboarding/student?studentId&campusId` to fetch the student's name and `onboarding_completed_at`.
4. **If already onboarded, the page shows "already complete" and stops.** Server-side completion guard in `server.js` enforces this for `POST /onboarding/message` as well.
5. **Page sends an empty POST to `/onboarding/message` to trigger the greeting.** Agent: `agents/onboarding.js` → `handleMessage`. Idempotent: returns the cached greeting if one already exists in `onboarding_sessions.conversation_history`.
6. **Server creates an `onboarding_sessions` row** if none exists for `(student_id, campus_id)`. Tables written: `onboarding_sessions`.
7. **One question at a time, six sections (Business Context, Personal Brand, Industry Authority, Audience, Content Creation, Industry Report).** Per turn the agent: validates the answer (vague answers trigger one probe via `probed_current`), persists the answer to `onboarding_sessions.answers`, and either advances the question index or generates an outro. Section 3 specifically: `parseInfluencers` extracts up to 5 handles or URLs from the student's reply, calls `tools/scraper.scrapeProfileVideos` for TikTok and Instagram (skips YouTube), persists results to `onboarding_sessions.influencer_transcripts` immediately so a subsequent crash does not lose them.
8. **After the last question, Section 6 generates an industry report.** Agent calls Claude with the niche and the influencer handle list, persists to `onboarding_sessions.industry_report`.
9. **Agent synthesizes the 8-section context document.** Single Claude call combining raw answers, influencer transcript content, and industry report. Output is markdown.
10. **Agent writes to `students` table.** `claude_project_context`, `onboarding_completed_at`, plus extracted social handles (`handle_tiktok`, `handle_instagram`, `handle_youtube`).
11. **UI shows the completion screen with a "Copy Claude Project Context" button.** Student or Caiden pastes the markdown into a Claude Projects project, which becomes the source for the (future) Scripting Agent.

## Topology: Supabase-only agent communication

Per CLAUDE.md, agents never call each other. They communicate through Supabase rows. The matrix below adds the new tables.

| Agent | Reads | Writes |
|---|---|---|
| Pipeline | `videos`, `campuses`, `editors` | `videos` (status, dropbox_folder, assignee_id), `agent_logs` |
| QA | `videos`, `brand_dictionary` | `videos.qa_passed`, `agent_logs` |
| Research | `campuses` (active), `research_library` (dedup check) | `research_library`, `agent_logs` |
| Performance | `campuses` (active), `performance`, `videos` (script column for transcripts), `research_library` | `performance_signals`, `agent_logs` |
| Onboarding | `students`, `onboarding_sessions`, `campuses` | `students` (claude_project_context, onboarding_completed_at, handle_*), `onboarding_sessions` (every turn), `agent_logs` |
| Scripting (stub) | `students`, `performance_signals`, `research_library` (planned) | `videos`, `processed_calendar_events` (planned) |

The `webhook_inbox` table is written and read by `handlers/clickup.js` only. It is not an agent table.

The Pipeline Agent calls `qa.runQA` inline from its `edited` case; this is the one in-process exception to the "agents never call each other" rule. It happens in the same Node process, not via the database.

## Cron schedule

Registered in `server.js` via `lib/scheduler.js` on server boot.

| Job name | Cron | What it does | Registered in |
|---|---|---|---|
| `research-agent` | `0 6 * * *` | Daily 6 AM. Calls `research.runAll()` per active campus. | `server.js` line 172 |
| `performance-agent` | `0 7 * * 1` | Every Monday 7 AM. Calls `performance.runAll()` per active campus. | `server.js` line 174 |

No Scripting Agent, Onboarding Agent, Fireflies, or OpenClaw cron is registered. The Onboarding Agent runs on demand from the `/onboard` page, not on a schedule. Fireflies and OpenClaw are spec'd in workflow SOPs but not built.

## Webhook map

All three inbound webhooks verify HMAC-SHA256 over the raw body with timing-safe comparison and length-mismatch guards (Session 1 hardening).

| Route | Method | Signature header | Handler | Routes to | Webhook inbox? |
|---|---|---|---|---|---|
| `/webhooks/clickup` | POST | `X-Signature` (secret: `CLICKUP_WEBHOOK_SECRET`) | `handlers/clickup.js` | `pipeline.handleStatusChange(taskId, newStatus, null)` | Yes. Insert before 200, mark processed/failed after async work. |
| `/webhooks/dropbox` | POST | `X-Dropbox-Signature` (secret: `DROPBOX_APP_SECRET`) | `handlers/dropbox.js` | Logs only. TODO: route to `pipeline.handleFootageDetected`. | No. TODO. |
| `/webhooks/dropbox` | GET | n/a (challenge query param) | `server.js` inline | Echoes `challenge` as text. | n/a |
| `/webhooks/frameio` | POST | `X-Frameio-Signature` (secret: `FRAMEIO_WEBHOOK_SECRET`) | `handlers/frameio.js` | Logs `comment.created`. TODO: trigger ClickUp `waiting`. | No. TODO. |
| `/onboarding/message` | POST | n/a (no signature; relies on student/campus UUIDs as opaque tokens) | `server.js` inline | `onboarding.handleMessage`. Completion guard fires first via `students.onboarding_completed_at`. | No. State lives in `onboarding_sessions`. |
| `/onboarding/student` | GET | n/a | `server.js` inline | Reads `students.name` and `students.onboarding_completed_at`. Returns `{ id, name, onboardingCompleted }`. | No. |
| `/health` | GET | n/a | `server.js` inline | Returns `{ status: 'ok', timestamp }`. | n/a |

The orchestrator endpoint `/orchestrator/trigger` described in `workflows/openclaw-integration.md` is not yet built.

## Error handling topology

Layered from inside to outside.

1. **Per-agent try/catch.** Every top-level agent function wraps its body in try/catch and calls `logger.log` with status `error` BEFORE rethrowing. Confirmed in `agents/pipeline.js`, `agents/qa.js`, `agents/research.js`, `agents/performance.js`, `agents/onboarding.js`, and the `agents/scripting.js` stub. This is CLAUDE.md rule 1.
2. **Logger isolation.** `lib/logger.js` wraps the Supabase insert in its own try/catch so a DB write failure never crashes the agent.
3. **Webhook inbox durable processing (ClickUp).** `handlers/clickup.js` follows a four-step pattern:
   - Verify signature. Reject with 401 on failure.
   - Insert raw payload into `webhook_inbox`. If insert fails, return 500 so ClickUp retries.
   - Return 200 to ClickUp. The event is now durable.
   - Process asynchronously. On success: `UPDATE webhook_inbox SET processed_at = now() WHERE id = inboxId`. On failure: `UPDATE webhook_inbox SET failed_at = now(), error_message = ..., retry_count = 1 WHERE id = inboxId`.
   This pattern was added in Session 5 (Codex Round 2 fix). Failed events are preserved in the inbox for inspection or replay rather than silently lost.
4. **Webhook handler 200-fast (legacy).** `handlers/clickup.js` returns 200 immediately after the inbox insert. This stops the ClickUp retry storm fixed in Session 4 (~15 duplicates per status change).
5. **Onboarding endpoint try/catch.** `POST /onboarding/message` and `GET /onboarding/student` in `server.js` wrap their bodies and log errors before responding 500. Failed onboarding turns return a JSON error to the chat UI without losing the session state, since session state is persisted between turns.
6. **Express route error middleware.** `server.js` 4-arg `app.use((err, _req, res, _next) => ...)` logs and returns 500 for synchronous throws.
7. **`process.on('unhandledRejection')`.** `server.js` catches orphan async rejections.
8. **Self-healing handler (planned, not built).** CLAUDE.md specifies a Claude-driven diagnose-and-retry-once layer that escalates to a ClickUp comment on failure. Spec in `workflows/self-healing-handler.md`.
9. **PM2 last line of defense.** `ecosystem.config.js` restarts on crash with exponential backoff, capped at 10 restarts and 512MB memory.

Localized recoveries that bypass the general path:
- `lib/dropbox.js` retries any 401 once with a fresh access token via `DROPBOX_REFRESH_TOKEN`. Token expiry never reaches the logger.
- `agents/qa.js` LUFS check fails closed when FFmpeg is missing. Logged at `error` status. Requires operator action (install FFmpeg) to unblock.

## Multi-tenant design

`campus_id` is on every domain table. Enforcement layers as of Session 5:

1. **Column constraint.** Every row in `videos`, `agent_logs`, `editors`, `performance`, `performance_signals`, `research_library`, `brand_dictionary`, `students`, `onboarding_sessions` carries `campus_id uuid references campuses(id)`. No row exists without one.
2. **RLS on data tables: anon cannot SELECT directly.** `scripts/setup-dashboard-rls.sql` drops the previous `anon_read_*` policies on `videos`, `editors`, `agent_logs`, `performance_signals`. The Codex Round 2 finding was that `USING (campus_id IS NOT NULL)` was not actually tenant scoping; it required only that the column be set, which every row satisfies. The replacement keeps anon SELECT only on `campuses` (active = true), which is needed to populate the dashboard's campus selector and carries no cross-tenant risk.
3. **`SECURITY DEFINER` RPC functions own all anon reads.** Four functions, each requires a `p_campus_id` parameter:
   - `get_campus_videos(p_campus_id uuid)`
   - `get_campus_agent_logs(p_campus_id uuid, p_limit integer DEFAULT 50)`
   - `get_campus_editors(p_campus_id uuid)`
   - `get_campus_performance_signals(p_campus_id uuid, p_limit integer DEFAULT 4)`
   All are `LANGUAGE sql SECURITY DEFINER STABLE`. `EXECUTE` is granted to `anon`. The functions filter by `campus_id = p_campus_id` internally; there is no path for anon to query without the parameter. `dashboard/src/lib/hooks.js` calls these via `sb.rpc('get_campus_videos', { p_campus_id: campusId })` and friends. If `campusId` is falsy, the hook returns empty data without an RPC call.
4. **Service role bypass for agents.** `lib/supabase.js` uses the service role key, which bypasses RLS entirely. Agents are responsible for filtering. Every agent query includes `.eq('campus_id', campusId)`. The Onboarding Agent additionally scopes `students` and `onboarding_sessions` lookups by `(student_id, campus_id)` so a forged URL with a real student ID but the wrong campus is rejected.
5. **Pipeline `resolveTask` guardrail.** `agents/pipeline.js resolveTask()` looks up campus by `campuses.clickup_list_id` matching the incoming task's list ID. If no campus maps, it logs and throws. The earlier `LIMIT 1` fallback was removed in Session 3 Codex Round 1 to prevent cross-tenant data corruption.
6. **Dropbox path scoping.** Folders are created under `campuses.dropbox_root`. Campus footage stays physically separated.

Austin is currently the only active campus. Its `clickup_list_id` is `901707767654`, confirmed in Session 3.

## Out of scope for Phase 1

Per SOW Section 2 "Out of Scope":

- **Premiere Pro automation.** Project creation, footage ingestion, timeline assembly, base editing, color transform, transcription, audio processing. Phase 2.
- **Any integrations not listed in SOW Section 2 Integrations.** ClickUp, Dropbox, Frame.io, Google Calendar, Fireflies are the only supported integrations. New integrations require a change order.
- **Ongoing content creation or campaign execution.** This system is the operational layer, not a content team.
- **Training or onboarding of Client staff beyond system handoff documentation.** The recorded walkthrough is the training artifact.

Adjacent items not yet built but in-scope per SOW Section 2:
- Self-healing error handler (`workflows/self-healing-handler.md`)
- OpenClaw deployment (`workflows/openclaw-integration.md`)
- Mac Mini configuration (`workflows/mac-mini-deployment.md`)
- Frame.io share link on `done` (`workflows/frame-io-share-link.md`)
- Scripting Agent body
- Fireflies integration (`workflows/fireflies-integration.md`) is in SOW Section 2 Integrations as "existing integration"; the in-repo addition runs alongside Scott's `fireflies_sync.py` per CLAUDE.md Gotchas.

The Student Onboarding Agent (`agents/onboarding.js`) is not listed in SOW Section 2 but was added in Session 5 to unblock the Scripting Agent. SOW Section 4 lists "Student data sheet (Claude project context per student)" as a Client Responsibility; the Onboarding Agent automates the Client side of that responsibility.

## Known gotchas (from CLAUDE.md and Session 5)

- **`videos.qa_passed` column** was missing from the original schema. Added during initial migration per `docs/decisions.md` 2026-04-01. Default `null` distinguishes "not yet checked" from "checked and failed".
- **Frame.io v4 vs v2.** v4 requires Adobe OAuth Server-to-Server. The current developer token only authenticates against v2. Decision 2026-04-02 commits to v2 for all agent integrations until v4 prerequisites are met.
- **Scott's `fireflies_sync.py` runs at 9 PM nightly.** The planned integration in `workflows/fireflies-integration.md` runs at 10 PM and writes to a new `meeting_transcripts` table. Do not replace Scott's script.
- **Dropbox desktop sync is live for the team.** Agent code only uses the Dropbox API and never touches local sync state.
- **ClickUp statuses are lowercase in the API, uppercase in Supabase.** `agents/pipeline.js` line 20 exposes `dbStatus(s) => s.toUpperCase()`. ClickUp reads and writes use lowercase. Supabase status reads, writes, and queries funnel through `dbStatus`. **The dashboard now stores statuses uppercase too** so that comparisons against `videos.status` work without translation. `dashboard/src/components/PipelineView.jsx` and `QAQueue.jsx` use `IDEA`, `READY FOR SHOOTING`, `EDITED`, `WAITING`, etc. throughout, with `statusLabel(s) => s.toLowerCase()` for display. Anyone editing dashboard code must keep this convention.
- **Google Calendar event format is unconfirmed.** Scripting Agent is blocked on this plus the student context approach. Onboarding Agent now resolves the context blocker; calendar format is still pending.
- **ClickUp custom field IDs are list-scoped.** Discovered in Session 3 for the Austin list (`901707767654`): "E - Frame Link" `53590f25-d850-4c19-8c7a-7b005904e04a`, "Dropbox Link" `d818eb86-41ce-416f-98aa-b1d92f13459f`, "Internal Video Name" `6e3fde3f-250f-470a-b88f-b382c599e998`, "Project Description" `8799f3b7-3385-4f9f-9a1b-b8872ecc78f4`, "Editor" `62642aae-d92d-49e9-a4fc-a17c137cdbe0`. **A second campus requires re-fetching every ID.**
- **FFmpeg must be installed on the Mac Mini before QA can pass.** `agents/qa.js` LUFS check now fails closed when FFmpeg is missing (Session 5 Codex Round 2). Without FFmpeg, every `edited` task hits the QA gate, gets `qa_passed = false`, and a comment is posted to ClickUp. `server.js` boot sequence runs `ffmpeg -version` and logs a warning to `agent_logs` if missing, but the warning alone does not block startup. `workflows/mac-mini-deployment.md` Phase 1 Step 6 installs FFmpeg via Homebrew.
- **Dropbox and Frame.io webhook handlers do not yet write to `webhook_inbox`.** Only `handlers/clickup.js` uses the durable inbox pattern. If a Dropbox or Frame.io event fails processing, the event is currently dropped. Update both handlers to mirror the ClickUp pattern when they are wired to actual routing.
- **Onboarding URL has no signature.** `/onboarding/message` accepts any well-formed request with valid `studentId` and `campusId`. The student ID UUID acts as an opaque token. If a URL leaks, an attacker could complete or read another student's onboarding. The completion guard prevents overwrite of completed onboardings, but the in-progress conversation could be polluted. TODO: verify whether Caiden wants to add a per-session token before broad rollout.

## TODOs

- **Dropbox webhook → Pipeline wiring.** `handlers/dropbox.js` logs events but does not call `pipeline.handleFootageDetected`. TODO: verify when this lands and update this doc.
- **Frame.io `comment.created` → ClickUp `waiting`.** `handlers/frameio.js` case is a TODO stub.
- **Webhook inbox coverage for Dropbox and Frame.io.** Mirror the ClickUp handler pattern when those handlers gain routing logic.
- **Onboarding URL signing.** Decide whether to add a per-session token to the URL or keep the UUID-as-token model.
- **Google Calendar event format.** Still unconfirmed with Scott. Blocks Scripting Agent ship.
- **Mac Mini cutover.** `workflows/mac-mini-deployment.md` is the playbook; cutover not yet executed. Webhook server still on Win11 + ngrok.
- **Self-healing handler.** Spec written, code not built.
- **Scripting Agent body.** Spec written, body is a stub. Now unblocked because the Onboarding Agent populates `students.claude_project_context`.

---

## Diff summary vs. previous version

The previous architecture.md described five agents and treated dashboard reads as direct table queries gated by `campus_id IS NOT NULL` RLS. This rewrite captures Session 5 in five concrete shifts. First, a sixth agent: the Student Onboarding Agent at `agents/onboarding.js` plus the `/onboard` page in the dashboard, with a six-section Claude-driven flow whose state lives entirely server-side in `onboarding_sessions`. Second, the RLS architecture is now `SECURITY DEFINER` RPC functions (`get_campus_videos`, `get_campus_agent_logs`, `get_campus_editors`, `get_campus_performance_signals`); anon role no longer has SELECT on data tables. Third, the ClickUp webhook handler now persists every event to `webhook_inbox` before returning 200 and updates `processed_at` or `failed_at` after async processing, so failed events survive instead of being dropped. Fourth, the QA Agent's LUFS check fails closed when FFmpeg is missing instead of skipping silently, and `server.js` runs an FFmpeg startup health check. Fifth, the dashboard now stores and compares statuses in uppercase (`IDEA`, `EDITED`, `WAITING`) to match the `dbStatus()` writes, with `statusLabel()` for display. The previous version's "delivered beyond scope" speculation (Pipeline Age Dashboard View, Content Performance Agent as a separate component) is removed; only items confirmed in code are documented. The new SOW PDF (`docs/Limitless_SOW (1).pdf`) is now grounded against, with explicit Section 2 / Section 3 / Section 9 references replacing the prior "TODO: verify SOW PDF" note.

---

Word count: 4254
