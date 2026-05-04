// Full 11-column kanban — ported from the design's PortraitKanban.
// Stuck and failed lanes get inset shadow markers. Cards clamp to two lines
// and surface editor first name + stuck days.

import { useMemo } from 'react';
import { useEditors, useVideos } from '../lib/hooks';
import {
  STATUS_ORDER, isStuck, statusLabel, timeAgo, STUCK_THRESHOLDS,
} from '../lib/health';

const HOUR_MS = 60 * 60 * 1000;

function stuckDays(video) {
  if (!video?.updated_at || !isStuck(video)) return 0;
  const ms = Date.now() - new Date(video.updated_at).getTime();
  return Math.max(1, Math.round(ms / (24 * HOUR_MS)));
}

export default function PipelineKanban({ campusId }) {
  const { data: videos, loading, error } = useVideos(campusId);
  const { data: editors } = useEditors(campusId);

  const editorById = useMemo(
    () => Object.fromEntries((editors || []).map((e) => [e.id, e])),
    [editors],
  );

  if (loading) return <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading pipeline…</div>;
  if (error)   return <div style={{ color: 'var(--red)',   fontSize: 12 }}>Error: {error}</div>;

  const cols = {};
  for (const s of STATUS_ORDER) cols[s] = [];
  for (const v of videos || []) {
    if (cols[v.status]) cols[v.status].push(v);
  }

  return (
    <div className="lim-cpv-kanban">
      {STATUS_ORDER.map((s, idx) => {
        const list = cols[s] || [];
        const stuckN = list.filter((v) => isStuck(v)).length;
        const failN  = list.filter((v) => v.qa_passed === false).length;
        return (
          <div
            key={s}
            className={`lim-cpv-lane ${stuckN > 0 ? 'has-stuck' : ''} ${failN > 0 ? 'has-fail' : ''}`}
          >
            <div className="lim-cpv-lane-head">
              <div className="lim-cpv-lane-count">{list.length}</div>
              <div className="lim-cpv-lane-name">{statusLabel(s)}</div>
              <div className="lim-cpv-lane-idx">{String(idx + 1).padStart(2, '0')} / 11</div>
              {STUCK_THRESHOLDS[s] && (
                <div className="lim-cpv-lane-idx" title="stuck threshold">
                  ⧗ {Math.round(STUCK_THRESHOLDS[s] / (24 * HOUR_MS))}d
                </div>
              )}
            </div>
            <div className="lim-cpv-lane-cards">
              {list.map((v) => {
                const editor = v.assignee_id ? editorById[v.assignee_id] : null;
                const sd = stuckDays(v);
                return (
                  <div
                    key={v.id}
                    className={`lim-cpv-card ${v.qa_passed === false ? 'is-fail' : ''} ${sd > 0 ? 'is-stuck' : ''}`}
                    title={v.title}
                  >
                    <div className="lim-cpv-card-title">{v.title}</div>
                    <div className="lim-cpv-card-meta">
                      <span>
                        {(editor?.name || v.student_name || '—').split(' ')[0]}
                      </span>
                      {sd > 0 && (
                        <span className="lim-stuck lim-stuck--pulse" title={`stuck ${sd}d`}>
                          <span className="lim-pulse-dot" />{sd}d
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto' }}>{timeAgo(v.updated_at)}</span>
                    </div>
                  </div>
                );
              })}
              {list.length === 0 && <div className="lim-cpv-lane-empty">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
