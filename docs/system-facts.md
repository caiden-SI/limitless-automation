# Limitless Automation — System Facts

A structured reference of what exists, what triggers what, and how data
moves between components. Designed to be readable as standalone
documentation and consumable as input to diagramming tools.

This document is the source of truth for the architecture diagrams. If
something here is wrong, the diagrams will be wrong.

---

## Components

### 9 Agents
Pipeline · Footage-scan · QA · Research · Performance · Scripting ·
Onboarding · Fireflies · Profile-views

### 7 Integrations
ClickUp · Dropbox · Frame.io · Fireflies · Google Calendar ·
Anthropic (Claude) · Supabase

Supabase is the spine — every agent reads from and writes to it.
Anthropic is the brain — every agent that makes a judgment call routes
through it.

---

## Agent specs

Format: trigger · cadence · reads from · writes to

**Pipeline**
Webhook (ClickUp status change) · continuous · reads ClickUp status,
Supabase videos · writes Dropbox folders, Frame.io projects, ClickUp
custom fields, Supabase videos. Routes every video through eleven
production stages.

**Footage-scan**
Cron · every 15 minutes · reads Dropbox folder contents, Supabase
videos · writes ClickUp status (advances to "ready for editing"),
Supabase videos. One-hour propagation buffer before advancement.

**QA**
Triggered (ClickUp status hits "edited") · event-driven · reads Frame.io
video, the edited video file · writes ClickUp comments (corrections),
Supabase videos.qa_passed. Four checks: audio loudness, transcript
cleanliness, hook presence, framing.

**Research**
Cron · daily 6 AM · reads TikTok and Instagram (via Apify) · writes
Supabase trending_hooks. Classifies each hook into a taxonomy used by
Scripting.

**Performance**
Cron · weekly Monday 7 AM · reads Supabase videos and view counts ·
writes Supabase performance_signals. Produces the "Do More Of / Avoid"
signals shown on the dashboard.

**Scripting**
Cron · every 15 minutes · reads Google Calendar (filming events),
Supabase students, performance_signals, trending_hooks · writes ClickUp
tasks (three concept scripts per event), routes generation through
Anthropic.

**Onboarding**
Triggered (student opens the /onboard URL) · event-driven · reads user
input via conversational web form · writes Supabase
students.brand_context. Six sections, about fifteen minutes per
student.

**Fireflies**
Cron · nightly 9 PM · reads Fireflies API (meeting transcripts) ·
writes Supabase transcripts, ClickUp tasks (action items extracted via
Anthropic).

**Profile-views**
Cron · daily 9 AM · reads every tracked post URL via Apify (per-URL
scrape, not channel scrape) · writes Supabase performance · pushes
the week's deltas back to the Content Performance Tracker sheet.
Produces the view-count history that Performance analyzes.

---

## Integration roles

**ClickUp** — source and sink. Source: status changes drive the
pipeline. Sink: scripting writes concept tasks; QA writes correction
comments; Fireflies writes action-item tasks.

**Dropbox** — source. Raw footage and edited videos are staged here by
the team. Footage-scan watches for uploads.

**Frame.io** — source and sink. Pipeline creates projects and writes
share links into ClickUp; QA reads the edited video for review.

**Fireflies** — source. Meeting transcripts are pulled nightly by the
Fireflies agent.

**Google Calendar** — source. Filming events drive Scripting. The team
schedules shoots; the system reads them and prepares concepts.

**Anthropic (Claude)** — source. Powers every AI judgment in the
system: classification (Research), generation (Scripting), extraction
(Fireflies), analysis (Performance), QA scoring (QA).

**Supabase** — source and sink, the spine. Every agent reads from and
writes to it. Tables include videos, students, trending_hooks,
performance_signals, transcripts, student_profile_metrics, agent_logs,
campuses.

---

## Key data flows

Each flow is a directional sequence of events that moves a video,
student, or insight through the system.

**1. Status change → production advancement**
ClickUp status changes → ClickUp webhook → Pipeline agent → branching
side effects (Dropbox folder, Frame.io project, editor assignment,
client share link) → Supabase videos updated.

**2. Footage upload → ready for editing**
Filmer uploads to Dropbox → one-hour propagation buffer → Footage-scan
detects new content (every 15 min) → advances ClickUp status →
Pipeline assigns editor.

**3. Edited → QA → next stage or rework**
Editor marks ClickUp "edited" → ClickUp webhook → QA agent runs four
checks via Anthropic → if pass, status advances; if fail, corrections
post to ClickUp comments and status returns to in-editing.

**4. Trending hooks → script generation**
Research scrapes TikTok and Instagram daily 6 AM → classifies hooks via
Anthropic → writes Supabase trending_hooks → Scripting reads on next
filming event.

**5. Filming event → three concept scripts**
Google Calendar event for student → Scripting (every 15 min) → reads
student brand context + recent performance signals + trending hooks
from Supabase → generates three scripts via Anthropic → writes ClickUp
tasks.

**6. New student → brand context**
Student opens /onboard URL → Onboarding agent walks through six-section
conversation via Anthropic → produces brand context document → stored
in Supabase students.brand_context → used by Scripting.

**7. Posted → view tracking → performance signals**
Video moved to "posted by client" in ClickUp (or URL pasted into the
Content Performance Tracker sheet) → Profile-views (daily 9 AM)
scrapes view counts via Apify → stored in Supabase performance →
Performance (Monday 7 AM) analyzes via Anthropic → writes
performance_signals → surfaces on dashboard SIGNALS panel.

**8. Meeting → action items**
Fireflies records meeting → Fireflies agent (nightly 9 PM) pulls
transcripts → Anthropic extracts action items → ClickUp tasks created.

---

## Notes & known gaps

These are referenced in the State of the System doc but worth flagging
here because they affect how the diagram should be read.

- **Student onboarding URL distribution** — closed 2026-05-13.
  `/students` dashboard console generates the personalized URL on
  student creation (copy-paste UX; SMS/email auto-distribute deferred).
  See `docs/dashboard-consoles-spec.md` §5.
- **Content performance Google Sheet sync** — closed 2026-05-11 as
  **two-way** sync (commit `2b7ab06`). `agents/profile-views.js` calls
  `sheet_pull_complete` (Sheet → Supabase, pulls new post URLs) and
  `sheet_push_complete` (Supabase → Sheet, writes weekly deltas) on
  every run. Supabase remains canonical.
- **Existing student handles** — Profile-views requires TikTok and
  Instagram handles in Supabase. New students populate these via
  Onboarding; existing students may need handles entered manually.
- **Manual scripting trigger** — closed 2026-05-13. `/scripting`
  dashboard console accepts a student + concept title and generates
  3 scripts on demand, with per-card REFINE + PUSH TO CLICKUP. See
  `docs/dashboard-consoles-spec.md` §4.
- **Profile-views cadence** — daily 9 AM (flipped from weekly
  Thursday on 2026-05-11; iteration-3 Fix 2 closed).
- **Calendar event matching** — closed 2026-05-12 (Fix 10). Scripting
  now matches by attendee email against `students.email`, since all
  filming events share the same title "Limitless Student Videos".

### Still open

- **Frame.io v4 comment routing + share-link automation** — Fix 9
  deferred behind Adobe Enterprise OAuth upgrade. Today the comment
  → ClickUp `waiting` flip and the `done` → share-link write are
  manual workarounds.
- **QA precondition awareness** — Fix 13 drafted. QA currently posts
  noisy "no .srt found / no video found" comments on tasks where the
  editor hasn't uploaded yet. Not blocking (advisory hotfix on
  2026-05-13 stopped the recursive waiting-loop), just noise.
- **Manually-created ClickUp tasks** — editors (Charles) sometimes
  create tasks directly in ClickUp, bypassing the Scripting →
  calendar-event origination path. Pipeline catches them via webhook
  but `videos.student_id` ends up null and folders may not get
  created. Fix 14/15 drafted; gated on understanding Charles's
  workflow intent.
- **Brand-account SIGNALS subsection** — Fix 7 drafted. Tracks
  alphahigh.school IG + TikTok as a distinct entity in the SIGNALS
  panel separate from the per-student rollup. Awaiting Scott input.

---

## Conventions used in diagrams

- **Arrows** represent direction of data flow or triggering.
- **Cron labels** (e.g., "every 15 min", "daily 6 AM") sit on the
  arrow that fires the agent.
- **Webhook labels** mark trigger arrows from external services.
- **Color** distinguishes layer: integrations (one color), agents
  (another), data spine — Supabase, Anthropic — distinct again.
- **Dashed lines** indicate planned or partial connections (i.e. the
  known gaps above).
