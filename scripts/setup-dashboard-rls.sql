-- RLS policies for dashboard (anon key read access).
-- Run this in the Supabase SQL Editor.
--
-- These policies allow the anon key to SELECT from tables
-- the dashboard needs. No INSERT/UPDATE/DELETE via anon.
-- Service role key (used by agents) bypasses RLS entirely.

-- Campuses: allow anon to read active campuses
CREATE POLICY "anon_read_campuses" ON campuses
  FOR SELECT TO anon
  USING (active = true);

-- Videos: allow anon to read all videos
CREATE POLICY "anon_read_videos" ON videos
  FOR SELECT TO anon
  USING (true);

-- Editors: allow anon to read active editors
CREATE POLICY "anon_read_editors" ON editors
  FOR SELECT TO anon
  USING (active = true);

-- Agent logs: allow anon to read logs
CREATE POLICY "anon_read_agent_logs" ON agent_logs
  FOR SELECT TO anon
  USING (true);

-- Performance signals: allow anon to read signals
CREATE POLICY "anon_read_performance_signals" ON performance_signals
  FOR SELECT TO anon
  USING (true);

-- Also add the unique index for research_library dedup (from previous session)
CREATE UNIQUE INDEX IF NOT EXISTS research_library_campus_url
  ON research_library(campus_id, source_url);
