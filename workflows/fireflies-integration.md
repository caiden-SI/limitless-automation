# Fireflies Integration

SOP for building the Fireflies integration. Source of truth for any build or refactor of this integration. Do not deviate from this spec without updating it first.

## Objective

Pull meeting transcripts from Fireflies into Supabase so they can be read by downstream agents (Scripting Agent for student context, Performance Agent for qualitative signal). Explicitly does not replicate what Scott's existing `fireflies_sync.py` does. That script handles action-item-to-ClickUp conversion and keeps running as-is.

Per SOW Section 2 (Intelligence Agents and Integrations), the Fireflies layer feeds meeting content into the shared brain so Claude-driven script generation can reference what was actually discussed with a student, not just what is in `students.claude_project_context`.

## Trigger

Cron job, nightly at 10PM. Registered in `server.js` via `lib/scheduler.js`. Schedule string: `0 22 * * *`.

**Why 10PM, not 9PM:** Scott's `fireflies_sync.py` runs at 9PM and finishes within a few minutes (exact duration unknown). Running at 10PM guarantees our pull starts after his script completes, avoiding any Fireflies API rate limit contention and ensuring we see the same 48-hour window he processed. Per CLAUDE.md Gotchas: `Scott's existing fireflies_sync.py runs at 9PM nightly. Do not replace, integrate alongside`.

## Inputs

From Fireflies (GraphQL `https://api.fireflies.ai/graphql`):
- `transcripts` query filtered to the last 48 hours
- For each transcript: `id`, `title`, `date`, `duration`, `organizer_email`, `participants`, `sentences` (text, speaker, timestamps), `summary` if present

From Supabase:
- `students`: to match transcripts to students by participant email or by name substring in title
- `campuses`: to attribute transcripts to a campus by organizer_email domain or explicit mapping

## Tools used

Existing:
- `lib/supabase.js`: service role client
- `lib/logger.js`: writes to `agent_logs` with `agent_name = "fireflies"`
- `lib/scheduler.js`: cron registration

New:
- `lib/fireflies.js`: GraphQL client. Methods: `fetchRecentTranscripts(windowHours)`, `fetchTranscriptDetail(id)`. Auth: `FIREFLIES_API_KEY` from `.env`.

## Data model additions

New table `meeting_transcripts`:

```sql
CREATE TABLE meeting_transcripts (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references campuses(id),
  student_id uuid references students(id),
  fireflies_id text unique not null,
  title text,
  meeting_date timestamptz,
  duration_seconds integer,
  organizer_email text,
  participants jsonb,
  transcript_text text,
  summary text,
  raw_payload jsonb,
  fetched_at timestamptz not null default now()
);
CREATE INDEX meeting_transcripts_campus_student ON meeting_transcripts(campus_id, student_id);
CREATE INDEX meeting_transcripts_date ON meeting_transcripts(meeting_date DESC);
```

`fireflies_id` is the deduplication key. The unique constraint prevents accidental re-ingestion. `raw_payload` preserves the full Fireflies response for forensic lookups if the flat columns miss something.

Migration SQL staged in `scripts/migrations/`. Caiden runs it in Supabase SQL Editor. Do not run automatically.

## Process flow

1. Cron fires at 10PM. Agent calls `fireflies.fetchRecentTranscripts(48)`.
2. For each returned transcript:
   - Check `meeting_transcripts` for an existing row with matching `fireflies_id`. Skip if found. This is the primary deduplication gate.
   - Call `fireflies.fetchTranscriptDetail(id)` to get the full sentence list if the list query only returned metadata. TODO: verify with Caiden before build: confirm whether the Fireflies `transcripts` root query returns sentences or requires a follow-up call. Scott's `fireflies_sync.py` may already know this.
   - Attempt student match: iterate `students`, match by email against participant emails first, then by name substring in transcript title. If zero matches, leave `student_id` null. If more than one match, leave `student_id` null and log a warning.
   - Attempt campus match: if `student_id` is set, inherit `campus_id` from the student. Otherwise, match by organizer_email domain against a config map. TODO: verify with Caiden before build: confirm campus-to-domain mapping (limitlessyt.com, alphaschool.com, etc.).
   - Concatenate sentences into `transcript_text` (one line per sentence, "Speaker Name: text").
   - Insert into `meeting_transcripts`.
3. Log summary to `agent_logs`: `{ fetched, skipped_duplicate, inserted, unmatched_student, unmatched_campus }`.

## Coexistence with Scott's fireflies_sync.py

Scott's script and this integration read the same Fireflies API independently. They do not share code, a database, or a cron coordinator. The only shared resource is the Fireflies rate limit.

- **His script writes to ClickUp.** We write to Supabase only. No overlap.
- **His script handles action items.** We handle full transcripts. No overlap.
- **He runs at 9PM, we run at 10PM.** No race.
- **If he stops running his script, our integration does not cover his function.** Action-item-to-ClickUp conversion is out of scope here. If Scott eventually migrates his script into this repo, that is a separate workflow and this SOP remains unaffected.

Do not read his script source or replicate any logic from it. If behavior needs to change, ask Scott to change his script or build a separate workflow.

## Outputs

- New `meeting_transcripts` rows (one per previously-unseen Fireflies transcript)
- `agent_logs` entries at start, per-transcript processing milestones, and completion summary

## Validation

- Fireflies GraphQL response must parse as JSON. Fail fast on parse error.
- Each transcript must have a `fireflies_id` (Fireflies' own ID) and a `date`. Reject rows missing either.
- `duration_seconds` coerced from whatever Fireflies returns (seconds, ms, or a string). Store as integer.
- `transcript_text` truncated to 1MB before write. Anything longer likely indicates a data quirk and should be flagged in the warning log.
- Student match: exact-case email match only. Name substring match is case-insensitive and must be at least 3 characters of the student's name present in the title.

## Edge cases

- **Fireflies returns a transcript Scott's script also sees.** Expected and fine. We write to Supabase, he writes to ClickUp. They do not touch the same table.
- **Fireflies API is down at 10PM.** Log the error. Skip the cycle. The next night's pull will re-cover the 48-hour window, so one missed night is recoverable without gap unless downtime exceeds 48 hours.
- **A single transcript is 4 hours long with 40,000 sentences.** The 1MB truncation in `transcript_text` caps the row. The full payload lives in `raw_payload`. Agents that need the full text can hydrate from `raw_payload` on demand.
- **Two students on the same call.** Participant email match returns two students. `student_id` is left null and a warning is logged. Downstream agents can read `participants` from the row and decide how to attribute.
- **Scott renames his script to run at a different time.** Our schedule does not auto-adjust. If his script moves to 11PM, ours should move to midnight. Update this spec and the cron expression together.
- **Duplicate transcript with mutated content.** Fireflies sometimes reprocesses a transcript and the content differs but the `fireflies_id` is the same. Our unique constraint on `fireflies_id` skips the second insert. This is acceptable. If richer content is needed, delete the stale row manually and re-pull.
- **A transcript is from a meeting with no Alpha School participant.** Log a warning with the transcript title and participant list. Insert with `campus_id = null`, `student_id = null`. A later manual review can decide whether to delete or reassign.

## Error handling

Per CLAUDE.md rules: log full error to `agent_logs` with status `"error"` BEFORE any recovery attempt. Do not implement per-agent auto-fix. Global self-healing handler owns diagnosis and retry.

## Test requirements

New file `scripts/test-fireflies-integration.js`. Must:
- Call `fireflies.fetchRecentTranscripts(48)` against the live API using `FIREFLIES_API_KEY`. Assert at least one transcript returns. TODO: verify with Caiden before build: confirm the Fireflies account has recent meetings to test against. If not, use a wider window.
- Run the full sync once. Assert `meeting_transcripts` rows are inserted and that `agent_logs` shows the expected summary.
- Run the sync a second time immediately. Assert zero new inserts (deduplication).
- Force a bad response (point `FIREFLIES_API_KEY` to a dummy value temporarily) and assert the error is logged to `agent_logs` with status `error` and no rows are inserted.
- Teardown: delete any test `meeting_transcripts` rows tagged with a known test `fireflies_id` prefix.

Test must be runnable standalone via `node scripts/test-fireflies-integration.js`.

## Dependencies

Before this integration can run in production:
- `FIREFLIES_API_KEY` set in `.env`. Per `docs/progress-log.md` Session 3, this credential was listed as "Not set": confirm it is added before scheduling the cron.
- `meeting_transcripts` table migration run in Supabase SQL Editor.
- Campus-to-domain map agreed with Scott. TODO: verify with Caiden before build.
- Confirmation that Scott's `fireflies_sync.py` is still running at 9PM. If he has already migrated it elsewhere, adjust the schedule offset.

## Out of scope for this workflow

- Extracting action items from transcripts and creating ClickUp tasks (Scott's script owns this)
- Real-time transcript push (Fireflies supports webhooks; we use polling for simplicity and to stay behind Scott's script)
- Sentiment analysis or other Claude-powered post-processing (a separate workflow can read `meeting_transcripts` when the feature is needed)
- Migrating Scott's `fireflies_sync.py` into this repo

## Acceptance criteria

The integration is complete when:
- Integration test passes against real Fireflies, real Supabase.
- One live 10PM run has completed and populated `meeting_transcripts` with at least one row.
- Scott confirms his `fireflies_sync.py` continues to work (ClickUp action items still appearing).
- `docs/progress-log.md` entry added showing the first successful sync and any unmatched-student or unmatched-campus warnings that need tuning.
- `docs/integrations.md` updated to note the 10PM offset and the `meeting_transcripts` table.
