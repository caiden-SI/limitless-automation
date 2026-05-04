-- Migration: performance.source provenance column.
-- Run manually in Supabase SQL Editor — do not auto-apply.
--
-- Background: two writers populate the `performance` table.
--   1. scripts/sync-performance-tracker.js  — Scott's Google Sheet, weekly
--                                              deltas with no cumulative
--                                              anchor. Source = 'sheet'.
--   2. agents/profile-views.js (planned)    — Apify per-profile snapshots.
--                                              First scrape per (video,
--                                              platform) plants an anchor
--                                              row carrying the cumulative
--                                              lifetime view count;
--                                              subsequent weeks store
--                                              deltas relative to that
--                                              anchor. Sources = 'apify'
--                                              and 'apify_anchor'.
--
-- Why provenance is required: the Profile Views Agent computes its weekly
-- delta as (current_cumulative - sum(prior Apify-lineage view_count)). It
-- must distinguish its own anchor + delta rows from sheet deltas, otherwise
-- the first Apify scrape against a video that already has sheet history
-- would absorb pre-tracking views into one anomalous spike. With this
-- column the agent filters its sum to source IN ('apify','apify_anchor')
-- and stays mathematically clean across the boundary.
--
-- Performance Agent integration: agents/performance.js must filter its 4-week
-- aggregation to source IN ('sheet','apify') so anchor rows (which carry
-- absorbed lifetime cumulative, not weekly deltas) do not pollute
-- top-performer ranking. See workflows/profile-views.md "Performance Agent
-- prerequisite" for the one-line query change.

ALTER TABLE performance
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'sheet';

-- All historical rows came from scripts/sync-performance-tracker.js, so
-- the 'sheet' default is correct for the existing ~1,580-row backfill.
-- New writers (the sync script, the Profile Views Agent) write the column
-- explicitly; the default is the safety net for legacy code paths only.

-- Lookup index for the cold-start detection query the Profile Views Agent
-- runs once per scraped (video_id, platform) pair:
--   SELECT 1 FROM performance
--   WHERE video_id = $1 AND platform = $2 AND source IN ('apify','apify_anchor')
--   LIMIT 1;
-- Without this index the cold-start check sequentially scans the partition
-- of `performance` keyed on (video_id, platform), which the existing
-- (video_id, platform, week_of) unique key already covers but does not
-- order on `source`. Cheap insurance for what will be the agent's hottest
-- read path.
CREATE INDEX IF NOT EXISTS performance_video_platform_source_idx
  ON performance (video_id, platform, source);
