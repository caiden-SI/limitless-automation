// QA queue — ported from PortraitQA. Two giant stat tiles (awaiting +
// failed/waiting), then failed-row list with inline error message and
// editor name.

import { useMemo } from 'react';
import { useAgentLogs, useEditors, useQAQueue } from '../lib/hooks';
import { timeAgo } from '../lib/health';

export default function QAQueue({ campusId, agentLogs }) {
  const { data: videos, loading, error } = useQAQueue(campusId);
  const { data: editors } = useEditors(campusId);
  const fallbackLogs = useAgentLogs(campusId, 100);
  const logs = agentLogs || fallbackLogs.data;

  const editorById = useMemo(
    () => Object.fromEntries((editors || []).map((e) => [e.id, e])),
    [editors],
  );

  if (loading) return <section><div style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading QA…</div></section>;
  if (error)   return <section><div style={{ color: 'var(--red)',   fontSize: 12 }}>Error: {error}</div></section>;

  const awaiting = (videos || []).filter((v) => v.status === 'EDITED' && v.qa_passed === null);
  const failed   = (videos || []).filter((v) => v.qa_passed === false || v.status === 'WAITING');

  const findError = (video) =>
    (logs || []).find(
      (l) =>
        l.agent_name === 'qa' &&
        l.status === 'error' &&
        ((l.action || '').includes(video.id) ||
          (l.error_message || '').includes(video.id) ||
          (l.action || '').toLowerCase().includes((video.title || '').toLowerCase())),
    );
  const lastQAErr = (logs || []).find((l) => l.agent_name === 'qa' && l.status === 'error');

  return (
    <section id="qa-queue" aria-label="QA queue">
      <div className="lim-section-title">
        <h3>QA QUEUE</h3>
        <span className="lim-section-title__right">
          {awaiting.length} AWAITING · {failed.length} FAILED
        </span>
      </div>

      <div className="lim-cpv-qa-grid">
        <div className="lim-cpv-stat">
          <div className="lim-cpv-stat-num">{awaiting.length}</div>
          <div className="lim-cpv-stat-label">AWAITING</div>
        </div>
        <div className={`lim-cpv-stat ${failed.length > 0 ? 'is-bad' : ''}`}>
          <div className="lim-cpv-stat-num">{failed.length}</div>
          <div className="lim-cpv-stat-label">FAILED / WAITING</div>
        </div>
      </div>

      <div className="lim-cpv-qa-list">
        {failed.length === 0 && <div className="lim-cpv-empty-row">— no failures —</div>}
        {failed.map((v) => {
          const editor = v.assignee_id ? editorById[v.assignee_id] : null;
          const log = findError(v) || (v.qa_passed === false ? lastQAErr : null);
          return (
            <button key={v.id} type="button" className="lim-cpv-qa-row">
              <div className="lim-cpv-qa-row-title">{v.title}</div>
              {log?.error_message && (
                <div className="lim-cpv-qa-row-err">↳ {log.error_message}</div>
              )}
              <div className="lim-cpv-qa-row-meta">
                <span className="lim-cpv-qa-row-editor">{editor?.name || 'unassigned'}</span>
                <span className="lim-cpv-qa-row-time">{timeAgo(v.updated_at)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
