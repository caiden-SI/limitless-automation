-- Migration: Fireflies integration tables.
-- Run manually in Supabase SQL Editor — do not auto-apply.
--
-- Adds:
--   1. meeting_transcripts — one row per Fireflies transcript ingested.
--      `fireflies_id` is the dedup key for transcripts (UNIQUE).
--      `raw_payload` preserves the full Fireflies response so downstream
--      agents can hydrate the full text on demand even when the flat
--      `transcript_text` was truncated to the 1MB cap.
--   2. created_action_items — dedup ledger for Claude-extracted action
--      items posted to ClickUp. UNIQUE(fireflies_id, action_item_hash)
--      makes the agent idempotent night-to-night: re-running over the
--      same transcript will not re-create the same ClickUp task.
--      `clickup_task_id` is null until the ClickUp create succeeds; the
--      agent's pending-scan retries any null rows on the next run, which
--      self-heals transient ClickUp 5xx without ever losing an item.
--
-- Spec: workflows/fireflies-integration.md §"Data model additions"

CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid REFERENCES campuses(id),
  student_id uuid REFERENCES students(id),
  fireflies_id text UNIQUE NOT NULL,
  title text,
  meeting_date timestamptz,
  duration_seconds integer,
  organizer_email text,
  participants jsonb,
  transcript_text text,
  summary text,
  raw_payload jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_transcripts_campus_student
  ON meeting_transcripts (campus_id, student_id);

CREATE INDEX IF NOT EXISTS meeting_transcripts_date
  ON meeting_transcripts (meeting_date DESC);

CREATE TABLE IF NOT EXISTS created_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fireflies_id text NOT NULL REFERENCES meeting_transcripts(fireflies_id),
  action_item_hash text NOT NULL,
  clickup_task_id text,
  campus_id uuid REFERENCES campuses(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fireflies_id, action_item_hash)
);

-- Partial index keeps the nightly retry-scan cheap: most rows have a
-- populated clickup_task_id, only the failures need to be revisited.
CREATE INDEX IF NOT EXISTS created_action_items_pending
  ON created_action_items (clickup_task_id)
  WHERE clickup_task_id IS NULL;
