// Health bars rendered as the design's PortraitHero pair: mega 96px score,
// 10px segmented bar weighted by `max`, breakdown keys with dots. Used as
// header siblings on Ops + Pipeline routes.

import { healthHexFor } from '../lib/health';

function classify(score) {
  if (score >= 90) return 'green';
  if (score >= 60) return 'amber';
  return 'red';
}

export default function HealthBars({ ops, sys }) {
  const sysParts = sys.cells.map((c) => ({
    label: c.label,
    score: c.state === 'green' ? c.weight : c.state === 'amber' ? Math.round(c.weight / 2) : 0,
    max: c.weight,
    state: c.state,
    anchor: 'system-health',
  }));
  const opParts = ops.parts.map((p) => ({
    label: p.label,
    score: p.score,
    max: p.max,
    state: p.score / p.max >= 0.9 ? 'green' : p.score / p.max >= 0.5 ? 'amber' : 'red',
    anchor: p.anchor,
  }));
  return (
    <>
      <Hero title="OPERATIONAL" score={ops.score} breakdown={opParts} />
      <Hero title="SYSTEM" score={sys.score} breakdown={sysParts} />
    </>
  );
}

function Hero({ title, score, breakdown }) {
  const state = classify(score);
  const stateColor = healthHexFor(state);
  return (
    <div className={`lim-cpv-hero lim-cpv-hero--${state}`}>
      <div className="lim-cpv-hero-head">
        <span className="lim-cpv-hero-title">{title}</span>
        <span className="lim-cpv-hero-state" style={{ color: stateColor }}>
          {state.toUpperCase()}
        </span>
      </div>
      <div className="lim-cpv-hero-num-wrap">
        <span className="lim-cpv-hero-num" style={{ color: stateColor }}>{score}</span>
        <span className="lim-cpv-hero-denom">/100</span>
      </div>
      <div className="lim-cpv-hero-bar">
        {breakdown.map((b, i) => (
          <div key={i} className={`lim-cpv-hero-seg lim-cpv-hero-seg--${b.state}`} style={{ flex: b.max }}>
            <div className="lim-cpv-hero-seg-fill" style={{ width: `${(b.score / b.max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="lim-cpv-hero-keys">
        {breakdown.map((b, i) => (
          <a key={i} className="lim-cpv-hero-key-anchor" href={`#${b.anchor || ''}`}>
            <div className="lim-cpv-hero-key">
              <span className={`lim-cpv-hero-key-dot lim-cpv-hero-key-dot--${b.state}`} />
              <span className="lim-cpv-hero-key-label">{b.label}</span>
              <span className="lim-cpv-hero-key-val">
                {b.score}<span style={{ color: 'var(--ink-3)' }}>/{b.max}</span>
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
