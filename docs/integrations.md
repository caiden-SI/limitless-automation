# Integrations — Limitless Media Agency

All credentials stored in shared 1Password vault: "Limitless - Caiden"
All accounts owned by Limitless Media Agency LLC.

---

## ClickUp

**Purpose:** Task management and pipeline status tracking. Central hub for all video project state.
**API Docs:** https://clickup.com/api/
**Base URL:** `https://api.clickup.com/api/v2/`

**Key endpoints used:**
- `GET /task/{task_id}` — get task details
- `PUT /task/{task_id}` — update task status, fields, assignee
- `POST /list/{list_id}/task` — create new task
- `GET /list/{list_id}/task` — get all tasks in a list

**Webhook events to listen for:**
- `taskStatusUpdated` — fires when status changes
- `taskCreated` — fires when new task created

**Auth:** Personal API key in Authorization header
**Credential location:** 1Password → "ClickUp API Key"

**Notes:**
- List ID for Austin campus needs to be confirmed with Scott
- Custom field ID for Frame.io link needs to be retrieved via API on first run
- Task status names are case-sensitive — use exact strings from pipeline.md

---

## Dropbox

**Purpose:** File storage for footage and project files. Webhook triggers editing pipeline.
**API Docs:** https://www.dropbox.com/developers/documentation/http/documentation
**Base URL:** `https://api.dropboxapi.com/2/`

**Key endpoints used:**
- `POST /files/create_folder_v2` — create concept folder + subfolders
- `POST /files/list_folder` — check folder contents (file count)
- `POST /files/list_folder/longpoll` — or webhook for file changes

**Webhook events to listen for:**
- File added to `[FOOTAGE]` subfolder → trigger status change to ready for editing

**Auth:** App Key + App Secret (OAuth 2.0 flow or long-lived token)
**Credential location:** 1Password → "Dropbox App Key" + "Dropbox App Secret"

**Folder structure:**
```
/[campus-slug]/[concept-title]/[FOOTAGE]/
/[campus-slug]/[concept-title]/[PROJECT]/
```

**Notes:**
- Dropbox desktop sync is already set up and working for the team — do not interfere with this
- The existing Dropbox database Scott built needs to be reviewed before finalizing schema
- 1-hour delay recommended after footage upload before triggering editing pipeline (time for full sync)

---

## Frame.io

**Purpose:** Video review and client delivery.
**API Docs:** https://developer.frame.io/api/reference/
**Base URL:** `https://api.frame.io/v4/`

**Key endpoints used:**
- `POST /assets` — upload video
- `GET /assets/{asset_id}/comments` — check for review comments
- `POST /assets/{asset_id}/share_links` — create client share link

**Webhook events to listen for:**
- Comment created on asset → trigger "waiting" status change in ClickUp

**Auth:** API token (generated from developer.frame.io)
**Credential location:** 1Password → "Frame.io API Token"

**Notes:**
- Frame.io was acquired by Adobe — v4 API is current. Verify comment webhook behavior before building QA trigger.
- Caiden has been invited to "Scott's Account" team — accept invite and generate token from inside that account
- Internal Frame link goes into ClickUp custom link field
- Client share link goes directly to student

---

## Fireflies

**Purpose:** Meeting transcript and action item extraction. Scott's existing scripts already use this.
**API:** GraphQL at `https://api.fireflies.ai/graphql`
**Docs:** https://docs.fireflies.ai/

**Key queries used:**
- `transcripts` — fetch recent transcripts
- Filter by date range for last 48hrs (matching Scott's existing sync pattern)

**Auth:** API key in Authorization header
**Credential location:** 1Password → "Fireflies API Key"

**Notes:**
- Scott has a working `fireflies_sync.py` script that runs at 9PM nightly and creates ClickUp tasks from meeting action items. **That script is retired on delivery day.** Our in-repo Fireflies Agent replaces it and owns both jobs: full transcripts → Supabase `meeting_transcripts`, and action items → ClickUp tasks (Austin list `901707767654`, status `idea`).
- Our extraction uses Claude over the transcript sentences, not a port of Scott's regex/rule-based method. Claude catches implicit phrasings ("Caiden will send Sarah the outline") that rules miss.
- **Do not run both.** Running Scott's cron and our agent against the same Fireflies account produces overlapping ClickUp tasks for every meeting in the shared 48-hour window. Cutover procedure (disable his cron → enable ours) is in `workflows/fireflies-integration.md`.
- Pre-cutover check: text Scott to confirm `FIREFLIES_API_KEY` in our `.env` matches the key his script uses. That's the only thing that requires his input; everything else (ClickUp conventions, GraphQL schema) is already in our docs or public.
- **Build status (2026-04-24):** `lib/fireflies.js`, `agents/fireflies.js`, the migration `scripts/migrations/2026-04-24-fireflies-integration.sql`, and the integration test `scripts/test-fireflies-integration.js` are in place. The 9 PM cron is registered in `server.js` only when `FIREFLIES_CRON_ENABLED=true`. The migration has not been applied yet — run it manually in the Supabase SQL Editor before the first run. Two new tables: `meeting_transcripts` (one row per Fireflies transcript) and `created_action_items` (dedup ledger keyed on `fireflies_id` + `action_item_hash`).

---

## Google Calendar

**Purpose:** Trigger for Scripting Agent — fires when a student is scheduled for filming.
**API Docs:** https://developers.google.com/calendar/api/guides/overview
**Auth:** Service Account with Calendar API enabled

**Setup:**
1. Google Cloud Console → New project "Limitless Automation"
2. Enable Google Calendar API
3. Create Service Account → download credentials JSON
4. Share the relevant calendar with the service account email

**Key endpoints used:**
- `GET /calendars/{calendarId}/events` — poll for upcoming events
- Or use Google Calendar push notifications (webhooks) for real-time triggering

**Credential location:** 1Password → "Google Calendar Service Account JSON"

**Notes:**
- Trigger logic: when an event with a student name appears on the filming calendar, fire the Scripting Agent for that student
- Need to confirm with Scott: what does a filming calendar event look like? What's in the title/description? Does it include the student name explicitly?
- Google Calendar integration was confirmed as the preferred trigger in the kickoff meeting — replacing the idea of students self-initiating

---

## Supabase

**Purpose:** Central database. All agents read/write here.
**Dashboard:** https://supabase.com/dashboard
**Docs:** https://supabase.com/docs

**Connection:**
- Project URL: `https://[project-ref].supabase.co`
- Service Role Key: use for agent server-side calls (bypasses RLS)
- Anon Key: use for dashboard frontend

**Credential location:** 1Password → "Supabase URL" + "Supabase Service Role Key" + "Supabase Anon Key"

**Notes:**
- Scott created the Supabase org under scott@limitlessyt.com — Caiden invited as Owner
- Initial schema migration runs once to create all tables — see schema.md
- Enable RLS on all tables after initial setup

---

## Anthropic API

**Purpose:** Claude API calls for all agent intelligence.
**Console:** https://console.anthropic.com
**Docs:** https://docs.anthropic.com

**Model:** `claude-sonnet-4-20250514` for all agents

**Auth:** API key in x-api-key header
**Credential location:** 1Password → "Anthropic API Key"

**Notes:**
- Account created by Scott under Limitless billing — Caiden invited as member
- Initial credits added at account creation
- Monitor usage in console — estimated $50-150/month at current video volume
- This is completely separate from Claude.ai subscription

---

## Webhook Server

**Purpose:** Receives all inbound webhooks from ClickUp, Dropbox, Frame.io. Routes to correct handler.
**Runtime:** Express.js running on the production Mac Mini under PM2 (auto-restart, launchd boot persistence). Cut over from the Win11 dev box on April 30, 2026.
**Public URL:** `https://limitless-automations-mac-mini.tail15aca0.ts.net` (Tailscale Funnel; survives Mac Mini restarts).
**Port:** 3000 (or configurable via .env)

**Routes:**
```
POST /webhooks/clickup    → handlers/clickup.js
POST /webhooks/dropbox    → handlers/dropbox.js
POST /webhooks/frameio    → handlers/frameio.js
```

**Verification:**
- ClickUp sends a signature header — verify before processing
- Dropbox sends a challenge on webhook registration — handle the GET verification request
- Frame.io sends a signature — verify before processing

**Environment Variables (.env):**
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
CLICKUP_API_KEY=
CLICKUP_WEBHOOK_SECRET=
DROPBOX_APP_KEY=
DROPBOX_APP_SECRET=
DROPBOX_ACCESS_TOKEN=
FRAMEIO_API_TOKEN=
FRAMEIO_WEBHOOK_SECRET=
FIREFLIES_API_KEY=
GOOGLE_CALENDAR_CREDENTIALS_PATH=
PORT=3000
```

**Notes:**
- All sensitive values in .env — never commit to Git
- .env.example committed to repo with placeholder values
- PM2 ecosystem file manages process restart and environment loading
