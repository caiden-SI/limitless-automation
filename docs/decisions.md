# Decision Log — Limitless Media Agency Automation

Format: Date | Decision | Rationale | Status

---

### 2026-04-01 | Schema gap: `qa_passed` column missing from `videos` table

**Decision:** Add `qa_passed boolean default null` to `videos` table during initial migration.

**Rationale:** agents.md specifies the QA Agent writes `qa_passed` to the `videos` table, but schema.md does not include this column. Default null (rather than false) distinguishes "not yet checked" from "checked and failed."

**Status:** Pending — add to migration script.

---

### 2026-04-01 | Project structure follows WAT framework

**Decision:** Organize codebase into `workflows/`, `agents/`, `tools/`, `handlers/`, `lib/` directories.

**Rationale:** CLAUDE-WAT.md specifies the WAT architecture (Workflows, Agents, Tools). `handlers/` added for webhook routing (not agent logic). `lib/` added for shared utilities (Supabase client, Claude client, logger).

**Status:** Done.

---

### 2026-04-01 | Express.js for webhook server, not Fastify or Hono

**Decision:** Use Express.js as specified in project docs.

**Rationale:** Explicitly stated in CLAUDE.md, integrations.md, and the tech stack table. Team familiarity and PM2 compatibility confirmed.

**Status:** Done.

---

### 2026-04-01 | Webhook signature verification required for all inbound routes

**Decision:** Verify signatures on all webhook endpoints before processing payloads.

**Rationale:** integrations.md specifies ClickUp sends a signature header, Dropbox sends a challenge on registration, and Frame.io sends a signature. Processing unverified payloads is a security risk.

**Status:** Scaffolded in handler stubs. Implementation pending per-integration.

---

### 2026-04-01 | Logger writes to both console and Supabase `agent_logs`

**Decision:** All agent activity logged to `agent_logs` table AND console (for PM2 log access).

**Rationale:** Error handling spec requires full error context in `agent_logs` before recovery attempts. Console logging preserved for PM2 `pm2 logs` debugging.

**Status:** Scaffolded in lib/logger.js.

---

### 2026-04-01 | Dropbox file detection uses 1-hour delay

**Decision:** After detecting new files in a Dropbox footage folder, wait 1 hour before triggering status change to "ready for editing".

**Rationale:** integrations.md recommends 1-hour delay to allow full Dropbox sync across all team members' machines. Triggering immediately could assign an editor before footage is available locally.

**Status:** Noted in Pipeline Agent spec. Implementation pending.

---

### 2026-04-02 | Frame.io: Use v2 API now, plan v4 migration later

**Decision:** Build all Frame.io agent integrations against the **v2 API** (`https://api.frame.io/v2/`) using the existing developer token (`fio-u-*`). Document the v4 migration path below so we can switch when ready.

**Rationale:** The v4 API requires Adobe OAuth Server-to-Server credentials issued through Adobe Developer Console. Our current developer token authenticates against v2 but returns 401 on all v4 endpoints. Setting up v4 requires Adobe org-level prerequisites (Frame.io provisioned on the Adobe org, Admin/Developer role, product profile assignment) that are outside our control and need Scott's involvement. The v2 API covers all endpoints we need today: asset upload, comments, share links. Building on v2 now avoids blocking the Pipeline and QA agents.

**v4 migration will be required if:** Adobe deprecates v2, or we need v4-only features (workspace-level access controls, Adobe I/O Events for webhooks instead of Frame.io native webhooks).

---

#### Frame.io v4 Setup Instructions (Adobe OAuth Server-to-Server)

When ready to migrate, follow these steps exactly:

**Prerequisites (Scott or Adobe org admin must complete):**

1. **Verify Adobe org has Frame.io provisioned.** Log in to [Adobe Admin Console](https://adminconsole.adobe.com/) → Products. Frame.io must appear as a provisioned product. If it does not, the org admin must add it (requires an active Frame.io Enterprise or Team plan linked to the Adobe org).

2. **Ensure the developer has the correct role.** The person creating the credential needs **Developer** or **System Administrator** role in Adobe Admin Console → Users.

3. **Confirm the Frame.io account is on Adobe identity.** If the team still logs in at `app.frame.io` with email/password (not Adobe SSO), the account has not been migrated. Migration is initiated by Frame.io/Adobe — contact Adobe support if needed.

**Adobe Developer Console Setup:**

4. Go to [Adobe Developer Console](https://developer.adobe.com/console/) and sign in with the Adobe org account.

5. Click **Create new project** → give it a name (e.g., "Limitless Automation").

6. In the project, click **+ Add to Project** → **API**.

7. Find **Frame.io** in the API list (under Creative Cloud). If it does not appear, Frame.io is not provisioned on the org (see prerequisite 1). Select it and click **Next**.

8. Choose **OAuth Server-to-Server** as the credential type. Give the credential a name (e.g., "limitless-automation-server").

9. Select the required **product profiles** — these control what Frame.io data the credential can access. Select the profile that includes "Scott's Account" / the team workspace where video assets live.

10. Click **Save configured API**.

11. On the credential overview page, copy:
    - `client_id` (also called "API Key")
    - `client_secret` (click "Retrieve client secret")

**Generate an Access Token:**

12. Request a token from Adobe IMS:

```bash
curl -X POST 'https://ims-na1.adobelogin.com/ims/token/v3' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&grant_type=client_credentials&scope={SCOPES}'
```

Scopes will be shown on the credential overview page in Adobe Developer Console after setup. They typically include the Frame.io-specific scopes assigned via product profiles.

13. The response returns:
```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer",
  "expires_in": 86400
}
```

**Token is valid for 24 hours.** There is no refresh token in the client_credentials flow — request a new token when the current one expires or on 401. Cache the token; Adobe throttles integrations that request tokens too frequently.

**Update .env:**

14. Add to `.env`:
```
FRAMEIO_V4_CLIENT_ID=<client_id from step 11>
FRAMEIO_V4_CLIENT_SECRET=<client_secret from step 11>
```

15. Build a token manager in `lib/frameio-auth.js` that:
    - Calls the IMS token endpoint with client credentials
    - Caches the token in memory
    - Re-requests on expiry or 401
    - Returns the Bearer token for v4 API calls

**Verify v4 Access:**

16. Test with:
```bash
curl -H "Authorization: Bearer {ACCESS_TOKEN}" https://api.frame.io/v4/accounts
```

A 200 response with account data confirms v4 is working.

**Webhook migration note:** v4 webhooks use **Adobe I/O Events** (registered in Developer Console → Add Event Registration → Frame.io Events) instead of the v2 `POST /v2/hooks` endpoint. This changes how the QA agent's comment trigger is set up — it will need an Adobe I/O Events subscription rather than a direct Frame.io webhook.

**Key differences between v2 and v4:**

| | v2 (current) | v4 (future) |
|---|---|---|
| Base URL | `https://api.frame.io/v2` | `https://api.frame.io/v4` |
| Auth | `Bearer fio-u-*` developer token | `Bearer eyJ...` Adobe IMS token |
| Token lifetime | Long-lived | 24 hours (re-request via client_credentials) |
| Token source | developer.frame.io | Adobe IMS `ims-na1.adobelogin.com/ims/token/v3` |
| Webhooks | Frame.io native (`POST /v2/hooks`) | Adobe I/O Events |
| Resource model | Teams → Projects → Assets | Orgs → Accounts → Workspaces → Projects → Assets |

**Status:** v2 chosen for now. v4 migration path documented. Requires Scott to verify Adobe org prerequisites (steps 1-3) before we can proceed.

---

### 2026-04-02 | Scripting Agent blocked — student context approach under review

**Decision:** Do not build the Scripting Agent until Scott confirms how student context will be collected and stored. Research and Performance agents proceed as planned.

**Rationale:** The `students` table has a `claude_project_context` field intended to give the Scripting Agent per-student context for script generation. However, this field may have incomplete or placeholder data — the approach for collecting and maintaining student context (manual entry, intake form, interview notes, etc.) has not been finalized with Scott. Building the Scripting Agent against unreliable context data would produce low-quality script output and require rework.

**Blocked on:** Confirmation from Scott on:
1. What data populates `students.claude_project_context` (source and format)
2. Whether the current data is complete enough to generate scripts against
3. Preferred collection method going forward

**Status:** Blocked — awaiting Scott's input. Research Agent and Performance Agent are unblocked and proceed on schedule.

---

### 2026-04-03 | ClickUp status names corrected — lowercase, different names

**Decision:** Update all ClickUp status references across the entire codebase to match the real ClickUp workspace statuses confirmed by Scott.

**Rationale:** The original status names were uppercase guesses (IDEA, READY FOR SHOOTING, READY FOR EDITING, IN EDITING, EDITED, NEEDS REVISIONS, DONE). Scott confirmed the real statuses are lowercase and use different names in some cases. The correct mapping is:

| Old (incorrect) | New (correct) |
|---|---|
| IDEA | idea |
| READY FOR SHOOTING | ready for shooting |
| READY FOR EDITING | ready for editing |
| IN EDITING | in editing |
| EDITED | edited |
| _(n/a)_ | uploaded to dropbox |
| NEEDS REVISIONS | waiting |
| DONE | done |
| _(new)_ | sent to client |
| _(new)_ | posted by client |

Key semantic changes: "EDITED" maps to "edited" (lowercase, same meaning — QA trigger). "NEEDS REVISIONS" is now "waiting" (generic hold state). "uploaded to dropbox" is a new status distinct from "edited". Two additional new statuses: "sent to client" and "posted by client".

**Files updated:** CLAUDE.md, agents/pipeline.js, agents/qa.js, agents/scripting.js, handlers/frameio.js, dashboard/src/components/PipelineView.jsx, dashboard/src/components/QAQueue.jsx, dashboard/src/lib/hooks.js, scripts/test-pipeline-folders.js, scripts/test-qa-agent.js, scripts/test-performance-agent.js, docs/architecture.md, docs/build-order.md, docs/integrations.md, docs/decisions.md.

**Status:** Done.

---

### 2026-04-03 | Editors table seeded for Austin campus

**Decision:** Seed the `editors` table with the two active editors for the Austin campus.

**Rationale:** Scott confirmed the editor roster during the April 3 meeting. The Pipeline Agent's `assignEditor()` function requires editor rows to assign work by lowest active task count. Without seeded editors, the agent logs a warning and skips assignment.

**Editors seeded:**
| Name | ClickUp User ID | Email |
|---|---|---|
| Charles Williams | 95229910 | charles@limitlessyt.com |
| Tipra | 95272148 | arpitv.tip@gmail.com |

Both set to `active = true`, `campus_id` = Austin campus UUID (`0ba4268f-f010-43c5-906c-41509bc9612f`).

**Status:** Done — seed script created at `scripts/seed-editors.js`.

---

### 2026-04-03 | QA trigger status corrected to "edited"

**Decision:** The QA Agent trigger status is "edited", not "uploaded to dropbox". These are two separate statuses in ClickUp.

**Rationale:** The initial status migration incorrectly mapped the old "EDITED" status to "uploaded to dropbox". Scott confirmed the actual QA trigger is "edited" (lowercase) — a separate status. "uploaded to dropbox" exists in the pipeline but does not trigger QA. The full status list is now: idea, ready for shooting, ready for editing, in editing, edited, uploaded to dropbox, sent to client, posted by client, done, waiting.

**Status:** Done.

---

### 2026-04-03 | Codex adversarial review — 4 fixes applied

**Decision:** Fix all 4 issues identified by the Codex adversarial review of the full codebase.

**Findings and changes:**

1. **[CRITICAL] Dashboard RLS — blanket anon access removed** (`scripts/setup-dashboard-rls.sql`)
   Old policies granted unrestricted `SELECT` on `videos`, `agent_logs`, and `performance_signals` to the `anon` role, exposing all data across campuses. Replaced with policies that require `campus_id IS NOT NULL`, so the dashboard must always filter by campus_id. Campuses table retains `active = true` filter (no cross-tenant risk). Editors table now requires both `active = true` AND `campus_id IS NOT NULL`.

2. **[CRITICAL] Pipeline resolveTask() — first-campus fallback removed** (`agents/pipeline.js`)
   When an incoming ClickUp webhook referenced a list ID not mapped to any campus, the code silently fell back to the first campus in the database. This could cause cross-tenant data corruption. Now logs the error and throws, rejecting the webhook with a clear message indicating which list ID needs to be configured.

3. **[HIGH] Pipeline done handler — disabled until createShareLink() is implemented** (`agents/pipeline.js`)
   The `done` status case previously called `createShareLink()`, which was a stub (TODO + log). This meant the final delivery action silently did nothing. Now logs `done_received_noop` and takes no action. TODO comment preserved with the 4-step implementation plan for when Frame.io share link creation is built.

4. **[MEDIUM] Dashboard campus selector — render-time state mutation fixed** (`dashboard/src/App.jsx`)
   `setCampusId()` was called during render whenever `campusId` was falsy, which made "All Campuses" mode unreachable and violated React's rules. Moved to a `useEffect` with an `initialized` guard so auto-selection only happens on first load. Selecting "All Campuses" (null) now persists correctly.

**Status:** Done — code changes applied. RLS SQL must be run manually in Supabase SQL Editor.

---

### 2026-04-07 | Codex adversarial review round 2 — 4 fixes applied

**Decision:** Fix all 4 issues identified by the second Codex adversarial review (full repo scan from root commit).

**Findings and changes:**

1. **[CRITICAL] RLS policies replaced with server-side RPC functions** (`scripts/setup-dashboard-rls.sql`)
   The `campus_id IS NOT NULL` RLS policy did not enforce tenant scoping — any anon client could query all campuses by omitting the filter. Replaced all anon SELECT policies (except campuses) with `SECURITY DEFINER` RPC functions that require a `campus_id` parameter: `get_campus_videos()`, `get_campus_agent_logs()`, `get_campus_editors()`, `get_campus_performance_signals()`. Dashboard hooks updated to call these RPCs instead of querying tables directly. Anon role can no longer SELECT from data tables.

2. **[HIGH] Webhook inbox for durable event processing** (`handlers/clickup.js`, `scripts/migrate-webhook-inbox.sql`)
   The handler was returning 200 before any durable processing, so failed automations were silently lost with no retry path. Now inserts the raw webhook payload into a `webhook_inbox` table before acknowledging. If the inbox insert fails, returns 500 so ClickUp retries. On processing failure, updates `failed_at` and `error_message` on the inbox row for investigation/replay. On success, sets `processed_at`.

3. **[HIGH] FFmpeg LUFS check fails closed** (`agents/qa.js`, `server.js`)
   When FFmpeg was missing, the LUFS check returned no issues, allowing videos to pass QA without audio validation. Now returns an explicit error issue (`LUFS: FFmpeg is not installed`) that blocks QA passage. Added FFmpeg availability check to server startup health checks — logs a warning on boot if FFmpeg is missing.

4. **[MEDIUM] Dashboard status casing unified to uppercase** (`dashboard/src/lib/hooks.js`, `dashboard/src/components/PipelineView.jsx`, `dashboard/src/components/QAQueue.jsx`, `dashboard/src/components/EditorCapacity.jsx`)
   The backend `dbStatus()` writes uppercase statuses to Supabase, but dashboard queries filtered for lowercase. Updated all status constants, filters, and comparisons to uppercase (EDITED, WAITING, IN EDITING, etc.). Added `statusLabel()` helper for display-friendly lowercase rendering in the UI.

**Migration required:** Run `scripts/migrate-webhook-inbox.sql` and `scripts/setup-dashboard-rls.sql` in Supabase SQL Editor.

**Status:** Done.

---

### 2026-04-07 | Onboarding agent: server-side session state (Codex adversarial review round 3)

**Decision:** Move all onboarding conversation state from client-supplied hidden HTML comments to a server-side `onboarding_sessions` table. Fix 4 issues identified by focused Codex adversarial review of the onboarding agent.

**Findings and changes:**

1. **[HIGH] Server-side session state replaces client-trusted hidden comments** (`agents/onboarding.js`, `scripts/migrate-onboarding-sessions.sql`)
   The original design embedded state in `<!-- STATE:{...} -->` HTML comments in assistant messages, passed back by the client on every request. A caller could forge state to skip sections, corrupt answer mapping, or force premature completion. Now all state lives in `onboarding_sessions` table: `current_section`, `current_question_index`, `answers` (jsonb), `influencer_transcripts` (jsonb), `industry_report`, `conversation_history` (jsonb). The client sends only `{ studentId, campusId, message }` — state is never read from or trusted from the client. Session is looked up by `student_id + campus_id` (unique constraint).

2. **[HIGH] Influencer transcripts persisted to session immediately** (`agents/onboarding.js`)
   Previously, `influencerResults` was a per-request local variable — populated only on the turn where `currentKey === 'influencers'`, then lost on the next request. The Apify-scraped transcripts were never available for final synthesis. Now `fetchInfluencerTranscripts()` results are written to `onboarding_sessions.influencer_transcripts` immediately after scraping. Synthesis reads from the persisted session column.

3. **[HIGH] Raw answers persisted after each turn** (`agents/onboarding.js`)
   Previously, answers were extracted from conversation history by parsing hidden state comments — fragile and client-dependent. Now each answer is written to `onboarding_sessions.answers` (jsonb key-value map) on every turn. Synthesis reads from this persisted object. The full conversation history is also persisted as an audit trail alongside the synthesized document.

4. **[MEDIUM] Completion guard on POST route** (`server.js`)
   The POST route now checks `students.onboarding_completed_at` before processing. If already set, returns `{ isComplete: true, contextDocument: existing claude_project_context }` immediately without reprocessing. Prevents overwrite of completed onboarding data.

**Architecture change:** The onboarding agent is no longer stateless. The `POST /onboarding/message` endpoint no longer accepts `conversationHistory` from the client. The React frontend sends only `{ studentId, campusId, message }` and displays messages locally for UX, but all authoritative state is server-side.

**Migration required:** Run `scripts/migrate-onboarding-sessions.sql` in Supabase SQL Editor.

**Status:** Done.

---

### 2026-04-15 | Onboarding URL auth deferred to retainer or Phase 2

**Decision:** Ship Phase 1 with the invite-link trust model. Scott sends each student a unique `/onboard?student=ID&campus=ID` URL. Anyone holding the link can impersonate that student. Add per-session signed tokens during retainer month one or Phase 2 if the threat model changes.

**Rationale:** The `/onboarding/message` endpoint accepts any well-formed `(studentId, campusId)` UUID pair. Server-side `onboarding_sessions` owns conversation state (closed via Session 5 Codex Round 3 issue #1), so a forged caller cannot tamper with the state shape. They can still pollute an in-progress conversation if they hold the URL. The completion guard prevents overwrite of finished onboardings, so blast radius is bounded to the in-flight session window.

**Mitigation:** Document in the Section 4 handoff notes so Scott knows before sharing onboarding links. No code changes in Phase 1.

**Status:** Deferred. Revisit during retainer month one or in Phase 2 SOW.

---

### 2026-04-22 | Brand voice validation — two-layer validator replaces BRAND_VOICE_EXAMPLES_PATH

**Decision:** Retire the single-file `BRAND_VOICE_EXAMPLES_PATH` approach. Replace with `lib/brand-voice-validator.js`: a deterministic universal quality floor (Layer 1 — AI-tell blocklist, brand dictionary, length bounds, hook presence, generic openers, payoff endings, proper-noun warnings) plus a Claude-as-judge voice fit gate (Layer 2 — tone-dimension scoring against the student's own onboarding-captured influencer transcripts). Three modes: `off`, `log_only` (default), `gate`. In gate mode, 3 consecutive voice aborts on the same `event_id` escalate the `processed_calendar_events` claim to `status=failed_cleanup` so the operator is forced to look.

**Rationale:** The original plan assumed one Scott-curated reference document could anchor voice for every student. Two problems surfaced before shipping it:
1. Voice is inherently per-student — a single reference pushes every student toward the same median tone, defeating the point.
2. Not every student uses scripts. Some record captions only, some record on-screen text only. A script-shaped reference doc doesn't apply.

The validator-side gate works because each student's `onboarding_sessions.influencer_transcripts` already captures their own stated voice reference during Section 3. That's the authoritative per-student signal — use it directly.

**Shipped in one PR, not split.** Both the generation prompt and the post-generation gate read from the same rule module (`lib/brand-voice-validator.js` constants + `buildGenerationConstraints()`). Two copies of rules drifting apart is the real source-of-truth risk; a single module serving both sides eliminates it.

**Consequences:**
- **Retired:** `BRAND_VOICE_EXAMPLES_PATH` env var removed from `.env.example` and `agents/scripting.js`. File-read code deleted from `loadContext`.
- **Prompt structure changed:** Scripting Agent now inlines two distinct sections (`HARD CONSTRAINTS` imperatives + `VOICE GUIDELINES` context) assembled by `buildGenerationConstraints(student)`.
- **New schema:** `students.content_format_preference` (check-constrained to `script|on_screen_text|caption_only|mixed`) + `video_quality_scores` table with per-concept Layer 1 / Layer 2 / overall results for calibration. Migration `scripts/migrations/2026-04-22-brand-voice-validation.sql`.
- **Retry budget stays at 2** per CLAUDE.md rule. Structural validation + Layer 1 + Layer 2 share one merged `lastError`.
- **Proper-noun check is always advisory** (`severity: 'warn'`, never gates `layer1_passed`) — a capitalized-word heuristic produces too many false positives to hard-fail on. SOP patched accordingly.
- **log_only summary comment** is posted once per event on the first inserted video's ClickUp task, not per concept. SOP patched.
- **Default mode is `log_only`.** Flipping to `gate` is a deliberate operator decision — never default implicitly.

**Follow-ups that stay open:**
- Onboarding Section 5 update to actually populate `content_format_preference` from student answers (currently defaults to `script` for every existing student).
- Threshold calibration once `video_quality_scores` has ≥20 rows. The current `standard = score≥4, loose = score≥3` values are defaults, not data-driven.
- Phase 2: tone dimension extraction via its own Claude pass (Phase 1 uses a deterministic keyword scan against `TONE_TAGS`).

**Status:** Done. Migration applied in Supabase SQL Editor. Test script `scripts/test-brand-voice-validation.js` covers all 11 SOP cases.

---

### 2026-04-23 | Fireflies integration replaces `fireflies_sync.py` rather than running alongside

**Decision:** The in-repo Fireflies Agent absorbs Scott's existing `fireflies_sync.py` script and retires it on delivery day. The agent owns both jobs: full transcripts → Supabase `meeting_transcripts`, and action items → ClickUp tasks (Austin list `901707767654`, status `idea`). Action item extraction uses a Claude pass over the transcript sentences — not a port of Scott's method. Cadence inherited: 9PM nightly.

**Rationale:** The original SOP split responsibilities (his script = action items to ClickUp, our agent = transcripts to Supabase) and scheduled our agent at 10PM to run after his 9PM script. That design has two failure modes:

1. **Duplicate ClickUp tasks.** Both consumers read the same Fireflies API and neither writes to a ledger the other reads. Any future expansion of our agent (or any accidental enablement of action-item handling on our side) immediately produces duplicate ClickUp tasks. The architectural seam is in the wrong place — action-item state needs to live in one ledger, not split across two cron-driven scripts.
2. **Dependency on Scott's machine.** His script runs on his host, on his schedule, with his credentials. If his machine goes down, the action-item workflow dies. The SOW commits to a delivered system; a critical path that requires Scott's personal cron to keep running is not a delivered system.

Consolidating into our agent puts dedup in one place (`created_action_items` table with `UNIQUE(fireflies_id, action_item_hash)`), puts monitoring in one place (`agent_logs`), and puts scheduling under PM2 where the rest of the pipeline already lives.

**Why Claude extraction, not port Scott's method:**
Scott's script likely uses regex or rule-based extraction (unconfirmed; we did not read it). A Claude pass over the transcript sentences catches implicit action-item phrasings ("Caiden will send Sarah the outline by Friday") that naïve rules miss, and produces cleaner task titles. The Fireflies GraphQL schema is public, ClickUp list/status conventions are already known from the Pipeline Agent build, and the extraction is self-contained — nothing about this integration actually requires reading Scott's source. The only coordination needed with him is a one-text API key parity check.

**Consequences:**
- **Schema addition:** `created_action_items` ledger alongside `meeting_transcripts`. Migration staged in `scripts/migrations/`.
- **`lib/fireflies.js` added:** GraphQL client only. Methods: `fetchRecentTranscripts(windowHours)`, `fetchTranscriptDetail(id)`.
- **`agents/fireflies.js` added:** orchestration layer that handles transcript ingest, calls Claude for action-item extraction, and creates ClickUp tasks. Retries ClickUp failures via pending-scan on the next run.
- **Cron moves from 10PM to 9PM.** No longer needs to wait behind Scott's script.
- **No seed pass.** The 48-hour pre-cutover overlap (where both scripts will have processed the same meetings) produces overlapping-but-not-identical tasks; operator archives Scott's old ones manually. Cheaper than building and rehearsing a seed script, and only happens once.
- **CLAUDE.md Gotcha rewritten** from "do not replace, integrate alongside" to "replaces on delivery day, confirm API key parity first."
- **Docs updated:** `workflows/fireflies-integration.md` (full rewrite), `docs/architecture.md` lines 227 and 235, `docs/integrations.md` Fireflies section, `docs/build-order.md` checklist item, `workflows/handoff.md` out-of-scope list.

**Pre-cutover blockers:**
- Text Scott to confirm `FIREFLIES_API_KEY` in `.env` matches the key his script authenticates with.
- Test ClickUp list provisioned for integration tests (so test runs don't pollute production Austin list).

**Status:** Spec updated, build pending. Cutover scheduled for Mac Mini delivery day alongside PM2 startup.
