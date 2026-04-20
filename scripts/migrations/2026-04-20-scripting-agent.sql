-- Migration: Scripting Agent prerequisites.
-- Run manually in Supabase SQL Editor — do not auto-apply.
--
-- Adds:
--   1. processed_calendar_events  — dedup table for Google Calendar events
--   2. videos.student_id           — FK to students (spec line 68); existing student_name stays for dashboard
--   3. campuses.google_calendar_id — per-campus calendar the Scripting Agent polls

-- processed_calendar_events doubles as an atomic claim table. Every row is
-- inserted before any side effects (videos, ClickUp) so the unique constraint
-- on (campus_id, event_id) serializes overlapping cron runs.
--
-- status lifecycle:
--   pending        — claim taken; writes in progress or interrupted
--   completed      — all writes succeeded; video_ids populated
--   failed_cleanup — write failure + rollback did not fully succeed;
--                    halts automatic retries until an operator clears the row
--
-- Orphaned "pending" rows (e.g. after a hard crash) must be cleared manually
-- to allow the event to reprocess.
CREATE TABLE IF NOT EXISTS processed_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES campuses(id),
  event_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  video_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_payload jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (campus_id, event_id)
);

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES students(id);

ALTER TABLE campuses
  ADD COLUMN IF NOT EXISTS google_calendar_id text;
