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

/** Fetch videos for a campus, ordered by updated_at desc. */
export function useVideos(campusId) {
  return useSupabaseQuery('videos', (sb) => {
    let q = sb.from('videos').select('*').order('updated_at', { ascending: false }).limit(100);
    if (campusId) q = q.eq('campus_id', campusId);
    return q;
  }, 15000);
}

/** Fetch recent agent logs. */
export function useAgentLogs(campusId, limit = 50) {
  return useSupabaseQuery('agent_logs', (sb) => {
    let q = sb.from('agent_logs').select('*').order('created_at', { ascending: false }).limit(limit);
    if (campusId) q = q.eq('campus_id', campusId);
    return q;
  }, 10000);
}

/** Fetch videos needing QA (qa_passed is null or false). */
export function useQAQueue(campusId) {
  return useSupabaseQuery('qa_queue', (sb) => {
    let q = sb.from('videos').select('*')
      .in('status', ['uploaded to dropbox', 'waiting'])
      .order('updated_at', { ascending: false });
    if (campusId) q = q.eq('campus_id', campusId);
    return q;
  }, 15000);
}

/** Fetch editors with their active task counts. */
export function useEditors(campusId) {
  return useSupabaseQuery('editors', (sb) => {
    let q = sb.from('editors').select('*').eq('active', true);
    if (campusId) q = q.eq('campus_id', campusId);
    return q;
  }, 30000);
}

/** Fetch active video count per editor. */
export function useEditorCounts(campusId) {
  return useSupabaseQuery('editor_counts', (sb) => {
    let q = sb.from('videos').select('assignee_id, status')
      .eq('status', 'in editing');
    if (campusId) q = q.eq('campus_id', campusId);
    return q;
  }, 15000);
}

/** Fetch latest performance signals. */
export function usePerformanceSignals(campusId, limit = 4) {
  return useSupabaseQuery('performance_signals', (sb) => {
    let q = sb.from('performance_signals').select('*')
      .order('week_of', { ascending: false }).limit(limit);
    if (campusId) q = q.eq('campus_id', campusId);
    return q;
  }, 60000);
}
