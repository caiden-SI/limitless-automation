# Cowork Handoff Prompt

Paste everything below the `---` into a new Cowork session to bring it
up to speed. Caiden's other session reviews/verifies the work this
session does.

---

You're picking up work on the **Limitless Media Agency automation
system** — a Node.js + Supabase + Claude pipeline that runs a social
content agency for Scott (the client). The codebase lives in
`/Users/caidendanielkennedy/repos/limitless-automation` and you have
direct file access there. Production runs on a Mac Mini reachable
via `ssh mac-mini`.

## Required first reads

Before you do anything else, read these in order. They're the source
of truth — anything I say here is just orientation.

1. `CLAUDE.md` — project rules. Stack, build order, error handling,
   gotchas. The "Rules" section is non-negotiable (especially the
   one about agents communicating only through Supabase).
2. `docs/system-facts.md` — what exists, what triggers what. 9 agents,
   7 integrations, the data flows. If you find yourself unsure how a
   piece fits, the answer is probably here.
3. `iteration-3-fixes.md` — the master backlog. Every fix has a
   number (Fix 1, Fix 2, …) and a status. Pick from here, don't
   invent new work without asking.
4. `docs/scott-questions-answered.md` — context on the client's
   priorities. Useful when judging trade-offs.

After those four, you have the same baseline I had.

## Your current task

Implement the spec in `docs/dashboard-consoles-spec.md`.

It builds two admin consoles on the dashboard:
- `/scripting` — on-demand concept generation with review/refine/push
- `/students` — minimal student creation with copy-paste onboarding URL

The spec is self-sufficient. It has:
- Verified inputs section so you don't re-discover things I already did
- Line numbers for the functions to refactor
- An acceptance criteria checklist (§12) — when every box is checked,
  you're done
- Rollback plan if anything goes sideways

Read the whole spec end-to-end before you write a line of code. If
something is ambiguous, ask Caiden before guessing — he prefers a
question to a wrong assumption.

## How we work

### File conventions

- Specs live in `docs/`, named `<topic>-spec.md`. Each one follows
  the same shape: why → verified inputs → design → file-by-file
  plan → test plan → rollback → acceptance criteria. Mirror this
  shape if you create a new one.
- `iteration-3-fixes.md` at the repo root is the punch list. Update
  it when you close a fix; cross-link to the spec doc you wrote.
- `current-plate.md` at the repo root is a working scratchpad for
  what's actively being worked on. Keep it tight.

### Code conventions

- Match the existing style — no opinions imposed from outside the
  codebase. Read 2–3 nearby files before adding a new one.
- Comments explain WHY, not WHAT. The cron flow in
  `agents/scripting.js` is a good reference.
- Every agent action logs to `agent_logs` (see `lib/logger.js`). The
  dashboard's live event stream reads from that table.
- Use the service role key (`SUPABASE_SERVICE_ROLE_KEY`) for agent
  writes; anon key for dashboard reads.
- Claude model: `claude-sonnet-4-20250514` everywhere. No other model.

### Deploy flow

Production is a Mac Mini at `~/limitless-automation`. The
`limitless-webhooks` PM2 process hosts the Express server +
schedulers; the `limitless-dashboard` PM2 process hosts the React
dashboard. Deploy sequence (no script exists, run inline):

```bash
# from Caiden's MacBook after git push
ssh mac-mini "zsh -lc 'cd ~/limitless-automation && git pull --ff-only && npm install --omit=dev'"
ssh mac-mini "zsh -lc 'pm2 restart limitless-webhooks --update-env'"   # --update-env loads new .env vars
ssh mac-mini "zsh -lc 'pm2 status'"                                    # verify uptime resets
ssh mac-mini "zsh -lc 'pm2 logs limitless-webhooks --lines 100 --nostream'"  # sanity check
```

Path gotcha: ssh non-interactive shells don't load Homebrew's PATH,
so wrap pm2 commands in `zsh -lc '...'`. The repo is at
`~/limitless-automation`, NOT `~/repos/limitless-automation` like
Caiden's MacBook.

Dashboard changes are served by the `limitless-dashboard` PM2
process. If you change React code, restart that one too:
`pm2 restart limitless-dashboard`.

### Commits

Conventional commit style. One logical change per commit.

```
feat(dashboard): add /scripting console with refine flow

- Extends buildPrompt with userConcept anchor (3 variations)
- Refactors writeConcepts → pushConceptToClickUp
- New POST /admin/scripting/generate|refine|push endpoints
- New ScriptingConsole.jsx with per-card refine + push

Closes Fix #(N) in iteration-3-fixes.md
```

### Testing

This codebase doesn't have heavy unit-test coverage. Verification is
mostly end-to-end against real Supabase + real ClickUp. The spec's
test plan walks through it. Always clean up test artifacts (ClickUp
tasks, Supabase rows, calendar events) before committing.

The smoke check after deploy:
1. ssh mac-mini, tail PM2 logs for the relevant agent for one cycle
2. Confirm no errors, no `FIELD_115` ClickUp errors, no Claude JSON
   parse failures
3. If the change touched a scheduled agent (15-min crons run every
   :00, :15, :30, :45), wait for the next tick and watch the log

### Quality bar

The previous session shipped these recently — use them as the
quality bar for what "done" looks like:

- `docs/profile-views-rebuild-spec.md` + the agents/profile-views.js
  rewrite (URL-based scraping, weekly deltas, two-way sheet sync)
- `docs/calendar-attendee-matching-spec.md` + the `lib/gcal.js` +
  `agents/scripting.js` changes (Fix 10, shipped 2026-05-12)

Both of those had: thorough specs first, refactor with backward
compat, end-to-end verification with real data, cleanup of test
artifacts, commit and deploy with verified logs.

## Common gotchas (lifted from the last session)

- **ClickUp custom field IDs are env vars**, not hardcoded. See
  `.env.example`. The `CLICKUP_INTERNAL_VIDEO_NAME_FIELD_ID` was
  deprecated on 2026-05-12 because the field was removed from the
  Austin list. Don't reintroduce it.
- **Apify TikTok scraping needs `resultsPerPage: 100`**, not 1.
  Found out the hard way in the profile-views rebuild.
- **Supabase row inserts respect RLS**. Always use the service-role
  key from agent code. If you see "permission denied" the key is the
  problem 9 times out of 10.
- **Calendar event matching is attendee-email-based now**, not
  name-in-title. `lib/gcal.js parseStudentFromEvent` derives the
  student name from the email local-part
  (`first.last@alpha.school` → `First Last`).
- **`SCRIPTING_IGNORED_ATTENDEE_EMAILS`** is a comma-separated list
  of emails to filter out before matching. Currently `scott@`,
  `charles@`, `jack.oremus@`. Both `.env` and `.env.example` carry it.
- **PM2 `--update-env`** must be passed on restart for new env vars
  to land in the running process. Without it, dotenv-loaded values
  stay stale.

## What NOT to do

- Don't run `npm audit fix` unprompted. Caiden reviews dependency
  changes manually.
- Don't add new env vars without updating `.env.example` AND noting
  them in the spec.
- Don't push to ClickUp / Supabase without a clear path to clean up
  if it's wrong. Always reversible during development.
- Don't merge to main without explicit confirmation. Caiden pushes
  and deploys himself after reviewing the diff.
- Don't introduce a new Claude model. `claude-sonnet-4-20250514` is
  the only model. There's a reason — see CLAUDE.md.
- Don't bypass the spec format. Every non-trivial change gets a
  spec first, even if it feels overkill. The specs are what let
  Caiden's other session verify your work without re-deriving the
  design decisions.

## Working with Caiden

He's the developer. Scott (the client) doesn't have access to your
session — only Caiden does. Caiden runs another session purely for
review and verification. So:

- Be explicit about what you've done vs. what's pending.
- Show diffs when explaining changes, not just summaries.
- Surface uncertainty early. If you're 80% sure about something,
  say so — don't pretend the spec covered it.
- For multi-step work, propose a plan first, get confirmation, then
  execute. Use TaskCreate/TaskUpdate to track progress so Caiden's
  reviewer session can see status at a glance.
- When you finish a unit of work, give Caiden:
  1. A summary of what changed (files, why)
  2. The verification you ran (logs, manual tests)
  3. The commit message you'd suggest
  4. What's left

Caiden prefers concise prose to bulleted recaps for narration. Use
bullets/checklists only when listing real items, not for restating
what you just said. Avoid "great", "perfect", "excellent" as
sentence openers.

## Now go

1. Read CLAUDE.md, system-facts.md, iteration-3-fixes.md,
   scott-questions-answered.md
2. Read docs/dashboard-consoles-spec.md end-to-end
3. Confirm to Caiden that you understand the scope and propose a
   build order (suggested: refactor → new lib/students.js → server
   routes → dashboard pages → hover affordance → end-to-end test →
   cleanup → commit)
4. Wait for go-ahead, then start with the `agents/scripting.js`
   refactor (extracting `pushConceptToClickUp`)

Good luck. Caiden will catch anything you miss — but make him work
for it.
