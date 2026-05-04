// Agent grid — ported from the design's PortraitAgents. Seven cards with
// status-coloured spine, name + run count, sparkline, last action / error.
// Sparkline uses real hourlyBuckets math (not the design's synthetic mixer)
// so the values reflect actual `agent_logs` polling, not visual filler.

import { AGENTS } from '../lib/agents';
import { hourlyBuckets, summarizeAgent, timeAgo } from '../lib/health';

export default function AgentGrid({ logs, loading }) {
  return (
    <section id="agent-grid">
      <SectionTitle right={`${AGENTS.length} AGENTS · 24h`}>AGENTS</SectionTitle>
      <div className="lim-cpv-agents">
        {AGENTS.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            summary={summarizeAgent(agent.name, logs || [])}
            logs={logs || []}
            loading={loading}
          />
        ))}
      </div>
    </section>
  );
}

function AgentCard({ agent, summary, logs }) {
  const errors = summary.errors24h.length;
  const warnings = (logs || []).filter(
    (l) => l.agent_name === agent.name && l.status === 'warning' &&
      Date.now() - new Date(l.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length;
  const tone = errors > 0 ? 'red' : warnings > 0 ? 'amber' : 'green';
  const lastErr = summary.errors24h[0];
  const totalRuns = (logs || []).filter((l) => l.agent_name === agent.name).length;
  const action = lastErr
    ? lastErr.error_message?.slice(0, 48) || 'error'
    : summary.last?.action?.slice(0, 56) || 'idle';
  return (
    <button type="button" className={`lim-cpv-agent lim-cpv-agent--${tone}`}>
      <div className="lim-cpv-agent-head">
        <span className={`lim-cpv-agent-dot lim-cpv-agent-dot--${tone}`} />
        <span className="lim-cpv-agent-name">{agent.name}</span>
        <span className="lim-cpv-agent-runs">{totalRuns}</span>
      </div>
      <Sparkline name={agent.name} tone={tone} logs={logs} />
      <div className="lim-cpv-agent-foot">
        {lastErr ? (
          <>
            <span className="lim-cpv-agent-err">{action}</span>
            <span className="lim-cpv-agent-time">{timeAgo(lastErr.created_at)}</span>
          </>
        ) : summary.last ? (
          <>
            <span className="lim-cpv-agent-action">{action}</span>
            <span className="lim-cpv-agent-time">{timeAgo(summary.last.created_at)}</span>
          </>
        ) : (
          <span className="lim-cpv-agent-action" style={{ color: 'var(--ink-3)' }}>idle</span>
        )}
      </div>
    </button>
  );
}

function Sparkline({ name, tone, logs }) {
  const own = (logs || []).filter((l) => l.agent_name === name);
  const bins = hourlyBuckets(own);
  const max = Math.max(1, ...bins);
  const color = tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--amber)' : 'var(--ink-2)';
  return (
    <div className="lim-cpv-spark" aria-label={`24-hour activity, max ${max}`} role="img">
      {bins.map((v, i) => (
        <div
          key={i}
          className="lim-cpv-spark-bar"
          style={{
            height: `${Math.max(2, (v / max) * 100)}%`,
            background: color,
            opacity: 0.4 + (v / max) * 0.6,
          }}
        />
      ))}
    </div>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div className="lim-section-title">
      <h3>{children}</h3>
      {right && <span className="lim-section-title__right">{right}</span>}
    </div>
  );
}
