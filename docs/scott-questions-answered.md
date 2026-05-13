# Limitless Automation — Answers to Scott's Questions

In response to the questions in the Build Document, May 2026.

---

## Priority Tasks

### Get access to the student chat onboarding interface

The interface lives at `/onboard` on the dashboard server. Each student
gets a personalized URL with their student ID embedded
(`https://[dashboard-domain]/onboard?student_id=XYZ`). Currently URLs
are generated manually per student. Automating distribution (a
self-serve "create student" action that emails the URL automatically)
is on the iteration-3 backlog. To preview the interface, Caiden can
generate a test-student URL on request.

### Determine what materials students need before the chat

Minimal. The conversation is self-contained: about fifteen minutes,
six sections, all conducted in the chat. Before starting, students
should have:

- TikTok handle (so Profile-views can wire up tracking)
- Instagram handle (same reason)
- A working sense of their content niche or who they're targeting
  (the chat will help refine this if they're unsure)
- A browser on phone or laptop

No prep documents required. The chat is conversational and adaptive.

---

## Unanswered Questions

### 1. Where does the data for the Research bot go? How do the hooks get classified?

Research scrapes TikTok and Instagram daily at 6 AM via Apify. Each
hook is sent to Claude (the Anthropic API) for classification into a
hook taxonomy. Both the raw scrape and the classified taxonomy land
in Supabase, in the `trending_hooks` table. The Scripting agent reads
from that table when generating concepts for upcoming filming events.

### 2. Is there a bot connected to Claude through GitHub to manually fire script creation for a concept off the top of our head?

Not yet. Scripting currently fires on Google Calendar events only. A
manual "generate now" trigger is on the iteration-3 backlog. It will
likely take the form of a button on the dashboard or a `/script`
endpoint that accepts a concept and student ID and returns scripts.
Until that ships, manual generation requires running the script
generator directly via the codebase.

### 3. What is "Signals panel renders" in the performance section?

The Signals panel is the bottom-strip dashboard panel showing the
weekly performance brief (DO MORE OF / AVOID recommendations).
"Renders" means the panel reads fresh data from Supabase and displays
it visually. Mechanically: every Monday at 7 AM, the Performance
agent analyzes the last four weeks of view data via Claude and writes
the resulting signals to Supabase. The Signals panel then surfaces
those signals for the rest of the week.

### 4. Is the only current trigger for script creation the Google Calendar event? Does student onboarding need to happen first?

Yes on both counts. The Scripting agent is live and runs every fifteen
minutes via cron. It reads Google Calendar with a 48-hour lookahead and
fires only when it sees an upcoming filming event. For the agent to
produce useful scripts, the student must have completed Onboarding
first (so their brand context exists in Supabase) and have their
handles populated. Matching between a calendar event and a student
happens via the student's name in the event title or attendees, using
`gcal.parseStudentFromEvent`.

Open item: we need to confirm with Scott exactly how filming events
are formatted on the calendar (title pattern, attendee email, or
another signal) so the matching logic recognizes them. UPCOMING SHOOTS
on the dashboard is currently empty either because no filming events
fall in the 48-hour window, or because their format does not match
the parser yet. The scripting panel showing "87 scans, 0 events
triggered" reflects this: the cron has fired 87 times and found zero
qualifying events.

### 5. How long before the shoot does this trigger happen?

The agent is configured for a 48-hour lookahead. It scans every
fifteen minutes and processes any upcoming filming event within
48 hours of the current time. That gives enough lead time for scripts
to generate, Scott to review, and the student to be briefed. The
window is tunable in code (`WINDOW_HOURS` in `agents/scripting.js`)
if we find a different cadence works better.

### 6. Is there a live link for students to do the onboarding chat? What is the process?

Yes, the link is live at `/onboard`. Process today:

1. Caiden creates a student record in Supabase with their handles.
2. The student receives their personalized `/onboard` URL (sent
   manually by Scott or Caiden).
3. The student opens the URL on phone or laptop.
4. They walk through the six-section conversation (~15 minutes).
5. The Onboarding agent writes the brand context document to
   Supabase.
6. From that point on, Scripting can generate scripts using their
   context.

The gap: URL distribution is still manual. Automating it (a
self-serve student-creation action that emails the URL) is on the
iteration-3 backlog.

### 7. Could we move the Apify Profile-views to Friday 9 AM instead of Thursday?

**Resolved 2026-05-11.** Scott approved daily cadence instead
("Yes this is completely fine, lets have it run once per day"),
which is a superset of any single-day-of-week cadence. Cron flipped
from `0 9 * * 4` to `0 9 * * *`. Paid Apify plan covers the
increased run count. iteration-3-fixes.md Fix 2 closed.

### 8. Is the Profile-views data going to get logged into the sheet you previously built, in addition to the backend?

Currently the data goes to Supabase only (the
`student_profile_metrics` table). Two-way sync with Scott's Google
Sheet is a known gap on the iteration-3 backlog. Two paths:

- Scheduled push from Supabase to the Sheet (one-way, simpler)
- Sheet ↔ Supabase webhook sync (two-way, more robust)

We can pick one once Scott confirms which Sheet (link please), what
columns it expects, and whether he wants to keep editing the Sheet
directly or treat Supabase as canonical.

### 9. The SIGNALS section may need an additional subsection for the alphahigh.school IG and TikTok accounts (since we run those).

Agreed. Today Performance and Profile-views aggregate signals at the
student level. To track the brand-owned accounts as a distinct
entity, we'd add a `brand_profile_metrics` track (or an
`is_brand_account` flag on existing profiles) and surface a "Brand"
subsection on the SIGNALS panel separate from the per-student
rollup. This is a real product change rather than a config tweak.
Adding to the iteration-3 list.

### 10. How expensive would it be to have Apify fire every day instead of weekly?

Need to pull our actual current monthly Apify bill and project the
multiplier. Rough math, assuming ~20 students × 2 platforms (TikTok
+ Instagram) = 40 scrapes per run:

- Current cadence: 40 scrapes / week
- Daily cadence: 280 scrapes / week (7×)
- Apify pricing: typically $0.50–$5 per 1,000 results depending on
  the actor

Likely range: $1–$10 per day, or $30–$300 per month, depending on
which actor we're using and how many results per scrape. Caiden will
pull the actual number from the Apify dashboard and confirm before
we change cadence. Worth it if the daily check materially improves
Scott's mid-week course-correction. Expensive if not.

---

## Open items requiring Scott's input

Pulled from the answers above so they're easy to track:

1. **Calendar event format** — confirm the pattern Scott uses for
   filming events (title format, attendees, etc.) so Scripting can
   reliably match events to students.
2. **Profile-views cadence** — closed 2026-05-11 (Q7); now daily 9 AM.
3. **Sheet sync direction** — share the link to the existing Google
   Sheet, confirm columns, and decide one-way or two-way (Q8).
4. **Apify daily cadence** — once Caiden surfaces the actual cost
   delta, confirm whether the daily run is worth it (Q10).

---

## Items going to iteration-3 backlog as a result of this Q&A

- ~~Manual scripting trigger (Q2)~~ — shipped 2026-05-12 as `/scripting`
  console (docs/dashboard-consoles-spec.md). Auto-push deferred per Scott;
  review-then-push is the v1 contract.
- ~~Profile-views cadence move to Friday 9 AM (Q7)~~ — superseded by daily cadence, shipped 2026-05-11
- Google Sheet sync for Profile-views data (Q8)
- Brand-account SIGNALS subsection (Q9)
- ~~Self-serve student creation that auto-distributes onboarding URL~~
  (priority task #1, Q6) — `/students` console shipped 2026-05-12 with
  copy-paste URL UX; SMS/email auto-distribute remains deferred per spec
  decision (docs/dashboard-consoles-spec.md §5.5).
