-- Per-card windowed agent_logs RPC for the AGENTS dashboard panel.
--
-- The previous get_campus_agent_logs(campus, limit) returns the latest N
-- rows globally, which means high-frequency agents (health-ping, pipeline)
-- saturate the buffer and infrequent agents (research, performance,
-- profile-views) get starved out of view. This RPC scopes by agent_name
-- and a time window, so each AGENTS card can fetch exactly the slice it
-- needs.

CREATE OR REPLACE FUNCTION get_campus_agent_logs_window(
  p_campus_id uuid,
  p_agent_name text,
  p_since timestamptz,
  p_limit integer DEFAULT 500
)
RETURNS SETOF agent_logs
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT * FROM agent_logs
  WHERE campus_id = p_campus_id
    AND agent_name = p_agent_name
    AND created_at >= p_since
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_campus_agent_logs_window(uuid, text, timestamptz, integer) TO anon;

-- Composite index supports the (campus_id, agent_name, created_at DESC)
-- access pattern this RPC introduces. Idempotent — IF NOT EXISTS so the
-- migration is safe to re-run.
CREATE INDEX IF NOT EXISTS agent_logs_campus_agent_created_idx
  ON agent_logs (campus_id, agent_name, created_at DESC);
