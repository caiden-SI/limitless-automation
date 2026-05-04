// Two header heroes for the dashboard. Per docs/dashboard-scoring-fix-spec.md:
//   - Left: ACTION ITEMS — mega number = action count, or "ALL CLEAR" green
//   - Right: SYSTEM PULSE — mega number = non-green pulse cells, or "ALL GREEN"
// Same .lim-cpv-hero shell as before; no weighted scores, no x/100.

import { healthHexFor } from '../lib/health';

const VISIBLE_CAP = 6;

// Group action items by category for the segmented bar. Each segment width
// is proportional to the count, coloured by category urgency.
function actionSegments(items) {
  if (items.length === 0) return [];
  const byCat = {};
  for (const it of items) {
    if (!byCat[it.category]) byCat[it.category] = { category: it.category, count: 0, urgency: it.urgency };
    byCat[it.category].count += 1;
    byCat[it.category].urgency = Math.max(byCat[it.category].urgency, it.urgency);
  }
  return Object.values(byCat).map((seg) => ({
    label: seg.category,
    state: seg.urgency >= 3 ? 'red' : seg.urgency >= 2 ? 'amber' : 'green',
    flex: seg.count,
  }));
}

export default function HealthBars({ actions = [], pulse = { count: 0, cells: [] } }) {
  return (
    <>
      <ActionItemsHero items={actions} />
      <SystemPulseHero pulse={pulse} />
    </>
  );
}

function ActionItemsHero({ items }) {
  const isClear = items.length === 0;
  const state = isClear ? 'green' : (items.some((i) => i.urgency >= 3) ? 'red' : 'amber');
  const stateColor = healthHexFor(state);
  const visible = items.slice(0, VISIBLE_CAP);
  const overflow = items.length - visible.length;

  // Pick anchor for "+ N more" link: panel with most overflow items
  let overflowAnchor = '#system-health';
  if (overflow > 0) {
    const overflowCounts = {};
    for (const it of items.slice(VISIBLE_CAP)) {
      overflowCounts[it.anchor] = (overflowCounts[it.anchor] || 0) + 1;
    }
    overflowAnchor = Object.entries(overflowCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '#system-health';
  }

  const segments = actionSegments(items);

  return (
    <div className={`lim-cpv-hero lim-cpv-hero--${state}`} id="action-items">
      <div className="lim-cpv-hero-head">
        <span className="lim-cpv-hero-title">ACTION ITEMS</span>
        <span className="lim-cpv-hero-state" style={{ color: stateColor }}>
          {isClear ? 'CLEAR' : state.toUpperCase()}
        </span>
      </div>
      <div className="lim-cpv-hero-num-wrap">
        {isClear ? (
          <span
            className="lim-cpv-hero-num lim-cpv-hero-num--word"
            style={{ color: stateColor }}
          >
            ALL CLEAR
          </span>
        ) : (
          <>
            <span className="lim-cpv-hero-num" style={{ color: stateColor }}>{items.length}</span>
            <span className="lim-cpv-hero-denom">{items.length === 1 ? 'item' : 'items'}</span>
          </>
        )}
      </div>
      {segments.length > 0 && (
        <div className="lim-cpv-hero-bar">
          {segments.map((seg, i) => (
            <div key={i} className={`lim-cpv-hero-seg lim-cpv-hero-seg--${seg.state}`} style={{ flex: seg.flex }}>
              <div className="lim-cpv-hero-seg-fill" style={{ width: '100%' }} />
            </div>
          ))}
        </div>
      )}
      <div className="lim-cpv-hero-keys">
        {isClear && (
          <div className="lim-cpv-empty-row" style={{ flex: 1 }}>
            no action items right now
          </div>
        )}
        {visible.map((item) => (
          <a key={item.id} className="lim-cpv-hero-key-anchor" href={item.anchor}>
            <div className="lim-cpv-hero-key">
              <span
                className={`lim-cpv-hero-key-dot lim-cpv-hero-key-dot--${item.urgency >= 3 ? 'red' : 'amber'}`}
              />
              <span className="lim-cpv-hero-key-label">{item.headline}</span>
              <span className="lim-cpv-hero-key-val" style={{ color: 'var(--ink-2)', fontWeight: 500 }}>
                {item.detail}
              </span>
            </div>
          </a>
        ))}
        {overflow > 0 && (
          <a className="lim-cpv-hero-key-anchor" href={overflowAnchor}>
            <div className="lim-cpv-hero-key">
              <span className="lim-cpv-hero-key-label" style={{ color: 'var(--ink-3)' }}>
                + {overflow} more
              </span>
            </div>
          </a>
        )}
      </div>
    </div>
  );
}

function SystemPulseHero({ pulse }) {
  const cells = pulse.cells || [];
  const isClear = pulse.count === 0;
  const state = isClear ? 'green' : (cells.some((c) => c.state === 'red') ? 'red' : 'amber');
  const stateColor = healthHexFor(state);
  return (
    <div className={`lim-cpv-hero lim-cpv-hero--${state}`} id="system-pulse">
      <div className="lim-cpv-hero-head">
        <span className="lim-cpv-hero-title">SYSTEM PULSE</span>
        <span className="lim-cpv-hero-state" style={{ color: stateColor }}>
          {isClear ? 'GREEN' : state.toUpperCase()}
        </span>
      </div>
      <div className="lim-cpv-hero-num-wrap">
        {isClear ? (
          <span
            className="lim-cpv-hero-num lim-cpv-hero-num--word"
            style={{ color: stateColor }}
          >
            ALL GREEN
          </span>
        ) : (
          <>
            <span className="lim-cpv-hero-num" style={{ color: stateColor }}>{pulse.count}</span>
            <span className="lim-cpv-hero-denom">{pulse.count === 1 ? 'cell' : 'cells'}</span>
          </>
        )}
      </div>
      <div className="lim-cpv-hero-bar">
        {cells.map((c) => (
          <div key={c.id} className={`lim-cpv-hero-seg lim-cpv-hero-seg--${c.state}`} style={{ flex: 1 }}>
            <div className="lim-cpv-hero-seg-fill" style={{ width: '100%' }} />
          </div>
        ))}
      </div>
      <div className="lim-cpv-hero-keys">
        {cells.map((c) => (
          <a key={c.id} className="lim-cpv-hero-key-anchor" href="#system-health">
            <div className="lim-cpv-hero-key">
              <span className={`lim-cpv-hero-key-dot lim-cpv-hero-key-dot--${c.state}`} />
              <span className="lim-cpv-hero-key-label">{c.label}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
