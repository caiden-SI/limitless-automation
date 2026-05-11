# Limitless Automation — System Overview

A short guide to what the system does, who's doing what, and what you need to do.

---

## What this is

The system on the Mac Mini in your office runs nine AI agents that handle
the work between filming and posting. Some fire on a schedule (daily,
weekly), others trigger when something happens (a video moves to a new
status, a filming event hits the calendar, a meeting wraps up). Together
they replace the manual handoffs that used to bounce between ClickUp,
Dropbox, Frame.io, and the team.

Everything runs 24/7. The dashboard on your monitor is your view into
what's happening and whether anything needs attention.

---

## The nine agents

### Pipeline · webhook-driven
Routes every ClickUp status change through eleven production stages.
Creates Dropbox folders, assigns editors, gates QA, syncs Frame.io
links, ships client share links on delivery. The backbone of the
production flow.

### Footage-scan · every 15 minutes
Checks Dropbox every fifteen minutes for new raw footage. When a folder
appears with content, advances the matching video to ready-for-editing
after a one-hour propagation buffer.

### QA · triggered (when a video hits EDITED status)
Runs a four-check quality review on every edited video — audio loudness,
transcript cleanliness, hook presence, framing. Stages corrections back
to ClickUp if anything fails.

### Research · daily 6 AM
Scrapes TikTok and Instagram every morning for trending hooks. Classifies
each into a hook taxonomy that the Scripting agent uses when generating
concepts. Keeps your scripts driven by what's actually working right now.

### Performance · Monday 7 AM
Once a week, analyzes which posts performed and which didn't. Generates
the "Do More Of / Avoid" signals you see in the SIGNALS panel on the
dashboard.

### Scripting · every 15 minutes
Watches your Google Calendar. When a filming event is coming up, generates
three concept scripts personalized to that student, informed by recent
performance data and the student's brand voice. Drops them into ClickUp
as ideas to pick from.

### Onboarding · triggered (when a new student opens the /onboard link)
Walks new students through a conversational intake (six sections, about
fifteen minutes). Produces a Claude project context document that the
Scripting agent uses to make scripts sound like the student.

### Fireflies · nightly 9 PM
Pulls every meeting transcript from Fireflies, extracts action items
via Claude, creates ClickUp tasks for each one. Replaces what used to
be manual note-taking and follow-up assignment.

### Profile-views · Thursday 9 AM
Once a week, scrapes view counts from every student's profiles. Tracks
growth over time so the Performance agent has data to analyze.

---

## What's connected

- **ClickUp** — Source of truth for the production pipeline. Status
  changes trigger most of the workflow.
- **Dropbox** — Raw footage and edited videos live here. Footage-scan
  watches for uploads.
- **Frame.io** — Editor review platform. Pipeline syncs links and
  creates client share URLs on delivery.
- **Fireflies** — Meeting transcripts. The Fireflies agent pulls these
  nightly.
- **Google Calendar** — Filming events trigger Scripting. The team
  schedules shoots; the system reads them and prepares concepts.
- **Anthropic (Claude)** — Powers every AI decision: classification,
  script generation, action-item extraction, performance analysis.
- **Supabase** — The database that stores videos, students, performance
  signals, agent activity logs, and everything else.

---

## What you have to do

The system runs itself most of the time. Your involvement comes down to:

**Onboard new students** — when a new creator joins, send them the
`/onboard` URL with their student ID. They walk through the conversation;
the system handles the rest.

**Make sure handles are populated** — for the Profile-views agent to
track a student's growth, their TikTok / Instagram handles need to be
entered into the system. New students do this during onboarding;
existing students may need their handles added manually.

**Shoot the videos** — the calendar is what drives Scripting. When you
schedule a filming event in Google Calendar, the system sees it and
prepares concepts. Without filming events on the calendar, Scripting
has nothing to do.

**Mark videos "posted by client" in ClickUp** — when a video ships,
move it to the "posted by client" status in ClickUp and paste the
public post URL in the right field. This unlocks Profile-views tracking
for that video and closes the production loop.

**Watch the dashboard** — that's the rest. If something's actually
broken (red dot, action item), call or text Caiden. If it's amber,
glance and decide. If it's green, move on with your day.

---

## When something looks wrong

A short cheat sheet for what to do when the dashboard surfaces a problem.
See the dashboard guide for what each panel means; this is just the
"escalation" version.

- **Red dot on an agent card** — the agent stopped firing. Text Caiden.
- **Red cell in System Pulse** — a piece of infrastructure is broken
  (tunnel down, server resources, etc). Text Caiden.
- **Action Items panel showing red items** — read the item, screenshot,
  send to Caiden if you don't recognize it.
- **Webhook tunnel red specifically** — usually a network blip. Caiden
  can fix in two minutes via SSH.
- **Cron schedule amber** — usually fine, means a cron is slightly
  overdue. Becomes red if it's actually broken.

---

## Contact

When in doubt, screenshot the dashboard and text Caiden. Most issues
are five-minute fixes.
