-- Migration: performance.weekly_delta column.
-- Run manually in Supabase SQL Editor — do not auto-apply.
--
-- Background: the Profile Views Agent rebuild (docs/profile-views-rebuild-spec.md
-- §2) splits the prior single-column model into two:
--   view_count   — cumulative all-time view count at the time of the scrape
--                  (the anchor basis subsequent runs delta against)
--   weekly_delta — views gained during the bucket
--                  (max(0, current_cumulative - previous_week_cumulative))
--
-- The 2026-05-08 scheduled run wrote cumulative numbers into view_count and
-- labeled them as the week's value. After this migration + rebuild, every
-- new performance row writes BOTH columns; the existing 2026-05-07 anchor
-- row keeps its view_count as the basis but its weekly_delta stays NULL
-- (no prior week to compute against).
--
-- Idempotency: ADD COLUMN IF NOT EXISTS so re-running on a database where
-- the column was created out-of-band is a no-op.

ALTER TABLE performance
  ADD COLUMN IF NOT EXISTS weekly_delta integer;

COMMENT ON COLUMN performance.view_count IS
  'Cumulative all-time view count at time of scrape';
COMMENT ON COLUMN performance.weekly_delta IS
  'Views gained during the week (current cumulative minus previous week cumulative, floored at 0)';
