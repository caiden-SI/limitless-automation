-- RLS policies for dashboard (anon key read access).
-- Run this in the Supabase SQL Editor.
--
-- These policies scope anon SELECT access by campus_id.
-- The dashboard must always filter by campus_id in queries.
-- Service role key (used by agents) bypasses RLS entirely.
--
-- To apply cleanly, drop any previous blanket policies first.

-- Drop old blanket policies if they exist
DROP POLICY IF EXISTS "anon_read_campuses" ON campuses;
DROP POLICY IF EXISTS "anon_read_videos" ON videos;
DROP POLICY IF EXISTS "anon_read_editors" ON editors;
DROP POLICY IF EXISTS "anon_read_agent_logs" ON agent_logs;
DROP POLICY IF EXISTS "anon_read_performance_signals" ON performance_signals;

-- Campuses: allow anon to read active campuses (no cross-tenant risk here)
CREATE POLICY "anon_read_campuses" ON campuses
  FOR SELECT TO anon
  USING (active = true);

-- Videos: anon can only read rows matching a campus_id filter
CREATE POLICY "anon_read_videos" ON videos
  FOR SELECT TO anon
  USING (campus_id IS NOT NULL);

-- Editors: anon can only read active editors scoped by campus_id
CREATE POLICY "anon_read_editors" ON editors
  FOR SELECT TO anon
  USING (active = true AND campus_id IS NOT NULL);

-- Agent logs: anon can only read logs scoped by campus_id
CREATE POLICY "anon_read_agent_logs" ON agent_logs
  FOR SELECT TO anon
  USING (campus_id IS NOT NULL);

-- Performance signals: anon can only read signals scoped by campus_id
CREATE POLICY "anon_read_performance_signals" ON performance_signals
  FOR SELECT TO anon
  USING (campus_id IS NOT NULL);

-- Also add the unique index for research_library dedup (from previous session)
CREATE UNIQUE INDEX IF NOT EXISTS research_library_campus_url
  ON research_library(campus_id, source_url);
