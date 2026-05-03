// Live event stream — ported from PortraitActivity. Real agent_logs feed
// with hover-pause and an agent filter. Errors expand inline.

import { useMemo, useState } from 'react';
import { AGENT_BY_NAME } from '../lib/agents';

const AGENT_LABEL = {
  pipeline: 'pipeline',
  qa: 'qa',
  research: 'research',
  performance: 'perf',
  scripting: 'script',
  onboarding: 'onb',
  fireflies: 'fireflies',
  scheduler: 'sched',
  server: 'server',
  webhook: 'webhook',
};

function logTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function LiveEventStream({ logs, loading, error, limit = 18 }) {
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('all');

  const visible = useMemo(() => {
    const filtered = (logs || []).filter((l) => {
      if (filter === 'all')   return true;
      if (filter === 'error') return l.status === 'error';
      return l.agent_name === filter;
    });
    return filtered.slice(0, limit);
  }, [logs, filter, limit]);

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Live event stream"
    >
      <div className="lim-section-title">
        <h3>ACTIVITY</h3>
        <div className="lim-stream-controls">
          <select
            className="lim-stream-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter events"
          >
            <option value="all">ALL</option>
            <option value="error">ERRORS</option>
            {Object.values(AGENT_BY_NAME).map((a) => (
              <option key={a.name} value={a.name}>{a.label.toUpperCase()}</option>
            ))}
          </select>
          <span className="lim-section-title__right">
            {paused ? 'PAUSED' : 'LIVE · 10s'}
          </span>
        </div>
      </div>

      <div className="lim-cpv-activity">
        {loading && <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading…</div>}
        {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>Error: {error}</div>}
        {!loading && visible.length === 0 && (
          <div style={{ color: 'var(--ink-3)', fontSize: 12, padding: '8px 0' }}>
            No events match this filter.
          </div>
        )}
        {visible.map((l) => (
          <div key={l.id} className={`lim-c-log lim-c-log--${l.status || 'success'}`}>
            <span className="lim-c-log-time">{logTime(l.created_at)}</span>
            <span className={`lim-c-log-agent lim-c-log-agent--${l.status || 'success'}`}>
              {AGENT_LABEL[l.agent_name] || l.agent_name}
            </span>
            <span className="lim-c-log-msg">
              {l.action}
              {l.error_message && (
                <span className="lim-c-log-err">↳ {l.error_message}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
