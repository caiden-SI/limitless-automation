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

-- =========================================================================
-- Step 4: Ops dashboard RPCs (added 2026-05-01 for /ops view)
-- =========================================================================

-- Webhook inbox status. The webhook_inbox table is global (no campus_id),
-- but the RPC takes p_campus_id for API consistency with the rest of the
-- dashboard surface and future tenant-scoping.
--
-- latest_failed_error_message added 2026-05-03 for the scoring-fix spec's
-- webhook-fail action item detail line.
CREATE OR REPLACE FUNCTION get_campus_webhook_inbox_status(p_campus_id uuid)
RETURNS TABLE (
  total bigint,
  processed bigint,
  pending bigint,
  failed bigint,
  oldest_pending_received_at timestamptz,
  latest_failed_at timestamptz,
  latest_received_at timestamptz,
  latest_failed_error_message text
)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE processed_at IS NOT NULL)::bigint,
    COUNT(*) FILTER (WHERE processed_at IS NULL AND failed_at IS NULL)::bigint,
    COUNT(*) FILTER (WHERE failed_at IS NOT NULL)::bigint,
    MIN(received_at) FILTER (WHERE processed_at IS NULL AND failed_at IS NULL),
    MAX(failed_at),
    MAX(received_at),
    (SELECT error_message FROM webhook_inbox
       WHERE failed_at IS NOT NULL
       ORDER BY failed_at DESC LIMIT 1)
  FROM webhook_inbox;
$$;

-- System health summary. One row with the timestamps and counts the
-- dashboard's three layers (Action Items, System Pulse, Integration
-- Activity) need.
--
-- Per docs/dashboard-scoring-fix-spec.md:
--  - last_*_run drops the `status = 'success'` filter. The dashboard
--    separates "did it fire" from "did it succeed"; an erroring cron
--    still fired and surfaces in the error-spike action item.
--  - system_uptime is the earliest agent_logs row for this campus, so
--    the cron-rule decision table can recognise crons that have never
--    been due during this system's lifetime.
--  - edited_video_count + lufs_errors_24h gate the audio-normalization
--    pulse cell — if no EDITED video has ever existed, the LUFS check
--    has never been exercised and the cell stays green.
--  - ffmpeg_boot_check_status and last_lufs_measurement remain in the
--    table for backward compat; the new code stops reading them.
CREATE OR REPLACE FUNCTION get_campus_system_health_summary(p_campus_id uuid)
RETURNS TABLE (
  last_research_run timestamptz,
  last_performance_run timestamptz,
  last_scripting_run timestamptz,
  last_fireflies_run timestamptz,
  last_lufs_measurement timestamptz,
  ffmpeg_boot_check_status text,
  errors_last_hour bigint,
  last_webhook_received_at timestamptz,
  system_uptime timestamptz,
  edited_video_count bigint,
  lufs_errors_24h integer
)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT
    (SELECT MAX(created_at) FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'research'),
    (SELECT MAX(created_at) FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'performance'),
    (SELECT MAX(created_at) FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'scripting'),
    (SELECT MAX(created_at) FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'fireflies'),
    (SELECT MAX(created_at) FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'qa' AND action ILIKE '%lufs%'),
    (SELECT status FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'server' AND action ILIKE '%ffmpeg%'
       ORDER BY created_at DESC LIMIT 1),
    (SELECT COUNT(*) FROM agent_logs
       WHERE campus_id = p_campus_id AND status = 'error'
         AND created_at > NOW() - INTERVAL '1 hour')::bigint,
    (SELECT MAX(received_at) FROM webhook_inbox),
    (SELECT MIN(created_at) FROM agent_logs
       WHERE campus_id = p_campus_id),
    (SELECT COUNT(*) FROM videos
       WHERE campus_id = p_campus_id AND status = 'EDITED')::bigint,
    (SELECT COUNT(*) FROM agent_logs
       WHERE campus_id = p_campus_id
         AND agent_name = 'qa'
         AND action ILIKE '%lufs%'
         AND status = 'error'
         AND created_at > NOW() - INTERVAL '24 hours')::integer;
$$;

GRANT EXECUTE ON FUNCTION get_campus_webhook_inbox_status(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_campus_system_health_summary(uuid) TO anon;
