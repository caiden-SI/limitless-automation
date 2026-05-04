// Integration Activity. Per docs/dashboard-scoring-fix-spec.md:
//   - Drop the green/amber/red state derivation. Single neutral dot.
//   - Status text is "last event {timeAgo}" or "no recent activity".
//   - Header counts active in last 24h, NOT connected/total.
//   - This panel never turns red. Real failures surface in Action Items
//     or System Pulse, not here.
//
// Layout (.lim-cpv-int + .lim-cpv-int-head + .lim-cpv-int-events) and
// expand-to-show-recent behaviour stay intact.

import { useMemo, useState } from 'react';
import { INTEGRATIONS } from '../lib/agents';
import { timeAgo } from '../lib/health';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function IntegrationHealth({ logs, inbox }) {
  const summary = useMemo(() => {
    const out = {};
    for (const integ of INTEGRATIONS) {
      const matches = (logs || []).filter((l) => {
        const haystack = `${l.agent_name} ${l.action || ''} ${l.error_message || ''}`.toLowerCase();
        return haystack.includes(integ.key);
      });
      out[integ.key] = { last: matches[0] || null, recent: matches.slice(0, 5) };
    }
    // Supabase: every agent_logs row IS a Supabase event. Surface the latest log.
    if ((logs || []).length > 0 && out.supabase) {
      out.supabase.last = logs[0];
    }
    // ClickUp: webhook_inbox.latest_received_at is a stronger ClickUp signal
    // than any log row.
    if (inbox?.latest_received_at && out.clickup) {
      const last = out.clickup.last;
      if (!last || new Date(inbox.latest_received_at) > new Date(last.created_at)) {
        out.clickup.last = { created_at: inbox.latest_received_at, action: 'webhook received' };
      }
    }
    return out;
  }, [logs, inbox]);

  // Active = saw activity in last 24h. Never alarming, just informational.
  const now = Date.now();
  const activeCount = INTEGRATIONS.filter((i) => {
    const last = summary[i.key]?.last?.created_at;
    return last && (now - new Date(last).getTime()) < DAY_MS;
  }).length;

  return (
    <section aria-label="Integrations">
      <div className="lim-section-title">
        <h3>INTEGRATIONS</h3>
        <span className="lim-section-title__right">
          {activeCount} ACTIVE IN LAST 24H
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
        const s = summary[it.key] || { last: null, recent: [] };
        const isOpen = open === it.key;
        return (
          <div key={it.key} className={`lim-cpv-int ${isOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className="lim-cpv-int-head"
              onClick={() => setOpen(isOpen ? null : it.key)}
              aria-expanded={isOpen}
            >
              <span className="lim-cpv-int-dot lim-cpv-int-dot--neutral" />
              <span className="lim-cpv-int-name">{it.name}</span>
              <span className="lim-cpv-int-last">
                {s.last ? `last event ${timeAgo(s.last.created_at)}` : 'no recent activity'}
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
