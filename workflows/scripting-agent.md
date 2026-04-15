# Scripting Agent

SOP for building and maintaining the Scripting Agent. Source of truth for any build or refactor of this agent. Do not deviate from this spec without updating it first.

## Objective

Generate 3 concept scripts per student when a filming event is detected on Google Calendar. Each concept includes a title, hook angle, full script, and creative direction. Output is informed by recent performance signals and research library benchmarks so concepting is driven by what is actually working, not a blank page. Final output lands as 3 ClickUp tasks in "idea" status and 3 rows in the `videos` table.

Contractually required per SOW Section 2 (Intelligence Agents → Scripting Agent).

## Trigger

Cron job, every 15 minutes, looking 48 hours ahead on the configured Google Calendar. Registered in `server.js` via `lib/scheduler.js`. Schedule string: `*/15 * * * *`.

Events are deduplicated by calendar event ID via the `processed_calendar_events` table. An event is never processed twice.

## Inputs

From Google Calendar:
- Event ID, title, description, start time

From Supabase:
- `students` row matched by student name substring against event title and description, scoped to the campus of the calendar
- Latest `performance_signals` row for the campus (structured signals including `top_hooks`, `top_formats`, `top_topics`, `recommendations`)
- Top 10 `research_library` entries for the campus by `view_count` as external benchmarks

## Tools used

Existing:
- `lib/supabase.js` — service role client for all DB reads and writes
- `lib/claude.js` — Claude API client, model `claude-sonnet-4-20250514`
- `lib/clickup.js` — ClickUp REST client, specifically `createTask` and `setCustomField`
- `lib/logger.js` — writes to `agent_logs` with `agent_name = "scripting"`
- `lib/scheduler.js` — cron registration
- `agents/pipeline.js` → `dbStatus()` helper — converts lowercase statuses to uppercase for Supabase writes

New:
- `lib/gcal.js` — Google Calendar service-account client. Methods: `listUpcomingFilmingEvents(calendarId, windowHours)`, `parseStudentFromEvent(event, campusStudents)`

## Data model additions

New table `processed_calendar_events`:

```sql
CREATE TABLE processed_calendar_events (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references campuses(id),
  event_id text not null,
  video_ids jsonb not null,
  processed_at timestamptz not null default now(),
  unique (campus_id, event_id)
);
```

Migration SQL staged in `scripts/migrations/` as a new file. Do not run automatically. Caiden runs it in Supabase SQL Editor.

## Process flow

1. Cron fires. Agent lists upcoming filming events from Google Calendar for the next 48 hours.
2. For each event, check `processed_calendar_events` for a match on `(campus_id, event_id)` BEFORE any other DB reads. Skip immediately if already processed. This check runs on every event on every cron fire, so it must come first to avoid unnecessary loads of students, performance_signals, and research_library.
3. Parse student name from event. Match against `students` table for the campus. If no match, log warning and skip. Do not retry.
4. Load `students.claude_project_context` for the matched student.
5. Load latest `performance_signals` row for the campus. If none, proceed and instruct Claude to hedge.
6. Load top 10 `research_library` entries for the campus by `view_count`. If none, proceed and instruct Claude to hedge.
7. Build the Claude prompt (see Prompt design below).
8. Call Claude. Validate output (see Validation below). Retry once with error description appended on validation failure. Abort on second failure.
9. For each of the 3 concepts:
   - Insert a `videos` row with `status = "IDEA"` (via `dbStatus`), `campus_id`, `student_id`, `script` (full concept JSON), `title`.
   - Create a ClickUp task in the campus's list with status `"idea"` (lowercase), `name` = title, populate custom fields: `Internal Video Name` = title, `Project Description` = script.
   - Store `clickup_task_id` back on the `videos` row.
10. Insert one `processed_calendar_events` row linking event ID to the three `video_ids`.
11. Log success to `agent_logs`.

## Prompt design

The Claude prompt must:
- Include student brand context verbatim from `claude_project_context`.
- Include the latest performance signals as a structured summary (top 3 hooks with view averages, top 3 formats, top topics, underperforming patterns).
- Include the research library benchmarks as a structured list.
- Include 2 to 3 Scott-approved scripts as `BRAND_VOICE_EXAMPLES` for tone inference. Source file: `wiki/clients/limitless-brand-voice.md` in the brain (see Dependencies). Claude infers voice from examples better than from written description.
- Require exactly 3 concepts, each targeting a different `hook_type` drawn from `top_hooks` when at least 3 are available. If fewer, allow repetition but note in a validation warning.
- Return strict JSON only. No prose wrapper, no markdown fences.

Output schema Claude must match:

```json
[
  {
    "title": "string, 1 to 4 words",
    "hook_type": "one of the allowed hook_type values",
    "hook_angle": "one sentence",
    "script": "70 to 150 words, 30 to 60 seconds spoken",
    "creative_direction": ["bullet 1", "bullet 2", "..."]
  }
]
```

## Outputs

- 3 new `videos` rows (status `IDEA`, linked to student and campus)
- 3 new ClickUp tasks (status `idea`, custom fields populated)
- 1 new `processed_calendar_events` row
- `agent_logs` entries at every step: start, event matched, student matched, context loaded, claude called, validation passed, writes completed

## Validation

- Claude output must parse as JSON. Fail fast on `JSON.parse` error.
- Must be an array of exactly length 3.
- Each concept must have all 5 fields (`title`, `hook_type`, `hook_angle`, `script`, `creative_direction`).
- `title` word count 1 to 4.
- `script` word count 70 to 150.
- `creative_direction` must be a non-empty array of strings.
- `hook_type` must be one of the allowed values from the research library classification taxonomy.
- On any validation failure, retry the Claude call once with the validation error appended to the prompt. On second failure, log error to `agent_logs` and abort without writing partial results.

## Edge cases

- **Student not matched from event.** Log warning with event ID and title. Do not retry. Do not insert to `processed_calendar_events` (so if the event is renamed later, it can be reprocessed).
- **Student has no `claude_project_context`.** Proceed. Instruct Claude in the prompt to hedge and produce more generic concepts. Log warning.
- **No `performance_signals` for campus.** Proceed. Omit the performance section from the prompt. Instruct Claude to hedge.
- **No `research_library` entries.** Proceed. Omit benchmarks section. Log warning.
- **Fewer than 3 unique `top_hooks` available.** Allow concept hook_type repetition. Note in the agent_logs warning so we can tune later.
- **Duplicate event.** Silently skip. Do not log.
- **Google Calendar auth failure.** Log error to `agent_logs` with status "error". Do not attempt self-repair in this agent. Let the global self-healing handler diagnose.
- **ClickUp task creation fails partway through the 3 concepts.** Roll back: delete any `videos` rows already inserted for this event, do not insert to `processed_calendar_events`. Log error. Next cron run will retry the event.

## Error handling

Per CLAUDE.md rules: log full error to `agent_logs` with status `"error"` BEFORE any recovery attempt. Do not implement per-agent auto-fix. Global self-healing handler owns diagnosis and retry.

## Test requirements

New file `scripts/test-scripting-agent.js`. Must:
- Use the one real populated student record already in Supabase (do not create a fake one for this test).
- Build a synthetic calendar event referencing that student by name.
- Run the full pipeline end-to-end against real Supabase, real Claude, real ClickUp.
- Assert 3 `videos` rows created, 3 ClickUp tasks created, all scripts pass the validation schema, and the 3 concepts target different hook types (if at least 3 top_hooks were available).
- Print all 3 generated concepts to stdout for human quality review.
- Include a rollback test case: force a ClickUp API error on the second task creation and assert that the first `videos` row is deleted, no `processed_calendar_events` row is inserted, and the error is logged to `agent_logs` with status `"error"`.
- Teardown: delete any test `videos` rows and ClickUp tasks after assertions.

Test must be runnable standalone via `node scripts/test-scripting-agent.js`.

## Dependencies

Before this agent can run in production:
- `GOOGLE_CALENDAR_CREDENTIALS_PATH` service account JSON file must exist at the path in `.env`. Credentials are already in `.env`, confirm the file is at the path.
- `processed_calendar_events` migration run in Supabase SQL Editor.
- At least one `students` row populated with real `claude_project_context`. Caiden confirmed one exists.
- `performance_signals` and `research_library` tables can be empty at first run; agent must handle this.
- Google Calendar events must contain enough info in title or description to match a student name. Format not enforced, agent does fuzzy match and logs unmatched events for tuning.
- Brand voice examples doc required before production use. File path: `wiki/clients/limitless-brand-voice.md` in the brain repo. Must contain 2 to 3 Scott-approved scripts he considers representative of Alpha tone. Caiden to request from Scott before the agent ships. Without this file, concepts will infer voice from `claude_project_context` alone, which is a quality risk.

## Out of scope for this workflow

- Frame.io share link on `done` status (see `frame-io-share-link.md`)
- Global self-healing error handler (see `self-healing-handler.md`)
- Migrating pre-existing student contexts into Supabase (manual task, not automated)
- Student Onboarding Agent that populates new students going forward (separate agent, already built)

## Acceptance criteria

The agent is complete when:
- Integration test passes end-to-end against real services.
- Three generated concepts from the real student record pass human quality eyeball review (not generic, voice-aligned, hook-differentiated).
- Cron is registered and running in `server.js`.
- Migration SQL is staged in `scripts/migrations/`.
- `workflows/scripting-agent.md` matches the implementation (update this spec if behavior intentionally diverges).
- `docs/progress-log.md` entry added for the session.
