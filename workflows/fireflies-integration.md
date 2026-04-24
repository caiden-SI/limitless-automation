# Fireflies Integration

SOP for building the Fireflies integration. Source of truth for any build or refactor of this integration. Do not deviate from this spec without updating it first.

## Objective

Own every consumer of the Fireflies API in this system. Two jobs in one agent:

1. **Transcripts to Supabase.** Pull full meeting transcripts into `meeting_transcripts` so downstream agents (Scripting Agent for student context, Performance Agent for qualitative signal) can reference what was actually discussed, not just what is in `students.claude_project_context`.
2. **Action items to ClickUp.** Use Claude to extract discrete action items from each transcript and create ClickUp tasks in the campus's list (Austin: List ID `901707767654`, status `idea`).

Per SOW Section 2 (Intelligence Agents and Integrations), the Fireflies layer feeds meeting content into the shared brain. This agent retires Scott's `fireflies_sync.py` on delivery day. Running both produces overlapping ClickUp tasks; do not do it.

**Note on approach:** we replace Scott's script rather than port it. His extraction method is whatever he wrote (likely regex or a rule-based pass); ours uses Claude over the full transcript, which handles implicit "Caiden will send Sarah the outline" phrasings that naïve rules miss. ClickUp conventions (list, status, fields) are already known from the Pipeline Agent build. The Fireflies GraphQL schema is public (`https://docs.fireflies.ai/`). The only thing that requires coordination with Scott is confirming `FIREFLIES_API_KEY` in `.env` matches the key his script authenticates with — one text message, not a code read.

## Trigger

Cron job, nightly at 9PM. Registered in `server.js` via `lib/scheduler.js`. Schedule string: `0 21 * * *`.

**Why 9PM:** inherit the cadence Scott's `fireflies_sync.py` currently runs on so the team continues to see action-item tasks land in ClickUp at the same time each night. Cutover happens in one window: Scott disables his cron and we enable ours in the same evening. Running both at 9PM duplicates every ClickUp task — see Cutover below.

## Inputs

From Fireflies (GraphQL `https://api.fireflies.ai/graphql`, schema at `https://docs.fireflies.ai/`):
- `transcripts` query filtered to the last 48 hours
- For each transcript: `id`, `title`, `date`, `duration`, `organizer_email`, `participants`, `sentences` (text, speaker, timestamps), `summary` if present.
- Action items are NOT fetched from Fireflies. They are extracted by a Claude pass over `sentences` via `lib/claude.js`, see `agents/fireflies.js::extractActionItems`.

From Supabase:
- `students`: to match transcripts to students by participant email or by name substring in title
- `campuses`: to attribute transcripts to a campus by organizer_email domain or explicit mapping
- `created_action_items`: dedup ledger (see Data model additions) to prevent duplicate ClickUp task creation across nightly runs

## Tools used

Existing:
- `lib/supabase.js`: service role client
- `lib/logger.js`: writes to `agent_logs` with `agent_name = "fireflies"`
- `lib/scheduler.js`: cron registration
- `lib/clickup.js`: creates action-item tasks. Uses the existing campus → List ID resolution (Austin = `901707767654`).
- `lib/claude.js`: action item extraction via `claude-sonnet-4-20250514` (per CLAUDE.md model rule).

New:
- `lib/fireflies.js`: GraphQL client. Methods: `fetchRecentTranscripts(windowHours)`, `fetchTranscriptDetail(id)`. Auth: `FIREFLIES_API_KEY` from `.env`.
- `agents/fireflies.js`: orchestration. Runs the transcript-ingest loop, calls Claude to extract action items from each transcript, guards ClickUp writes against `created_action_items`. Exposes `extractActionItems(transcript) → Array<{ text, assignee_email? }>`.

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

New table `created_action_items`:

```sql
CREATE TABLE created_action_items (
  id uuid primary key default gen_random_uuid(),
  fireflies_id text not null references meeting_transcripts(fireflies_id),
  action_item_hash text not null,
  clickup_task_id text,
  campus_id uuid references campuses(id),
  created_at timestamptz not null default now(),
  UNIQUE(fireflies_id, action_item_hash)
);
CREATE INDEX created_action_items_pending ON created_action_items(clickup_task_id) WHERE clickup_task_id IS NULL;
```

`fireflies_id` on `meeting_transcripts` is the dedup key for transcripts. `action_item_hash` is `sha256(normalize(action_item_text))` — normalization lowercases, collapses whitespace, and strips trailing punctuation so cosmetic differences don't bypass dedup. The `UNIQUE(fireflies_id, action_item_hash)` constraint means re-running the agent over the same transcript does not re-create the same ClickUp task — the insert fails with conflict and the ClickUp call is skipped. `clickup_task_id` is populated only after the ClickUp create succeeds; a null value means the ClickUp write failed and the next run retries. The partial index keeps the retry query cheap. `raw_payload` on `meeting_transcripts` preserves the full Fireflies response for forensic lookups if the flat columns miss something.

Migration SQL staged in `scripts/migrations/`. Caiden runs it in Supabase SQL Editor. Do not run automatically.

## Process flow

1. Cron fires at 9PM. Agent calls `fireflies.fetchRecentTranscripts(48)`.
2. **Transcript ingest.** For each returned transcript:
   - Check `meeting_transcripts` for an existing row with matching `fireflies_id`. Skip the insert if found, but do not skip step 3 — transcript dedup and action-item dedup are independent so a failed ClickUp write on a previous run can retry.
   - Call `fireflies.fetchTranscriptDetail(id)` to get the full sentence list if the list query only returned metadata. Implementation detail to verify against the public Fireflies GraphQL schema (`https://docs.fireflies.ai/`) during build — if `transcripts` root returns sentences inline, skip the second call.
   - Attempt student match: iterate `students`, match by email against participant emails first, then by name substring in transcript title. If zero matches, leave `student_id` null. If more than one match, leave `student_id` null and log a warning.
   - Attempt campus match: if `student_id` is set, inherit `campus_id` from the student. Otherwise, match by organizer_email domain against the hardcoded `CAMPUS_DOMAIN_MAP` constant in `agents/fireflies.js`. Current mapping (Phase 1, single campus): `{ 'limitlessyt.com': '0ba4268f-f010-43c5-906c-41509bc9612f' /* Austin */ }`. When a second campus is onboarded, move this mapping into a `campuses.google_workspace_domain` column and resolve via Supabase lookup instead of the in-code constant. Until then, the constant is the source of truth.
   - Concatenate sentences into `transcript_text` (one line per sentence, "Speaker Name: text").
   - Insert into `meeting_transcripts` (skip if `fireflies_id` conflict).
3. **Retry pending ClickUp creates.** Query `created_action_items WHERE clickup_task_id IS NULL` and retry the ClickUp create for each. This clears out action items whose ClickUp write failed on a previous run (ClickUp outage, transient 5xx). On success, update `clickup_task_id`. On continued failure, leave null and move on — next run retries again; self-heal surfaces sustained failures.
4. **Action item sync.** For each transcript (newly inserted *or* skipped-as-duplicate — both paths run so a failed ClickUp write can retry on the next call):
   - Call `agents/fireflies.js::extractActionItems(transcript)` — Claude pass over the transcript sentences with a structured extraction prompt. Returns `[{ text, assignee_email? }, ...]`.
   - For each action item: compute `action_item_hash = sha256(normalize(text))` and attempt `INSERT INTO created_action_items (fireflies_id, action_item_hash, campus_id) VALUES (...) ON CONFLICT DO NOTHING RETURNING id`. If a new row returned, call `clickup.createTask` (list resolved from `campus_id` — Austin = `901707767654`, status `idea`, body includes the action item text and a link back to the Fireflies transcript), then `UPDATE created_action_items SET clickup_task_id = ... WHERE id = ...`. If conflict fired, skip — already created.
   - On ClickUp 4xx/5xx: leave `clickup_task_id` null. The next run's step 3 pending scan retries.
5. Log summary to `agent_logs`: `{ fetched, skipped_duplicate_transcripts, inserted_transcripts, action_items_extracted, action_items_created, action_items_retried, action_items_skipped_duplicate, action_items_skipped_unmatched_campus, unmatched_student, unmatched_campus }`.

## Cutover and retirement of `fireflies_sync.py`

This agent replaces Scott's `fireflies_sync.py` on delivery day. Running both at once produces overlapping ClickUp tasks — his regex-extracted items alongside our Claude-extracted items for the same meetings.

Cutover procedure:

1. **Confirm API key parity.** Text Scott: "Is your Fireflies API key the same one I have in `.env`?" If yes, done. If no, either swap ours to his or confirm both keys authenticate against the same Fireflies account. Different accounts means different source transcripts — hard block.
2. **Disable Scott's cron.** Scott removes or comments out the `fireflies_sync.py` cron entry on his host. Confirm via `crontab -l`. Archive the script outside the repo.
3. **Enable our cron.** Start our agent in `server.js`. The next 9PM run is ours.
4. **Monitor the first run.** Watch `agent_logs` and ClickUp. Expected: Claude-extracted action items land as tasks in the Austin list, status `idea`. Any tasks Scott's script created in the 48 hours before cutover remain as-is. Operator archives the obsolete ones if the overlap is visually noisy.

The `created_action_items` ledger keeps OUR agent idempotent night-to-night — the `UNIQUE(fireflies_id, action_item_hash)` constraint means our agent never re-creates its own tasks. It does not attempt to dedup against Scott's last run's output (different extraction method → different text → different hashes). That 48-hour overlap is handled by manual archiving, which takes a few minutes and only happens once.

After cutover, Scott's script is not a dependency, not a fallback, and not a consumer of the Fireflies rate limit. The repo does not retain a copy of it.

## Outputs

- New `meeting_transcripts` rows (one per previously-unseen Fireflies transcript)
- New `created_action_items` rows (one per unique action item per transcript) with `clickup_task_id` populated on success
- New ClickUp tasks in each campus's list for every previously-uncreated action item
- `agent_logs` entries at start, per-transcript processing milestones, and completion summary

## Validation

- Fireflies GraphQL response must parse as JSON. Fail fast on parse error.
- Each transcript must have a `fireflies_id` (Fireflies' own ID) and a `date`. Reject rows missing either.
- `duration_seconds` coerced from whatever Fireflies returns (seconds, ms, or a string). Store as integer.
- `transcript_text` truncated to 1MB before write. Anything longer likely indicates a data quirk and should be flagged in the warning log.
- Student match: exact-case email match only. Name substring match is case-insensitive and must be at least 3 characters of the student's name present in the title.

## Edge cases

- **Cutover overlap.** The 48 hours before cutover contains transcripts Scott's script already posted tasks for. Our first run extracts its own action items from those same transcripts via Claude, producing overlapping (but not identical) tasks. Expected and acceptable — operator archives Scott's old ones if the visual overlap is undesirable. This only happens once.
- **Fireflies API is down at 9PM.** Log the error. Skip the cycle. Next night's pull re-covers the 48-hour window, so one missed night is recoverable without gap unless downtime exceeds 48 hours.
- **Fireflies API succeeds but ClickUp is down.** `created_action_items` row inserts with `clickup_task_id = null`. The next run's pending-scan (process step 4) retries the ClickUp create. Self-heal surfaces sustained failures.
- **A single transcript is 4 hours long with 40,000 sentences.** The 1MB truncation in `transcript_text` caps the row. The full payload lives in `raw_payload`. Agents that need the full text can hydrate from `raw_payload` on demand. Action-item extraction still runs on the full payload, not the truncated text.
- **Two students on the same call.** Participant email match returns two students. `student_id` is left null and a warning is logged. Downstream agents can read `participants` from the row and decide how to attribute. Action items still post to ClickUp using the organizer's campus.
- **Duplicate transcript with mutated content.** Fireflies sometimes reprocesses a transcript and the content differs but the `fireflies_id` is the same. Our unique constraint on `fireflies_id` skips the second transcript insert. If the mutated version has new action items, the `action_item_hash` dedup still handles it correctly — only genuinely new items create ClickUp tasks. If richer transcript content is needed, delete the stale `meeting_transcripts` row manually and re-pull.
- **A transcript is from a meeting with no Alpha School participant.** Log a warning with the transcript title and participant list. Insert with `campus_id = null`, `student_id = null`. No ClickUp task created (no campus → no list). Manual review decides whether to delete or reassign.
- **Scott re-enables `fireflies_sync.py` after retirement.** This should not happen, but if it does every action item produces two ClickUp tasks nightly. The symptom is visible in ClickUp the next morning and escalates to re-disabling his cron.

## Error handling

Per CLAUDE.md rules: log full error to `agent_logs` with status `"error"` BEFORE any recovery attempt. Do not implement per-agent auto-fix. Global self-healing handler owns diagnosis and retry.

## Test requirements

New file `scripts/test-fireflies-integration.js`. Must:
- Call `fireflies.fetchRecentTranscripts(48)` against the live API using `FIREFLIES_API_KEY`. Assert at least one transcript returns. TODO: verify with Caiden before build: confirm the Fireflies account has recent meetings to test against. If not, use a wider window.
- Run the full sync once against a **test ClickUp list** (not production). Assert `meeting_transcripts` rows are inserted, `created_action_items` rows inserted with populated `clickup_task_id`, and the ClickUp tasks themselves exist.
- Run the sync a second time immediately. Assert zero new `meeting_transcripts` inserts, zero new `created_action_items` inserts, zero new ClickUp tasks (end-to-end deduplication).
- Stub ClickUp to return 500 on `createTask`. Run the sync. Assert `created_action_items` row inserts with `clickup_task_id = null`. Remove the stub, run again. Assert the pending-scan retries and the row now has a `clickup_task_id`.
- Force a bad Fireflies response (point `FIREFLIES_API_KEY` to a dummy value temporarily) and assert the error is logged to `agent_logs` with status `error` and no rows are inserted.
- Teardown: delete test `meeting_transcripts` rows, test `created_action_items` rows, and the ClickUp tasks they spawned in the test list.

Test must be runnable standalone via `node scripts/test-fireflies-integration.js`.

## Dependencies

Before this integration can run in production:
- `FIREFLIES_API_KEY` set in `.env` AND confirmed (via one text to Scott) to match the key `fireflies_sync.py` authenticates with. If the keys differ, resolve before cutover.
- `meeting_transcripts` and `created_action_items` migrations run in Supabase SQL Editor.
- Campus-to-domain map: hardcoded in `agents/fireflies.js` as `CAMPUS_DOMAIN_MAP = { 'limitlessyt.com': '0ba4268f-f010-43c5-906c-41509bc9612f' }` (Austin). Migrate to a `campuses.google_workspace_domain` column when the second campus onboards; until then the constant is the source of truth.
- Scott's 9PM cron entry ready to disable on delivery day.
- Test ClickUp list available for integration tests (so test runs don't pollute the production Austin list `901707767654`).

## Out of scope for this workflow

- Real-time transcript push (Fireflies supports webhooks; we use nightly polling for simplicity)
- Sentiment analysis or other Claude-powered post-processing of transcripts (a separate workflow can read `meeting_transcripts` when the feature is needed)
- Preserving a copy of Scott's `fireflies_sync.py` in the repo (archived on Scott's side, not checked in)
- Matching the exact output shape of Scott's action-item extraction — our Claude extraction is a clean replacement, not a port

## Acceptance criteria

The integration is complete when:
- Integration test passes against real Fireflies, test ClickUp list, real Supabase.
- Cutover executed: Scott's cron disabled, our cron enabled, API key parity confirmed.
- One live 9PM run has completed and populated `meeting_transcripts` with at least one row and `created_action_items` rows aligned with the ClickUp tasks that appeared in the Austin list.
- Second-night run shows zero new `created_action_items` for transcripts seen on night one (idempotency verified against real data).
- Scott confirms `fireflies_sync.py` is retired and no longer on cron.
- `docs/progress-log.md` entry added showing the first successful sync and any unmatched-student or unmatched-campus warnings that need tuning.
- `docs/integrations.md` updated to note the 9PM cron, the `meeting_transcripts` + `created_action_items` tables, and the retirement of `fireflies_sync.py`.
