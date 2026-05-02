# Claude Design Brief — Limitless Ops Pipeline Dashboard

> **You're the designer.** This document gives Claude Design what it needs to help you build — what the system *is*, what data exists, who's looking at the screen, and what they need to know. It deliberately avoids prescribing the visual look (colors, layout, density, theme, typography). That's yours to drive in the canvas.
>
> **How to use:** paste this into a fresh Claude Design project as your opening message, then drive iteration in chat. The "Workflow notes" at the bottom walks you through setup. The "Iteration prompts" section gives you content-focused prompts to push on, not look-focused ones.

---

## 1. What you're building

A responsive operations dashboard for the Limitless Media Agency video production pipeline. It runs across three target devices (see §1.1) — including an always-on portrait Studio Display in the office, Scott's MacBook Air for day-to-day work, and an iPhone for on-the-go checks. It replaces the current tab-based dashboard with a single experience where every state of the system is visible without clicking.

The core read is *"is the pipeline healthy and what needs attention right now?"*

This is a **fresh redesign of the look**. Reuse the data sources and the canonical status names — those are bound to the codebase. Everything else is open: layout, theme, density, color treatment, typography, hierarchy. Design what feels right.

### 1.1 Target devices (all three are first-class)

| Device | Dimensions | Role | Layout note |
|---|---|---|---|
| **Vertical Studio Display** | 1440 × 2560 portrait | Scott's secondary monitor at his desk — sits next to his laptop in portrait orientation. **Actively interactive**, viewed at arm's length, not a wall-mounted ambient display. | Vertical layout. Normal desktop density (13–14px body text is fine). Lots of vertical real estate means everything fits without compromise: agent grid + full pipeline kanban (vertical-flowed) + QA queue + editor capacity + performance signals + integration health + system health. Every panel is clickable/interactive. |
| **MacBook Air** | 1440 × 932 landscape | Scott's primary working screen | Horizontal layout. Tighter — 932px tall is shorter than typical, so content needs to fit cleanly. Compressed-lanes pipeline works well here, or the full kanban gets its own `/pipeline` route. |
| **iPhone** | 430 × 932 portrait | On-the-go status check | Stack everything vertically. Pipeline becomes a list grouped by status, or a tabbed view. Health bars stack. Scrolling is fine on phone. |

The same data, the same content sections, three layouts. The Studio Display is the most generous canvas — design it as a "tall desktop" first, then condense for laptop, then stack for phone.

## 2. Audience

| User | Frequency | What they need from a glance |
|---|---|---|
| **Scott** (production manager) | Primary, all-day | Bottlenecks, QA failures, editor workload, weekly performance trends. Not technical — should not see raw error stacks unless he expands something. |
| **Caiden** (system owner) | Occasional — error checks | Webhook inbox failures, agent errors, FFmpeg/cron health. Wants to drill into details when something is wrong. |

Design Scott-first. Caiden's needs surface as a system-health area that's quiet when everything works and assertive when it doesn't.

## 3. What needs to be on the screen

> **Reframe (added after first iteration with Claude Design):** This dashboard is for monitoring the **automation system** — the seven AI agents Caiden built to run the agency's video production pipeline. The pipeline kanban is NOT the headline. The headline is *"the agents are working — here's what they're doing right now."* The pipeline is a downstream side-effect of the agents' work; surface it compactly, not as the dominant element.
>
> **Visual priority order (highest → lowest):**
> 1. **Agent activity grid** (§3.0) — what each agent is doing, when it last ran, when it runs next, throughput, errors. THIS is the headline.
> 2. **Live event stream** — webhooks arriving and being processed, agent decisions being made
> 3. **Integration health** — ClickUp, Dropbox, Frame.io, Fireflies, Google Calendar, Supabase, Anthropic — all connected and ticking
> 4. **System health bar + System health strip** — infrastructure uptime
> 5. **Operational health bar** — pipeline-level outcome metrics
> 6. **Pipeline summary** (§3.1) — a compact widget showing where work is, NOT a full kanban
> 7. **QA queue** — what needs editor attention
> 8. **Editor capacity** — workload
> 9. **Performance signals** — weekly insights

### 3.0 Agent grid — the dominant read

A grid (or row, or row-of-rows) of cards, **one per agent**. There are seven agents in the system today:

| Agent | Trigger | What it does |
|---|---|---|
| **Pipeline** | ClickUp webhook (status changes) | Routes status changes to actions: creates Dropbox folders, assigns editors, triggers QA, creates client share links |
| **QA** | Pipeline agent on `edited` | LLM-powered quality gate: spell check, caption formatting, FFmpeg LUFS audio check, stutter/filler detection |
| **Research** | Cron · daily 6 AM | Scrapes TikTok/Instagram, classifies hooks/formats/topics with Claude, dedupes |
| **Performance** | Cron · Monday 7 AM | Weekly Claude pattern recognition over performance data + research benchmarks |
| **Scripting** | Cron · every 15 min | Watches Google Calendar, generates 3 concept scripts per filming event |
| **Onboarding** | Student opens `/onboard?student=...` | Conversational Claude intake; produces a Claude Project context document for each student |
| **Fireflies** | Cron · nightly 9 PM | Pulls meeting transcripts → Supabase, extracts action items → ClickUp tasks |

**Per-agent card should show:**
- Agent name + a status pill: `IDLE` (green), `RUNNING` (blue, animated), `ERROR` (red), `WAITING FOR TRIGGER` (gray)
- One-line description of what it does
- **Last run**: timestamp + outcome (success/error)
- **Next run**: scheduled cron time, or "on trigger" for event-driven agents
- **Today's throughput**: count of successful runs today (e.g., "Pipeline · 23 status routes today")
- **Recent errors**: count + click to expand the latest error message
- A small sparkline or 24h timeline showing activity

Visual treatment is open — could be tall cards in a 7-card row, or a 2×4 grid (with one cell for "All systems"), or a vertical list with each agent as a row. The portrait Studio Display has room for big agent cards stacked vertically; the laptop view can compress to a compact grid.

### 3.0.1 Live event stream
Replaces the old "agent activity feed" framing — same data (`agent_logs`), but presented as a live stream of *system actions* with stronger visual emphasis. Each row: agent badge + the action + relative time. Errors expand. Refreshes every 10s, hover pauses. On the Studio Display this is a wide column on the right or below the agent grid. On laptop, it's a sidebar. On phone, it's a tab.

### 3.0.2 Integration health
Pills or chips, one per external system: ClickUp, Dropbox, Frame.io, Fireflies, Google Calendar, Supabase, Anthropic. Each shows:
- Connected / Disconnected (green / red)
- Last successful interaction timestamp
- Click to expand: last 5 events with that integration

Lives near the System Health strip at the bottom (or wherever your layout puts infrastructure status).

### 3.1 Pipeline summary (compact, not dominant)

Now demoted from the headline read. The pipeline is downstream ClickUp state, useful as context but not the focus. Surface it as a **compact summary visualization**, not a full kanban:

- A horizontal stacked bar showing counts per status (idea 8 · ready for shooting 6 · ready for editing 4 · in editing 7 · edited 3 · uploaded 5 · sent 4 · revised 2 · posted 5 · done 2 · waiting 1)
- Or a small funnel showing the 11 stages flowing left-to-right with counts
- Or a row of 11 mini-columns with just count + name (no card-level detail)

Stuck videos still need to be visible — overlay a count or a red marker on any status with stuck items. Click-through to the full kanban view (which can live on a separate page or modal — out of the at-a-glance screen).

Detail per video that should be reachable when clicked: title, student name, last-updated relative time, QA pass/fail badge, assigned editor, stuck indicator. Stuck thresholds:

`idea` → `ready for shooting` → `ready for editing` → `in editing` → `edited` → `uploaded to dropbox` → `sent to client` → `revised` → `posted by client` → `done` → `waiting`

Per-video info that should be reachable: title, student name, last-updated relative time, QA pass/fail badge if present, assigned editor, and a **stuck indicator** when a video has been in a status longer than its threshold:

| Status | Stuck threshold |
|---|---|
| idea | 7 days |
| ready for shooting | 5 days |
| ready for editing | 3 days |
| in editing | 4 days |
| edited | 24 hours |
| waiting | 24 hours |
| all others | 7 days |

Note: the database stores statuses uppercase (`IDEA`, `READY FOR SHOOTING`, etc.) because of how the pipeline agent writes them. Display them however you want — the existing dashboard lowercases them.

### 3.2 Agent activity (live event feed) — see §3.0.1
This is the same content as §3.0.1 above. Keeping the data shape spec here for reference: newest-first stream from `agent_logs`. Each row: agent name (pipeline, qa, research, performance, scripting, onboarding, fireflies, scheduler, server), action description, timestamp, optionally error message + retry count.

### 3.3 QA queue (what needs editor attention)
Two groups:
- **Awaiting QA** — videos with `status === 'EDITED'` and `qa_passed === null` (haven't been checked yet).
- **Failed / Waiting** — videos where `qa_passed === false` or `status === 'WAITING'` (someone needs to fix something).

For failures, the recent matching error message from `agent_logs` is the most useful thing to surface inline (e.g., *"LUFS -17.2 (target -14 ±1) · stutter at 00:42"*). Also surface the assigned editor's name so Scott knows who to nudge.

### 3.4 Editor capacity
One element per active editor. Today there are two on the Austin campus: Charles Williams and Tipra. The key number is "videos currently in `IN EDITING` assigned to them." A target of ~5 active is reasonable — over that, they're overloaded. Empty state: "No active editors."

### 3.5 Performance signals (latest week only)
The Performance Agent writes one row per week. Most recent row only. It includes:
- A summary paragraph
- Three categories — top hooks, top formats, top topics — each with a small list of items + view counts (`avg_views`)
- Recommendations (positive)
- Underperforming patterns (negative)

Empty state: *"First report generates Monday 7AM."*

### 3.6 System health
Five health indicators, each green/amber/red:

| Cell | Green | Amber | Red |
|---|---|---|---|
| Webhook inbox | All events processed within 60s | Any unprocessed > 60s | Any `failed_at` set in last hour |
| Cron jobs | All 5 scheduled jobs ran on time | Any job missed by > 2h | Any job missed > 24h or last run errored |
| FFmpeg | Last QA produced a LUFS measurement | — | Server boot health check failed |
| Tailscale | Last webhook within 24h | 24–48h ago | 48h+ |
| Recent errors | 0 in last hour | 1–4 | 5+ |

Each should drill into the relevant rows from `agent_logs` or `webhook_inbox` when expanded.

### 3.7 Header
Campus selector (default Austin — only active campus today), last-refresh indicator, **two health bars** (see §3.7.1), and two user toggles:

- **Theme toggle** — light / dark mode. Persists across reloads (localStorage). Both modes are first-class — neither is a "default with a fallback." Design both fully.
- **Background toggle** — on / off for an ambient animated background (see §3.8). Default off so the dashboard reads cleanly on first load. Persists across reloads.

Both toggles live in the header chrome so they're discoverable but not in Scott's primary read path.

#### 3.7.1 Health bars (the two summary scores)

Two horizontal percentage bars in the header. Each shows a 0–100 score with color encoding (green ≥90, amber 60–89, red <60). Hover or click reveals the breakdown so it's clear *why* the number is what it is.

**Operational Health (Scott's bar)** — is the *production line* healthy? Pipeline-focused. Total = 100, weighted by impact. Each metric measures a real problem regardless of time of day, so the bar doesn't drop on slow nights or weekends:

| Component | Weight | Scoring |
|---|---|---|
| Stuck videos count | 35 | 0 stuck = 35 · 1–2 = 23 · 3–5 = 12 · 6+ = 0 |
| Editor overload | 30 | No editor ≥5 active = 30 · one ≥5 = 15 · multiple ≥5 = 0 |
| QA failure rate (last 7 days) | 35 | <10% = 35 · 10–25% = 17 · >25% = 0 |

(Note: an earlier draft included a "pipeline freshness" metric that scored time-since-last-status-change. That was dropped because it falsely penalized idle nights/weekends. The "stuck videos" metric already captures the real signal — videos sitting too long in a single status — without the false positives.)

**System Health (Caiden's bar)** — is the *infrastructure* up? The same 5 cells from §3.6, weighted by blast radius:

| Cell | Weight | Green / Amber / Red |
|---|---|---|
| FFmpeg | 25 | 25 / — / 0 (no amber state — it's binary) |
| Webhook inbox | 25 | 25 / 12 / 0 |
| Cron jobs | 20 | 20 / 10 / 0 |
| Recent errors | 15 | 15 / 7 / 0 |
| Tailscale | 15 | 15 / 7 / 0 |

Hover/expand on either bar shows the line-by-line breakdown: *"Stuck videos 23/35 · Editor overload 30/30 · QA failures 17/35 = 70%."* Click on any line jumps the page to the relevant panel (stuck videos → scroll the pipeline; editor overload → editor capacity, etc.).

Both bars live in the header. Visual treatment is open — stacked, side-by-side, labeled, or compact-with-tooltip — that's a Claude Design call. The data and rules above are the spec.

### 3.8 Ambient background (toggleable)
When the background toggle is **on**, render a slowly-evolving grayscale noise/grain field behind the dashboard content — soft radial falloff, very fine particles, drifting slowly. Inverts cleanly for light vs. dark mode (dark grain on near-white, light grain on near-black). Implementation as a fullscreen canvas pinned behind everything (`z-index: -1`, `pointer-events: none`).

Constraints:
- Cap opacity ≤ 15%. The dashboard is data-dense — the background must not compete with reads.
- Pause animation when the System Health strip is amber or red. Motion behind triage is fatiguing.
- Disable automatically on mobile (≤500px wide) regardless of toggle state — phones don't have the screen budget for atmospheric chrome.
- Respect `prefers-reduced-motion: reduce` — if the user's OS asks for less motion, force off.

## 4. Data sources

The dashboard reads exclusively through Supabase RPCs (anon key, tenant-scoped by `campus_id`). All RPCs already exist and are wired in `dashboard/src/lib/hooks.js`:

```js
useCampuses()                                // active campuses
useVideos(campusId)                          // get_campus_videos
useAgentLogs(campusId, limit=50)             // get_campus_agent_logs
useEditors(campusId)                         // get_campus_editors
useEditorCounts(campusId)                    // same as useVideos, filtered client-side
usePerformanceSignals(campusId, limit=4)     // get_campus_performance_signals
```

**Two new hooks need to be added** for system health:

```js
useWebhookInboxStatus(campusId)  // count by state, latest failed event time
useSystemHealthSummary(campusId) // last cron timestamps, FFmpeg, Tailscale last-event
```

### Data shapes (verbatim from the existing code)

```ts
Video {
  id: uuid
  campus_id: uuid
  title: string
  status: 'IDEA' | 'READY FOR SHOOTING' | 'READY FOR EDITING' | 'IN EDITING'
        | 'EDITED' | 'UPLOADED TO DROPBOX' | 'SENT TO CLIENT' | 'REVISED'
        | 'POSTED BY CLIENT' | 'DONE' | 'WAITING'
  qa_passed: boolean | null
  student_name: string | null
  assignee_id: uuid | null   // foreign key to editors.id
  dropbox_folder: string | null
  updated_at: timestamptz
}

AgentLog {
  id: uuid
  campus_id: uuid
  agent_name: 'pipeline' | 'qa' | 'research' | 'performance' | 'scripting'
            | 'onboarding' | 'fireflies' | 'scheduler' | 'server'
  action: string
  status: 'success' | 'error' | 'warning'
  error_message: string | null
  created_at: timestamptz
}

Editor {
  id: uuid
  campus_id: uuid
  name: string
  active: boolean
}

PerformanceSignal {
  id: uuid
  campus_id: uuid
  week_of: date
  summary: string | null
  top_hooks:   Array<string | { type, avg_views }>
  top_formats: Array<string | { type, avg_views }>
  top_topics:  Array<string | { topic, avg_views }>
  raw_output: { recommendations: string[], underperforming_patterns: string[] }
}

WebhookInboxRow {
  id: uuid
  event_type: string
  payload: jsonb
  received_at: timestamptz
  processed_at: timestamptz | null
  failed_at: timestamptz | null
  error_message: string | null
  retry_count: int
}

// Optional — produced by the new Fireflies agent (cron 9PM nightly).
// Not surfaced in the dashboard yet; could power a "Recent Meetings"
// panel if you want it. Action items extracted from these transcripts
// are auto-created as ClickUp tasks in `idea` status, so they already
// flow into the pipeline board.
MeetingTranscript {
  id: uuid
  campus_id: uuid
  student_id: uuid | null
  fireflies_id: string  // unique
  title: string | null
  meeting_date: timestamptz
  duration_seconds: int
  organizer_email: string | null
  participants: jsonb
  transcript_text: string | null
  summary: string | null
  fetched_at: timestamptz
}
```

## 5. Behavior (non-visual)

- **Auto-refresh** intervals (use the polling pattern in `dashboard/src/lib/hooks.js`): pipeline 15s, agent activity 10s, editors 30s, performance signals 60s, system health 30s.
- **Stable identity across polls.** Don't re-mount cards on each refresh. Use stable React keys.
- **Hover pauses** the activity feed so it's readable.
- **Errors don't block render.** If one RPC fails, that section shows an inline error and the rest stays live.
- **Read-only.** No write actions, no auth UI, no `/onboard` integration. The agents own writes. The dashboard is a trusted-display read view using the anon key.
- **Toggle persistence.** Theme and background-on/off both persist in `localStorage` under keys `limitless.theme` (`'light' | 'dark'`) and `limitless.bg` (`'on' | 'off'`). Hydrate on mount before first paint to avoid flash-of-wrong-theme.
- **Click-throughs to design** (out of scope to wire, but design the affordances):
  - Click pipeline card → modal with the full video record + recent `agent_logs` filtered to that video
  - Click QA failure → same modal scrolled to the failure log
  - Click editor → list of their assigned videos
  - Click system-health cell → relevant rows

## 6. Existing codebase reference

When linking the codebase to Claude Design, point it at `dashboard/src/components/` and `dashboard/src/lib/`. Do not link the repo root — Claude Design lags on monorepos. Subdirectory links give Claude the existing JSX patterns, polling hooks, and data shapes to mirror without rebuilding the data layer.

The current dashboard has these components — they're tab-based and you're replacing them, but they're a useful reference for *how the data flows*:
- `PipelineView.jsx` — kanban using the same status order
- `AgentActivityFeed.jsx` — log feed with agent badges
- `QAQueue.jsx` — two-section list (awaiting / failed)
- `EditorCapacity.jsx` — editor cards with active counts
- `PerformanceSignals.jsx` — weekly signal cards

The current visual treatment (status colors, dark/light theme, layout proportions, density) is **not** something to copy. That was a first-pass utility look. You're redesigning.

## 7. Optional starting context for Claude Design

When you paste this brief, you can also tell Claude Design any preferences you have at the start, or skip it entirely and let it propose. Things you might want to specify (or leave open):
- Theme direction (dark / light / either)
- Density (information-dense vs. spacious)
- Brand vibe (clinical / playful / editorial / utilitarian)
- A reference look you like (a screenshot of any product whose dashboard you admire)
- Whether you want a single screen or multiple views

If you don't know yet, don't decide upfront. Tell Claude Design *"surprise me with three different directions and I'll pick"* — that's a faster way to find what you like than describing it in words.

---

## Workflow notes — using Claude Design

### Step 1: Open Claude Design
1. Go to `claude.ai`. Pro, Max, Team, or Enterprise plan required (research preview from Anthropic Labs; default-off for Enterprise — admin can enable in settings).
2. Switch on Claude Design from the labs/features menu.
3. If your team has a custom design system configured, it'll auto-apply. Otherwise you'll define the look conversationally.

### Step 2: Create the project and add context
1. **New project**, name it something like *"Limitless Ops Dashboard."*
2. Paste **this entire brief** into the chat as your first message. End with what *you* want to do first — for example:
   - *"Show me three different visual directions for this dashboard before we pick one."*
   - *"Generate a first version with a dark theme and we'll iterate."*
   - *"Don't generate yet — ask me your top 5 questions first."*
3. **Attach references**:
   - Screenshots of any dashboards you admire (Linear, Vercel, Datadog, Retool, Plane, Notion, Posthog — whatever resonates). Caption: *"For visual inspiration, not literal copy."*
   - **Link the subdirectories** `dashboard/src/components/` and `dashboard/src/lib/` from the repo so Claude can mirror the data layer.
   - Optionally upload screenshots of the *current* dashboard as *"this is what we're replacing — same data, completely different look."*

### Step 3: Iteration prompts (content/structure, not look)
Use these as a sequence, or skip/reorder freely. They're written to push on what to surface, not how it looks — that's your call in chat and inline comments.

1. *"Walk me through your layout decisions. Why is each panel where it is? What did you put closest to the eye?"*
2. *"Scott opens this at 9 AM and one editor is overloaded, one video has been stuck in QA for 2 days, and a webhook hasn't been processed in an hour. Where does his eye go in what order? Show me the screen in that scenario."*
3. *"What can I drop without losing the at-a-glance read? I'd rather have less stuff bigger than more stuff smaller."*
4. *"Add a stuck-status indicator to the pipeline so we can tell visually which videos have been sitting longer than their threshold (see thresholds in the brief). Show me three different visual treatments and I'll pick."*
5. *"Show the QA Failed card with a real failure reason — `LUFS -17.2 (target -14 ±1) · stutter at 00:42`. Where does the failure reason go and how does the editor's name fit in?"*
6. *"Render this with realistic seed data: 47 videos across all 11 statuses (weighted: 8 idea, 6 ready for shooting, 4 ready for editing, 7 in editing, 3 edited, 5 uploaded to dropbox, 4 sent to client, 2 revised, 5 posted by client, 2 done, 1 waiting). Two editors (Charles 4 active, Tipra 3 active). 12 agent activity rows including one QA error. One performance signal row for the latest week."*
7. *"Now show me the worst-case state — System Health is mostly red, the activity feed is full of errors, three videos are stuck. Does the design still hold up or does it become noise?"*
8. *"Review for accessibility — contrast on every status color, font sizes from 5ft viewing distance (it's on a wall monitor), motion that could trigger vestibular issues, color-blindness considerations on the 11-color status palette."*

### Step 4: Use inline comments for tweaks
Click directly on a panel/element and request the change there — *"this section is too dense,"* *"swap these two columns,"* *"I want this to be the focal point."* Reserve chat for structural rethinks.

### Step 5: Export
- **Send to Claude Code** when you're happy — generates a working React + Vite project that mirrors the existing `dashboard/` stack. Drop into `dashboard/src/pages/Ops.jsx` and route to it.
- **PDF / PPTX** for a stakeholder review with Scott before you build.
- **Standalone HTML** if you want a static reference.

### Tips that pay off
- Be specific in feedback. *"Tighten the spacing between QA cards"* beats *"make it tighter."*
- Ask for variations early when you're undecided. Comparing two options is faster than describing one.
- Save before risky pivots. *"Save this version and try a layout where the activity feed is the dominant panel."* Claude saves and confirms where, so you can return.
- If inline comments disappear (a known limitation), paste them into chat instead.
- Link subdirectories, not the repo root — large repos lag.
- *"Chat upstream error"* → start a fresh chat tab in the same project.

---

*Last updated 2026-05-01.*
