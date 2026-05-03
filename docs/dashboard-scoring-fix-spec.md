# Dashboard scoring fix — spec

Branch: `feature/dashboard-scoring-fix` · single PR · ship-today scope.

## Problem

The Ops dashboard scores subsystems red whenever recent activity is absent.
Three classes of false positives have been verified on a healthy pre-launch
system:

1. **Weekly crons before their first schedule.** `performance` runs Mon
   07:00. The Mac Mini went live Apr 29; the first scheduled fire is May 4.
   Today's rule treats "30 days since last successful run" as a missed cron.
   The cron has never been due.
2. **Gated metrics whose gate has not fired.** The FFmpeg/LUFS cell asks
   "did QA measure LUFS recently?" QA is event-driven on `EDITED`. No video
   has reached `EDITED` yet, so QA has never fired. The gate has not been
   exercised.
3. **Intentionally idle integrations.** Frame.io webhook deferred by Scott;
   Fireflies env-gated; Calendar empty by Scott's choice; Anthropic only
   logs through other agents. Today's rule labels each "disconnected." None
   are broken.

The dashboard goes on Scott's desk daily. False-positive red teaches him to
ignore the screen — worse than no dashboard.

The fix is structural. Today's model conflates three different questions
into one weighted score: *what should I do?*, *is anything broken?*, *what's
connected?*. Splitting them into three layers eliminates the false-positive
class entirely.

## Goals

1. **Three layers.** Action Items (concrete to-dos), System Pulse (binary
   green/amber/red for real failures), Integration Activity (informational,
   never red).
2. **Cron health calculated against each cron's own schedule**, not absolute
   time. A weekly cron can't be late on day 3.
3. **Gated metrics stay green when the gate hasn't fired.** No `EDITED`
   videos → audio cell green.
4. **Integrations show "last successful interaction" in neutral styling**,
   not connection state.
5. **Empty state ("ALL CLEAR") is the most common state and looks
   reassuring.**
6. **Each scoring rule has a synthetic-input test.**

## The three layers

### Layer 1 — Action Items

Replaces the left "Operational" hero in `dashboard/src/components/HealthBars.jsx`.
Same hero shape (`.lim-cpv-hero`, mega number, segmented bar, breakdown
keys), but the mega number is the **count of open action items**, or the
text **"ALL CLEAR"** in green when zero.

An action item is a concrete row Scott can resolve. Shape:

```
{ id, category, headline, detail, anchor, urgency }
```

Categories and rules:

| Category | When it appears | Headline shape | Anchor |
|---|---|---|---|
| `stuck` | `now - updated_at > STUCK_THRESHOLDS[status]` | "{n} stuck in {status}" | `#pipeline-summary` |
| `editor-overload` | Any editor with `≥ 5` videos in `IN EDITING` | "{name} overloaded — {n} active edits" | `#editor-capacity` |
| `qa-fail` | Video with `qa_passed = false` AND `updated_at` within last 7 days, no later pass | "{n} QA failures awaiting re-review" | `#qa-queue` |
| `webhook-fail` | `webhook_inbox.failed > 0` AND `latest_failed_at` within last hour | "{n} webhooks failed in last hour" | `#system-health` |
| `cron-miss` | Any cron RED per §"Cron rules" | "{agent} cron has not fired since {prev_expected}" | `#system-health` |
| `error-spike` | `errors_last_hour ≥ 5` | "{n} agent errors in last hour" | `#system-health` |

**Detail line content — surface the "why," not just the "what."** Action
items run on a live system, so the detail string should include the most
recent `error_message` (truncated to ≤ 120 chars) when one exists for the
underlying cause. Specifically:

- `cron-miss` detail: most recent `error_message` from that agent's logs
  in the last 24h, or "{agent} hasn't logged any activity since {timestamp}"
  if no logs exist.
- `error-spike` detail: "most: {top_agent_name} ({n} of total)" — i.e. which
  agent is producing the bulk of errors. Pulled from a `GROUP BY agent_name`
  on errors in the last hour.
- `webhook-fail` detail: most recent `error_message` from the latest failed
  inbox row.
- `qa-fail` detail: editor name(s) of the failed videos, e.g. "Charles: 2 ·
  Tipra: 1".
- `stuck` detail: status breakdown, e.g. "IDEA: 1 · IN EDITING: 2".
- `editor-overload` detail: "{name}: {n} active edits."

Truncation rule: keep details ≤ 140 chars. If `error_message` is longer,
truncate with an ellipsis. The full message is still visible in the
panel that the action item anchors to.

Sort: `urgency` desc, then category, then headline. Cap visible list at 6;
overflow becomes "+ {n} more" linking to the panel with most overflow.

Empty state: hero shows "ALL CLEAR" in green; a single muted breakdown row
"no action items right now" using `.lim-cpv-empty-row`.

### Layer 2 — System Pulse

Replaces the right "System" hero plus `dashboard/src/components/SystemHealthStrip.jsx`.
Same hero + cell shape (`.lim-cpv-hero`, `.lim-cpv-health-list`,
`.lim-cpv-health`), but:

- **No weighted scores.** Hero mega number is count of non-green pulses, or
  **"ALL GREEN"** when zero.
- **Each cell is binary state with optional amber.** Default green; amber
  for transient anomaly; red for confirmed failure.
- **Drop the per-cell "x/y" weight readout.** Cell renders dot + label +
  one-line detail.

Cells (replacing today's five):

| Cell | Green | Amber | Red |
|---|---|---|---|
| Webhook ingestion | No `failed_at` in last hour AND `oldest_pending_received_at` < 60s old | `oldest_pending_received_at` 60s–5min old | `failed_at` in last hour AND no successful processing since |
| Cron schedule | Every cron has a run on or after `prev_expected_fire`, OR `prev_expected_fire` is in the future relative to system uptime | Any cron 2h–24h overdue past `prev_expected_fire` | Any cron > 24h overdue past `prev_expected_fire` AND has fired before |
| Worker errors | `errors_last_hour = 0` | `1 ≤ errors_last_hour ≤ 4` | `errors_last_hour ≥ 5` |
| Webhook tunnel | Webhook received in last 24h | Last received 24–48h ago | Last received > 48h ago |
| Audio normalization | `edited_video_count = 0` (gate not exercised) OR `lufs_errors_24h = 0` | `lufs_errors_24h = 1` AND `edited_video_count > 0` | `lufs_errors_24h ≥ 2` AND `edited_video_count > 0` |

The audio cell uses the **gate principle**: if the upstream event hasn't
happened, the cell is green by definition. Document the gate in the cell
detail line: "no `EDITED` videos yet — gate not exercised".

### Layer 3 — Integration Activity

Replaces `dashboard/src/components/IntegrationHealth.jsx`. Same accordion
shell (`.lim-cpv-int`, `.lim-cpv-int-head`, `.lim-cpv-int-events`), but:

- **Status dot is neutral** (single class, suggestion: `.lim-cpv-int-dot--neutral`
  styled with `var(--ink-3)`). No green/amber/red modifiers.
- **Status text is "last event {timeAgo}"** for any integration with
  activity, or "no recent activity" if none. Drop "connected / degraded /
  disconnected" entirely.
- **Header reads "INTEGRATIONS · {n} active in last 24h"** rather than
  "x/y CONNECTED."

Layer 3 never turns red. Real failures surface in Layer 1 (action item) or
Layer 2 (pulse cell), not here.

## Cron rules

Add `prevCronFire(cron, now)` to `dashboard/src/lib/agents.js` mirroring the
existing `nextCronFire`. Returns the most recent moment the cron should have
fired (largest cron-tick boundary ≤ now). Same supported expressions:
`0 6 * * *`, `0 7 * * 1`, `0 21 * * *`, `*/15 * * * *`.

For each cron, compute:

```
prev = prevCronFire(cron, now)
last = MAX(created_at) FROM agent_logs
       WHERE agent_name = X AND campus_id = $1
       (no status filter — "did it run at all" is the question)
```

Decision table:

| Condition | State |
|---|---|
| `prev` is before `system_uptime` (cron has never been due during this system's lifetime) | green |
| `prev` is in the past AND `last >= prev` | green |
| `last < prev` AND `now - prev ≤ 2h` | green (within grace) |
| `last < prev` AND `2h < now - prev ≤ 24h` | amber |
| `last < prev` AND `now - prev > 24h` AND prior log exists for this agent | red |
| No prior log ever for this agent AND `prev > system_uptime` | green (hasn't been due) |

**Do not filter by `status = 'success'`.** A cron that fired and errored did
fire. The error itself surfaces in the `error-spike` action item / Worker
errors pulse cell. Conflating "did it fire" with "did it succeed" is what
produces the current fireflies false positive (16 error runs counted as
zero runs).

## Files to change

All paths relative to repo root.

### `dashboard/src/lib/health.js`
Remove `operationalHealth` and `systemHealth`. Add:

- `actionItems({ videos, editors, logs, inbox, summary }) → ActionItem[]`
- `systemPulse({ logs, inbox, summary }) → { count, cells: PulseCell[] }`

Keep all other exports unchanged.

### `dashboard/src/lib/agents.js`
Add `prevCronFire(cron, now)`. Pure function, mirrors `nextCronFire`.

### `dashboard/src/components/HealthBars.jsx`
Keep filename. Change props from `{ ops, sys }` to `{ actions, pulse }`.
Render two heroes:

- **Left ("ACTION ITEMS")** — mega number = `actions.length`, or "ALL CLEAR"
  when zero. Bar segments weighted by category counts. Breakdown rows
  anchor via existing `<a href="#anchor">`.
- **Right ("SYSTEM PULSE")** — mega number = count of `cells` where
  `state !== 'green'`, or "ALL GREEN" when zero.

### `dashboard/src/components/SystemHealthStrip.jsx`
Consume new `pulse.cells` shape. Drop per-cell score/weight rendering.
Detail lines per state:

| Cell | Green detail | Amber detail | Red detail |
|---|---|---|---|
| Webhook ingestion | "no failed webhooks in last hour" | "oldest pending {timeAgo}" | "{n} failed in last hour" |
| Cron schedule | "all crons on schedule" | "{agent} {timeAgo} overdue" | "{agent} not fired in {timeAgo}" |
| Worker errors | "no errors in last hour" | "{n} errors in last hour" | "{n} errors in last hour" |
| Webhook tunnel | "last webhook {timeAgo}" | "last webhook {timeAgo}" | "no webhook in {timeAgo}" |
| Audio normalization | "no `EDITED` videos yet — gate not exercised" or "no LUFS failures" | "1 LUFS error in last 24h" | "{n} LUFS errors in last 24h" |

Detail lines ≤ 60 characters.

### `dashboard/src/components/IntegrationHealth.jsx`
Drop the state derivation in `summary` (the `let state = 'red'` block).
Single neutral dot class. Status text: "last event {timeAgo}" or "no recent
activity." Header counts "active in last 24h." Remove `connected` math.

### `dashboard/src/components/OpsHeader.jsx`
- Remove `is-amber` / `is-red` classes from the counts row. Numbers stay in
  default ink color; alarm semantics belong in Action Items.
- Pip strip consumes new `pulse.cells` shape with `--{state}` modifier.
- Change polling label `POLLING · 15s` → `LIVE`.

### `dashboard/src/pages/Ops.jsx`
- Imports: replace `{ operationalHealth, systemHealth }` with
  `{ actionItems, systemPulse }`. Keep `isStuck` (used by `totals`).
- Replace `ops` and `sysHealth` `useMemo`s with `actions` and `pulse`.
- Pass `{ actions, pulse }` into `HealthBars` and `pulse` into
  `SystemHealthStrip`.
- Phone `Kpi` row: tone derived from action items. "STUCK" red if any
  `stuck` action exists. "QA FAIL" red if any `qa-fail`. "ALERTS" matches
  pulse aggregate.
- Replace `sysIsClean = sysHealth.score >= 90` with
  `sysIsClean = pulse.cells.every((c) => c.state === 'green')`.
- Keep `totals` memo as-is (`active`, `stuck`, `failed`). The header still
  renders the counts row "{active} ACTIVE · {stuck} STUCK · {failed} QA"
  — they're useful at-a-glance numbers. Only the alarm-coloring (`is-amber`,
  `is-red` classes in `OpsHeader.jsx`) is removed; the counts themselves
  stay.

### `dashboard/src/pages/Pipeline.jsx`
Same prop change for the hero pair.

### `scripts/setup-dashboard-rls.sql`
Update `get_campus_system_health_summary` to add two new fields:

```sql
RETURNS TABLE (
  -- existing fields ...
  system_uptime timestamptz,         -- earliest agent_logs.created_at for this campus
  edited_video_count bigint,         -- COUNT(*) FROM videos WHERE status = 'EDITED'
  lufs_errors_24h integer            -- COUNT of qa logs with action ILIKE '%lufs%' AND status='error' in last 24h
)
```

Drop the `status = 'success'` filter on every `last_*_run` field — return
`MAX(created_at)` for any status. The dashboard separates "did the cron
fire" from "did it succeed."

The existing `last_lufs_measurement` and `ffmpeg_boot_check_status` fields
can stay in the table for backward compat but the new code stops reading
them. Idempotent (`CREATE OR REPLACE`).

## Don't change

`GrainBackground.jsx`, `Toolbar.jsx`, `lib/theme.js`, `lib/hooks.js`,
`lib/supabase.js`, `AgentGrid.jsx`, `LiveEventStream.jsx`,
`PipelineSummary.jsx`, `PipelineKanban.jsx`, `QAQueue.jsx`,
`EditorCapacity.jsx`, `PerformanceSignals.jsx`, `UpcomingShoots.jsx`,
the responsive grid in `Ops.jsx`, polling intervals, routes, the lazy-load
contract, `.lim-*` class names. Reuse what exists.

## Manual test plan

Run all 8 tests against current Austin data and against synthetic inserts.
Each test has a single expected outcome — pass or fail.

| # | What it proves | Synthetic input | Expected after fix |
|---|---|---|---|
| 1 | Weekly cron not yet due → green | Default state (Mac Mini live Apr 29; performance never due) | Cron pulse cell **green**; no `cron-miss` action item for performance |
| 2 | Daily cron missed by 26h → red | Insert one `research` log 50h ago; current time 09:00 | Cron pulse cell **red**; action item "research cron has not fired since {prev}" |
| 3 | Cron fired with errors → still counts as fired | Insert ten `fireflies` logs in last 24h, all `status='error'` | Cron pulse cell **green** for fireflies (it fired); separate `error-spike` action item appears |
| 4 | Audio gate not exercised → green | Default state (no `EDITED` videos, no LUFS logs) | Audio pulse cell **green** with detail "no EDITED videos yet — gate not exercised" |
| 4b | Audio: single LUFS error → amber | One `EDITED` video; one `qa` log `action='lufs_failed' status='error'` in last 24h | Audio pulse cell **amber** with detail "1 LUFS error in last 24h" |
| 4c | Audio: two LUFS errors → red | One `EDITED` video; two `qa` logs `action='lufs_failed' status='error'` in last 24h | Audio pulse cell **red** with detail "2 LUFS errors in last 24h" |
| 5 | Webhook failure → red | Insert one inbox row with `failed_at = now - 30min` and no successful processing since | Webhook pulse cell **red**; `webhook-fail` action item |
| 6 | Idle integration → neutral | Default state (no Frame.io / Calendar / Anthropic logs in 24h) | Integration rows for those three say "no recent activity" with neutral dot; no red |
| 7 | Stuck videos → action items | Three videos past `STUCK_THRESHOLDS[status]` | Action items list contains a `stuck` row "3 stuck in {status}"; anchors to `#pipeline-summary` |
| 8 | Empty state → ALL CLEAR | Healthy synthetic state (no stuck, no overload, no QA fail, no webhook fail, no error spike, all crons green) | Action Items hero shows "ALL CLEAR" in green; System Pulse hero shows "ALL GREEN"; Integrations neutral |

For each test, screenshot the dashboard before and after the synthetic
input. Attach to PR.

## Implementation order

1. **SQL.** Update `get_campus_system_health_summary` (add `system_uptime`,
   `edited_video_count`, and `lufs_errors_24h`; drop the `status = 'success'`
   filters on `last_*_run` fields). Run in Supabase. Confirm new fields
   populate.
2. **Helpers.** Add `prevCronFire` to `lib/agents.js`. Add `actionItems`
   and `systemPulse` to `lib/health.js`.
3. **Components.** Update `HealthBars.jsx`, `SystemHealthStrip.jsx`,
   `IntegrationHealth.jsx`, `OpsHeader.jsx` to consume the new shapes.
4. **Pages.** Update `Ops.jsx` and `Pipeline.jsx` imports and props.
5. **Cleanup.** Remove dead `operationalHealth` / `systemHealth` exports
   from `health.js`. Confirm `npm run build` passes; bundle within ±5%
   of pre-PR.
6. **Verify.** Run the 8 manual tests against current Austin data + the
   synthetic inserts. Screenshot results for the PR.

## Out of scope (explicit)

- Fixing the actual agent failures (fireflies → ClickUp pipeline, etc.).
  Separate tickets. This PR only changes interpretation.
- Wiring real ffmpeg boot-check logging.
- Refactoring redundant data hooks.
- Changing routes, polling intervals, or the lazy-load contract.

## Acceptance criteria

PR mergeable when:

1. All 8 tests pass.
2. `npm run build` succeeds; bundle within ±5% of pre-PR.
3. Dashboard against current Austin data shows: Action Items "ALL CLEAR" or
   real-only items; System Pulse "ALL GREEN" or real-only failures;
   Integrations neutral with timestamp rows; performance cron green; audio
   normalization green; Frame.io / Anthropic / Calendar / Fireflies neutral.
4. No changes to the "don't change" list above.
5. Console silent on hard reload of `/ops`.
