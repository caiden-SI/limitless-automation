// Integration health — horizontal pill strip rebuild
// (dashboard-agents-rebuild-spec.md → "INTEGRATIONS pill strip").
//
// Compresses the previous ~600px stacked panel into a ~50–60px
// row of pills. Each pill: status dot + integration name + last
// event time. "<connected>/<total> CONNECTED" summary on the right
// of the section header. Hover reveals the full last-event detail
// in a CSS tooltip.
//
// "Connected" = activity within the last 24h. The same definition
// the previous panel used for its "ACTIVE IN LAST 24H" count, just
// reframed as a health read.
//
// Substring-match summary logic (haystack of agent_name + action +
// error_message) is unchanged — only the rendered shape differs.

import { useMemo } from 'react';
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
      out[integ.key] = { last: matches[0] || null };
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

  const now = Date.now();
  const connectedCount = INTEGRATIONS.filter((i) => {
    const last = summary[i.key]?.last?.created_at;
    return last && (now - new Date(last).getTime()) < DAY_MS;
  }).length;

  return (
    <section aria-label="Integrations">
      <div className="lim-section-title">
        <h3>INTEGRATIONS</h3>
        <span className="lim-section-title__right">
          {connectedCount}/{INTEGRATIONS.length} CONNECTED
        </span>
      </div>
      <div className="lim-cpv-int-strip">
        {INTEGRATIONS.map((it) => {
          const last = summary[it.key]?.last;
          const lastMs = last ? new Date(last.created_at).getTime() : null;
          const isConnected = lastMs != null && now - lastMs < DAY_MS;
          const ago = last ? timeAgo(last.created_at, now) : 'no activity';
          const action = (last?.action || 'activity').toString();
          const tooltip = last
            ? `last event: ${action} · ${ago}`
            : 'no recent activity';
          const stateClass = isConnected
            ? 'lim-cpv-int-pill--connected'
            : 'lim-cpv-int-pill--idle';
          return (
            <span
              key={it.key}
              className={`lim-cpv-int-pill ${stateClass}`}
              data-tooltip={tooltip}
              title={tooltip}
              aria-label={`${it.name} — ${tooltip}`}
            >
              <span className="lim-cpv-int-pill-dot" aria-hidden="true" />
              <span className="lim-cpv-int-pill-name">{it.name}</span>
              <span className="lim-cpv-int-pill-ago">{ago}</span>
            </span>
          );
        })}
      </div>
    </section>
  );
}
