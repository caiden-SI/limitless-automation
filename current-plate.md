# What's On Our Plate — May 8, 2026 (updated evening)

**Important update from this evening:** Frame.io has a third role we
missed earlier — **new-post detection**. Frame.io was supposed to
detect when a Limitless-made video goes live and add it to the
tracked posts list with its URL. Without that, Profile-views has no
idea about new posts (e.g., Alpha High posted 4 IG videos this week
that the agent never tried to scrape because they weren't in the
videos table).

Sheet Sync (Fix 5) is now **two-way**, not one-way. Scott pastes new
post URLs into student tabs in the Content Performance Tracker
Sheet; Direction 1 of the sync (Sheet → Supabase) creates the
matching `videos` rows so Profile-views can track them. Direction 2
(Supabase → Sheet) writes the weekly deltas back as planned.

This means **Fix 5 (Sheet Sync) and Fix 11 (Profile-views URL-based
refactor) MUST ship together**. The agent depends on the new URLs
being pulled from the sheet; the sheet depends on the agent writing
correct deltas. Build as a single coupled deliverable.

---


Snapshot after Scott's reply to the Build Document Q&A and the Frame.io
v4 OAuth license discovery. Use as the working punch list. Fed by:
- Scott's seven comments on `Automation Suite Build Document (1).docx`
  (May 7, 2026)
- The Frame.io v4 OAuth license blocker discovered May 8 evening
- All open items from `iteration-3-fixes.md`

Items are grouped by who's blocking what, not by Fix number, so it's
easy to see what's actually shippable now vs. waiting on a third party.

---

## Awaiting Scott's input (he replies, you ship)

These are blocked on a single Scott response; once received, each is
small to ship.

1. **Per-student Claude Project question** (Scott's comment #2)
   Scott asked whether each student gets their own Claude Project that
   could be iteratively trained based on content performance. Needs an
   honest answer from you on what currently exists vs. what could be
   built. Three things to confirm with him:
   - Today: each student has a `claude_project_context` document in
     Supabase (the 8-section synthesis from Onboarding). The Scripting
     agent feeds that context PLUS fresh performance signals + research
     benchmarks to Claude on each script generation, so the prompt is
     dynamic per call.
   - The completion screen of `/onboard` says "create a project at
     claude.ai/projects and paste this context" — implying he's been
     creating manual claude.ai projects per student. Confirm if that
     workflow is still active or if we can drop it.
   - Pitch the iterative-training feature (weekly job that re-synthesizes
     each student's context from recent post performance) as an
     iteration-3+ build if he wants it.

2. **Frame.io support contact** (your action, not Scott's reply)
   Have Scott contact Frame.io support to ask whether his current plan
   SHOULD include Server-to-Server OAuth. The hover error said
   "if you think this is an error, contact support." Worth 5 minutes
   of his time before accepting the plan-tier conclusion. If Adobe
   says "yes you have access, here's how to enable," the entire
   Frame.io migration unblocks.

---

## Shippable now (your code, no third-party wait)

These have all the inputs needed; just engineering work to do.
Two co-equal critical items at the top — pick whichever you can
focus on first; both are needed before next Thursday's run.

**3a. Profile-views URL-based scraping refactor** (Fix 11 in
iteration-3-fixes.md) — CRITICAL DATA QUALITY

The first scheduled run on May 8 captured the wrong data. Channel-
level scraping missed 95% of Instagram tracked posts, and the
"31 rows written" we celebrated were cumulative all-time view
counts labeled as weekly deltas. Pinned videos inflated Alex
Mathews' May 1 number by 1.4M views. You manually recovered
the data for the deadline by URL-scraping each tracked post and
computing deltas in Python.

Five sub-changes need to ship together (full spec in Fix 11):
- Switch `tools/scraper.js` to URL-based scraping per platform
- Refactor `agents/profile-views.js` `run()` to iterate URLs not profiles
- Add `weekly_delta` and `cumulative_views` columns to `performance`
- Stub Twitter (mark manual until a working actor is found)
- Wire ClickUp's "posted by client" handler to populate
  `videos.post_url_*` columns from custom fields, plus a one-off
  backfill from the existing spreadsheet URLs

Without this, every weekly run repeats the May 8 problem.

**3b. Calendar attendee matching** (Scott's comment #4 / Fix 10) —
CRITICAL UNBLOCKER
   Scott confirmed: event title is `"Limitless Student Videos"`,
   attendees are students with `first.last@alpha.school` emails,
   ignore `scott@limitlessyt.com`, `charles@limitlessyt.com`,
   `jack.oremus@alpha.school`. The current `parseStudentFromEvent`
   matcher in `lib/gcal.js` looks at title text only, which won't
   work since all events share the same title.
   
   Build needed:
   - Update `gcal.listUpcomingFilmingEvents` to include attendees in
     the returned event objects (currently strips them)
   - Rewrite `parseStudentFromEvent` to match by attendee email
     against `students.email` (likely a new column to add)
   - OR keep matching by name but parse attendee email local-parts
     (`first.last` → `First Last`) and match against `students.name`
   - Make the ignored-email list config-driven via env var, not
     hardcoded
   
   Until this ships, UPCOMING SHOOTS stays empty even when filming
   events are on the calendar. Scripts won't generate. Highest
   leverage item on the plate.

4. **Daily Apify cron switch** (Scott's comment #6 — APPROVED)
   Single-line change: `'0 9 * * 4'` → `'0 9 * * *'` in `server.js`
   line 204. ~5 min to ship after Scott's Apify account is wired in.
   
   Sub-blocker: needs Scott's Apify account set up first so the
   higher daily cost lands on his plan, not your free tier. Text
   Scott to start the Apify account if he hasn't.

5. **Sheet sync — one-way push** (Scott's comment #5 — CONFIRMED)
   Confirmed direction: one-way (Supabase → Sheet), Supabase
   canonical. He's been editing manually but doesn't need to going
   forward. Spec is ready in `sheet-sync-spec.md`. Build window:
   this weekend, after one Profile-views run lands real data we
   can test against.

6. **Test onboarding URL for Scott** (Scott's comment #1)
   Scott wants a test URL for a specific student he has in mind.
   Run `scripts/create-student.js` with a clearly-marked test name,
   send him the URL. ~5 min. Easy trust-building win.

7. **"Stub mode" label fix** (already shipped May 7)
   Done. Verify after next deploy that the dashboard shows
   `awaiting filming events · N scans this month` instead of
   `stub mode`.

---

## Iteration-3 backlog (build queue, sequenced by impact)

These don't have Scott blockers but aren't urgent. Order by leverage.

8. **Self-serve student creation flow with auto-distributed URL**
   (Scott's comment #0 — APPROVED)
   Builds on the existing `scripts/create-student.js`. Add a
   dashboard button that creates the student row and either copies
   the URL or auto-sends to the student via SMS/email. Scott said
   "if not difficult lets do this as well" — so the auto-distribute
   variant, not just URL copy.

9. **Manual scripting trigger** (Scott's comment #3 — CONFIRMED)
   Dashboard button or `/scripting/generate` endpoint that takes a
   concept brief + student ID and returns 3 generated scripts.
   Useful for "I have an idea right now, generate scripts off the
   top of my head."

10. **Brand-account SIGNALS subsection** (covered by Scott earlier
    in the doc — agreed in principle)
    Add `is_brand_account` flag on `students` and split SIGNALS
    panel into per-student vs. brand subsections. Real product
    change, not a config tweak.

11. **Onboarding chat polish** (already shipped May 7)
    Done. Verify after next deploy that the progress bar is sticky,
    typing dots animate, brand wordmark renders.

---

## Deferred — known cost, not blocking

12. **Frame.io v4 OAuth migration**
    Code is written and committed (`lib/frameio-oauth.js`,
    `lib/frameio.js`, `handlers/frameio.js`,
    `scripts/register-frameio-webhook.js`) but not in use. Blocked
    by Frame.io plan-tier license — Server-to-Server OAuth requires
    Enterprise. Cost of deferring: Scott manually moves ClickUp to
    `waiting` after leaving review comments (Flow 1), and manually
    creates Frame.io share links on `done` (Flow 2). Both were
    manual before automation; deferring is a regression vs. plan
    but not a blocker. Full revival playbook in
    `iteration-3-fixes.md` Fix 9.
    
    Revisit if: Scott upgrades Frame.io to Enterprise, OR Adobe
    relaxes the license gating, OR support confirms his existing
    plan should include Server-to-Server (item #2 above).

---

## Known unfixable Profile-views gaps (discovered 2026-05-11)

These cells will stay blank in the sheet's weekly columns no matter
how often the agent runs. Document them so we don't keep
re-investigating.

- **9 TikTok URLs** (5 Jackson Price, 3 Stella Grams, 1 Alpha High photo)
  — the `clockworks/tiktok-scraper` actor returns no data for these
  specific URLs. Single-URL probes also fail, so it's not a batch
  issue. Likely cause for Jackson + Stella: handle changes
  (`@llimepcrepair1` → `@lalimepcrepair`, `@stella_makes_bank` →
  `@stellamakesbank`) — old-handle URLs in the sheet may need to be
  updated to the new handles. Alpha High `/photo/` URL: TikTok photo
  carousels aren't supported by this actor period.
- **3-6 Instagram Sidecar (image post) URLs** — Apify returns metadata
  but no view count. Will always be blank.
- **10 Twitter URLs** — Twitter Lite scraper doesn't expose view
  counts. Manual entry only until a better actor is found.

Total unfixable blanks: ~19-25 of ~130 URLs (~80% coverage on auto
scrape). Action items for Scott (not us):
- Check the 9 TikTok URLs — update sheet to new handles if account
  was renamed; delete row if post was taken down.
- Continue manual Twitter entry weekly.

---

## Open structural questions (no immediate answer needed)

13. **Should we add an email column to `students`?**
    Required for calendar matching (item #3) if we go the
    match-by-email path instead of name-derived-from-email. Cleaner
    and more robust than parsing email local-parts. Migration is
    one line; backfill from Scott's roster in 5 min.

14. **What happens to the manual claude.ai projects Scott has been
    creating per student?**
    Tied to question #1 above. If we keep them, the `/onboard`
    completion screen stays as-is. If we drop them (since
    Scripting agent already uses dynamic context), the completion
    screen should be simplified.

15. **Profile-views Instagram path verified end-to-end?**
    Tomorrow's first scheduled run gave 6 TT scrapes + 9 IG scrapes.
    Both platforms succeeded. Item closed.

---

## Recently shipped (for reference)

- May 7 — Stub mode label fix in `dashboard/src/lib/agents.js`
- May 7 — Onboarding chat polish (sticky header, progress bar,
  typing dots, Limitless wordmark)
- May 7 — `scripts/create-student.js` CLI for adding students
- May 8 — Frame.io v4 migration code (deferred, see #12)

---

## My read on what to do next

If you have 30 min: text Scott about (1) the per-student Claude
Project question and (2) the Frame.io support contact. Both are
unblocking conversations that take you nowhere if delayed.

If you have 2 hours: ship calendar attendee matching (#3b / Fix 10).
Scope is bounded, all inputs known, unblocks Scripting end-to-end.

If you have a weekend block: ship Profile-views URL-based refactor
(#3a / Fix 11). Bigger build (~6-8 hours focused) but you have one
clean week before next Thursday's run to land it. Scott's data was
wrong this week and we manually patched; we cannot do that twice.

If you have an evening: build sheet sync (#5 / sheet-sync-spec.md).
**Note:** the sheet sync depends on Profile-views writing correct
data. Build it AFTER Fix 11 ships, otherwise the sync just pushes
the wrong data into the Sheet faster.

If Scott's Apify account materializes mid-week: ship daily cron (#4),
takes 5 min — but ONLY after Fix 11 ships, otherwise daily cadence
multiplies the wrong-data problem 7×.
