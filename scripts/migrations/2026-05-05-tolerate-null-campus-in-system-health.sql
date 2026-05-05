-- Tolerate NULL campus_id in agent-last-run subqueries of
-- get_campus_system_health_summary.
--
-- Background: the fireflies agent writes its run-level events
-- (fireflies_run_started, fireflies_run_complete) with NULL
-- campus_id because Fireflies meetings span campuses before
-- per-transcript matching tags individual rows. research /
-- performance / scripting also occasionally write run-level
-- rows without a campus_id (e.g. run_all_error before the
-- per-campus loop assigns one).
--
-- The previous RPC scoped these MAX(created_at) subqueries with
-- `WHERE campus_id = p_campus_id`, which excluded those system-
-- level rows. Result: the System Pulse "Cron schedule" cell
-- (and the cron-miss action item) saw a stale lastFire — the
-- last campus-tagged row, often days behind the actual most-
-- recent fire — and lit amber for fireflies even when it had
-- fired on schedule the previous night.
--
-- Fix: include NULL campus rows in the four agent-last-run
-- subqueries, since they represent fires that affect all
-- campuses. Other subqueries (last_lufs_measurement, ffmpeg
-- check, errors_last_hour, system_uptime, edited_video_count,
-- qa error counts, all health-ping fields) keep their strict
-- `campus_id = p_campus_id` filter — those rows are tagged
-- per-campus by their writers.
--
-- The function shape is unchanged from the previous definition,
-- so CREATE OR REPLACE works (no DROP needed). Idempotent —
-- safe to re-run.

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
  lufs_errors_24h integer,
  qa_errors_24h integer,
  last_tunnel_ping_ok timestamptz,
  tunnel_recent_failures integer,
  tunnel_last_error text,
  pm2_status text,
  pm2_detail text,
  ffmpeg_status text,
  ffmpeg_detail text,
  disk_status text,
  disk_detail text,
  memory_status text,
  memory_detail text
)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT
    -- last_research_run — broadened to include NULL-campus rows
    (SELECT MAX(created_at) FROM agent_logs
       WHERE agent_name = 'research'
         AND (campus_id = p_campus_id OR campus_id IS NULL)),
    -- last_performance_run — broadened
    (SELECT MAX(created_at) FROM agent_logs
       WHERE agent_name = 'performance'
         AND (campus_id = p_campus_id OR campus_id IS NULL)),
    -- last_scripting_run — broadened
    (SELECT MAX(created_at) FROM agent_logs
       WHERE agent_name = 'scripting'
         AND (campus_id = p_campus_id OR campus_id IS NULL)),
    -- last_fireflies_run — broadened (this was the active bug:
    -- run-level rows are NULL-campus, so the strict filter saw
    -- only the most recent per-transcript row, days stale)
    (SELECT MAX(created_at) FROM agent_logs
       WHERE agent_name = 'fireflies'
         AND (campus_id = p_campus_id OR campus_id IS NULL)),
    -- last_lufs_measurement — campus-tagged, unchanged
    (SELECT MAX(created_at) FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'qa' AND action ILIKE '%lufs%'),
    -- ffmpeg_boot_check_status — unchanged
    (SELECT status FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'server' AND action ILIKE '%ffmpeg%'
       ORDER BY created_at DESC LIMIT 1),
    -- errors_last_hour — unchanged
    (SELECT COUNT(*) FROM agent_logs
       WHERE campus_id = p_campus_id AND status = 'error'
         AND created_at > NOW() - INTERVAL '1 hour')::bigint,
    -- last_webhook_received_at — unchanged
    (SELECT MAX(received_at) FROM webhook_inbox),
    -- system_uptime — unchanged
    GREATEST(
      (SELECT MIN(created_at) FROM agent_logs
         WHERE campus_id = p_campus_id
           AND created_at > '2026-04-29'::timestamptz),
      '2026-04-29'::timestamptz
    ),
    -- edited_video_count — unchanged
    (SELECT COUNT(*) FROM videos
       WHERE campus_id = p_campus_id AND status = 'EDITED')::bigint,
    -- lufs_errors_24h — unchanged
    (SELECT COUNT(*) FROM agent_logs
       WHERE campus_id = p_campus_id
         AND agent_name = 'qa'
         AND action ILIKE '%lufs%'
         AND status = 'error'
         AND created_at > NOW() - INTERVAL '24 hours')::integer,
    -- qa_errors_24h — unchanged
    (SELECT COUNT(*) FROM agent_logs
       WHERE campus_id = p_campus_id
         AND agent_name = 'qa'
         AND status = 'error'
         AND created_at > NOW() - INTERVAL '24 hours')::integer,
    -- All health-ping fields below are written per-campus by
    -- scripts/health-ping.js, unchanged.
    (SELECT MAX(created_at) FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_tunnel' AND status = 'success'),
    (SELECT COUNT(*) FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_tunnel' AND status = 'error'
         AND created_at > NOW() - INTERVAL '5 minutes')::integer,
    (SELECT error_message FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_tunnel' AND status = 'error'
       ORDER BY created_at DESC LIMIT 1),
    (SELECT status FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_pm2'
         AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC LIMIT 1),
    (SELECT error_message FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_pm2'
         AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC LIMIT 1),
    (SELECT status FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_ffmpeg'
         AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC LIMIT 1),
    (SELECT error_message FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_ffmpeg'
         AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC LIMIT 1),
    (SELECT status FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_disk'
         AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC LIMIT 1),
    (SELECT error_message FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_disk'
         AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC LIMIT 1),
    (SELECT status FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_memory'
         AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC LIMIT 1),
    (SELECT error_message FROM agent_logs
       WHERE campus_id = p_campus_id AND agent_name = 'health'
         AND action = 'ping_memory'
         AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY created_at DESC LIMIT 1);
$$;

GRANT EXECUTE ON FUNCTION get_campus_system_health_summary(uuid) TO anon;
