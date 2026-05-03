// Integration list — ported from PortraitIntegrations. Click expands to
// the most recent five matching events. Source of truth: agent_logs +
// webhook_inbox.latest_received_at (the ClickUp tunnel proxy).

import { useMemo, useState } from 'react';
import { INTEGRATIONS } from '../lib/agents';
import { timeAgo } from '../lib/health';

const HOUR = 60 * 60 * 1000;

export default function IntegrationHealth({ logs, inbox }) {
  const summary = useMemo(() => {
    const now = Date.now();
    const out = {};
    for (const integ of INTEGRATIONS) {
      const matches = (logs || []).filter((l) => {
        const haystack = `${l.agent_name} ${l.action || ''} ${l.error_message || ''}`.toLowerCase();
        return haystack.includes(integ.key);
      });
      const last = matches[0];
      const lastErr = matches.find((m) => m.status === 'error');
      let state = 'red';
      if (last) {
        const age = now - new Date(last.created_at).getTime();
        if (age < 24 * HOUR) state = 'green';
        if (lastErr && now - new Date(lastErr.created_at).getTime() < HOUR) state = 'amber';
      }
      out[integ.key] = { last, state, recent: matches.slice(0, 5) };
    }
    if ((logs || []).length > 0 && out.supabase) {
      out.supabase.state = 'green';
      out.supabase.last = logs[0];
    }
    if (inbox?.latest_received_at && out.clickup) {
      const last = out.clickup.last;
      if (!last || new Date(inbox.latest_received_at) > new Date(last.created_at)) {
        out.clickup.last = { created_at: inbox.latest_received_at, action: 'webhook received' };
        out.clickup.state = 'green';
      }
    }
    return out;
  }, [logs, inbox]);

  const connected = INTEGRATIONS.filter((i) => summary[i.key]?.state === 'green').length;

  return (
    <section aria-label="Integrations">
      <div className="lim-section-title">
        <h3>INTEGRATIONS</h3>
        <span className="lim-section-title__right">
          {connected}/{INTEGRATIONS.length} CONNECTED
        </span>
      </div>
      <Body summary={summary} />
    </section>
  );
}

function Body({ summary }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="lim-cpv-int-list">
      {INTEGRATIONS.map((it) => {
        const s = summary[it.key] || { state: 'red', last: null, recent: [] };
        const isOpen = open === it.key;
        return (
          <div key={it.key} className={`lim-cpv-int ${isOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className="lim-cpv-int-head"
              onClick={() => setOpen(isOpen ? null : it.key)}
              aria-expanded={isOpen}
            >
              <span className={`lim-cpv-int-dot lim-cpv-int-dot--${s.state}`} />
              <span className="lim-cpv-int-name">{it.name}</span>
              <span className={`lim-cpv-int-status lim-cpv-int-status--${s.state}`}>
                {s.state === 'green' ? 'connected' : s.state === 'amber' ? 'degraded' : 'disconnected'}
              </span>
              <span className="lim-cpv-int-sep">·</span>
              <span className="lim-cpv-int-last">
                last event {s.last ? timeAgo(s.last.created_at) : '—'}
              </span>
              <span className="lim-cpv-int-chev">{isOpen ? '–' : '+'}</span>
            </button>
            {isOpen && (
              <div className="lim-cpv-int-events">
                {s.recent.length === 0 && (
                  <div className="lim-cpv-int-event" style={{ color: 'var(--ink-3)' }}>
                    No events on record.
                  </div>
                )}
                {s.recent.map((evt, i) => (
                  <div key={evt.id || i} className="lim-cpv-int-event">
                    {evt.action || evt.event_type || 'activity'} ({timeAgo(evt.created_at)})
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
