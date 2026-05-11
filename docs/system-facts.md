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
Cron · weekly Thursday 9 AM · reads TikTok and Instagram profile pages
(via Apify) · writes Supabase student_profile_metrics. Produces the
view-count history that Performance analyzes.

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
Video moved to "posted by client" in ClickUp with public URL pasted →
Profile-views (Thursday 9 AM) scrapes view counts via Apify → stored
in Supabase student_profile_metrics → Performance (Monday 7 AM)
analyzes via Anthropic → writes performance_signals → surfaces on
dashboard SIGNALS panel.

**8. Meeting → action items**
Fireflies records meeting → Fireflies agent (nightly 9 PM) pulls
transcripts → Anthropic extracts action items → ClickUp tasks created.

---

## Notes & known gaps

These are referenced in the State of the System doc but worth flagging
here because they affect how the diagram should be read.

- **Student onboarding URL distribution** — the /onboard URL exists,
  but the path for getting it to students with their student ID
  pre-filled is not yet automated. Currently manual.
- **Content performance Google Sheet sync** — performance signals live
  in Supabase, but the team-facing Google Sheet that reflects them is
  not yet wired up. Two-way sync planned.
- **Existing student handles** — Profile-views requires TikTok and
  Instagram handles in Supabase. New students populate these via
  Onboarding; existing students may need handles entered manually.
- **Manual scripting trigger** — Scripting fires on calendar events
  only. A "generate now" trigger from the dashboard is on the
  roadmap.
- **Profile-views cadence** — currently Thursday 9 AM. Scott has
  requested Friday morning to align with weekly review timing.

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
