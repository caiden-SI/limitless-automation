# Dashboard Consoles — Build Spec

Builds two admin consoles reachable from the AGENTS panel on `/ops`:

1. **`/scripting`** — on-demand script generation. Scott picks a
   student, types a concept, hits Generate, reviews three scripts,
   refines if needed, then pushes to ClickUp.
2. **`/students`** — minimal student creation. Scott enters name +
   TikTok + Instagram, hits Create, gets the personalized `/onboard`
   URL ready to copy.

Both are reached via two text links above the AGENTS grid on `/ops`,
mirroring the existing `CLICK → /pipeline` link on the PIPELINE
section title. No per-card hover affordance (see §3 for the rationale).

This spec replaces ad-hoc workflows currently required to do these
tasks (running the cron-only scripting flow OR editing Supabase by
hand to create students). After this ships, Scott does not need
Caiden in the loop for either operation.

---

## 0. Scope — v1 vs v1.5

This spec is intentionally trimmed to the minimum-useful set. Things
explicitly punted to a v1.5 follow-up are listed below so future
reviewers know they were cut on purpose, not forgotten.

**In v1 (what this spec builds):**
- `/scripting`: student picker + concept title + Generate → 3 cards
  → per-card REFINE + per-card PUSH TO CLICKUP
- `/students`: name + TT + IG + campus + Create → onboarding URL +
  Copy Link + tight recent-students strip (read-only)
- Two simple text-link nav targets on `/ops` to reach the new pages

**Out of scope until v1.5 (do not build now):**
- Optional concept-description field on /scripting (concept title is
  enough anchor; add later if Scott wants more nuance)
- Hook-type selector on /scripting (would require buildPrompt to
  honor `preferred_hook_type` which it doesn't today; add later)
- REFINE ALL 3 batch button (regenerating with a sharper concept
  title is faster and produces better results)
- PUSH ALL 3 batch button (3 clicks isn't friction worth fixing)
- "Pinned" pushed-state card UX (just disable the button + show
  "pushed → taskId" inline; same info, no state machine)
- Hover affordance with `↗` glyph on the AGENTS cards (replaced by
  a simple text-link strip — same discoverability, no nested-
  interactive-content accessibility risk)
- COPY URL button on the recent-students list (URL is regenerable
  from the student UUID; not a v1 use case)
- History strip on /scripting (deferred to v1.5)
- Email/SMS auto-distribution of the onboarding URL

Anything below this section is the v1 build.

---

## 1. Why this build

### Current pain — scripting

The Scripting agent only fires on Google Calendar filming events
(every 15 min lookahead, 48h window). Generating scripts off the top
of someone's head — "Scott has a concept right now, wants 3 takes" —
requires either:

- Manufacturing a fake calendar event (slow, leaves debris in
  `processed_calendar_events`), or
- Running `agents/scripting.js` directly from the repo (developer-only)

Neither works for Scott. The cron-only trigger is the right default
for filming-day automation, but it shouldn't be the only path.

### Current pain — onboarding

Every new student goes through this sequence today:

1. Caiden opens Supabase, manually inserts a row into `students` with
   name, handles, campus_id, and a freshly minted UUID
2. Caiden hand-builds the URL `/onboard?student=<uuid>&campus=<id>`
3. Caiden sends Scott or the student the URL via Slack / iMessage

Iteration-3 priority task #1 is "self-serve student creation."
This spec is that build.

---

## 2. Verified inputs (use these, don't re-discover)

### 2.1 Existing routing

Confirmed in `dashboard/src/main.jsx`:

```js
<Route path="/onboard"   element={<Onboarding />} />  {/* student chat */}
<Route path="/ops"       element={<Ops />} />         {/* dashboard home */}
<Route path="/pipeline"  element={<Pipeline />} />    {/* pipeline detail */}
```

`/onboard` is the STUDENT-facing chat — keep it. The admin console
needs a different path. We use `/students`.

### 2.2 Existing onboarding API (server.js)

```
POST /onboarding/message    — student chat message
GET  /onboarding/student    — student lookup
```

These are part of the student-facing flow and unchanged by this
build. The new admin endpoints live under `/admin/*` to avoid
collision.

### 2.3 Existing scripting entry point

`agents/scripting.js`:
- `processEvent({ id, title, description, startTime }, campusId)` —
  full pipeline, expects a calendar event. Lines 36–280 cover the
  read path (claim, campus/student/context loads). Lines 715–840
  (`writeConcepts`) is the ClickUp-write block that gets extracted.
- `generateConcepts({ campusId, student, context, validatorContext,
  genConstraints })` (line 417) — pure concept generation, no
  calendar dependency. **This is the function we wrap.**
- `buildPrompt({ student, context, genConstraints, validationError })`
  (line 273) — composes the system + user prompt strings. Today this
  takes no user-supplied concept; §4.4 extends it.

`generateConcepts` already returns `{ concepts, validatorResults }` or
`{ aborted, issues, attempts }`. It does NOT write to ClickUp on its
own — the calling `processEvent` does that via `writeConcepts`.
Perfect for review-first.

### 2.4 Existing student-creation prior art

`scripts/create-student.js` already does the create flow end to end
(parse args → resolve campus → duplicate-name guard → insert →
compose onboarding URL). The `/admin/students/create` HTTP handler is
a thin wrapper around the same logic. Specifically reuse:

- `KNOWN_CAMPUS_SLUGS` constant (line 34) — keeps the Austin UUID in
  one place
- `resolveCampusId(input)` (line 63) — UUID-or-slug-or-name lookup
- `normalizeHandle(h)` (line 90) — strips leading `@`, returns null
  if empty. **Note:** the spec earlier said "ensure `@` prefix" —
  that was wrong. Strip the `@`, store the bare handle. Matches the
  rest of the codebase.
- The duplicate-name guard pattern (lines 116–130)
- The URL composition pattern (line 155) using `PUBLIC_DASHBOARD_URL`

### 2.5 AGENT_REGISTRY entries we care about

`dashboard/src/lib/agents.js` exports:
- `AGENT_REGISTRY.scripting` — card on row 2, col 3
- `AGENT_REGISTRY.onboarding` — card on row 3, col 1

Both render via `AgentGrid.jsx` → `AgentCard`. The agent name lives at
`<span className="lim-cpv-agent-name">{agent.name}</span>`.

### 2.6 Campus ID

Austin campus: `0ba4268f-f010-43c5-906c-41509bc9612f`. Hardcoded as
default; only campus active today. Reads from `campusId` prop already
passed through `AgentGrid`.

---

## 3. Discovery — text-link strip on /ops

Both `/scripting` and `/students` are reached via a small text-link
strip rendered above the AGENTS grid on `/ops`. No per-card hover
affordance — that pattern would nest a `<Link>` inside the existing
`<button onClick={onToggle}>` AgentCard, which is invalid HTML and
breaks accessibility.

### 3.1 Visual

```
                                        + /scripting   + /students
AGENTS                                                    9 ON · 24h
┌──────────┬──────────┬──────────┐
│ pipeline │ footage  │   qa     │
```

Right-aligned, same row as the AGENTS section title. Mirrors the
existing `CLICK → /pipeline` link in the PIPELINE section title
(see `dashboard/src/components/PipelineSummary.jsx` line 22-26 for
the styling reference). Each is a plain `<Link>` element styled
in the dim ink color with hover underline + orange accent.

### 3.2 Implementation note

In `dashboard/src/components/AgentGrid.jsx`, modify `SectionTitle`'s
usage (line 41) to pass a `right` value that includes the two
links plus the existing "N ON · 24h" counter. The component already
renders a `right` slot — no new prop needed.

No changes required to `AgentCard`, `AGENT_REGISTRY`, or `ops.css`
class structure. Other 7 agent cards behave identically.

### 3.3 What we explicitly are NOT doing

- No `consoleRoute` field on AGENT_REGISTRY entries
- No wrapper around the `lim-cpv-agent-name` span
- No `↗` glyph hint on individual cards
- No hover-only visibility — the links are always visible

Rationale: the affordance gain is identical, the HTML stays valid,
and the AGENT_REGISTRY shape stays clean for downstream consumers
(LiveEventStream filter, action prose lookup, etc.) that don't care
about navigation.

---

## 4. `/scripting` console

### 4.1 Layout

```
← LIMITLESS · OPS                      143 ACTIVE · 18 STUCK
SCRIPTING
                                       Manual concept generator.

┌─────────────────────────────────────────────────────────┐
│ STUDENT       [ Geetesh Parelly        ▼ ]              │
│ CONCEPT       [ How AI flips homework on its head      ]│
│                                                         │
│                       [ GENERATE 3 SCRIPTS ]            │
└─────────────────────────────────────────────────────────┘

┌─ CONCEPT 1 ─────────────────────────────────────────────┐
│ TITLE:  <generated title>                               │
│ HOOK:   <hook_angle, one sentence>                      │
│ SCRIPT: <full script body, 70-150 words>                │
│ DIRECTION:                                              │
│   • <creative_direction[0]>                             │
│   • <creative_direction[1]>                             │
│   • <creative_direction[2]>                             │
│                                                         │
│  [ REFINE ]   [ PUSH TO CLICKUP ]                       │
└─────────────────────────────────────────────────────────┘
(× 3 concept blocks)
```

Empty states:
- Zero students on the campus (or all un-onboarded): show "No
  onboarded students yet. Create one at /students and walk them
  through onboarding first."
- Generate returns voice-abort: replace the 3-card area with an
  error block listing the validator issues, plus a single
  Regenerate button. No drafts shown (drafts don't exist; see §4.3).

### 4.2 Inputs

| Field         | Required | Source                                              |
|---|---|---|
| Student       | yes      | `students` table, `is_brand_account = false`, `campus_id = current`, AND `onboarding_completed_at IS NOT NULL`. Un-onboarded students would generate generic-fallback scripts; better to surface that as a separate "needs onboarding" section than to silently produce low-quality output. |
| Concept title | yes      | free text, max 200 chars                            |

### 4.3 Generate flow

1. Form submit → `POST /admin/scripting/generate` with
   `{ campusId, studentId, conceptTitle }`
2. Server loads student, brand context, recent
   `performance_signals`, recent `trending_hooks` (same context the
   cron flow uses — see `processEvent` lines 117–137 + `loadContext`
   at line 240, and `validator.loadSharedContext` /
   `validator.buildGenerationConstraints` at lines 121–125)
3. Server calls `generateConcepts({ campusId, student, context,
   validatorContext, genConstraints, userConcept })` where
   `userConcept = { title: conceptTitle }`. No `description`, no
   `preferred_hook_type` — those are v1.5 surface area.
4. Success: returns `{ concepts: [...], validatorResults: [...] }`
   (3 concepts, shape identical to cron-flow output).
5. Voice-abort in gate mode: returns
   `{ aborted: true, issues, attempts: 2 }`. NO concepts are
   returned — `generateConcepts` doesn't preserve raw output on
   abort. UI renders an error block with the issue list and a single
   Regenerate button.

Server does NOT write to `processed_calendar_events` and does NOT
write to ClickUp at this stage. Session state lives in-memory in the
React component until Push is clicked. Page refresh = state lost
(documented footgun; persisting would require a session token and
schema we don't need for v1).

### 4.4 Concept-title plumbing (extending `buildPrompt`)

Current `buildPrompt({ student, context, genConstraints,
validationError })` at line 273 takes no user-supplied concept. The
cron flow generates 3 *open-ended* concepts each time. The manual
console needs 3 *takes on Scott's specific idea*.

**Decision:** Scott's concept is a HARD anchor, not a soft hint. All
3 generated scripts should be variations on the typed concept —
different angles, different hooks, different openings, but the same
underlying idea. Otherwise the button doesn't earn its name.

**Implementation:** extend `buildPrompt` signature:

```js
function buildPrompt({
  student,
  context,
  genConstraints,
  validationError,
  userConcept,   // NEW — { title: string } | null
}) { ... }
```

When `userConcept` is present, prepend this block to the user prompt
(between the brand context block and the hook benchmark block):

```
USER-SPECIFIED CONCEPT (THREE VARIATIONS REQUIRED):
The operator has supplied this concept. Generate 3 distinct VARIATIONS
of it — each must clearly be the same underlying idea, but with a
different hook angle, different opening, and different shot direction.
Do NOT generate three unrelated concepts.

Title: {userConcept.title}

The `title` field in each output object should be a short distinct
variant (e.g., "AI Homework Flip", "Homework Trap", "AI Did The Hw")
that reflects this concept, not a generic recap of the user's title.
```

When `userConcept` is null/undefined (cron path), `buildPrompt`
behaves exactly as today — the generated prompt string must be
byte-identical for the cron path. `processEvent` calls
`generateConcepts` without passing `userConcept`, so the cron path
is unchanged.

`generateConcepts` signature gets the same new param and forwards it
to `buildPrompt`. No other changes.

### 4.5 Per-concept actions

Each of the 3 concept cards has its own:

- **REFINE** — opens a textarea inline ("What would you change?").
  Submit calls `POST /admin/scripting/refine` with
  `{ campusId, studentId, originalConcept, refinementInput }`.
  Server delegates to a new `scripting.refineConcept(...)` which
  builds a single-concept prompt (original + refinement as context),
  runs through the same brand-voice validator path, and follows the
  same 2-attempt retry budget as `generateConcepts`. Returns
  `{ concept, validatorResult }` on success or
  `{ aborted: true, issues, attempts: 2 }` on second voice failure.
  Result replaces that card; the other two stay.
  - On abort: that card shows an inline error with the issue list
    + a Try Again button. The other two cards remain interactive.
- **PUSH TO CLICKUP** — calls `POST /admin/scripting/push` with
  `{ campusId, studentId, concept }`. Server calls the new exported
  `scripting.pushConceptToClickUp(concept, { campus, student })`,
  which:
  1. Inserts ONE `videos` row (status=`idea`,
     `script = JSON.stringify(concept)`, `student_id`, `student_name`,
     `campus_id`). Yes, a videos row IS written — this matches the
     cron flow so the concept enters Pipeline like any other.
  2. Creates ONE ClickUp task (name = `concept.title`,
     description = `concept.hook_angle`, status = `idea`).
  3. Sets the `CLICKUP_PROJECT_DESCRIPTION_FIELD_ID` custom field to
     `concept.script`.
  4. Updates `videos.clickup_task_id` to the new task ID.
  5. Returns `{ taskId, taskUrl, videoId }`.

  No `video_quality_scores` row is written on manual pushes —
  that's a cron-flow concern tied to atomic-3-row generation.

  No rollback: manual pushes are independent, so a partial failure
  (e.g., videos insert succeeds but ClickUp create fails) leaves
  an orphan videos row. Surface the error to the UI; operator can
  clean up manually if needed.

  On the UI: the card's button row flips to a disabled state with
  inline text `pushed → 86e1bdfXX ↗` (linking to `taskUrl`). REFINE
  button on that card also disables. No localStorage persistence —
  page refresh = state lost, ClickUp tasks still exist. Surface as
  a single-line caution at the top of the page: "Pushed concepts
  persist in ClickUp. Refresh resets this page's view."

### 4.6 Batch actions

Not in v1. See §0 for rationale.

### 4.7 What it doesn't do (out of scope for v1)

- No calendar event creation
- No `processed_calendar_events` row written (this isn't a calendar
  event being processed)
- No automatic scheduling for follow-up — Scott pushes when he's ready
- No history view of past on-demand generations (logged to
  `agent_logs` with action `manual_scripting_generated` so the activity
  feed surfaces it, but no dedicated history page yet)
- No batch refine or batch push (v1.5)
- No concept description, hook-type selector (v1.5)

### 4.8 Optional v1.5 — history strip

A small right-rail showing the last 10 on-demand generations (timestamp,
student, concept title, push-status). Reads from `agent_logs` filtered
to `action = 'manual_scripting_pushed'`. **Not in v1.** Easy follow-up
once Scott has used the console for a week.

---

## 5. `/students` console

### 5.1 Layout

```
← LIMITLESS · OPS                      143 ACTIVE · 18 STUCK
STUDENTS                               9 enrolled · Austin campus

┌── CREATE NEW STUDENT ──────────────────────────────────┐
│ NAME              [ Marcus Reyes                     ] │
│ TIKTOK HANDLE     [ @marcus.reyes                    ] │
│ INSTAGRAM HANDLE  [ @marcus_reyes_                   ] │
│ CAMPUS            [ Austin                         ▼ ] │
│                                                        │
│                           [ CREATE & GENERATE URL ]    │
└────────────────────────────────────────────────────────┘

┌── ONBOARDING LINK ─────────────────────────────────────┐
│ https://limitless-automations-mac-mini.tail15aca0.ts… │
│   …onboard?student=abc-123&campus=0ba4268f…           │
│                                                        │
│                                  [ COPY LINK ]         │
│                                                        │
│ Send this to Marcus. The link is valid until Marcus    │
│ completes onboarding (~15 min, six sections).          │
└────────────────────────────────────────────────────────┘

┌── RECENT STUDENTS ─────────────────────────────────────┐
│ Marcus Reyes        created just now                   │
│ Geetesh Parelly     onboarded 2026-05-08              │
│ Stella Grams        onboarded 2026-04-30              │
│ Jackson Price       onboarded 2026-04-30              │
│ ... (last 10)                                          │
└────────────────────────────────────────────────────────┘
Read-only strip. No per-row actions in v1.
```

### 5.2 Inputs

| Field             | Required | Notes                                            |
|---|---|---|
| Name              | yes      | full name, used by `gcal.parseStudentFromEvent`   |
| TikTok handle     | yes      | leading `@` stripped on save (match codebase: handles stored bare, see `scripts/create-student.js` `normalizeHandle`) |
| Instagram handle  | yes      | same                                             |
| Campus            | yes      | dropdown, defaults to Austin (only option today) |

YouTube handle, niche, and brand context are intentionally NOT
collected here. The onboarding chat captures those during the
six-section flow. Spec section 3 of Scott Q&A: "no prep documents
required, conversation is conversational and adaptive."

### 5.3 Create flow

1. Form submit → `POST /admin/students/create` with
   `{ name, tiktokHandle, instagramHandle, campusId }`
2. Server validates:
   - Non-empty name
   - Handles normalized via `lib/students.normalizeHandle` (strip
     whitespace + leading `@`, store bare). Empty/whitespace-only
     becomes null.
   - No existing `students` row with the same name on this campus
     (case-insensitive). Returns HTTP 409 with body
     `{ error: 'duplicate_name', existingStudentId, existingUrl }`
     so the UI can render "Marcus Reyes already exists — copy
     their existing URL instead?" without needing a second round-trip.
3. Server inserts:
   ```sql
   INSERT INTO students
     (id, name, handle_tiktok, handle_instagram, campus_id, is_brand_account)
   VALUES
     (gen_random_uuid(), $1, $2, $3, $4, false)
   RETURNING id;
   ```
4. Server returns `{ studentId, name, url }` where `url` is:
   ```
   ${PUBLIC_DASHBOARD_URL}/onboard?student=${studentId}&campus=${campusId}
   ```
   `PUBLIC_DASHBOARD_URL` MUST be set in `.env` on the limitless-
   webhooks process. The `lib/students.createStudent` helper fails
   fast with a clear error if missing — do NOT fall back to a
   placeholder URL. (The current fallback in `scripts/create-student.js`
   line 107 is the literal Tailscale documentation placeholder
   `tailnet.ts.net`, not the real production URL — that's a latent
   bug we're closing as part of this build by removing the fallback
   in the lifted helper.)
5. Client renders the URL with the COPY LINK button. On click,
   `navigator.clipboard.writeText(url)` and the button flips to
   "COPIED" for 2 seconds (same UX as the existing Onboarding.jsx
   complete screen).

### 5.4 Recent students list

Reads the last 10 rows from `students` where `is_brand_account = false`
and `campus_id = current campus`, ordered by `created_at DESC`. Each
row shows:
- Name
- "created Xd ago" if no `onboarding_completed_at`, else
  "onboarded YYYY-MM-DD"

Read-only in v1. No per-row actions. If Scott needs to re-share an
onboarding URL for an existing student, the URL is regenerable from
the (studentId, campusId) pair — Caiden can construct it manually
or we add a per-row Copy URL in v1.5 once we see the need.

### 5.5 What it doesn't do (out of scope for v1)

- No bulk import from a CSV
- No email-send / SMS-send (copy-paste only)
- No editing existing students (name change, handle rename) — still
  a Supabase-direct operation
- No deletion (we never delete students; if they leave, Scott marks
  them via a flag — separate spec)
- No per-row Copy URL on the recent list (v1.5)

---

## 6. API endpoints (all new, all under `/admin`)

### 6.1 Auth

None for v1. The dashboard is localhost-only and behind Scott's
Tailscale Funnel; the same access-control surface as the existing
ops dashboard. If we later open the dashboard publicly, add a session
cookie check at the `/admin/*` middleware layer.

### 6.2 Routes

```
POST  /admin/scripting/generate
  body: { campusId, studentId, conceptTitle }
  200:  { concepts: [...], validatorResults: [...] }
  200:  { aborted: true, issues, attempts: 2 }   (gate-mode voice abort — still 200; aborted flag drives UI)
  400:  { error: 'missing_field', field }        (missing required input)
  500:  { error: 'internal', message }           (Claude failure, Supabase failure, etc.)

POST  /admin/scripting/refine
  body: { campusId, studentId, originalConcept, refinementInput }
  200:  { concept: {...}, validatorResult: {...} }
  200:  { aborted: true, issues, attempts: 2 }
  400:  { error: 'missing_field', field }
  500:  { error: 'internal', message }

POST  /admin/scripting/push
  body: { campusId, studentId, concept }
  200:  { taskId, taskUrl, videoId }
  400:  { error: 'missing_field', field }
  500:  { error: 'internal', message }
        — manual pushes have no rollback; partial failure may leave
          an orphan videos row (logged to agent_logs with status=error)

POST  /admin/students/create
  body: { name, tiktokHandle, instagramHandle, campusId }
  200:  { studentId, name, url }
  409:  { error: 'duplicate_name', existingStudentId, existingUrl }
  400:  { error: 'missing_field', field }
  500:  { error: 'internal', message }

GET   /admin/students/recent?campusId=XXX&limit=10
  200:  { students: [{ id, name, created_at, onboarding_completed_at }] }
  400:  { error: 'missing_field', field: 'campusId' }
  500:  { error: 'internal', message }
```

Logged `agent_logs` actions (pinned canonical names):
- `manual_scripting_generated` — on /generate success or abort
- `manual_scripting_refined`   — on /refine success or abort
- `manual_scripting_pushed`    — on /push success
- `admin_student_created`      — on /create success
- `admin_student_create_duplicate` — on /create duplicate-name hit
  (helps surface accidental re-attempts in the activity feed)
- No log on GET /recent (read-only, would flood the feed)

All `aborted` and `error` rows use `status: 'error'` so the dashboard
event stream colors them correctly.

### 6.3 PUBLIC_DASHBOARD_URL

Already exists in `.env`, used by `scripts/create-student.js`. No new
env vars added by this build. Verify before deploy:

```bash
ssh mac-mini "zsh -lc 'grep ^PUBLIC_DASHBOARD_URL= ~/limitless-automation/.env'"
```

Should return `PUBLIC_DASHBOARD_URL=https://limitless-automations-mac-mini.tail15aca0.ts.net`.
If it's missing, add it (same as the existing TUNNEL_URL value).

---

## 7. File-by-file build plan

### Server side

- `server.js` — register 5 new routes, all delegating to two new
  route modules (mirror the existing `/onboarding/message` and
  `/onboarding/student` pattern around lines 66 and 124). All five
  routes are served by the limitless-webhooks PM2 process — same
  process that hosts /onboarding/*, so existing CORS / body-parser
  middleware applies unchanged.
- `routes/admin-scripting.js` (NEW) — 3 handlers:
  - `generateHandler` — loads context via the existing helpers from
    `agents/scripting.js` (`loadContext`, plus
    `validator.loadSharedContext` and `validator.buildGenerationConstraints`),
    then wraps `scripting.generateConcepts({ ..., userConcept })`
  - `refineHandler` wraps the new `scripting.refineConcept(...)`
  - `pushHandler` wraps the new `scripting.pushConceptToClickUp(...)`
- `routes/admin-students.js` (NEW) — 2 handlers:
  - `createHandler` calls `lib/students.createStudent` which owns
    `resolveCampusId`, `normalizeHandle`, duplicate-name guard, and
    insertion. Returns 409 on duplicate per §5.3.
  - `recentHandler` calls `lib/students.recentStudents({ campusId,
    limit })` and returns the rows
- `lib/students.js` (NEW) — extracted from
  `scripts/create-student.js`:
  - `KNOWN_CAMPUS_SLUGS` (constant)
  - `resolveCampusId(input)` — UUID-or-slug-or-name lookup
  - `normalizeHandle(h)` — strip whitespace + leading `@`, null if empty
  - `createStudent({ name, tiktokHandle, instagramHandle, campusId })`
    → `{ studentId, name, url }` on success, throws on duplicate-name
    with a typed error the route handler maps to 409. **Fails fast
    if `PUBLIC_DASHBOARD_URL` is missing** — no fallback string.
  - `recentStudents({ campusId, limit = 10 })` → array of rows
- `scripts/create-student.js` — rewritten as a thin CLI wrapper
  around `lib/students.createStudent`. Same CLI flags, same output
  on the last line. The duplicate-name guard error is caught and
  printed; everything else propagates.
- `agents/scripting.js` refactor #1: extract lines 715–840
  (`writeConcepts` body) into a new exported function
  `pushConceptToClickUp(concept, { campus, student })` returning
  `{ taskId, taskUrl, videoId }`. The cron `writeConcepts` becomes
  a loop that calls `pushConceptToClickUp` 3 times wrapped in the
  existing rollback. The admin push handler calls it once at a time
  with NO rollback (manual pushes don't have the 3-row atomicity
  invariant). Specifically:
  - Lift the `PROJECT_FIELD` env check + `createTask` + `setCustomField`
    + `videos` insert/update into the new function
  - Keep `video_quality_scores` insert in the cron loop only —
    manual pushes don't have a `validatorResults[i]` row tied to
    the same generation index in the same way
- `agents/scripting.js` refactor #2: extend `buildPrompt` (line 273)
  and `generateConcepts` (line 417) signatures to accept `userConcept`.
  Add the prepended block from §4.4 when present. **The cron path
  (calling without `userConcept`) must produce a byte-identical
  prompt string to today** — verify with a unit-style diff on a
  fixed student fixture before committing.
- `agents/scripting.js` add: `refineConcept({ campusId, student,
  context, validatorContext, genConstraints, originalConcept,
  refinementInput })` returning `{ concept, validatorResult }` or
  `{ aborted: true, issues, attempts: 2 }`. Builds a single-concept
  prompt with the original + refinement as context; reuses the same
  validator path; same 2-attempt retry budget as `generateConcepts`.
  Returns a single-element shape — NOT a 3-array.
- `.env.example` — no new vars. Ensure `PUBLIC_DASHBOARD_URL` is
  documented with a comment explaining its role.

### Dashboard side
- `dashboard/src/main.jsx` — add 2 routes:
  ```jsx
  <Route path="/scripting" element={<ScriptingConsole />} />
  <Route path="/students"  element={<StudentsConsole />} />
  ```
- `dashboard/src/pages/ScriptingConsole.jsx` (NEW) — back-link header
  (`← LIMITLESS · OPS`) mirroring `Pipeline.jsx`, form + 3-card view
  + per-card actions. Uses `lim-root` outer + a page-specific stage
  div like `Onboarding.jsx`.
- `dashboard/src/pages/ScriptingConsole.css` (NEW) — page-specific
  styles, following the `Onboarding.css` convention.
- `dashboard/src/pages/StudentsConsole.jsx` (NEW) — same shell as
  ScriptingConsole, create form + URL display + recent list.
- `dashboard/src/pages/StudentsConsole.css` (NEW)
- `dashboard/src/components/AgentGrid.jsx` — adjust the existing
  `SectionTitle` `right` slot for AGENTS to include two text links
  `+ /scripting` and `+ /students` alongside the existing counter.
  No changes to `AgentCard`, no changes to `AGENT_REGISTRY`,
  no changes to ops.css class structure (use existing
  section-title link styling).

### Docs
- `iteration-3-fixes.md` — note that Fix 4 (self-serve student
  creation) and the Scott Q&A Q2/Q6 items are resolved by this build
- `docs/scott-questions-answered.md` — update Q2 and Q6 sections to
  reflect "shipped"

---

## 8. Test plan

### 8.1 Cron-path regression (do this FIRST)

Before any UI testing, confirm the buildPrompt refactor doesn't move
the cron path. Easiest verification: run a Node REPL or one-off
script that calls `buildPrompt({ student, context, genConstraints })`
twice — once against the current code and once against the refactored
code, with the same fixture — and string-compare. They must match
exactly. If they don't, the refactor is wrong.

### 8.2 Local — `/scripting`

1. Start the limitless-webhooks server + the limitless-dashboard dev
   server.
2. Navigate to `/ops`. Verify the two new text links `+ /scripting`
   and `+ /students` appear in the AGENTS section title row.
3. Click `+ /scripting`. Verify navigation to `/scripting`.
4. Pick a real onboarded student (Geetesh Parelly). Type concept
   "How AI flips homework on its head". Hit Generate. Verify:
   - 3 concept cards render with title / hook / script /
     creative_direction bullets
   - No ClickUp tasks created yet (check Austin list)
   - No `videos` rows created yet
   - No `processed_calendar_events` rows created
   - `agent_logs` shows one `manual_scripting_generated` row
5. Click REFINE on concept 1. Type "Make the hook more dramatic."
   Submit. Verify:
   - Only concept 1 changes; 2 and 3 untouched
   - The new concept 1 is meaningfully different and aligned with the
     refinement
   - `agent_logs` shows one `manual_scripting_refined` row
6. Click PUSH TO CLICKUP on concept 2. Verify:
   - One ClickUp task in Austin list, name = concept 2 title,
     Project Description custom field = concept 2 script
   - One `videos` row in Supabase, status `IDEA`, `clickup_task_id`
     populated
   - Card 2's buttons disable; inline shows "pushed → 86e1... ↗"
   - `agent_logs` shows one `manual_scripting_pushed` row
7. Voice-abort path (only if validator gate mode is on and a known
   bad-voice student exists): generate with a deliberately bad
   concept. Verify the 3-card area is replaced by an error block
   listing the issues + a Regenerate button. No drafts shown.

### 8.3 Local — `/students`

1. From `/ops` click `+ /students`. Verify navigation.
2. Create a fake student ("Test Student 5/12", TT `test.5_12`,
   IG `test_5_12`). Submit. Verify:
   - URL card renders with a URL containing the new UUID + campus
   - Supabase `students` row exists; `handle_tiktok` and
     `handle_instagram` are bare (no `@` prefix)
   - `agent_logs` shows one `admin_student_created` row
3. Click COPY LINK. Verify clipboard matches the displayed URL.
4. Open the URL in a new tab. Verify onboarding chat loads with the
   test student's name.
5. Submit the form again with the same name. Verify the 409 path:
   error message names the existing student and shows the existing
   URL ready to copy. `agent_logs` shows one
   `admin_student_create_duplicate` row.
6. Verify the recent students list shows the test student with
   "created just now" and no per-row buttons.
7. **Cleanup:** delete the test student row from Supabase.

### 8.4 Smoke after deploy

After production deploy, with Scott:

- Scott navigates `/ops` → clicks `+ /scripting` → generates concepts
  for an existing student → pushes one to ClickUp → confirms it
  arrives in his Austin list.
- Scott creates a real new student via `/students` → copies the URL
  → sends to the student via iMessage → verifies the student can
  open the URL and the onboarding chat loads.

---

## 9. Rollback plan

Both consoles are additive. If we need to disable them:

- Comment out the two new `<Route>` entries in `main.jsx`
- Revert the `SectionTitle` `right` slot change in `AgentGrid.jsx`
  to drop the two text links
- Comment out the 5 new routes in `server.js`

No data migration. No schema changes. No removal of existing
behavior. Existing cron-driven scripting flow and existing
student-facing `/onboard` chat continue to work unchanged.

The refactor pieces (`pushConceptToClickUp` extraction, `userConcept`
param in `buildPrompt`/`generateConcepts`, `lib/students.js` lift)
can stay in place even when consoles are disabled — they preserve
backward-compatible signatures.

---

## 10. Iteration-3 items closed by this build

- **Q2 (Scott Q&A):** manual scripting trigger from the dashboard. ✓
- **Q6 + priority task #1 (Scott Q&A):** self-serve student creation
  with auto-generated URL. ✓ (URL auto-emailing remains deferred per
  decision in this spec — copy-paste UX.)

---

## 11. Open questions

Resolved during spec authoring:

1. ~~Hover affordance: button or text link?~~ — text-link strip on
   /ops above the AGENTS grid (no per-card hover, see §3)
2. ~~Scripting: review-then-push or auto-push?~~ — review-then-push
3. ~~Scripting: calendar event required?~~ — no
4. ~~Onboarding: fields at creation?~~ — name, TikTok, IG, campus
5. ~~Onboarding: auto-email?~~ — no, copy-paste
6. ~~Concept-title direction: hard anchor or soft hint?~~ — hard anchor
   (3 variations of the typed concept, not 3 unrelated ideas)
7. ~~Voice-abort UX: preserve drafts or error-only?~~ — error-only
   with Regenerate button (drafts physically don't exist on abort)
8. ~~Refine retry budget?~~ — same 2-attempt budget as generate
9. ~~Manual push side effects?~~ — yes, inserts a videos row; no
   video_quality_scores; no rollback
10. ~~Hook-type selector in v1?~~ — no, deferred to v1.5
11. ~~Description field on /scripting in v1?~~ — no, deferred to v1.5
12. ~~Student dropdown filter?~~ — onboarded-only by default

Carrying forward (v1.5):

- Per-row Copy URL on the recent students list
- REFINE ALL 3 / PUSH ALL 3 batch buttons
- Concept description + hook-type selector
- History strip showing the last 10 on-demand generations
- Edit existing student (name/handle change)
- Push-state persistence across page refresh

---

## 12. Acceptance criteria checklist

Claude Code is done when ALL of these pass. Order doesn't matter,
but each is a verifiable statement.

### Refactor — `agents/scripting.js`
- [ ] `buildPrompt` accepts `userConcept` param. Cron path
      (`userConcept = undefined`) produces a byte-identical prompt
      to today — verified by string-diffing against a fixture.
- [ ] `generateConcepts` accepts `userConcept` and forwards to
      `buildPrompt`. Existing cron behavior unchanged.
- [ ] `pushConceptToClickUp(concept, { campus, student })` exported.
      Inserts ONE videos row, creates ONE ClickUp task, sets the
      custom field, updates `videos.clickup_task_id`. No
      `video_quality_scores`. No rollback. Returns
      `{ taskId, taskUrl, videoId }`.
- [ ] `writeConcepts` (cron path) refactored to loop
      `pushConceptToClickUp` 3 times wrapped in the existing
      atomic-3-row rollback. End-to-end: a cron-driven run still
      produces 3 videos + 3 ClickUp tasks + 3 video_quality_scores
      rows with the existing rollback semantics on partial failure.
- [ ] `refineConcept(...)` returns a single-concept shape
      `{ concept, validatorResult }` or
      `{ aborted: true, issues, attempts: 2 }`. Same 2-attempt budget.

### Refactor — `lib/students.js` + `scripts/create-student.js`
- [ ] `lib/students.js` exports `createStudent`, `recentStudents`,
      `resolveCampusId`, `normalizeHandle`, `KNOWN_CAMPUS_SLUGS`.
- [ ] `createStudent` throws fast if `PUBLIC_DASHBOARD_URL` is unset
      (no placeholder fallback).
- [ ] `scripts/create-student.js` produces the same CLI output (URL
      printed on last line) for the same inputs as today.

### New server routes
- [ ] `POST /admin/scripting/generate` returns 200 with
      `{ concepts, validatorResults }` on success or
      `{ aborted, issues, attempts }` on voice-abort.
- [ ] Same endpoint returns 400 on missing required fields.
- [ ] `POST /admin/scripting/refine` returns 200 with single-concept
      payload or aborted payload.
- [ ] `POST /admin/scripting/push` returns 200 with
      `{ taskId, taskUrl, videoId }`; creates one videos row + one
      ClickUp task with populated Project Description field.
- [ ] `POST /admin/students/create` returns 200 with
      `{ studentId, name, url }`; returns 409 with
      `{ error: 'duplicate_name', existingStudentId, existingUrl }`
      on case-insensitive name collision.
- [ ] `GET /admin/students/recent` returns last 10 non-brand students
      for the campus, descending by `created_at`, including
      `onboarding_completed_at` for the UI label.
- [ ] Logged actions match the canonical list in §6.2 exactly.
- [ ] GET /recent does NOT log to agent_logs (would flood the feed).

### Dashboard pages
- [ ] `/scripting` route mounted in `main.jsx`, page renders with the
      `← LIMITLESS · OPS` back link header.
- [ ] `/students` route mounted in `main.jsx`, same shell.
- [ ] Student dropdown on `/scripting` populates from Supabase: only
      `is_brand_account = false` AND `onboarding_completed_at IS NOT NULL`
      AND current campus. Empty state shows the §4.1 friendly message.
- [ ] Generate button disabled when student or concept fields are empty.
- [ ] After successful generate, 3 concept cards render with title,
      hook angle, full script body, and creative_direction bullets.
- [ ] Each concept card has REFINE and PUSH TO CLICKUP buttons.
- [ ] REFINE opens an inline textarea, submit replaces ONLY that card.
- [ ] REFINE abort: that card shows inline error + Try Again. Other
      cards stay interactive.
- [ ] PUSH TO CLICKUP disables both buttons on that card; inline
      shows `pushed → taskId ↗` linking to the ClickUp task.
- [ ] Voice-abort on Generate: 3-card area is replaced by an error
      block with issue list + a Regenerate button. No drafts shown.
- [ ] On `/students`, COPY LINK copies the rendered URL and the button
      flashes "COPIED" for 2 seconds (mirror `Onboarding.jsx` complete
      screen).
- [ ] On `/students`, 409 duplicate-name response renders an inline
      error with the existing student's URL ready to copy.
- [ ] Recent students list reads from `GET /admin/students/recent`,
      shows name + relative-time label, no per-row actions.

### Discovery — text-link strip
- [ ] Above the AGENTS grid on `/ops`, two links `+ /scripting` and
      `+ /students` render alongside the existing "N ON · 24h" counter.
- [ ] Clicking each navigates to the respective console.
- [ ] No changes to `AGENT_REGISTRY`, `AgentCard`, or
      `lim-cpv-agent-name` styling.

### End-to-end smoke
- [ ] From `/ops`, click `+ /scripting` → generate 3 concepts for
      Geetesh Parelly with concept "How AI flips homework on its head"
      → REFINE concept 1 with "make the hook more dramatic" →
      PUSH concept 1, then concept 2, then concept 3 → 3 ClickUp tasks
      exist in Austin list with populated Project Description fields.
- [ ] From `/ops`, click `+ /students` → create a test student
      ("Test Student 5/12") → URL renders → opens correctly in a new
      tab and loads onboarding chat with the test student's name.
- [ ] Cleanup: delete the test student row, the 3 test videos rows,
      and the 3 test ClickUp tasks before committing.
- [ ] No `processed_calendar_events` rows created by either flow.
- [ ] No `INTERNAL_FIELD` / `FIELD_115` errors anywhere in the logs.
- [ ] Cron-driven scripting still runs cleanly on the next 15-min
      tick after deploy (smoke the next cycle's `agent_logs`).
