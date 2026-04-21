-- Migration: 1-hour delay column for Dropbox footage detection.
-- Run manually in Supabase SQL Editor — do not auto-apply.
--
-- Enforces CLAUDE.md rule: "Dropbox: 1-hour delay after footage upload before
-- triggering editing pipeline". The team's Dropbox desktop sync can take up to
-- an hour to fully propagate a batch upload to all collaborators; advancing
-- to READY FOR EDITING immediately would assign an editor who cannot yet see
-- the footage locally.
--
-- Used by agents/pipeline.js scanPendingFootage():
--   - First detection (files present, column null)  → set timestamp, stay in READY FOR SHOOTING
--   - Subsequent scan (files still present, ≥1hr)   → advance to READY FOR EDITING
--   - Files disappear before window elapses         → clear timestamp (reset clock)

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS footage_detected_at timestamptz;

-- Index lets the cron scan cheaply query "what's pending a delay check?"
-- without a full table scan. Scoped to rows where a timestamp is set.
CREATE INDEX IF NOT EXISTS videos_footage_detected_at
  ON videos (footage_detected_at)
  WHERE footage_detected_at IS NOT NULL;
