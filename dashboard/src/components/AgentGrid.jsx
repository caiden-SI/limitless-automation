// AGENTS panel — 3×3 grid rebuild (dashboard-agents-rebuild-spec.md).
//
// Cards render from AGENT_REGISTRY in order:
//   row 1: pipeline       footage-scan    qa
//   row 2: research       performance     scripting
//   row 3: onboarding     fireflies       profile-views
//
// Turn 3 fully implements the row-1 trio (pipeline / footage-scan /
// qa). The other six render placeholder bodies so the 3×3 grid
// holds its shape; Turns 4–5 swap them in.
//
// Each card pulls everything operational from the registry — its
// row filter (sourceAgent + optional actionFilter), sparkline
// window/bars, dot health thresholds, headline metric, cadence
// label/cron — so per-agent logic stays in lib/agents.js, not
// inlined here.

import { useMemo, useState } from 'react';
import { AGENT_REGISTRY, nextCronFire } from '../lib/agents';
import { timeAgo } from '../lib/health';

const FULL_IMPL = new Set([
  'pipeline',
  'footage-scan',
  'qa',
  'research',
  'performance',
  'scripting',
]);

// Object-property iteration order is insertion order in modern
// engines, and AGENT_REGISTRY is declared in 3×3 grid order — so
// Object.values() yields the layout sequence directly.
const REGISTRY_ORDER = Object.values(AGENT_REGISTRY);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AgentGrid({ logs }) {
  const [expandedName, setExpandedName] = useState(null);
  const now = Date.now();

  // Pre-slice the polled log array per agent so each card sees only
  // its own rows. footage-scan + pipeline share agent_name='pipeline'
  // and divide via actionFilter.
  const perAgentRows = useMemo(() => {
    const out = {};
    for (const agent of REGISTRY_ORDER) {
      const sourceMatched = (logs || []).filter(
        (l) => l.agent_name === agent.sourceAgent,
      );
      out[agent.name] = agent.actionFilter
        ? sourceMatched.filter((l) => agent.actionFilter(l.action || ''))
        : sourceMatched;
    }
    return out;
  }, [logs]);

  return (
    <section id="agent-grid" aria-label="Agents">
      <SectionTitle right={`${REGISTRY_ORDER.length} ON · 24h`}>
        AGENTS
      </SectionTitle>
      <div className="lim-cpv-agents">
        {REGISTRY_ORDER.map((agent) => {
          const isExpanded = expandedName === agent.name;
          const onToggle = () =>
            setExpandedName(isExpanded ? null : agent.name);
          const rows = perAgentRows[agent.name];
          if (FULL_IMPL.has(agent.name)) {
            return (
              <AgentCard
                key={agent.name}
                agent={agent}
                rows={rows}
                isExpanded={isExpanded}
                onToggle={onToggle}
                now={now}
              />
            );
          }
          return (
            <PlaceholderCard
              key={agent.name}
              agent={agent}
              isExpanded={isExpanded}
              onToggle={onToggle}
            />
          );
        })}
      </div>
    </section>
  );
}

function AgentCard({ agent, rows, isExpanded, onToggle, now }) {
  const dot = computeDot(agent, rows, now);
  const headline = agent.headlineMetric(rows, now);
  const footer = computeFooter(agent, rows, now);
  const className =
    `lim-cpv-agent lim-cpv-agent--${dot}` +
    (isExpanded ? ' is-expanded' : '');

  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      aria-expanded={isExpanded}
    >
      <div className="lim-cpv-agent-head">
        <span className={`lim-cpv-agent-dot lim-cpv-agent-dot--${dot}`} />
        <span className="lim-cpv-agent-name">{agent.name}</span>
        <span className="lim-cpv-agent-cadence">{agent.cadenceLabel}</span>
      </div>
      <div className="lim-cpv-agent-desc">{agent.description}</div>
      <Sparkline rows={rows} agent={agent} now={now} />
      <div className="lim-cpv-agent-metric">{headline}</div>
      <div className="lim-cpv-agent-footer">{footer}</div>
    </button>
  );
}

function PlaceholderCard({ agent, isExpanded, onToggle }) {
  const className =
    'lim-cpv-agent lim-cpv-agent--gray lim-cpv-agent--placeholder' +
    (isExpanded ? ' is-expanded' : '');
  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      aria-expanded={isExpanded}
    >
      <div className="lim-cpv-agent-head">
        <span className="lim-cpv-agent-dot lim-cpv-agent-dot--gray" />
        <span className="lim-cpv-agent-name">{agent.name}</span>
        <span className="lim-cpv-agent-cadence">{agent.cadenceLabel}</span>
      </div>
      <div className="lim-cpv-agent-desc">{agent.description}</div>
      <div className="lim-cpv-agent-placeholder">
        implementation in a later turn
      </div>
    </button>
  );
}

function Sparkline({ rows, agent, now }) {
  const bars = useMemo(
    () =>
      computeBars(rows, agent.sparklineWindowMs, agent.sparklineBars, now),
    [rows, agent, now],
  );
  const max = Math.max(1, ...bars);
  return (
    <div
      className="lim-cpv-spark"
      role="img"
      aria-label={`activity over ${formatWindowLabel(agent.sparklineWindowMs)}`}
    >
      {bars.map((v, i) => (
        <div
          key={i}
          className="lim-cpv-spark-bar"
          style={{
            height: `${Math.max(2, (v / max) * 100)}%`,
            opacity: 0.4 + (v / max) * 0.6,
          }}
        />
      ))}
    </div>
  );
}

// Bin row counts into `barCount` evenly-sized buckets ending at `now`.
// `windowMs` covers the whole sparkline; `binMs = windowMs / barCount`.
function computeBars(rows, windowMs, barCount, now) {
  const bins = new Array(barCount).fill(0);
  const start = now - windowMs;
  const binMs = windowMs / barCount;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (t < start || t > now) continue;
    const idx = Math.min(barCount - 1, Math.floor((t - start) / binMs));
    bins[idx] += 1;
  }
  return bins;
}

// Cadence-aware health dot. Spec: green within (interval × 1.5),
// amber up to (× 2), red beyond — plus per-agent overrides:
//   - qa: gray until first qa_started; amber when stale (no red).
//   - any agent: red when latest row's status is 'error'.
//   - event-driven without redAfterMs: stale → gray.
function computeDot(agent, rows, now) {
  const latest = rows[0]; // rows are DESC by created_at
  if (!latest) return 'gray';
  if (latest.status === 'error') return 'red';
  if (
    agent.name === 'qa' &&
    !rows.some((r) => r.action === 'qa_started')
  ) {
    return 'gray';
  }
  const ageMs = now - new Date(latest.created_at).getTime();
  if (ageMs <= agent.greenWithinMs) return 'green';
  if (agent.redAfterMs != null) {
    return ageMs > agent.redAfterMs ? 'red' : 'amber';
  }
  // Event-driven with no red threshold. qa goes amber when stale
  // (per its spec); pipeline/onboarding stay gray (idle ≠ unhealthy).
  if (agent.name === 'qa') return 'amber';
  return 'gray';
}

// Footer: `<last-run-ago> · <next-run>` in agent-appropriate form.
// Cron agents: relative ("next in Xm") under an hour, absolute
// ("next at 6 AM tomorrow") otherwise. Event-driven agents: pipeline
// shows "waiting for next event"; qa/onboarding show "idle · waits
// for trigger" (the more accurate "no pending EDITED video" check
// would require a videos-table read this component doesn't make).
function computeFooter(agent, rows, now) {
  const latest = rows[0];
  const ago = latest ? timeAgo(latest.created_at, now) : null;

  if (agent.cadenceType === 'cron') {
    const nextStr = formatNextCron(agent.cronExpression, now);
    if (!ago) return `awaiting first run · ${nextStr}`;
    return `${ago} · ${nextStr}`;
  }

  // Event-driven
  if (!ago) return 'idle · waits for trigger';
  if (agent.name === 'pipeline') return `${ago} · waiting for next event`;
  return `${ago} · idle · waits for trigger`;
}

function formatNextCron(cron, now) {
  const next = nextCronFire(cron, new Date(now));
  if (!next) return '';
  const diffMs = next.getTime() - now;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `next in ${diffMin}m`;

  const hour = next.getHours();
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  const timeStr = `${h12} ${ampm}`;

  // Weekly crons (day-of-week field is a literal number) always show
  // the day name — "next Mon at 7 AM" reads as a rhythm, "next at
  // 7 AM tomorrow" doesn't. Spec acceptance for performance/profile-views.
  if (isWeeklyCron(cron)) {
    return `next ${DAY_NAMES[next.getDay()]} at ${timeStr}`;
  }

  // Daily / sub-daily crons: today/tomorrow framing.
  const todayStr = new Date(now).toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toDateString();
  const nextStr = next.toDateString();

  if (nextStr === todayStr) {
    return `next at ${timeStr} ${hour >= 12 ? 'tonight' : 'today'}`;
  }
  if (nextStr === tomorrowStr) {
    return `next at ${timeStr} tomorrow`;
  }
  return `next ${DAY_NAMES[next.getDay()]} at ${timeStr}`;
}

function isWeeklyCron(cron) {
  if (!cron) return false;
  const parts = cron.trim().split(/\s+/);
  // Standard 5-field cron: <min> <hour> <dom> <mon> <dow>
  return parts.length >= 5 && /^\d+(,\d+)*$/.test(parts[4]);
}

function formatWindowLabel(windowMs) {
  const days = Math.round(windowMs / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.round(windowMs / 3_600_000);
  return `${hours}h`;
}

function SectionTitle({ children, right }) {
  return (
    <div className="lim-section-title">
      <h3>{children}</h3>
      {right && <span className="lim-section-title__right">{right}</span>}
    </div>
  );
}
