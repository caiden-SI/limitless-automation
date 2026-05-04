-- Migration: videos.post_url + performance unique key.
-- Run manually in Supabase SQL Editor — do not auto-apply.
--
-- Background: agents/performance.js reads from a `performance` table that
-- nothing in the codebase populates. The Content Performance Tracker
-- (Google Sheet) is the source of truth for weekly view counts. The new
-- scripts/sync-performance-tracker.js reads each per-student tab, matches
-- the row's "Post Link" against `videos.post_url`, and upserts one
-- `performance` row per (video_id, platform, week_of).
--
-- This migration adds the two pieces of schema the sync depends on:
--   1. videos.post_url        — public TikTok/Instagram/YouTube/X URL of the
--                               posted video. Set once per video, when the
--                               editor (or Scott) marks it as posted by
--                               client. The sync canonicalizes URLs (strips
--                               query string + trailing slash) before lookup.
--   2. UNIQUE on performance  — required for ON CONFLICT upsert in the sync
--      (video_id, platform,     so re-running the script is idempotent
--       week_of)                instead of producing duplicates.

-- 1. Public post URL on videos.
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS post_url text;

-- Lookup index for the sync's `loadVideoUrlIndex(campusId)` query —
-- partial so the index only carries rows we actually match against.
CREATE INDEX IF NOT EXISTS videos_post_url_idx
  ON videos (campus_id, post_url)
  WHERE post_url IS NOT NULL;

-- 2. Idempotency key for `performance`. A given video on a given platform
-- has exactly one row per weekly bucket; without this constraint the sync
-- would either insert duplicates on re-run or have to read-then-write per
-- row.
ALTER TABLE performance
  ADD CONSTRAINT IF NOT EXISTS performance_video_platform_week_unique
  UNIQUE (video_id, platform, week_of);

-- Companion index already called for in docs/build-order.md line 13. Safe
-- to create here so a fresh Supabase doesn't have to remember it.
CREATE INDEX IF NOT EXISTS performance_video_week_idx
  ON performance (video_id, week_of);
