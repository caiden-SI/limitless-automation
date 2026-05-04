// Performance signals — ported from PortraitSignals. Latest week only
// (per design brief §3.5), with 36px hero numeral on the top hook.

import { usePerformanceSignals } from '../lib/hooks';

function formatViews(n) {
  if (!n && n !== 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function topHookViews(sig) {
  const top = sig.top_hooks?.[0];
  if (!top || typeof top.avg_views !== 'number') return null;
  return formatViews(top.avg_views);
}

export default function PerformanceSignals({ campusId }) {
  const { data: signals, loading, error } = usePerformanceSignals(campusId, 1);

  if (loading) return <section><div style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading signals…</div></section>;
  if (error)   return <section><div style={{ color: 'var(--red)',   fontSize: 12 }}>Error: {error}</div></section>;

  const sig = (signals || [])[0];

  return (
    <section aria-label="Performance signals">
      <div className="lim-section-title">
        <h3>SIGNALS</h3>
        <span className="lim-section-title__right">
          {sig ? `WK ${sig.week_of}` : 'WEEKLY · MON 7AM'}
        </span>
      </div>
      {!sig && <div className="lim-cpv-empty-row">First report generates Monday 7 AM.</div>}
      {sig && (
        <div className="lim-cpv-signals">
          <div className="lim-cpv-signal-hero">
            <div className="lim-cpv-signal-num">{topHookViews(sig) || '—'}</div>
            <div className="lim-cpv-signal-label">
              TOP HOOK · {(typeof sig.top_hooks?.[0] === 'object' ? sig.top_hooks[0].type : sig.top_hooks?.[0]) || '—'}
            </div>
          </div>
          {sig.summary && <p className="lim-cpv-signal-summary">{sig.summary}</p>}
          {sig.raw_output?.recommendations?.length > 0 && (
            <div className="lim-cpv-signal-section">
              <div className="lim-cpv-signal-section-head lim-cpv-signal-section-head--ok">+ DO MORE OF</div>
              {sig.raw_output.recommendations.slice(0, 3).map((r, i) => (
                <div key={i} className="lim-cpv-signal-line">{r}</div>
              ))}
            </div>
          )}
          {sig.raw_output?.underperforming_patterns?.length > 0 && (
            <div className="lim-cpv-signal-section">
              <div className="lim-cpv-signal-section-head lim-cpv-signal-section-head--warn">− AVOID</div>
              {sig.raw_output.underperforming_patterns.slice(0, 2).map((p, i) => (
                <div key={i} className="lim-cpv-signal-line">{p}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
