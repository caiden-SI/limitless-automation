# Dashboard — AGENTS Panel Rebuild

The AGENTS panel is the centerpiece of the Ops dashboard. Agents are the
product. The panel should make it obvious to anyone — Scott reading from
across the room, an operator checking on a Tuesday morning, a new
teammate seeing the system for the first time — that each agent is firing,
healthy, and doing its job.

This is a focused rebuild. Single PR, separate from iteration 2 polish.

**Target branch:** `feature/dashboard-agents-rebuild`
**Scope:** AGENTS panel + the INTEGRATIONS strip directly above it +
the supporting metadata module. Dashboard-only.
**Out of scope:** every other dashboard panel (System Pulse, Signals,
Pipeline, QA Queue, Editor Capacity, Activity feed, Upcoming Shoots,
Action Items), the System Pulse cells, the agents themselves
(no changes to `agents/*.js`, `server.js`, or any Supabase migration).

> **Source-of-truth note:** every code reference, action name, file path,
> and cron expression in this doc was verified against the working tree
> on May 4 2026. Action prose mappings come from `grep "action: '"
> agents/*.js`, not memory.

---

## Why this rebuild

The current AGENTS panel (`dashboard/src/components/AgentGrid.jsx`,
fed by `dashboard/src/lib/agents.js AGENTS`) has three problems:

1. **Incomplete agent list.** Shows 7 cards. The system runs a 9-card
   surface (8 distinct `agent_name` values + 1 logical slice). Missing
   `profile-views` and `footage-scan`.
2. **Generous green dots.** Every agent shows green regardless of whether
   it has run, is overdue, is blocked, or has never fired in production.
   Looks healthy when it isn't.
3. **Uninformative content.** Cards show raw cron jargon like
   `campus_run_complete · 6m ago` rather than human-readable operational
   metrics. The card communicates nothing about what the agent actually
   accomplished.

Plus a fourth problem newly introduced: **the panel is cramped.** Seven
cards crammed in one row at ~410px each leaves no room for visual
hierarchy. The current layout looks like a server admin tool.

After this rebuild, looking at the panel should answer one question
quickly: *"Is each agent firing and doing its job correctly?"*

---

## Operational, not promotional

The AGENTS panel occupies a unique niche on the dashboard. Other panels
already cover the questions that look adjacent:

- **What's working / trending hooks** → SIGNALS panel
- **Per-integration last-event timestamps** → INTEGRATIONS strip
- **Calendar events upcoming** → UPCOMING SHOOTS panel
- **Real-time event firehose** → ACTIVITY feed
- **Aggregated alerts** → ACTION ITEMS panel
- **Subsystem health** → SYSTEM PULSE

What none of those cover, and what AGENTS owns: *did this specific agent
run, what did it process, are there problems with this specific agent?*

The card should answer that. **Volume + outcome metrics from the agent's
own log payload.** Not insight ("top hook"), not trends ("growing 15%"),
not context ("next event Mon 10am"). Those numbers live elsewhere on
the dashboard. Putting them on the AGENTS card makes it a redundant
summary instead of its own panel.

This rules out a large category of "interesting metrics." If a number
appears on another panel, the AGENTS card does not echo it. When in
doubt, pick the operational angle (volume, ready-state, error count) over
the analytical angle (top, trend, recommendation).

---

## Data model: 9 cards, 8 distinct agent_names

This is the most important architectural detail. Read carefully before
implementing.

The system has **8 distinct `agent_name` values** in `agent_logs`:

```
fireflies, onboarding, performance, pipeline,
profile-views, qa, research, scripting
```

(Plus `health` and `server`, both excluded from this panel.)

The 9th card the panel renders — `footage-scan` — is a **logical slice
of pipeline rows**. The cron registration in `server.js:194`
(`scheduler.register('footage-scan', '*/15 * * * *', pipeline.scanPendingFootageAll)`)
calls a function inside `agents/pipeline.js`, which writes log rows with
`agent_name: 'pipeline'` (the file's `AGENT_NAME` constant on line 19).
There is no `agent_name = 'footage-scan'` row in the database.

To render footage-scan as its own card, the dashboard filters pipeline
rows by **action name**:

- **footage-scan card** reads pipeline rows where
  `action.startsWith('footage_') || action === 'dropbox_list_folder_error'`
- **pipeline card** reads pipeline rows where the inverse is true (status
  routing, editor assignment, frame.io sync, share-link creation, etc.)

Each entry in `AGENT_REGISTRY` has both a `sourceAgent` field (the
`agent_name` to query) and an optional `actionFilter` (a predicate
applied client-side). All other 8 cards have `sourceAgent === name` and
no filter.

Webhook-received rows (`clickup_webhook_received: <event>`,
`dropbox_webhook_received`) appear under `agent_name: 'pipeline'` —
verified in the May 4 2026 action census. The handlers route the
webhook into pipeline's processing path and pipeline logs the
receipt. So the pipeline card naturally includes these rows in its
sparkline and metric calculation. Only signature-rejection rows
(`*_webhook_rejected`) live under `agent_name: 'server'` and stay
out of this panel.

---

## Visual design

### Layout — V1 (integrations as pill strip, AGENTS as 3×3)

Locked from Claude Design mockup pass.

```
┌─ INTEGRATIONS ─────────────────────────────────────────  7/7 CONNECTED ─┐
│  ● ClickUp 22m ago  ● Dropbox 8m ago  ● Frame.io 14m ago  ● Fireflies … │
└─────────────────────────────────────────────────────────────────────────┘

┌─ AGENTS ──────────────────────────────────────────────────  9 ON · 24h ─┐
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐         │
│ │ ● pipeline       │ │ ● footage-scan   │ │ ● qa             │         │
│ │ <sparkline>      │ │ <sparkline>      │ │ <sparkline>      │         │
│ │ <metric>         │ │ <metric>         │ │ <metric>         │         │
│ │ <footer>         │ │ <footer>         │ │ <footer>         │         │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘         │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐         │
│ │ ● research       │ │ ● performance    │ │ ● scripting      │         │
│ │ ...              │ │ ...              │ │ ...              │         │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘         │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐         │
│ │ ○ onboarding     │ │ ● fireflies      │ │ ● profile-views  │         │
│ │ ...              │ │ ...              │ │ ...              │         │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```

INTEGRATIONS gets compressed from the current ~600px-tall panel to a
~50–60px horizontal pill strip directly above AGENTS. Each pill: tiny
status dot + integration name + last-event-ago. `7/7 CONNECTED` summary
on the right. Detail (full last-event payload) reveals on pill hover.
Folds the existing `IntegrationHealth` component into a much tighter
shape; same data, much less real estate.

AGENTS goes from the current 7-up cramped row at ~410px per card to a
3×3 grid at ~880px per card on portrait Studio Display (2880×5120).
Each card has room for sparkline + bold metric + footer line without
crowding.

Layout target: portrait orientation. The dashboard runs as Scott's
always-on second monitor. Glanceability from across the room matters
more than information density.

### Card — default state

```
┌────────────────────────────────────────────────┐
│ ●  agent-name              <cadence label>     │
│                                                │
│ ▆▂▅▃▆▄▅▃▆▂▅▃▆▄▅▃▆▂▅▃▆▄  <-- 24h sparkline    │
│                                                │
│ <bold operational metric>                      │
│                                                │
│ <last-run> · <next-run>                        │
└────────────────────────────────────────────────┘
```

Fields:

- **Status dot** (top-left) — cadence-based per
  [Dot semantics](#dot-semantics). Green / amber / red / gray hollow.
- **Agent name** — lowercase, monospaced, primary text color, prominent.
- **Cadence label** (top-right) — concise. Examples: `daily · 6 am`,
  `every 15 min`, `mon · 7 am`, `nightly · 9 pm`, `thu · 9 am`,
  `webhook · live`, `on edited`, `on /onboard visit`. Standardize
  triggered-agent labels to verb-led form (`on EDITED status`,
  `on /onboard visit`) so they read parallel.
- **Sparkline** — bars showing run frequency over the agent's natural
  window (see [Sparkline windows](#sparkline-windows)). Light bars on
  dark theme, neutral on light.
- **Operational metric** (bold, prominent) — the single line that
  answers "did this agent do work, and what did it process?" Per-agent
  prose specified below in [Per-agent specifications](#per-agent-specifications).
- **Footer line** — `<relative time since last run> · <next run>`.
  Examples: `6m ago · next in 9m`, `14h ago · next at 6 AM tomorrow`,
  `8s ago · waiting for next event`, `3w ago · idle · waits for trigger`.

### Card — hover / expand state

```
┌────────────────────────────────────────────────┐
│ ●  agent-name              <cadence label>     │
│ │ <one-sentence description>                   │
│                                                │
│ ▆▂▅▃▆▄▅▃▆▂▅▃▆▄▅▃▆▂▅▃▆▄                       │
│                                                │
│ <bold operational metric>                      │
│                                                │
│ <last-run> · <next-run>                        │
└────────────────────────────────────────────────┘
```

The description appears as a single-sentence block with a left rule, slid
in below the cadence label. Tight, technical, not marketing voice.
Per-agent descriptions are spec'd below.

### Interaction modes

Hover-capable devices: CSS transition triggered by `:hover`. Detect via
`@media (hover: hover)` so the hover transition only applies where it
works. Do not use `'ontouchstart' in window` or `userAgent` sniffing.

Touch devices: `onClick` on the card toggles an `.is-expanded` class.
Tapping a different card collapses any other expanded card so only one
description shows at a time.

---

## Dot semantics

Replace existence-based green dots with cadence-based health dots:

- **Green:** last successful run within (scheduled interval × 1.5)
- **Amber:** scheduled but no run in (interval × 1.5 to × 2)
- **Red:** overdue beyond (interval × 2) OR last run logged an error
- **Gray (hollow circle ○):** scheduled but not yet first-run, OR
  webhook/triggered agent that hasn't received traffic recently

Webhook and triggered agents have a different baseline: green if they've
fired in the last 24h (recent activity), gray if longer (just idle, not
unhealthy).

---

## Alive pulse animation

A subtle whole-cell pulse fires when a new `agent_logs` row arrives that
matches the card's `sourceAgent` + `actionFilter`. The pulse encodes the
row's status, not just "something happened" — gives Scott peripheral
awareness *and* signal differentiation.

- **Green pulse on `success`.** Subtle — alpha ~10–15% green wash that
  fades in over ~200ms and out over ~1.5s. Total ~1.7s, then gone.
  Should be peripheral, not attention-stealing. From across the room
  the panel "breathes green" as agents fire.
- **Red flash on `error`.** Sharper — slightly higher alpha (~25%),
  faster fade-in (~100ms), shorter total duration (~1s). Errors should
  grab the eye.
- **Amber fade on `warning`.** Same shape as green, different color.

The whole cell pulses, not the border or the dot. From distance the
border-blink reads as a notification; whole-cell pulse reads as the
agent itself being alive. Implementation: a CSS keyframe animation
applied to the card via a transient class set in the React component
when a new row enters.

---

## Sparkline windows

Different agents fire at different rhythms, so the sparkline window
adapts per cadence. A weekly agent with a 24h window shows an empty
sparkline 6 of 7 days — looks broken. The window scales to the cadence:

| Cadence type | Window | Bar count |
|---|---|---|
| Daily / sub-daily (every 15 min, every 6h, daily) | 24h | 24–48 bars |
| Weekly (Monday cron, Thursday cron) | 14d | 14 bars |
| Event-driven (webhook, triggered) | 7d | 7 bars or smooth curve |

The label below the sparkline can optionally show the window size
(`24h` / `14d` / `7d`) in small secondary text — useful when the
window varies. Or omit if visual rhythm makes it obvious.

This ensures every card always renders a sparkline that actually shows
activity, not a confusing empty one.

---

## Per-agent specifications

Each entry below feeds one row in `AGENT_REGISTRY`. Action prose is
**verified against the May 4 2026 working tree.** The "headline metric"
is the bold operational counter line — derived per-agent from
`agent_logs` payload via a small custom function in the registry.

Operational metric principles:

- One volume number that proves work happened
- Plus one short outcome or status when meaningful
- No "0 errors" filler — silent when zero, surfaced only when non-zero
- Nothing that overlaps with another panel (no top hooks, no trends,
  no calendar event details)

The `health-ping` agent is intentionally NOT shown — it's infrastructure
monitoring, drives the System Pulse cells.

### pipeline

- **Cadence label:** `webhook · live`
- **Cadence type:** event
- **Source agent:** `pipeline`
- **Action filter:** `(a) => !a.startsWith('footage_') && a !== 'dropbox_list_folder_error'`
- **Sparkline window:** 7d (event frequency)
- **Description:** "Routes ClickUp status changes through 11 production
  stages — creates Dropbox folders, assigns editors, gates QA, syncs
  Frame.io, ships share links."
- **Headline metric:** `<N> status changes today`. If error rows in the
  same window > 0, append `· <N> errors`.
- **Verified action prose** (for activity feed filter, not card surface):
  - `status_change: <status>` → `"routed status: <status>"` (parse status)
  - `status_change_error: <status>` → `"status change errored: <status>"` (parse status)
  - `creating_dropbox_folders` → `"creating Dropbox folders"`
  - `dropbox_folders_created` → `"Dropbox folders created"`
  - `dropbox_scan_complete` → `"Dropbox scan complete"`
  - `dropbox_webhook_received` → `"Dropbox webhook received"`
  - `clickup_webhook_received: <event>` → `"ClickUp webhook: <event>"` (parse event)
  - `editor_assigned` → `"editor assigned"`
  - `assign_editor_skipped` → `"editor not assigned"`
  - `qa_gate_passed` → `"QA gate passed"`
  - `qa_gate_blocked` → `"QA gate blocked — waiting"`
  - `frameio_link_synced` → `"Frame.io link synced"`
  - `frameio_link_unchanged` → `"Frame.io link unchanged"`
  - `frameio_link_sync_skipped` → `"Frame.io link sync skipped"`
  - `frameio_link_sync_error` → `"Frame.io link sync errored"`
  - `frameio_link_opaque` → `"Frame.io link opaque"`
  - `share_link_created` → `"share link created"`
  - `share_link_reused` → `"share link reused"`
  - `clickup_frame_link_updated` → `"ClickUp Frame field updated"`
  - `review_comment_routed` → `"review comment routed"`
  - `resolve_task_rejected` → `"task could not be resolved"`
  - `done_received_noop` → `"done — no action"`
- **Footer:** `<last-event-ago> · waiting for next event`
- **Dot:** green if last event within 24h, gray if longer.

### footage-scan

- **Cadence label:** `every 15 min`
- **Cadence type:** cron
- **Cron:** `*/15 * * * *`
- **Source agent:** `pipeline` (logical slice — see [Data model](#data-model-9-cards-8-distinct-agent_names))
- **Action filter:** `(a) => a.startsWith('footage_') || a === 'dropbox_list_folder_error'`
- **Sparkline window:** 24h (96 bars or down-sampled)
- **Description:** "Checks Dropbox every 15 min for new raw footage;
  advances videos when folders appear, with a 1-hour propagation
  delay."
- **Headline metric:** `<N> checks · <M> footage detected today`.
  When M is 0, omit the second clause: just `<N> checks today`.
- **Verified action prose:**
  - `footage_detected_empty` → `"no footage in folder"`
  - `footage_detected_pending_delay` → `"footage detected — waiting 1h"`
  - `footage_detected_skipped` → `"footage check skipped"`
  - `footage_detected_status_updated` → `"footage ready — status advanced"`
  - `footage_detected_stamp_error` → `"footage timestamp errored"`
  - `footage_detection_cleared` → `"footage detection cleared"`
  - `footage_scan_campus_error` → `"campus scan errored"`
  - `dropbox_list_folder_error` → `"Dropbox listing errored"`
- **Footer:** `<last-run-ago> · next in <X>m`
- **Dot:** green within 30 min, red after 1h.

### qa

- **Cadence label:** `on EDITED status`
- **Cadence type:** event (triggered by pipeline on EDITED status)
- **Source agent:** `qa`
- **Sparkline window:** 7d
- **Description:** "Runs 4-check QA (LUFS audio loudness, transcript
  cleanliness, hook presence, framing) when a video moves to EDITED.
  Stages corrections to ClickUp on failure."
- **Headline metric:**
  - When zero runs ever: `0 reviewed · waiting for EDITED`
  - When runs exist: `<N> reviewed today · <P> passed · <F> corrections staged`
- **Verified action prose:**
  - `qa_started` → `"QA started"`
  - `qa_passed` → `"QA passed"`
  - `qa_failed` → `"QA failed — corrections staged"`
  - `runQA` → `"QA dispatch started"`
  - `lufs_failed_no_ffmpeg` → `"LUFS check failed (FFmpeg missing)"`
  - `self_heal_attempted` → `"self-heal recovery attempted"`
  - `self_heal_window_hit` → `"self-heal retry window hit"`
  - `self_heal_alert_sent` → `"self-heal alert sent"`
- **Footer:** `<last-run-ago> · idle · waits for trigger` (when no
  pending EDITED video; otherwise omit "idle")
- **Dot:** gray if no `qa_started` events ever; green if last QA within
  7d; amber otherwise.

### research

- **Cadence label:** `daily · 6 am`
- **Cadence type:** cron
- **Cron:** `0 6 * * *`
- **Source agent:** `research`
- **Sparkline window:** 24h (will show one bar near 6 AM)
- **Description:** "Daily TikTok and Instagram scrape, classified by
  Claude into the hook taxonomy Scripting reads."
- **Headline metric:** `<N> hooks classified today` (read from
  `payload.hooks_classified` if present; fall back to count of
  `tiktok_scrape_complete` + `instagram_scrape_complete` rows for
  today)
- **Verified action prose:**
  - `research_run_started` → `"research run started"`
  - `tiktok_scrape_complete` → `"TikTok scraped"`
  - `instagram_scrape_complete` → `"Instagram scraped"`
  - `tiktok_scrape_error` → `"TikTok scrape errored"`
  - `instagram_scrape_error` → `"Instagram scrape errored"`
  - `research_run_complete` → with payload: `"${count} hooks classified"`;
    fallback: `"research run complete"`
  - `research_run_empty` → `"no hooks scraped"`
  - `research_video_error` → `"video classification errored"`
  - `research_insert_error` → `"hook insert errored"`
  - `run_all_error` → `"campus iteration errored"`
- **Footer:** `<last-run-ago> · next at 6 AM tomorrow`
- **Dot:** green within 36h, red after 48h.

### performance

- **Cadence label:** `mon · 7 am`
- **Cadence type:** cron
- **Cron:** `0 7 * * 1`
- **Source agent:** `performance`
- **Sparkline window:** 14d (shows two Monday bars max)
- **Description:** "Weekly Claude analysis of top and bottom performing
  posts. Generates the signals the SIGNALS panel renders."
- **Headline metric:** `signals generated · last Mon` (do not surface
  the signals themselves — those are SIGNALS panel content). If the
  most recent run skipped: `skipped — <reason from payload>`.
- **Verified action prose:**
  - `performance_run_started` → `"performance run started"`
  - `performance_run_complete` → `"signals generated"`
  - `performance_run_skipped` → with payload: `"skipped — ${reason}"`;
    fallback: `"skipped (no data yet)"`
  - `run_all_error` → `"campus iteration errored"`
- **Footer:** `<days-since-Monday> ago · next Mon at 7 AM`
- **Dot:** green within 10d, red after 14d.

### scripting

- **Cadence label:** `every 15 min`
- **Cadence type:** cron
- **Cron:** `*/15 * * * *`
- **Source agent:** `scripting`
- **Sparkline window:** 24h
- **Description:** "Watches Google Calendar every 15 min and stages 3
  concept scripts when a filming event is upcoming. Brand-voice
  validation gates each concept before ClickUp."
- **Headline metric:**
  - Default (live, no qualifying events in 48h window): `awaiting filming events · <N> scans this month`
  - Once concepts are being staged: `<N> concepts staged this week · <M> events served`
  - On voice-validate-abort streak: `<N> scans · <M> voice aborts today`
    (when M > 0)
- **Verified action prose:**
  - `campus_run_started` → `"campus scan started"`
  - `campus_run_complete` → `"campus scan complete"` (or with payload:
    `"${concepts} concepts staged"`)
  - `campus_skipped_no_calendar` → `"no calendar configured"`
  - `event_received` → `"calendar event received"`
  - `event_claimed` → `"calendar event claimed"`
  - `student_matched` → `"student matched"`
  - `context_loaded` → `"student context loaded"`
  - `validation_passed` → `"validation passed"`
  - `voice_validation_failed_retrying` → `"voice validation failed — retrying"`
  - `voice_abort_claim_released` → `"voice abort: claim released"`
  - `brand_voice_validate_abort` → `"voice validation aborted"`
  - `brand_voice_escalated_to_failed_cleanup` → `"voice escalated to cleanup"`
  - `brand_voice_log_only_comment_posted` → `"voice issue noted (log-only)"`
  - `brand_voice_log_only_comment_failed` → `"voice comment write failed"`
  - `claim_released` → `"event claim released"`
  - `claim_release_failed` → `"event claim release failed"`
  - `claim_completion_update_failed` → `"claim completion update failed"`
- **Footer:** `<last-run-ago> · next in <X>m`
- **Dot:** green within 30 min, red after 1h.

### onboarding

- **Cadence label:** `on /onboard visit`
- **Cadence type:** event (triggered by `/onboard` URL open)
- **Source agent:** `onboarding`
- **Sparkline window:** 7d
- **Description:** "Conversational student intake at /onboard. Generates
  the Claude project context document Scripting uses to personalize
  scripts."
- **Headline metric:** `<N> students onboarded · <last-completion-ago>`.
  When N == 0: `0 students onboarded · ready for next student`.
- **Verified action prose:**
  - `completion_started` → `"onboarding completion started"`
  - `industry_report_generated` → `"industry report generated"`
  - `industry_report_error` → `"industry report errored"`
  - `context_document_synthesized` → `"context document synthesized"`
  - `context_document_synth_error` → `"context document synthesis errored"`
  - `students_table_written` → `"students table updated"`
  - `onboarding_complete` → `"context ready for student"`
  - `influencer_scrape_failed` → `"influencer scrape failed"`
  - `influencer_scrape_batch_error` → `"influencer batch errored"`
  - `answer_persist_error` → `"answer save errored"`
  - `final_session_update_warning` → `"final session update warning"`
- **Footer:** `<last-run-ago> · idle · waits for trigger`
- **Dot:** gray if no recent runs; green if completion event within 7d.

### fireflies

- **Cadence label:** `nightly · 9 pm`
- **Cadence type:** cron (env-gated on `FIREFLIES_CRON_ENABLED`)
- **Cron:** `0 21 * * *`
- **Source agent:** `fireflies`
- **Sparkline window:** 24h
- **Description:** "Pulls meeting transcripts nightly and creates ClickUp
  tasks for action items extracted via Claude."
- **Headline metric:** `<N> meetings · <M> action items created`.
  Pull both counts from the `fireflies_run_complete` payload.
- **Verified action prose:**
  - `fireflies_run_started` → `"Fireflies sync started"`
  - `fireflies_run_complete` → with payload: `"${count} meetings ingested"`;
    fallback: `"Fireflies sync complete"`
  - `student_match_ambiguous` → `"student match ambiguous"`
  - `campus_match_failed` → `"campus match failed"`
  - `extraction_failed` → `"action item extraction failed"`
  - `clickup_create_failed` → `"ClickUp task create failed"`
  - `clickup_retry_failed` → `"ClickUp retry exhausted"`
  - `action_item_insert_failed` → `"action item insert failed"`
  - `action_item_sync_error` → `"action item sync errored"`
  - `run` → `"run wrap"` (self-heal context wrap; rare)
  - `self_heal_alert_skipped` → `"self-heal alert skipped"`
- **Footer:** `<last-run-ago> · next at 9 PM tonight`
- **Dot:** gray until first production run completes; then green within
  30h, red after 48h. Env-gating is invisible to the dashboard — if the
  cron isn't registered, the dot stays gray.

### profile-views

- **Cadence label:** `thu · 9 am`
- **Cadence type:** cron (env-gated on `APIFY_API_TOKEN`)
- **Cron:** `0 9 * * 4`
- **Source agent:** `profile-views`
- **Sparkline window:** 14d (shows two Thursday bars max)
- **Description:** "Weekly Apify scrape of student + brand profiles.
  Writes anchor or delta rows to performance per (video, platform, week)."
- **Headline metric:** `<N> rows written · last Thu`. Pull from
  `profile_views_run_complete` payload (`anchorsPlanted + deltasWritten`).
  Trends and growth analysis live in SIGNALS — don't surface here.
- **Verified action prose:**
  - `profile_views_run_started` → `"profile-views run started"`
  - `profile_views_run_complete` → with payload:
    `"${matched} matched, ${anchorsPlanted} anchors / ${deltasWritten} deltas"`;
    fallback: `"profile-views run complete"`
  - `profile_views_unmatched` → with payload: `"${count} unmatched URLs"`
  - `profile_views_handleless_with_videos` → `"student has videos but no handle"`
  - `profile_views_handle_invalid` → `"invalid handle skipped"`
  - `profile_views_invalid_items` → with payload: `"${count} bad scraped items"`
  - `profile_views_negative_delta_floored` → `"negative delta floored — review"`
  - `profile_views_scrape_error` → `"scrape errored"`
  - `duplicate_post_urls_detected` → `"duplicate post_urls detected"`
- **Footer:** `<days-since-Thursday> ago · next Thu at 9 AM`
- **Dot:** green within 10d, red after 14d.

---

## Implementation notes

### Metadata module — preserve existing exports

`dashboard/src/lib/agents.js` currently exports `AGENTS` (array),
`AGENT_BY_NAME` (object), `INTEGRATIONS` (array), and the helpers
`prevCronFire` / `nextCronFire`. Three places consume them:

- `dashboard/src/components/LiveEventStream.jsx:5,51` — uses
  `AGENT_BY_NAME` for the agent filter dropdown.
- `dashboard/src/components/AgentGrid.jsx:6,12,14` — maps over `AGENTS`
  to render the current panel (this gets replaced).
- `dashboard/src/lib/health.js:172` — has its own `CRON_AGENTS` list
  that's manually kept in sync.

**Add `AGENT_REGISTRY` alongside, do not replace existing exports.**
Derive the legacy `AGENTS` shape from the registry so consumers stay
working:

```js
// 'profile-views' must use string syntax (hyphens are not valid
// bare JS identifiers).
export const AGENT_REGISTRY = {
  pipeline: {
    name: 'pipeline',
    sourceAgent: 'pipeline',
    actionFilter: (a) => !a.startsWith('footage_') && a !== 'dropbox_list_folder_error',
    cadenceLabel: 'webhook · live',
    cadenceType: 'event',
    cronExpression: null,
    sparklineWindowMs: 7 * 24 * 3600 * 1000,
    sparklineBars: 7,
    greenWithinMs: 24 * 3600 * 1000,
    redAfterMs: null,                  // event-driven: never red on idleness
    description: 'Routes ClickUp status changes...',
    headlineMetric: (rows) => {
      // Filter to today, return "<N> status changes today" + error suffix
      const today = startOfTodayLocal();
      const todayRows = rows.filter((r) => new Date(r.created_at) >= today);
      const statusChanges = todayRows.filter((r) => r.action.startsWith('status_change:'));
      const errors = todayRows.filter((r) => r.status === 'error');
      const base = `${statusChanges.length} status changes today`;
      return errors.length > 0 ? `${base} · ${errors.length} errors` : base;
    },
    actionProse: { /* see per-agent spec */ },
  },
  'footage-scan': {
    name: 'footage-scan',
    sourceAgent: 'pipeline',
    actionFilter: (a) => a.startsWith('footage_') || a === 'dropbox_list_folder_error',
    cadenceLabel: 'every 15 min',
    cadenceType: 'cron',
    cronExpression: '*/15 * * * *',
    sparklineWindowMs: 24 * 3600 * 1000,
    sparklineBars: 48,
    greenWithinMs: 30 * 60 * 1000,
    redAfterMs: 60 * 60 * 1000,
    description: 'Checks Dropbox every 15 min...',
    headlineMetric: (rows) => {
      const today = startOfTodayLocal();
      const todayRows = rows.filter((r) => new Date(r.created_at) >= today);
      const checks = todayRows.length;
      const detected = todayRows.filter(
        (r) => r.action === 'footage_detected_pending_delay' ||
               r.action === 'footage_detected_status_updated'
      ).length;
      return detected > 0
        ? `${checks} checks · ${detected} footage detected today`
        : `${checks} checks today`;
    },
    actionProse: { /* see per-agent spec */ },
  },
  // ...rest of the 9 (qa, research, performance, scripting,
  //                   onboarding, fireflies, 'profile-views')
};

// Back-compat: derive AGENTS from the registry.
export const AGENTS = Object.values(AGENT_REGISTRY).map((a) => ({
  name: a.name,
  label: a.label || a.name,
  description: a.description,
  trigger: a.cadenceType,
  triggerLabel: a.cadenceLabel,
  cron: a.cronExpression,
  color: a.color || null,
}));

export const AGENT_BY_NAME = Object.fromEntries(AGENTS.map((a) => [a.name, a]));

// INTEGRATIONS, prevCronFire, nextCronFire — keep as-is.
```

The `headlineMetric` function is per-agent. Most pull a count from the
matching log rows over a window (today, this week) and produce the
operational metric string. Some (qa, scripting) have multiple states
(zero-runs, normal, error-streak) that branch on the data.

The `actionProse` map values can be either a string or a function.
Functions receive `(action, payload)` and return either a string or
`null` (use fallback). Used for actions like `status_change: <status>`
that need to parse the action string, and for actions whose prose
depends on payload counts.

Action prose maps are still useful even though the card surfaces only
the headline metric — the activity feed filter dropdown
(`LiveEventStream.jsx`) renders friendlier action labels for filtering,
and future row-detail views can reuse the same map.

### Card sizing and grid layout

Portrait Studio Display target: 2880×5120 (flipped 27").

- **Portrait (≥2400px width):** 3 columns × 3 rows. Cards ~880px wide.
- **Desktop landscape (≥1100px width):** 3 columns × 3 rows. Cards
  ~360px wide. Tighter but readable.
- **Tablet (≥720px width):** 2 columns × 5 rows (last row has one
  card; that's fine).
- **Mobile (<720px):** single column, vertical stack.

Match existing dashboard breakpoints from `dashboard/src/ops.css`. Do
not invent new ones.

### Real-time updates

Polling stays at 10s via existing `useAgentLogs(campusId)` hook
(`dashboard/src/lib/hooks.js:91`, calls `get_campus_agent_logs` RPC).

Each card's render computes from the latest `logs` array on each
poll tick:

1. Filter rows by `sourceAgent` and (if defined) `actionFilter`.
2. Most recent row → drives the dot pulse animation if it's new since
   the previous tick.
3. Headline metric via `headlineMetric(rows)`.
4. Sparkline bars from row timestamps within `sparklineWindowMs`.
5. Footer: `timeAgo(latestRow.created_at)` + `nextCronFire(cronExpression)`.
6. Dot color: `(now - latestRow.created_at)` against `greenWithinMs` /
   `redAfterMs` thresholds.

All from the same `logs` array — no extra fetches.

### Pulse animation implementation

When a new row arrives (detected by comparing the latest row's `id` to
the previously-rendered latest row's `id`), set a transient
`.is-pulsing-success` / `.is-pulsing-error` / `.is-pulsing-warning`
class on the card. Remove after the animation duration. Use a CSS
keyframe:

```css
@keyframes lim-agent-pulse-success {
  0%   { background-color: var(--bg); }
  10%  { background-color: rgba(92, 209, 139, 0.12); }   /* --green at 12% */
  100% { background-color: var(--bg); }
}
.lim-agent-card.is-pulsing-success {
  animation: lim-agent-pulse-success 1700ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .lim-agent-card.is-pulsing-success { animation: none; }
}
```

Same shape for warning (amber, ~1.7s) and error (red, ~1s, higher
alpha). Honor `prefers-reduced-motion` — Scott's monitor probably
doesn't, but a teammate viewing on a laptop might.

### INTEGRATIONS pill strip

Replace the current `IntegrationHealth.jsx` panel with a horizontal
strip immediately above AGENTS. Each integration becomes a small pill:

```
[● ClickUp 22m ago]  [● Dropbox 8m ago]  [● Frame.io 14m ago]  ...
```

Default state: status dot + name + last-event-ago. Hover: reveals the
fuller "last event 2h ago" detail in a tooltip or inline expansion.

`7/7 CONNECTED` summary on the right of the strip — at-a-glance health
read of the whole integration layer.

Keep the existing substring-match logic in
`IntegrationHealth.jsx:21–25` for finding each integration's most
recent activity. Just render the result as pills, not stacked rows.

The Integration pills are independent of the AGENTS panel's
`AGENT_REGISTRY`; they continue to read from the existing
`INTEGRATIONS` array in `lib/agents.js`.

### Cross-platform interaction

```css
@media (hover: hover) {
  .lim-agent-card:hover .lim-agent-card-desc {
    max-height: 80px;
    opacity: 1;
  }
}
```

Touch devices: `setExpanded((v) => !v)` toggles `.is-expanded` on the
card. That class triggers the same description reveal as hover.
Tapping a different card collapses any other expanded card.

---

## Acceptance

After this rebuild, the AGENTS panel reads as the dashboard's
centerpiece. Looking at it should answer "is each agent firing and
doing its job correctly?" within seconds, no system knowledge required.

Sample expected state (May 4 evening, post-iteration-2 merge,
post-Profile Views Agent ship):

Numbers grounded against the May 4 2026 action census so examples
match what's actually firing.

| Agent | Dot | Headline metric | Footer |
|---|---|---|---|
| pipeline | green | `2 status changes today · 1 errors` | `4m ago · waiting for next event` |
| footage-scan | green | `96 checks today` | `6m ago · next in 9m` |
| qa | gray | `0 reviewed · waiting for EDITED` | `idle · waits for trigger` |
| research | red | `0 hooks classified today` | `~36h ago · next at 6 AM tomorrow` |
| performance | green | `signals generated · last Mon` | `4d ago · next Mon at 7 AM` |
| scripting | red | `7 scans · 41 voice aborts in 30d` | `2m ago · next in 13m` |
| onboarding | gray | `2 students onboarded · 5d ago` | `idle · waits for trigger` |
| fireflies | green | `1 meeting · 6 action items created` | `12h ago · next at 9 PM tonight` |
| profile-views | gray | `awaiting first run` | `next Thu at 9 AM` |

A few of those numbers will look unhealthy (research red, scripting
red). That's correct — the panel surfacing the real state of the
system. Research has only fired twice in 30 days. Scripting is
processing events but hitting voice-validation aborts at a high rate.
Both are real operational issues the rebuild will surface clearly,
not paper over.

Hovering or tapping any card reveals its description.

Status dot color and headline metric update in near-real-time
(within one 10s poll cycle) as new `agent_logs` rows arrive.

A new row triggers a whole-cell pulse (green/amber/red per status) —
visible from across the room as the panel "breathing" healthy.

INTEGRATIONS displayed as a single ~50–60px pill strip above AGENTS,
not the current ~600px stacked panel.

---

## Constraints

- **No new dependencies.** Existing toolchain is sufficient.
- **No backend changes.** Don't modify `agents/*.js`, `server.js`,
  `handlers/*.js`, or any Supabase migration.
- **Preserve existing exports.** `AGENTS`, `AGENT_BY_NAME`,
  `INTEGRATIONS`, `prevCronFire`, `nextCronFire` must continue to work
  for current consumers (`LiveEventStream`, `lib/health.js`).
- **No insight metrics on AGENTS cards.** No "top hook," no "trend up,"
  no "next calendar event." Those numbers belong to other panels.
- **Single PR.** Push to `feature/dashboard-agents-rebuild`. Do not
  merge until reviewed.
- **Verify before pushing.** Run `npm run build` in `dashboard/` to
  confirm no build errors.
- **Run the action-coverage SQL.** Capture the actual top-N actions per
  agent and report any prose gaps in the PR description:
  ```sql
  SELECT agent_name, action, COUNT(*) as occurrences
  FROM agent_logs
  WHERE created_at > now() - interval '30 days'
  GROUP BY agent_name, action
  ORDER BY agent_name, occurrences DESC;
  ```

## When done

Tell me:

- The final filename(s) created or modified (expect
  `dashboard/src/lib/agents.js`,
  `dashboard/src/components/AgentGrid.jsx`,
  `dashboard/src/components/IntegrationHealth.jsx`,
  `dashboard/src/ops.css`).
- A 1-2 sentence summary of what changed structurally.
- Output of the action-coverage SQL — any actions not in the prose
  maps, flagged.
- Screenshots of the rendered AGENTS panel: full default state, one
  card hovered to show the expanded description, and one card during
  a pulse animation (or short video clip).
- Branch name + PR URL on GitHub.

---

## Verified action census (May 4 2026)

Top 10 actions per agent over the last 30 days, captured from production
`agent_logs`. Used to verify the prose maps in the per-agent specs above
are complete. Every action listed here has prose in the spec.

```sql
WITH ranked AS (
  SELECT agent_name, action, COUNT(*) AS occurrences,
    ROW_NUMBER() OVER (PARTITION BY agent_name ORDER BY COUNT(*) DESC) AS rn
  FROM agent_logs
  WHERE created_at > now() - interval '30 days'
    AND agent_name IN ('pipeline','qa','research','performance',
                       'scripting','onboarding','fireflies','profile-views')
  GROUP BY agent_name, action
)
SELECT agent_name, action, occurrences FROM ranked
WHERE rn <= 10 ORDER BY agent_name, occurrences DESC;
```

#### fireflies

| action | occurrences |
|---|---|
| fireflies_run_started | 21 |
| fireflies_run_complete | 13 |
| clickup_retry_failed | 12 |
| run | 8 |
| self_heal_alert_skipped | 8 |
| clickup_create_failed | 4 |

#### onboarding

| action | occurrences |
|---|---|
| onboarding_complete | 2 |
| industry_report_generated | 1 |
| completion_started | 1 |
| context_document_synthesized | 1 |
| students_table_written | 1 |

#### performance

| action | occurrences |
|---|---|
| performance_run_started | 2 |
| performance_run_complete | 1 |
| performance_run_skipped | 1 |

#### pipeline

| action | occurrences |
|---|---|
| dropbox_scan_complete | 138 |
| dropbox_webhook_received | 138 |
| clickup_webhook_received: taskStatusUpdated | 55 |
| status_change: ready for shooting | 41 |
| dropbox_list_folder_error | 32 |
| status_change_error: ready for shooting | 29 |
| creating_dropbox_folders | 28 |
| status_change: idea | 13 |
| editor_assigned | 12 |
| status_change: ready for editing | 12 |

#### profile-views

| action | occurrences |
|---|---|
| duplicate_post_urls_detected | 2 |

#### qa

| action | occurrences |
|---|---|
| qa_started | 9 |
| qa_failed | 5 |
| runQA | 4 |
| self_heal_alert_sent | 4 |
| self_heal_window_hit | 2 |
| self_heal_attempted | 1 |

#### research

| action | occurrences |
|---|---|
| research_run_started | 2 |
| tiktok_scrape_complete | 2 |
| research_run_complete | 2 |
| instagram_scrape_complete | 2 |
| research_video_error | 1 |

#### scripting

| action | occurrences |
|---|---|
| campus_run_complete | 212 |
| campus_run_started | 212 |
| event_received | 76 |
| event_claimed | 61 |
| student_matched | 61 |
| context_loaded | 61 |
| brand_voice_validate_abort | 41 |
| voice_validation_failed_retrying | 40 |
| voice_abort_claim_released | 28 |
| validation_passed | 19 |

### Operational reads from the census

- **research has only fired twice in 30 days.** Expected ~30 daily runs.
  Either the cron isn't registering on production or the runs are
  silently exiting before logging. Worth investigating outside the
  scope of this rebuild — the dashboard should surface this honestly
  with a red dot, which the spec does.
- **scripting fires `campus_run_complete` 212× in 30 days.** Cron is
  every 15 min (96/day expected = ~2880/month). 212 means the agent is
  exiting before logging in most cron ticks, probably skipping fast on
  the no-event path. The headline metric should reflect actual
  observed runs, not expected.
- **scripting voice-validation is the dominant failure mode.** 41
  `brand_voice_validate_abort` + 40 `voice_validation_failed_retrying`
  in 30 days. The brand-voice gate is currently the biggest source of
  pipeline drag. Surfacing this on the scripting card is correct.
- **pipeline error rate is meaningful.** 29 `status_change_error` over
  138 webhooks = ~21% of routings produce an error. The spec's
  `· N errors` suffix on the pipeline card will be useful most days.
- **profile-views has only logged duplicate detections** because the
  full agent is brand new (shipped earlier today). Census will fill
  out after the first Thursday cron fires.
- **fireflies' `clickup_retry_failed` (12) outweighs successes (13).**
  ClickUp task creation from action items is unreliable. Worth a
  separate fix; the dashboard surfacing this honestly via the
  fireflies card is correct.

### Coverage check

Every action in this census has prose in the spec's per-agent
sections. No gaps. Claude Code does not need to run additional SQL
during implementation — the headline metric functions are designed
against this exact action vocabulary.

If new actions appear in `agent_logs` after this date that aren't in
the prose maps, the card falls back to the raw action string (per the
implementation notes). That's a graceful degradation — not a crash —
and the next census refresh catches it.
