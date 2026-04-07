-- RLS policies and RPC functions for dashboard (anon key access).
-- Run this in the Supabase SQL Editor.
--
-- Instead of allowing anon to query tables directly (which cannot enforce
-- tenant scoping at the policy level), we use RPC functions that require
-- a campus_id parameter. Anon SELECT policies are removed from data tables.
-- Service role key (used by agents) bypasses RLS entirely.

-- =========================================================================
-- Step 1: Drop all previous anon policies on data tables
-- =========================================================================

DROP POLICY IF EXISTS "anon_read_campuses" ON campuses;
DROP POLICY IF EXISTS "anon_read_videos" ON videos;
DROP POLICY IF EXISTS "anon_read_editors" ON editors;
DROP POLICY IF EXISTS "anon_read_agent_logs" ON agent_logs;
DROP POLICY IF EXISTS "anon_read_performance_signals" ON performance_signals;

-- Campuses: keep anon read — no cross-tenant risk, needed to populate selector
CREATE POLICY "anon_read_campuses" ON campuses
  FOR SELECT TO anon
  USING (active = true);

-- No anon SELECT policies on videos, editors, agent_logs, performance_signals.
-- All dashboard reads go through the RPC functions below.

-- =========================================================================
-- Step 2: RPC functions — each requires a campus_id parameter
-- =========================================================================

-- Videos scoped to a single campus
CREATE OR REPLACE FUNCTION get_campus_videos(p_campus_id uuid)
RETURNS SETOF videos
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT * FROM videos
  WHERE campus_id = p_campus_id
  ORDER BY updated_at DESC
  LIMIT 200;
$$;

-- Agent logs scoped to a single campus
CREATE OR REPLACE FUNCTION get_campus_agent_logs(p_campus_id uuid, p_limit integer DEFAULT 50)
RETURNS SETOF agent_logs
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT * FROM agent_logs
  WHERE campus_id = p_campus_id
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

-- Editors scoped to a single campus (active only)
CREATE OR REPLACE FUNCTION get_campus_editors(p_campus_id uuid)
RETURNS SETOF editors
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT * FROM editors
  WHERE campus_id = p_campus_id AND active = true;
$$;

-- Performance signals scoped to a single campus
CREATE OR REPLACE FUNCTION get_campus_performance_signals(p_campus_id uuid, p_limit integer DEFAULT 4)
RETURNS SETOF performance_signals
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT * FROM performance_signals
  WHERE campus_id = p_campus_id
  ORDER BY week_of DESC
  LIMIT p_limit;
$$;

-- Grant anon the ability to call these functions
GRANT EXECUTE ON FUNCTION get_campus_videos(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_campus_agent_logs(uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION get_campus_editors(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_campus_performance_signals(uuid, integer) TO anon;

-- =========================================================================
-- Step 3: Research library unique index (from previous session)
-- =========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS research_library_campus_url
  ON research_library(campus_id, source_url);
