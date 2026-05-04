# Dashboard Phase A — complete the monitoring foundation

Branch: `feature/dashboard-scoring-fix` (PR #6, still open) · single PR · ship-today scope.

## Goal

Take the Phase 5 / scoring-fix dashboard from "mostly works for monitoring" to
"comprehensively monitors every layer of the system with no false positives and
self-explanatory red signals." After Phase A lands, Scott can use the dashboard
unattended and trust that:

- Every red signal means something is *actively verified broken*, not "no
  activity, might be quiet."
- Every red signal has a corresponding action item explaining what to check.
- Every layer of the stack — network, transport, process, scheduling,
  application, hardware, output — has a representative pulse cell.

This PR closes the remaining philosophical gaps in the scoring-fix PR (the
time-based webhook tunnel detection) and adds the hardware/process layer
coverage that didn't exist before. It does not add work observation
(per-agent drilldown, "what was produced today" view) — that is Phase B.

## Pulse cell architecture after Phase A

The System Pulse strip expands from 5 cells to **8 cells**, each representing
one independent failure mode at one layer of the stack:

| # | Cell | Layer | Detection method |
|---|---|---|---|
| 1 | Webhook ingestion | Application transport | Failed/pending counts in `webhook_inbox` |
| 2 | Webhook tunnel | Network transport | Active outbound ping from Mac Mini through tunnel URL |
| 3 | Cron schedule | Work scheduling | `prevCronFire` per agent vs latest log |
| 4 | Worker errors | Application errors | `errors_last_hour` from `agent_logs` |
| 5 | Process manager | OS processes | Active `pm2 jlist` check on Mac Mini |
| 6 | FFmpeg | Toolchain | Active `ffmpeg -version` check on Mac Mini |
| 7 | Server resources | Hardware | Active disk + memory check on Mac Mini |
| 8 | Output quality | Application output | QA error rate (was Audio Normalization) |

**No cell is time-based after Phase A.** Every one is either an active health
ping (cells 2, 5, 6, 7), a positive event count (cells 1, 4, 8), or a
schedule-relative comparison (cell 3). Absence-of-activity never produces red.

## What to build

### 1. Mac Mini health-ping agent

Create `scripts/health-ping.js` — a single Node script that runs every 60
seconds via PM2 cron and writes one row per check to `agent_logs`. Each row
uses `agent_name = 'health'` and a distinct `action`:

| Action | Checks | Status logic |
|---|---|---|
| `ping_tunnel` | `fetch(TUNNEL_URL + '/health')` with 5s timeout | success on 2xx; error on timeout/non-2xx, with HTTP code or error message in `error_message` |
| `ping_pm2` | `pm2 jlist`, parse JSON, count any process with `status !== 'online'` | success if all online; error with comma-separated list of bad processes |
| `ping_ffmpeg` | `ffmpeg -version` exit code | success if 0; error with stderr in `error_message` |
| `ping_disk` | `df -k /` for root partition usage % | success if <85%; warning if 85–94%; error if ≥95%; usage % in `error_message` |
| `ping_memory` | `os.totalmem()` / `os.freemem()` | success if used <85%; warning if 85–94%; error if ≥95%; usage % in `error_message` |

The script runs all five checks in parallel, batches the inserts into one
`supabase.from('agent_logs').insert([...])` call, and exits. Uses the
service-role Supabase key (already in Mac Mini env). Reads `CAMPUS_ID` from
env.

### 2. Webhook server health endpoint

Add `GET /health` to whatever Express/HTTP route file the webhook server uses.
Returns 200 with body `ok`. Existing routes unchanged.

```js
app.get('/health', (req, res) => res.status(200).send('ok'))
```

### 3. PM2 cron configuration

Add a cron entry to PM2 (via `ecosystem.config.js` or system cron) running
`scripts/health-ping.js` every minute:

```
*/1 * * * *  cd /path/to/limitless-automation && node scripts/health-ping.js
```

Add `TUNNEL_URL` to the Mac Mini's environment if not already there (e.g. the
public Tailscale Funnel URL or ngrok URL pointing at port 3000). Document
required env in `.env.example`.

### 4. SQL RPC update

Update `get_campus_system_health_summary` in `scripts/setup-dashboard-rls.sql`
to expose new fields driving the new pulse cells. Use `DROP FUNCTION IF EXISTS`
before `CREATE OR REPLACE` since the return type is changing.

Add fields:

```sql
-- Tunnel ping
last_tunnel_ping_ok timestamptz,
tunnel_recent_failures integer,
tunnel_last_error text,

-- PM2
pm2_status text,           -- 'success' | 'warning' | 'error' | NULL if no recent ping
pm2_detail text,           -- error_message from latest ping_pm2 row

-- FFmpeg
ffmpeg_status text,        -- 'success' | 'error' | NULL
ffmpeg_detail text,

-- Disk + memory
disk_status text,
disk_detail text,
memory_status text,
memory_detail text
```

Each field reads from the most recent `agent_logs` row matching its
`(agent_name='health', action='ping_X')` pattern. `tunnel_recent_failures`
is `COUNT(*)` of error-status pings in the last 5 minutes.

Drop the old `last_lufs_measurement` and `ffmpeg_boot_check_status` field
*reads* from the SQL body — no longer used. Leave the columns in the return
type for backward compat if the agent prefers; they can return NULL.

### 5. Frontend — `lib/health.js`

Update `systemPulse()` to produce 8 cells in the order shown above. Each cell
is `{ id, label, pipLabel, state, detail, anchor }` where `state` is one of
`green` / `amber` / `red`.

**Cell rules:**

| Cell | Green | Amber | Red |
|---|---|---|---|
| Webhook ingestion | No `failed_at` in last hour AND oldest pending <60s | oldest pending 60s–5min | failed_at in last hour, no successful processing since |
| Webhook tunnel | `tunnel_recent_failures = 0` AND `last_tunnel_ping_ok` within last 5 min | `tunnel_recent_failures` 1–2, OR no successful ping in last 5 min (ping agent down) | `tunnel_recent_failures ≥ 3` |
| Cron schedule | All crons on schedule per `prevCronFire` rule | Any cron 2h–24h overdue | Any cron >24h overdue with prior log history |
| Worker errors | `errors_last_hour = 0` | 1–4 | ≥5 |
| Process manager | `pm2_status = 'success'` | `pm2_status = 'warning'` OR no recent ping | `pm2_status = 'error'` |
| FFmpeg | `ffmpeg_status = 'success'` | no recent ping | `ffmpeg_status = 'error'` |
| Server resources | both disk and memory `success` | either `warning` | either `error` |
| Output quality | `edited_video_count = 0` (gate not exercised) OR `qa_errors_24h = 0` | `qa_errors_24h = 1` | `qa_errors_24h ≥ 2` |

**Pip labels** (used by `OpsHeader.jsx`'s pip strip) — explicit to avoid
duplicate abbreviations:

| Cell | pipLabel |
|---|---|
| Webhook ingestion | INGEST |
| Webhook tunnel | TUNNEL |
| Cron schedule | CRON |
| Worker errors | ERRORS |
| Process manager | PM2 |
| FFmpeg | FFMP |
| Server resources | RES |
| Output quality | OUT |

### 6. Action items for every red pulse cell

In `actionItems()`, ensure every red cell produces a corresponding action item
so Scott always sees both *what* and *why*. The `webhook-fail`, `cron-miss`,
and `error-spike` categories already exist; add:

| Category | When | Headline | Detail |
|---|---|---|---|
| `tunnel-down` | Webhook tunnel red | "Tunnel verification failing — {n} consecutive ping failures" | Most recent `tunnel_last_error` (truncated to 120 chars) |
| `pm2-fail` | Process manager red | "PM2 process(es) not online" | `pm2_detail` (e.g. "fireflies: stopped, scripting: errored") |
| `ffmpeg-fail` | FFmpeg red | "FFmpeg not responding on Mac Mini" | `ffmpeg_detail` |
| `resources-fail` | Server resources red | "Mac Mini resources critical" | combined disk + memory detail (e.g. "disk 96%, memory 92%") |
| `output-quality` | Output quality red | "{n} QA errors in last 24h" | Most recent QA `error_message`, plus "Review QA queue at #qa-queue." |

All anchor to `#system-health`. Sort priority among the new categories: same
order as listed (tunnel before pm2 before ffmpeg before resources before
output) — infrastructure first, then output.

### 7. Frontend — `SystemHealthStrip.jsx`

Render 8 cells using the `pulse.cells` array. Detail line per cell per state:

| Cell | Green detail | Amber detail | Red detail |
|---|---|---|---|
| Webhook ingestion | "no failed webhooks in last hour" | "oldest pending {timeAgo}" | "{n} failed in last hour — see action items" |
| Webhook tunnel | "tunnel verified · last ping {timeAgo}" | "{n} ping failure(s) in last 5 min" or "no recent pings — check ping agent" | "tunnel down · {n} consecutive failures · {tunnel_last_error}" |
| Cron schedule | "all crons on schedule" | "{agent} {timeAgo} overdue" | "{agent} not fired in {timeAgo} — check scheduler" |
| Worker errors | "no errors in last hour" | "{n} errors in last hour" | "{n} errors in last hour — most: {top_agent}" |
| Process manager | "all PM2 processes online" | "no recent PM2 health ping" | "{pm2_detail}" |
| FFmpeg | "ffmpeg responding" | "no recent ffmpeg health ping" | "{ffmpeg_detail}" |
| Server resources | "disk + memory healthy" | "{component} elevated · {detail}" | "{component} critical · {detail}" |
| Output quality | "no EDITED videos yet — gate not exercised" or "no QA failures in last 24h" | "1 QA error in last 24h" | "{n} QA errors in last 24h — see QA queue" |

Detail lines ≤ 60 chars where possible.

### 8. Frontend — `OpsHeader.jsx` polish

- Pip strip uses each cell's `pipLabel` (no more `abbrev()` collisions).
- Add a "fresh as of" indicator near the LIVE pip. `useState` updates every
  second, comparing the most recent successful fetch timestamp from any data
  hook. Format: `updated 5s ago` or `updated 14:11` (relative below 60s,
  absolute above). If no successful fetch in last 60s, the LIVE pip turns
  amber and prefix changes to `stale`.

### 9. Action item phrasing tightening

In `actionItems()` for the `stuck` category and others, fix the existing
awkward phrasing like "3 stuck in idea IDEA: 3":

- Headline: always uppercase status. "3 videos stuck in IDEA" (singular form
  for n=1).
- Detail: only show per-status breakdown when stuck items span more than one
  status. Single-status case: replace with age info — "oldest stuck: 8 days".
  Multi-status case: keep "IDEA: 3 · IN EDITING: 2" pattern.

Audit other categories (`editor-overload`, `qa-fail`, `webhook-fail`,
`cron-miss`, `error-spike`) for similar redundancy. Each detail line should
add information, not repeat the headline.

### 10. Page wiring

Update `dashboard/src/pages/Ops.jsx` and `Pipeline.jsx` to pass the new
`pulse` shape (now with 8 cells) to `HealthBars` and `SystemHealthStrip`.
Phone-mode KPI row tones derived from action items, unchanged from prior PR.

## Files touched

All paths relative to repo root.

**New:**
- `scripts/health-ping.js` (Mac Mini agent)

**Modified:**
- Webhook server file with route definitions (add `/health` endpoint) — find
  whichever file owns Express routes
- `ecosystem.config.js` or PM2 config for the new cron entry
- `.env.example` — add `TUNNEL_URL` documentation
- `scripts/setup-dashboard-rls.sql` — RPC return type changes (DROP + CREATE)
- `dashboard/src/lib/health.js` — `systemPulse()` 8 cells, `actionItems()` 5 new categories
- `dashboard/src/components/SystemHealthStrip.jsx` — 8 cells, new detail strings
- `dashboard/src/components/OpsHeader.jsx` — pipLabel usage, freshness indicator
- `dashboard/src/pages/Ops.jsx` — pass new pulse shape
- `dashboard/src/pages/Pipeline.jsx` — pass new pulse shape

**Don't change:**
- `GrainBackground.jsx`, `Toolbar.jsx`, `lib/theme.js`, `lib/hooks.js`,
  `lib/supabase.js`, `AgentGrid.jsx`, `LiveEventStream.jsx`,
  `PipelineSummary.jsx`, `PipelineKanban.jsx`, `QAQueue.jsx`,
  `EditorCapacity.jsx`, `PerformanceSignals.jsx`, `UpcomingShoots.jsx`.
- `.lim-*` class names. Reuse what exists; don't introduce new design tokens
  besides what the existing styles support.
- Polling intervals, routes, lazy-load contract.

## Implementation order

1. **Mac Mini side first.** Write `scripts/health-ping.js`, add `/health`
   endpoint to webhook server, add PM2 cron, add `TUNNEL_URL` env. Run once
   manually with `node scripts/health-ping.js`, confirm 5 rows appear in
   `agent_logs`. Restart PM2, wait 2 min, confirm pings continue every minute.
2. **SQL.** Update `get_campus_system_health_summary` (DROP + CREATE OR
   REPLACE). Apply in Supabase. Sanity-check with a SELECT against Austin
   that all new fields populate.
3. **Frontend `lib/health.js`.** Implement `systemPulse()` with 8 cells, add
   5 new `actionItems()` categories.
4. **Components.** Update `SystemHealthStrip.jsx` detail strings,
   `OpsHeader.jsx` for pipLabel + freshness.
5. **Pages.** Update `Ops.jsx` and `Pipeline.jsx` for new pulse shape.
6. **Action item phrasing audit.**
7. **Build + verify.** `npm run build` passes. Manual eyeball at `/ops`:
   - 8 pulse cells, 8 distinct pip labels in header.
   - All cells green on healthy state (or amber/red only for actually verified
     conditions).
   - Stop the tunnel temporarily on Mac Mini → tunnel cell goes red within
     ~3 minutes (3 consecutive ping failures). Action item appears.
     Restart tunnel → recovers within ~60s.
   - Action item phrasing reads cleanly.
   - Freshness indicator updates in real time.

## Acceptance criteria

PR mergeable when:

1. `npm run build` succeeds; bundle within ±5% of pre-PR.
2. Mac Mini `agent_logs` shows 5 rows per minute with `agent_name='health'`
   and the 5 distinct ping actions.
3. Dashboard renders 8 pulse cells. On healthy Austin state, all 8 are green
   except for the cron schedule cell (which may legitimately surface an amber
   if research/fireflies has missed a fire — that's real).
4. Stopping the tunnel process on Mac Mini causes the webhook tunnel cell to
   go red within 3 minutes, with the corresponding `tunnel-down` action item
   appearing. Restarting the tunnel resolves both within ~60s.
5. No new console errors on `/ops` hard reload.
6. Webhook tunnel cell is no longer time-based — it reflects active ping
   results.
7. The 8 pip labels in the header are all distinct (no `WEBH/WEBH`).
8. Action items for stuck videos read with corrected phrasing.

## Out of scope

- Phase B (work observation tool, per-agent drilldown, "today's output" panel,
  artifact tracking).
- Hardcoded `2026-04-29` system_uptime floor → `campuses.deployed_at` column
  migration. Stays hardcoded until a second campus ships.
- Notification system (Slack ping, email).
- Quiet-hours / weekend mode.
- Tooltips on cell labels.
