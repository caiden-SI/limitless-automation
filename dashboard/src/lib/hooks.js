import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

/**
 * Generic Supabase query hook with auto-refresh.
 *
 * Contract: callers pass an inline `queryFn` arrow (so it can close over
 * tenant ids etc.) plus an explicit `deps` array that lists every value the
 * query depends on. The query function lives in a ref so the fetch effect's
 * identity is stable across renders — only `deps` and `refreshInterval`
 * trigger refetches. Without this contract, the inline arrow's reference
 * changes on every render, which previously caused setData → re-render →
 * new arrow → new effect → immediate refetch → setData → ... an unbounded
 * loop that exhausted the browser socket pool with ERR_INSUFFICIENT_RESOURCES.
 */
export function useSupabaseQuery(tableName, queryFn, refreshInterval = 30000, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Always read the latest queryFn closure — assigning during render is
  // safe for refs (React doesn't track them) and avoids needing a separate
  // sync effect.
  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { data: result, error: err } = await queryFnRef.current(supabase);
        if (cancelled) return;
        if (err) throw err;
        setData(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    let intervalId;
    if (refreshInterval > 0) {
      intervalId = setInterval(run, refreshInterval);
    }
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
    // `deps` is a variadic refetch trigger — eslint can't see through it.
    // Each call site passes a stable-length array (one per hook), so the
    // dep-array length stays consistent across renders for that hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshInterval, ...deps]);

  const refetch = useCallback(() => {
    queryFnRef.current(supabase).then(({ data: result, error: err }) => {
      if (err) setError(err.message);
      else { setData(result); setError(null); }
    }).catch((err) => setError(err.message));
  }, []);

  return { data, loading, error, refetch };
}

/** Fetch all active campuses. */
export function useCampuses() {
  return useSupabaseQuery(
    'campuses',
    (sb) => sb.from('campuses').select('id, name, slug').eq('active', true).order('name'),
    60000,
    [],
  );
}

/** Fetch videos for a campus via RPC (enforces tenant scoping). */
export function useVideos(campusId) {
  return useSupabaseQuery(
    'videos',
    (sb) => {
      if (!campusId) return sb.from('videos').select('*').limit(0);
      return sb.rpc('get_campus_videos', { p_campus_id: campusId });
    },
    15000,
    [campusId],
  );
}

/** Fetch recent agent logs via RPC. */
export function useAgentLogs(campusId, limit = 50) {
  return useSupabaseQuery(
    'agent_logs',
    (sb) => {
      if (!campusId) return sb.from('agent_logs').select('*').limit(0);
      return sb.rpc('get_campus_agent_logs', { p_campus_id: campusId, p_limit: limit });
    },
    10000,
    [campusId, limit],
  );
}

/** Fetch videos needing QA (qa_passed is null or false). */
export function useQAQueue(campusId) {
  return useSupabaseQuery(
    'qa_queue',
    (sb) => {
      if (!campusId) return sb.from('videos').select('*').limit(0);
      return sb.rpc('get_campus_videos', { p_campus_id: campusId });
    },
    15000,
    [campusId],
  );
}

/** Fetch editors via RPC. */
export function useEditors(campusId) {
  return useSupabaseQuery(
    'editors',
    (sb) => {
      if (!campusId) return sb.from('editors').select('*').limit(0);
      return sb.rpc('get_campus_editors', { p_campus_id: campusId });
    },
    30000,
    [campusId],
  );
}

/** Fetch active video count per editor via RPC. */
export function useEditorCounts(campusId) {
  return useSupabaseQuery(
    'editor_counts',
    (sb) => {
      if (!campusId) return sb.from('videos').select('*').limit(0);
      return sb.rpc('get_campus_videos', { p_campus_id: campusId });
    },
    15000,
    [campusId],
  );
}

/** Fetch latest performance signals via RPC. */
export function usePerformanceSignals(campusId, limit = 4) {
  return useSupabaseQuery(
    'performance_signals',
    (sb) => {
      if (!campusId) return sb.from('performance_signals').select('*').limit(0);
      return sb.rpc('get_campus_performance_signals', { p_campus_id: campusId, p_limit: limit });
    },
    60000,
    [campusId, limit],
  );
}

/** Webhook inbox state — count by state, oldest pending, latest failed/received. */
export function useWebhookInboxStatus(campusId) {
  return useSupabaseQuery(
    'webhook_inbox_status',
    (sb) => {
      if (!campusId) return sb.from('webhook_inbox').select('id').limit(0);
      return sb.rpc('get_campus_webhook_inbox_status', { p_campus_id: campusId });
    },
    30000,
    [campusId],
  );
}

/** Single-row infra health snapshot for the system health strip. */
export function useSystemHealthSummary(campusId) {
  return useSupabaseQuery(
    'system_health_summary',
    (sb) => {
      if (!campusId) return sb.from('agent_logs').select('id').limit(0);
      return sb.rpc('get_campus_system_health_summary', { p_campus_id: campusId });
    },
    30000,
    [campusId],
  );
}
