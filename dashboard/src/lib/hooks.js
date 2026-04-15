import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

/**
 * Generic Supabase query hook with auto-refresh.
 */
export function useSupabaseQuery(tableName, queryFn, refreshInterval = 30000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    try {
      const query = queryFn(supabase);
      const { data: result, error: err } = await query;
      if (err) throw err;
      setData(result);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [queryFn]);

  useEffect(() => {
    fetch();
    if (refreshInterval > 0) {
      const id = setInterval(fetch, refreshInterval);
      return () => clearInterval(id);
    }
  }, [fetch, refreshInterval]);

  return { data, loading, error, refetch: fetch };
}

/** Fetch all active campuses. */
export function useCampuses() {
  return useSupabaseQuery('campuses', (sb) =>
    sb.from('campuses').select('id, name, slug').eq('active', true).order('name'),
  60000);
}

/** Fetch videos for a campus via RPC (enforces tenant scoping). */
export function useVideos(campusId) {
  return useSupabaseQuery('videos', (sb) => {
    if (!campusId) return sb.from('videos').select('*').limit(0);
    return sb.rpc('get_campus_videos', { p_campus_id: campusId });
  }, 15000);
}

/** Fetch recent agent logs via RPC. */
export function useAgentLogs(campusId, limit = 50) {
  return useSupabaseQuery('agent_logs', (sb) => {
    if (!campusId) return sb.from('agent_logs').select('*').limit(0);
    return sb.rpc('get_campus_agent_logs', { p_campus_id: campusId, p_limit: limit });
  }, 10000);
}

/** Fetch videos needing QA (qa_passed is null or false). */
export function useQAQueue(campusId) {
  return useSupabaseQuery('qa_queue', (sb) => {
    if (!campusId) return sb.from('videos').select('*').limit(0);
    return sb.rpc('get_campus_videos', { p_campus_id: campusId });
  }, 15000);
}

/** Fetch editors via RPC. */
export function useEditors(campusId) {
  return useSupabaseQuery('editors', (sb) => {
    if (!campusId) return sb.from('editors').select('*').limit(0);
    return sb.rpc('get_campus_editors', { p_campus_id: campusId });
  }, 30000);
}

/** Fetch active video count per editor via RPC. */
export function useEditorCounts(campusId) {
  return useSupabaseQuery('editor_counts', (sb) => {
    if (!campusId) return sb.from('videos').select('*').limit(0);
    return sb.rpc('get_campus_videos', { p_campus_id: campusId });
  }, 15000);
}

/** Fetch latest performance signals via RPC. */
export function usePerformanceSignals(campusId, limit = 4) {
  return useSupabaseQuery('performance_signals', (sb) => {
    if (!campusId) return sb.from('performance_signals').select('*').limit(0);
    return sb.rpc('get_campus_performance_signals', { p_campus_id: campusId, p_limit: limit });
  }, 60000);
}
