// Direction C — Portrait + Mobile variants.
// Adds DirCPortrait (1440x2560 wall-mount studio display) and DirCMobile (430x932 iPhone)
// reusing the same data + LIM_C helpers + StylesC class names.

const D_CP = window.LIMITLESS_DATA;
const { useState: useStateCP, useMemo: useMemoCP } = React;

// ─────────── In-app toolbar ───────────
// Renders inside each viewport root (position: absolute, bottom-right) so it's
// part of the dashboard itself — not parent chrome.
// Style: minimal ■/□ checkbox row — filled square = active, empty = inactive.
function InAppToolbar({ theme, setTheme, bg, setBg, mono, setMono, alpha, setAlpha, compact }) {
  // Each control is a pair of checkable labels: [activeValue, inactiveValue]
  const Pair = ({ optA, optB, value, set }) => (
    <span className="lim-iat-pair">
      <button
        type="button"
        className="lim-iat-opt"
        aria-pressed={value === optA.value}
        onClick={() => set(optA.value)}
      >
        <span className="lim-iat-mark">{value === optA.value ? '■' : '□'}</span>
        <span className="lim-iat-text">{optA.label}</span>
      </button>
      <button
        type="button"
        className="lim-iat-opt"
        aria-pressed={value === optB.value}
        onClick={() => set(optB.value)}
      >
        <span className="lim-iat-mark">{value === optB.value ? '■' : '□'}</span>
        <span className="lim-iat-text">{optB.label}</span>
      </button>
    </span>
  );
  return (
    <div className={`lim-iat${compact ? ' lim-iat--compact' : ''}`} role="toolbar" aria-label="Display options">
      <Pair value={theme} set={setTheme}
        optA={{ value: 'light', label: 'LIGHT' }}
        optB={{ value: 'dark',  label: 'DARK' }} />
      <Pair value={mono} set={setMono}
        optA={{ value: 'on',  label: 'MONOSPACED' }}
        optB={{ value: 'off', label: 'SANS' }} />
      <Pair value={bg} set={setBg}
        optA={{ value: 'on',  label: 'GRAIN' }}
        optB={{ value: 'off', label: 'PLAIN' }} />
      {typeof alpha === 'number' && setAlpha ? (
        <span className="lim-iat-dial" title="Card transparency">
          <span className="lim-iat-text lim-iat-dial-label">OPACITY</span>
          <input
            type="range" min="0" max="100" step="1"
            value={alpha}
            onChange={(e) => setAlpha(e.target.value)}
            aria-label="Card transparency"
          />
          <span className="lim-iat-dial-num">{String(alpha).padStart(2,'0')}</span>
        </span>
      ) : null}
    </div>
  );
}

function InAppToolbarStyles() {
  return (
    <style>{`
      .lim-iat {
        position: absolute; bottom: 18px; right: 20px;
        z-index: 50;
        display: flex; align-items: center; gap: 22px;
        padding: 10px 14px;
        background: var(--bg-2);
        backdrop-filter: blur(10px) saturate(140%);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        border: 1px solid var(--rule);
        font: 11px/1 ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: var(--ink);
        pointer-events: auto;
      }
      .lim-iat-pair { display: inline-flex; align-items: center; gap: 12px; }
      .lim-iat-opt {
        appearance: none; border: 0; background: transparent; padding: 0;
        display: inline-flex; align-items: center; gap: 6px;
        font: inherit; color: var(--ink-2);
        cursor: pointer; transition: color 0.15s;
      }
      .lim-iat-opt[aria-pressed="true"] { color: var(--ink); }
      .lim-iat-opt:hover { color: var(--ink); }
      .lim-iat-mark {
        font-family: ui-monospace, "JetBrains Mono", monospace;
        font-size: 13px; line-height: 1;
        display: inline-block; width: 13px; text-align: center;
      }
      .lim-iat-text { letter-spacing: 0.14em; }

      /* Opacity dial — minimal flat slider, monospaced numeric readout */
      .lim-iat-dial { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-2); }
      .lim-iat-dial-label { color: var(--ink-2); }
      .lim-iat-dial-num   { color: var(--ink); font-variant-numeric: tabular-nums; min-width: 22px; text-align: right; }
      .lim-iat-dial input[type=range] {
        appearance: none; -webkit-appearance: none;
        width: 90px; height: 4px;
        background: color-mix(in oklab, var(--ink) 15%, transparent);
        border-radius: 0;
        outline: none; cursor: pointer; padding: 0; margin: 0;
      }
      .lim-iat-dial input[type=range]::-webkit-slider-runnable-track {
        height: 4px; background: color-mix(in oklab, var(--ink) 15%, transparent); border: 0;
      }
      .lim-iat-dial input[type=range]::-moz-range-track {
        height: 4px; background: color-mix(in oklab, var(--ink) 15%, transparent); border: 0;
      }
      .lim-iat-dial input[type=range]::-webkit-slider-thumb {
        appearance: none; -webkit-appearance: none;
        width: 10px; height: 14px; background: var(--ink);
        border: 0; border-radius: 0; margin-top: -5px; cursor: pointer;
      }
      .lim-iat-dial input[type=range]::-moz-range-thumb {
        width: 10px; height: 14px; background: var(--ink);
        border: 0; border-radius: 0; cursor: pointer;
      }

      /* Compact: shrink for phone */
      .lim-iat--compact { gap: 10px; padding: 7px 10px; bottom: 12px; right: 12px; font-size: 9px; letter-spacing: 0.08em; flex-wrap: wrap; max-width: calc(100% - 24px); }
      .lim-iat--compact .lim-iat-pair { gap: 6px; }
      .lim-iat--compact .lim-iat-opt { gap: 3px; }
      .lim-iat--compact .lim-iat-mark { font-size: 10px; width: 10px; }
      .lim-iat--compact .lim-iat-dial { gap: 5px; }
      .lim-iat--compact .lim-iat-dial input[type=range] { width: 60px; }

      /* ── Scrollbars in viewports — match dashboard chrome ── */
      .lim-cpv-scroll,
      .lim-cpv-root .lim-cpv-activity {
        scrollbar-width: thin;
        scrollbar-color: color-mix(in oklab, var(--ink) 22%, transparent) transparent;
      }
      .lim-cpv-scroll::-webkit-scrollbar,
      .lim-cpv-root .lim-cpv-activity::-webkit-scrollbar { width: 8px; height: 8px; }
      .lim-cpv-scroll::-webkit-scrollbar-track,
      .lim-cpv-root .lim-cpv-activity::-webkit-scrollbar-track { background: transparent; }
      .lim-cpv-scroll::-webkit-scrollbar-thumb,
      .lim-cpv-root .lim-cpv-activity::-webkit-scrollbar-thumb {
        background: color-mix(in oklab, var(--ink) 22%, transparent);
        border: 2px solid transparent; background-clip: padding-box;
      }
      .lim-cpv-scroll::-webkit-scrollbar-thumb:hover,
      .lim-cpv-root .lim-cpv-activity::-webkit-scrollbar-thumb:hover {
        background: color-mix(in oklab, var(--ink) 38%, transparent);
        background-clip: padding-box; border: 2px solid transparent;
      }
      .lim-cpv-scroll::-webkit-scrollbar-corner,
      .lim-cpv-root .lim-cpv-activity::-webkit-scrollbar-corner { background: transparent; }
    `}</style>
  );
}

// ─────────── Frosted-glass panels (active when grain background is on) ───────────
// All panel surfaces share these selectors. When data-glass="on" sits on the
// dashboard root, each surface gets backdrop-filter; the rgba --bg-2/--bg-3
// values are swapped in by the variant components, not here.
function DirCGlassStyles() {
  // Glass model: ONLY the outermost section panels get rgba bg + backdrop-filter.
  // Every inner card/row/cell becomes transparent and is defined by border + spacing,
  // so grain shows through every individual card without compounding opacity.
  return (
    <style>{`
      /* OUTER SECTION PANEL — frost only here */
      [data-glass="on"] .lim-cpv-root > * > section,
      [data-glass="on"] .lim-cpv-root > * > * > section,
      [data-glass="on"] .lim-cpl-root > * > section,
      [data-glass="on"] .lim-cpl-root > * > * > section,
      [data-glass="on"] .lim-cpm-root > * > section {
        background: var(--bg-2);
        backdrop-filter: blur(10px) saturate(140%);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        padding: 18px 20px 20px;
        margin-bottom: 14px;
      }
      [data-glass="on"] .lim-cpm-root > * > section { padding: 14px; margin-bottom: 12px; }

      /* INNER CARDS — strip all fills, add hairline borders for definition */
      [data-glass="on"] .lim-cpv-hero,
      [data-glass="on"] .lim-cpv-agent,
      [data-glass="on"] .lim-cpv-lane,
      [data-glass="on"] .lim-cpv-card,
      [data-glass="on"] .lim-cpv-stat,
      [data-glass="on"] .lim-cpv-empty-row,
      [data-glass="on"] .lim-cpv-qa-row,
      [data-glass="on"] .lim-cpv-editor,
      [data-glass="on"] .lim-cpv-health,
      [data-glass="on"] .lim-cpv-signals,
      [data-glass="on"] .lim-cpv-shoot,
      [data-glass="on"] .lim-cpv-int,
      [data-glass="on"] .lim-cpv-activity,
      [data-glass="on"] .lim-cpv-hero-seg,
      [data-glass="on"] .lim-cpv-editor-pip,
      [data-glass="on"] .lim-cpl-pipe-col,
      [data-glass="on"] .lim-cp-row,
      [data-glass="on"] .lim-c-card,
      [data-glass="on"] .lim-c-log,
      [data-glass="on"] .lim-c-lane,
      [data-glass="on"] .lim-c-hero,
      [data-glass="on"] .lim-c-hero-seg,
      [data-glass="on"] [data-kpi] {
        background: transparent !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }

      /* Hover/open states use subtle tint instead of solid fill */
      [data-glass="on"] .lim-cpv-agent:hover,
      [data-glass="on"] .lim-cpv-lane:hover,
      [data-glass="on"] .lim-cpv-card:hover,
      [data-glass="on"] .lim-cpv-editor:hover,
      [data-glass="on"] .lim-cpv-health:hover,
      [data-glass="on"] .lim-cpv-shoot:hover,
      [data-glass="on"] .lim-cpv-int.is-open,
      [data-glass="on"] .lim-cpl-pipe-col:hover,
      [data-glass="on"] .lim-c-lane:hover,
      [data-glass="on"] .lim-c-lane.is-open {
        background: color-mix(in oklab, var(--ink) 5%, transparent) !important;
      }

      /* Borders re-establish card edges */
      [data-glass="on"] .lim-cpv-agent,
      [data-glass="on"] .lim-cpv-lane,
      [data-glass="on"] .lim-cpv-stat,
      [data-glass="on"] .lim-cpv-qa-row,
      [data-glass="on"] .lim-cpv-editor,
      [data-glass="on"] .lim-cpv-health,
      [data-glass="on"] .lim-cpv-shoot,
      [data-glass="on"] .lim-cpv-int,
      [data-glass="on"] .lim-cpl-pipe-col,
      [data-glass="on"] .lim-c-lane {
        border: 1px solid var(--rule) !important;
      }
      [data-glass="on"] .lim-cpv-card,
      [data-glass="on"] .lim-c-card,
      [data-glass="on"] .lim-c-log {
        border: 1px solid color-mix(in oklab, var(--rule) 60%, transparent) !important;
      }

      /* Editor-pip needs to stay visible */
      [data-glass="on"] .lim-cpv-editor-pip {
        border: 1px solid var(--rule) !important;
      }
      [data-glass="on"] .lim-cpv-editor-pip.is-on {
        background: var(--ink) !important;
      }
      [data-glass="on"] .lim-cpv-editor-pip.is-over {
        background: var(--red) !important;
      }
    `}</style>
  );
}

// ---------- Studio Display 1440x2560 portrait ----------
// Scott's secondary monitor at his desk, portrait orientation, arm's length.
// Working desktop, NOT a wall TV — normal density, fully interactive.
// Vertical budget (2560 tall):
//   ~32+32 wrapper padding
//   ~80    header (clock, polling, integration pips)
//   ~280   hero pair — OPERATIONAL + SYSTEM (~96px mega numerals)
//   ~360   agents grid — 10 agent cards 5×2
//   ~870   pipeline kanban — 11 lanes, full-width, all videos visible
//   ~720   bottom 2-col — QA + editors / signals + activity
//   gaps × 4 = ~96
function DirCPortrait({ scenario, theme, accent, stuckStyle, grain, grainOn, mono, setTheme, bg, setBg, setMono, alpha, setAlpha }) {
  const data = window.LIMITLESS_SCENARIOS[scenario] || window.LIMITLESS_SCENARIOS.busy;
  const dark = theme === 'dark';
  const glass = grainOn;
  // Card transparency — alpha 0..100 (0 = invisible, 100 = solid). Default 65.
  // When grain bg is on, panels use the live alpha so the shader shows through.
  // When grain is off, panels stay solid (alpha doesn't fight a flat backdrop).
  const a = (typeof alpha === 'number') ? Math.max(0, Math.min(100, alpha)) / 100 : 0.65;
  const a2 = Math.min(1, a + 0.05);
  const cssVars = {
    '--bg':      dark ? '#0a0c0e' : '#f6f6f4',
    '--bg-2':    glass ? (dark ? `rgba(20,20,24,${a})` : `rgba(255,255,255,${a})`) : (dark ? '#13161a' : '#ececea'),
    '--bg-3':    glass ? (dark ? `rgba(28,32,38,${a2})` : `rgba(255,255,255,${a2})`) : (dark ? '#1c2026' : '#e2e2df'),
    '--ink':     dark ? '#f5f5f2' : '#0a0c0e',
    '--ink-2':   dark ? '#a8aaad' : '#54565a',
    '--ink-3':   dark ? '#62656b' : '#9a9ca0',
    '--rule':    dark ? '#262a30' : '#d8d8d4',
    '--accent':  accent,
    '--green':   dark ? '#5cd18b' : '#1c8a3c',
    '--amber':   dark ? '#f0b03a' : '#b8721a',
    '--red':     dark ? '#ff5c4a' : '#cc2a18',
  };
  const cols = useMemoCP(() => {
    const m = {};
    for (const s of D_CP.STATUS_ORDER) m[s] = [];
    for (const v of data.videos) (m[v.status] || (m[v.status] = [])).push(v);
    return m;
  }, [data]);
  const stuck = data.videos.filter((v) => v.stuck_days > 0).length;
  const failed = data.videos.filter((v) => v.qa_passed === false || v.status === 'WAITING');

  return (
    <div data-glass={glass ? 'on' : 'off'} className="lim-c lim-cpv-root" style={{ ...cssVars, background: 'var(--bg)', color: 'var(--ink)', position: 'relative', minHeight: '100%', fontFamily: mono ? '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' : '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif' }}>
      <DirCGlassStyles />
      <window.LIM.GrainBackground on={grainOn} dark={dark} paused={data.health.systemScore < 60} pixelated={mono} />
      <div style={{ position: 'relative', zIndex: 1, padding: '28px 32px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* HEADER — clock, polling, integration pips */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.22em', color: 'var(--ink-3)' }}>LIMITLESS · AUSTIN · OPS</div>
            <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1, marginTop: 6 }}>
              FRI · 09:03 <span style={{ color: 'var(--ink-3)' }}>CT</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', color: 'var(--ink-3)' }}>
              <span style={{ width: 8, height: 8, background: 'var(--green)' }} />
              POLLING · 15s
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--ink-3)', marginTop: 4 }}>
              <span style={{ color: 'var(--ink)' }}>{data.videos.length}</span> ACTIVE · <span style={{ color: stuck > 0 ? 'var(--amber)' : 'var(--ink)' }}>{stuck}</span> STUCK · <span style={{ color: failed.length > 0 ? 'var(--red)' : 'var(--ink)' }}>{failed.length}</span> QA
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
              {data.health.cells.map((c) => (
                <div key={c.id} className={`lim-c-pip lim-c-pip--${c.state}`} title={`${c.label}: ${c.detail}`}>{c.label.split(' ')[0].slice(0, 4).toUpperCase()}</div>
              ))}
            </div>
          </div>
        </div>

        {/* HERO PAIR — OPERATIONAL + SYSTEM */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <PortraitHero title="OPERATIONAL" score={data.opScore} breakdown={data.op} />
          <PortraitHero title="SYSTEM" score={data.sysScore} breakdown={data.health.systemBreakdown} />
        </div>

        {/* AGENTS + UPCOMING SHOOTS — 2 col */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <PortraitAgents data={data} />
          <PortraitShoots data={data} />
        </div>

        {/* PIPELINE KANBAN — 11 lanes, full width */}
        <PortraitKanban cols={cols} stuckStyle={stuckStyle} videoCount={data.videos.length} stuck={stuck} />

        {/* BOTTOM 2-COL — left: QA + Editors; right: Signals + Activity */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PortraitQA data={data} />
            <PortraitEditors data={data} />
            <PortraitHealth data={data} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PortraitSignals data={data} />
            <PortraitActivity data={data} />
            <PortraitIntegrations data={data} />
          </div>
        </div>
      </div>
      <InAppToolbar theme={theme} setTheme={setTheme} bg={bg} setBg={setBg} mono={mono ? "on" : "off"} setMono={setMono} alpha={alpha} setAlpha={setAlpha} />
      <InAppToolbarStyles />
      <window.StylesCP />
      <window.StylesCPV />
      <window.StylesC />
    </div>
  );
}

// Compact hero — laptop density, mega numerals at 96px (not 360px)
function PortraitHero({ title, score, breakdown }) {
  const state = window.LIM.healthState(score);
  const stateColor = `var(--${state})`;
  return (
    <div className={`lim-cpv-hero lim-cpv-hero--${state}`}>
      <div className="lim-cpv-hero-head">
        <span className="lim-cpv-hero-title">{title}</span>
        <span className="lim-cpv-hero-state" style={{ color: stateColor }}>{state.toUpperCase()}</span>
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
          <div key={i} className="lim-cpv-hero-key">
            <span className={`lim-cpv-hero-key-dot lim-cpv-hero-key-dot--${b.state}`} />
            <span className="lim-cpv-hero-key-label">{b.label}</span>
            <span className="lim-cpv-hero-key-val">{b.score}<span style={{ color: 'var(--ink-3)' }}>/{b.max}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// AGENTS — 7 cards. Each: name, status, last action, sparkline of recent runs.
// The 7 AI agents Caiden built. Infrastructure (webhook/scheduler/server) is in System Health.
function PortraitAgents({ data }) {
  const agentNames = ['pipeline', 'qa', 'research', 'performance', 'scripting', 'onboarding', 'fireflies'];
  const stats = {};
  for (const name of agentNames) stats[name] = { runs: 0, errors: 0, warnings: 0, last: null, lastErr: null };
  for (const l of data.logs) {
    const s = stats[l.agent_name];
    if (!s) continue;
    s.runs++;
    if (l.status === 'error') { s.errors++; if (!s.lastErr) s.lastErr = l; }
    if (l.status === 'warning') s.warnings++;
    if (!s.last || new Date(l.created_at) > new Date(s.last.created_at)) s.last = l;
  }

  return (
    <section>
      <PortraitSectionTitle right={`${agentNames.length} AGENTS · 24h`}>AGENTS</PortraitSectionTitle>
      <div className="lim-cpv-agents">
        {agentNames.map((name) => {
          const s = stats[name];
          const state = s.errors > 0 ? 'red' : s.warnings > 0 ? 'amber' : 'green';
          return (
            <button key={name} type="button" className={`lim-cpv-agent lim-cpv-agent--${state}`}>
              <div className="lim-cpv-agent-head">
                <span className={`lim-cpv-agent-dot lim-cpv-agent-dot--${state}`} />
                <span className="lim-cpv-agent-name">{name}</span>
                <span className="lim-cpv-agent-runs">{s.runs}</span>
              </div>
              <AgentSpark name={name} state={state} logs={data.logs} />
              <div className="lim-cpv-agent-foot">
                {s.lastErr ? (
                  <>
                    <span className="lim-cpv-agent-err">{s.lastErr.error_message?.slice(0, 48) || 'error'}</span>
                    <span className="lim-cpv-agent-time">{window.LIM.timeAgo(s.lastErr.created_at, D_CP.NOW)}</span>
                  </>
                ) : s.last ? (
                  <>
                    <span className="lim-cpv-agent-action">{s.last.action.slice(0, 56)}</span>
                    <span className="lim-cpv-agent-time">{window.LIM.timeAgo(s.last.created_at, D_CP.NOW)}</span>
                  </>
                ) : (
                  <span className="lim-cpv-agent-action" style={{ color: 'var(--ink-3)' }}>idle</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AgentSpark({ name, state, logs }) {
  // Synthetic 24-bin spark: count this agent's logs per "bin" + add visual filler so it reads.
  const own = logs.filter((l) => l.agent_name === name);
  const bins = new Array(24).fill(0);
  for (let i = 0; i < own.length; i++) bins[(i * 3) % 24] += own[i].status === 'error' ? 3 : 2;
  // Add baseline shape
  for (let i = 0; i < 24; i++) bins[i] = Math.max(bins[i], 1 + ((name.charCodeAt(0) + i) % 4));
  const max = Math.max(...bins);
  const color = state === 'red' ? 'var(--red)' : state === 'amber' ? 'var(--amber)' : 'var(--ink-2)';
  return (
    <div className="lim-cpv-spark">
      {bins.map((v, i) => (
        <div key={i} className="lim-cpv-spark-bar" style={{ height: `${(v / max) * 100}%`, background: color, opacity: 0.55 + (v / max) * 0.45 }} />
      ))}
    </div>
  );
}

// PIPELINE KANBAN — 11 lanes, full width 1376px, all videos visible inside lane
function PortraitKanban({ cols, stuckStyle, videoCount, stuck }) {
  return (
    <section>
      <PortraitSectionTitle right={`${videoCount} ACTIVE · ${stuck} STUCK · CLICK TO DRILL`}>PIPELINE</PortraitSectionTitle>
      <div className="lim-cpv-kanban">
        {D_CP.STATUS_ORDER.map((s, idx) => {
          const list = cols[s] || [];
          const stuckN = list.filter((v) => v.stuck_days > 0).length;
          const failN = list.filter((v) => v.qa_passed === false).length;
          return (
            <div key={s} className={`lim-cpv-lane ${stuckN > 0 ? 'has-stuck' : ''} ${failN > 0 ? 'has-fail' : ''}`}>
              <div className="lim-cpv-lane-head">
                <div className="lim-cpv-lane-count">{list.length}</div>
                <div className="lim-cpv-lane-name">{s.toLowerCase()}</div>
                <div className="lim-cpv-lane-idx">{String(idx + 1).padStart(2, '0')} / 11</div>
              </div>
              <div className="lim-cpv-lane-cards">
                {list.map((v) => (
                  <div key={v.id} className={`lim-cpv-card ${v.qa_passed === false ? 'is-fail' : ''} ${v.stuck_days ? 'is-stuck' : ''}`} title={v.title}>
                    <div className="lim-cpv-card-title">{v.title}</div>
                    <div className="lim-cpv-card-meta">
                      <span>{(D_CP.EDITORS.find((e) => e.id === v.assignee_id)?.name || v.student_name || '—').split(' ')[0]}</span>
                      {v.stuck_days > 0 && <window.LIM.StuckMark days={v.stuck_days} style={stuckStyle} />}
                    </div>
                  </div>
                ))}
                {list.length === 0 && <div className="lim-cpv-lane-empty">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// QA queue — desktop density, list of failed/waiting cards
function PortraitQA({ data }) {
  const awaiting = data.videos.filter((v) => v.status === 'EDITED' && v.qa_passed === null);
  const failed = data.videos.filter((v) => v.qa_passed === false || v.status === 'WAITING');
  const lastQAErr = data.logs.find((l) => l.agent_name === 'qa' && l.status === 'error');
  return (
    <section>
      <PortraitSectionTitle right={`${awaiting.length} AWAITING · ${failed.length} FAILED`}>QA QUEUE</PortraitSectionTitle>
      <div className="lim-cpv-qa-grid">
        <div className="lim-cpv-stat">
          <div className="lim-cpv-stat-num">{awaiting.length}</div>
          <div className="lim-cpv-stat-label">AWAITING</div>
        </div>
        <div className={`lim-cpv-stat ${failed.length > 0 ? 'is-bad' : ''}`}>
          <div className="lim-cpv-stat-num">{failed.length}</div>
          <div className="lim-cpv-stat-label">FAILED / WAITING</div>
        </div>
      </div>
      <div className="lim-cpv-qa-list">
        {failed.length === 0 && <div className="lim-cpv-empty-row">— no failures —</div>}
        {failed.map((v) => {
          const editor = D_CP.EDITORS.find((e) => e.id === v.assignee_id);
          return (
            <button key={v.id} type="button" className="lim-cpv-qa-row">
              <div className="lim-cpv-qa-row-title">{v.title}</div>
              {lastQAErr && v.qa_passed === false && (
                <div className="lim-cpv-qa-row-err">↳ {lastQAErr.error_message}</div>
              )}
              <div className="lim-cpv-qa-row-meta">
                <span className="lim-cpv-qa-row-editor">{editor?.name || 'unassigned'}</span>
                <span className="lim-cpv-qa-row-time">{window.LIM.timeAgo(v.updated_at, D_CP.NOW)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Editor capacity — 4 editors, /5 capacity
function PortraitEditors({ data }) {
  const counts = {};
  for (const v of data.videos) if (v.status === 'IN EDITING' && v.assignee_id) counts[v.assignee_id] = (counts[v.assignee_id] || 0) + 1;
  return (
    <section>
      <PortraitSectionTitle>EDITOR CAPACITY</PortraitSectionTitle>
      <div className="lim-cpv-editors">
        {D_CP.EDITORS.map((ed) => {
          const n = counts[ed.id] || 0;
          const over = n >= 5;
          return (
            <button key={ed.id} type="button" className={`lim-cpv-editor ${over ? 'is-over' : ''}`}>
              <div className="lim-cpv-editor-name">{ed.name}</div>
              <div className="lim-cpv-editor-row">
                <span className="lim-cpv-editor-num">{n}</span>
                <span className="lim-cpv-editor-denom">/5</span>
                <div className="lim-cpv-editor-pips">
                  {[0,1,2,3,4].map((i) => (
                    <span key={i} className={`lim-cpv-editor-pip ${i < n ? 'is-on' : ''} ${over && i < n ? 'is-over' : ''}`} />
                  ))}
                </div>
              </div>
              <div className="lim-cpv-editor-state">{over ? 'OVERLOADED' : `${5 - n} HEADROOM`}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Integration / system health rows
function PortraitHealth({ data }) {
  const breakdownMap = {};
  for (const b of data.health.systemBreakdown) breakdownMap[b.label.toLowerCase()] = b;
  return (
    <section>
      <PortraitSectionTitle right="5 SUBSYSTEMS">SYSTEM HEALTH</PortraitSectionTitle>
      <div className="lim-cpv-health-list">
        {data.health.cells.map((c) => {
          const b = breakdownMap[c.label.toLowerCase()];
          return (
            <button key={c.id} type="button" className={`lim-cpv-health lim-cpv-health--${c.state}`}>
              <span className={`lim-cpv-health-dot lim-cpv-health-dot--${c.state}`} />
              <div className="lim-cpv-health-body">
                <div className="lim-cpv-health-row1">
                  <span className="lim-cpv-health-label">{c.label}</span>
                  {b && (
                    <span className="lim-cpv-health-val" style={{ color: c.state === 'red' ? 'var(--red)' : c.state === 'amber' ? 'var(--amber)' : 'var(--ink)' }}>
                      {b.score}<span style={{ color: 'var(--ink-3)', fontWeight: 600 }}>/{b.max}</span>
                    </span>
                  )}
                </div>
                <div className="lim-cpv-health-detail">{c.detail}</div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Performance signals (compact)
function PortraitSignals({ data }) {
  const sig = D_CP.PERF_SIGNAL;
  return (
    <section>
      <PortraitSectionTitle right={`WK ${sig.week_of}`}>SIGNALS</PortraitSectionTitle>
      <div className="lim-cpv-signals">
        <div className="lim-cpv-signal-hero">
          <div className="lim-cpv-signal-num">{(sig.top_hooks[0].avg_views / 1000).toFixed(0)}K</div>
          <div className="lim-cpv-signal-label">TOP HOOK · {sig.top_hooks[0].type}</div>
        </div>
        <p className="lim-cpv-signal-summary">{sig.summary}</p>
        <div className="lim-cpv-signal-section">
          <div className="lim-cpv-signal-section-head" style={{ color: 'var(--green)' }}>+ DO MORE OF</div>
          {sig.raw_output.recommendations.slice(0, 2).map((r, i) => (
            <div key={i} className="lim-cpv-signal-line">{r}</div>
          ))}
        </div>
        <div className="lim-cpv-signal-section">
          <div className="lim-cpv-signal-section-head" style={{ color: 'var(--red)' }}>− AVOID</div>
          {sig.raw_output.underperforming_patterns.slice(0, 1).map((p, i) => (
            <div key={i} className="lim-cpv-signal-line">{p}</div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Activity feed — full live log
function PortraitActivity({ data }) {
  const [paused, setPaused] = useStateCP(false);
  return (
    <section>
      <PortraitSectionTitle right={paused ? 'PAUSED' : 'LIVE · 10s'}>ACTIVITY</PortraitSectionTitle>
      <div
        className="lim-cpv-activity"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {data.logs.slice(0, 18).map((l) => (
          <div key={l.id} className={`lim-c-log lim-c-log--${l.status}`}>
            <span className="lim-c-log-time">{new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span className={`lim-c-log-agent lim-c-log-agent--${l.status}`}>{window.LIM.AGENT_LABEL[l.agent_name] || l.agent_name}</span>
            <span className="lim-c-log-msg">
              {l.action}
              {l.error_message && <span style={{ display: 'block', fontSize: 11, color: 'var(--red)', fontWeight: 600, marginTop: 2 }}>↳ {l.error_message}</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// UPCOMING SHOOTS — Scripting agent watches Google Calendar every 15min, generates 3 concept scripts per filming event.
// Surfaces the work product. Lives next to the agent grid since the Scripting agent owns this data.
const SHOOT_SCHEDULE = [
  { id: 'sh-1', when: 'in 4h',         iso: 'Fri 1:00 PM',  student: 'Mason R.',  location: 'Studio A',           scripts: 'pending',     pendingHours: 4 },
  { id: 'sh-2', when: 'tomorrow 9am',  iso: 'Sat 9:00 AM',  student: 'Erika P.',  location: 'Domain rooftop',     scripts: 'ready',       count: 3 },
  { id: 'sh-3', when: 'tomorrow 2pm',  iso: 'Sat 2:00 PM',  student: 'Trent K.',  location: 'South Congress',     scripts: 'generating' },
  { id: 'sh-4', when: 'Mon 10am',      iso: 'Mon 10:00 AM', student: 'Devon S.',  location: 'Studio B',           scripts: 'ready',       count: 3 },
  { id: 'sh-5', when: 'Mon 3pm',       iso: 'Mon 3:00 PM',  student: 'Hailey W.', location: null,                 scripts: 'manual' },
  { id: 'sh-6', when: 'Tue 11am',      iso: 'Tue 11:00 AM', student: 'Marco V.',  location: 'Whole Foods Domain', scripts: 'ready',       count: 3 },
  { id: 'sh-7', when: 'Wed 9am',       iso: 'Wed 9:00 AM',  student: 'Ava L.',    location: 'Studio A',           scripts: 'ready',       count: 3 },
];

function PortraitShoots({ data }) {
  const shoots = SHOOT_SCHEDULE;
  const ready = shoots.filter((s) => s.scripts === 'ready').length;
  const blocked = shoots.filter((s) => s.scripts === 'pending' || s.scripts === 'manual').length;
  return (
    <section>
      <PortraitSectionTitle right={`${shoots.length} IN 7d · ${ready} READY · ${blocked} BLOCKED`}>UPCOMING SHOOTS</PortraitSectionTitle>
      <div className="lim-cpv-shoots">
        {shoots.length === 0 && <div className="lim-cpv-empty-row">No shoots scheduled in next 7 days.</div>}
        {shoots.map((s) => {
          const tone = s.scripts === 'ready' ? 'green' : s.scripts === 'generating' ? 'blue' : s.scripts === 'pending' ? 'red' : 'gray';
          const statusText =
            s.scripts === 'ready'      ? `Scripts ready (${s.count})` :
            s.scripts === 'generating' ? 'Generating…' :
            s.scripts === 'pending'    ? `Pending — shoot in ${s.pendingHours}h, no scripts` :
                                         'No scripts (manual)';
          return (
            <button key={s.id} type="button" className={`lim-cpv-shoot lim-cpv-shoot--${tone}`}>
              <div className="lim-cpv-shoot-when">
                <span className="lim-cpv-shoot-rel">{s.when}</span>
                <span className="lim-cpv-shoot-iso">{s.iso}</span>
              </div>
              <div className="lim-cpv-shoot-body">
                <div className="lim-cpv-shoot-name">{s.student}</div>
                <div className="lim-cpv-shoot-loc">{s.location || '—'}</div>
              </div>
              <div className={`lim-cpv-shoot-status lim-cpv-shoot-status--${tone}`}>
                <span className={`lim-cpv-shoot-dot lim-cpv-shoot-dot--${tone}`} />
                {statusText}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// INTEGRATIONS — 7 external systems the agents depend on. Click expands to last 5 events.
const EXT_INTEGRATIONS = [
  { id: 'clickup',   name: 'ClickUp',          status: 'connected',    last: '22m ago', events: ['task moved → IN EDITING (22m)', 'task created — Hook test 04 (1h)', 'task moved → READY FOR EDITING (1h)', 'webhook event received (1h)', 'task updated — assignee Tipra (2h)'] },
  { id: 'dropbox',   name: 'Dropbox',          status: 'connected',    last: '8m ago',  events: ['file uploaded — final-04.mp4 (8m)', 'folder synced — /Hailey W. (38m)', 'file uploaded — VO_take3.wav (1h)', 'file uploaded — final-03.mp4 (2h)', 'folder created — /Marco V. (3h)'] },
  { id: 'frameio',   name: 'Frame.io',         status: 'connected',    last: '14m ago', events: ['comment posted — "fix audio drift @2:00" (14m)', 'review approved — final-02 (1h)', 'asset uploaded — final-04.mp4 (1h)', 'comment posted — Scott (2h)', 'review requested — Charles (3h)'] },
  { id: 'fireflies', name: 'Fireflies',        status: 'connected',    last: '47m ago', events: ['transcript posted — strategy call (47m)', 'meeting summarized (47m)', 'meeting recorded — 32m (1h)', 'transcript posted — 1:1 Tipra (3h)', 'meeting recorded (3h)'] },
  { id: 'gcal',      name: 'Google Calendar',  status: 'connected',    last: '6m ago',  events: ['polled — 7 events found (6m)', 'event detected — Mason R. shoot (6m)', 'polled (21m)', 'polled (36m)', 'polled (51m)'] },
  { id: 'supabase',  name: 'Supabase',         status: 'connected',    last: '3s ago',  events: ['agent_logs INSERT (3s)', 'videos UPDATE (12s)', 'agent_logs INSERT (28s)', 'videos UPDATE (44s)', 'agent_logs INSERT (1m)'] },
  { id: 'anthropic', name: 'Anthropic',        status: 'connected',    last: '2m ago',  events: ['claude-sonnet-4 · 1.4k tok (2m)', 'claude-sonnet-4 · 2.1k tok (5m)', 'claude-haiku · 0.6k tok (8m)', 'claude-sonnet-4 · 3.2k tok (12m)', 'claude-haiku · 0.4k tok (18m)'] },
];

function PortraitIntegrations({ data }) {
  const [open, setOpen] = useStateCP(null);
  const connected = EXT_INTEGRATIONS.filter((i) => i.status === 'connected').length;
  return (
    <section>
      <PortraitSectionTitle right={`${connected}/${EXT_INTEGRATIONS.length} CONNECTED`}>INTEGRATIONS</PortraitSectionTitle>
      <div className="lim-cpv-int-list">
        {EXT_INTEGRATIONS.map((it) => {
          const isOpen = open === it.id;
          const tone = it.status === 'connected' ? 'green' : 'red';
          return (
            <div key={it.id} className={`lim-cpv-int ${isOpen ? 'is-open' : ''}`}>
              <button type="button" className="lim-cpv-int-head" onClick={() => setOpen(isOpen ? null : it.id)}>
                <span className={`lim-cpv-int-dot lim-cpv-int-dot--${tone}`} />
                <span className="lim-cpv-int-name">{it.name}</span>
                <span className={`lim-cpv-int-status lim-cpv-int-status--${tone}`}>{it.status}</span>
                <span className="lim-cpv-int-sep">·</span>
                <span className="lim-cpv-int-last">last event {it.last}</span>
                <span className="lim-cpv-int-chev">{isOpen ? '–' : '+'}</span>
              </button>
              {isOpen && (
                <div className="lim-cpv-int-events">
                  {it.events.map((e, i) => (
                    <div key={i} className="lim-cpv-int-event">{e}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PortraitSectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>{children}</h3>
      {right && <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--ink-3)' }}>{right}</span>}
    </div>
  );
}

function StylesCPV() {
  return (
    <style>{`
      .lim-cpv-root { font-size: 13px; }

      /* ── HERO ── compact desktop density */
      .lim-cpv-hero {
        background: var(--bg-2);
        border-left: 6px solid var(--rule);
        padding: 16px 20px 18px;
        display: flex; flex-direction: column;
      }
      .lim-cpv-hero--green { border-left-color: var(--green); }
      .lim-cpv-hero--amber { border-left-color: var(--amber); background: color-mix(in oklab, var(--amber) 6%, var(--bg-2)); }
      .lim-cpv-hero--red   { border-left-color: var(--red); background: color-mix(in oklab, var(--red) 8%, var(--bg-2)); }
      .lim-cpv-hero-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
      .lim-cpv-hero-title { font-size: 12px; font-weight: 800; letter-spacing: 0.2em; }
      .lim-cpv-hero-state { font-size: 11px; font-weight: 800; letter-spacing: 0.18em; }
      .lim-cpv-hero-num-wrap { display: flex; align-items: baseline; gap: 12px; padding: 6px 0 8px; }
      .lim-cpv-hero-num { font-size: 96px; font-weight: 800; line-height: 0.9; letter-spacing: -0.05em; font-feature-settings: "tnum" 1; }
      .lim-cpv-hero-denom { font-size: 22px; font-weight: 600; color: var(--ink-3); }
      .lim-cpv-hero-bar { display: flex; gap: 2px; height: 10px; margin-top: 4px; }
      .lim-cpv-hero-seg { background: var(--bg-3); position: relative; }
      .lim-cpv-hero-seg-fill { height: 100%; }
      .lim-cpv-hero-seg--green .lim-cpv-hero-seg-fill { background: var(--green); }
      .lim-cpv-hero-seg--amber .lim-cpv-hero-seg-fill { background: var(--amber); }
      .lim-cpv-hero-seg--red   .lim-cpv-hero-seg-fill { background: var(--red); }
      .lim-cpv-hero-keys { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 10px; }
      .lim-cpv-hero-key { display: flex; align-items: center; gap: 6px; font-size: 11px; }
      .lim-cpv-hero-key-dot { width: 8px; height: 8px; }
      .lim-cpv-hero-key-dot--green { background: var(--green); }
      .lim-cpv-hero-key-dot--amber { background: var(--amber); }
      .lim-cpv-hero-key-dot--red   { background: var(--red); }
      .lim-cpv-hero-key-label { color: var(--ink-2); font-weight: 600; }
      .lim-cpv-hero-key-val { color: var(--ink); font-weight: 800; }

      /* ── AGENTS GRID ── 2 cols × 4 rows, last card spans both cols */
      .lim-cpv-agents { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
      .lim-cpv-agents > .lim-cpv-agent:nth-child(7) { grid-column: span 2; }
      .lim-cpv-agent {
        background: var(--bg-2); border: none;
        padding: 10px 12px 10px;
        display: flex; flex-direction: column; gap: 6px;
        cursor: pointer; text-align: left;
        font-family: inherit; color: var(--ink);
        transition: background 0.15s;
        min-height: 110px;
      }
      .lim-cpv-agent:hover { background: var(--bg-3); }
      .lim-cpv-agent--red   { box-shadow: inset 3px 0 0 var(--red); background: color-mix(in oklab, var(--red) 8%, var(--bg-2)); }
      .lim-cpv-agent--amber { box-shadow: inset 3px 0 0 var(--amber); }
      .lim-cpv-agent--green { box-shadow: inset 3px 0 0 var(--green); }
      .lim-cpv-agent-head { display: flex; align-items: center; gap: 8px; }
      .lim-cpv-agent-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .lim-cpv-agent-dot--green { background: var(--green); }
      .lim-cpv-agent-dot--amber { background: var(--amber); }
      .lim-cpv-agent-dot--red   { background: var(--red); animation: lim-cpv-blink 1.6s infinite; }
      @keyframes lim-cpv-blink { 50% { opacity: 0.5; } }
      .lim-cpv-agent-name { font-size: 14px; font-weight: 700; letter-spacing: 0.02em; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .lim-cpv-agent-runs { font-size: 12px; font-weight: 700; color: var(--ink-3); font-feature-settings: "tnum" 1; }
      .lim-cpv-spark {
        display: flex; align-items: flex-end; gap: 1px;
        height: 28px;
      }
      .lim-cpv-spark-bar { flex: 1; min-height: 1px; }
      .lim-cpv-agent-foot {
        display: flex; flex-direction: column; gap: 2px;
        font-size: 11px; line-height: 1.35;
      }
      .lim-cpv-agent-action { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lim-cpv-agent-err { color: var(--red); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lim-cpv-agent-time { color: var(--ink-3); font-size: 10px; letter-spacing: 0.04em; }

      /* ── PIPELINE KANBAN ── 11 lanes full width */
      .lim-cpv-kanban {
        display: grid;
        grid-template-columns: repeat(11, minmax(0, 1fr));
        gap: 4px;
      }
      .lim-cpv-lane {
        background: var(--bg-2);
        cursor: pointer;
        transition: background 0.15s;
        min-height: 660px;
        display: flex; flex-direction: column;
      }
      .lim-cpv-lane:hover { background: var(--bg-3); }
      .lim-cpv-lane.has-stuck { box-shadow: inset 0 -3px 0 var(--amber); }
      .lim-cpv-lane.has-fail  { box-shadow: inset 0 -3px 0 var(--red); }
      .lim-cpv-lane-head {
        padding: 10px 10px 8px;
        border-bottom: 1px solid var(--rule);
      }
      .lim-cpv-lane-count { font-size: 28px; font-weight: 800; line-height: 0.9; letter-spacing: -0.04em; font-feature-settings: "tnum" 1; }
      .lim-cpv-lane.has-stuck .lim-cpv-lane-count { color: var(--amber); }
      .lim-cpv-lane.has-fail  .lim-cpv-lane-count { color: var(--red); }
      .lim-cpv-lane-name {
        font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
        text-transform: uppercase; color: var(--ink-2);
        margin-top: 4px; line-height: 1.2;
        word-break: break-word;
      }
      .lim-cpv-lane-idx { font-size: 9px; letter-spacing: 0.12em; color: var(--ink-3); margin-top: 4px; }
      .lim-cpv-lane-cards {
        padding: 6px;
        display: flex; flex-direction: column; gap: 4px;
        flex: 1;
      }
      .lim-cpv-lane-empty { color: var(--ink-3); font-size: 11px; padding: 4px 0; }
      .lim-cpv-card {
        background: var(--bg-3); padding: 6px 8px;
        display: flex; flex-direction: column; gap: 3px;
        cursor: pointer; transition: background 0.15s;
      }
      .lim-cpv-card:hover { background: color-mix(in oklab, var(--accent) 10%, var(--bg-3)); }
      .lim-cpv-card.is-fail  { box-shadow: inset 3px 0 0 var(--red); background: color-mix(in oklab, var(--red) 10%, var(--bg-3)); }
      .lim-cpv-card.is-stuck { box-shadow: inset 3px 0 0 var(--amber); }
      .lim-cpv-card.is-fail.is-stuck { box-shadow: inset 3px 0 0 var(--red); }
      .lim-cpv-card-title {
        font-size: 11px; font-weight: 600; line-height: 1.3;
        overflow: hidden; text-overflow: ellipsis;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      }
      .lim-cpv-card-meta {
        display: flex; align-items: center; gap: 6px;
        font-size: 10px; color: var(--ink-3);
      }

      /* ── QA STATS + LIST ── */
      .lim-cpv-qa-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
      .lim-cpv-stat {
        background: var(--bg-2); padding: 12px 14px;
      }
      .lim-cpv-stat.is-bad { background: color-mix(in oklab, var(--red) 12%, var(--bg-2)); border-left: 4px solid var(--red); }
      .lim-cpv-stat-num { font-size: 36px; font-weight: 800; line-height: 1; letter-spacing: -0.03em; font-feature-settings: "tnum" 1; }
      .lim-cpv-stat.is-bad .lim-cpv-stat-num { color: var(--red); }
      .lim-cpv-stat-label { font-size: 10px; font-weight: 800; letter-spacing: 0.14em; color: var(--ink-3); margin-top: 4px; }
      .lim-cpv-stat.is-bad .lim-cpv-stat-label { color: var(--red); }
      .lim-cpv-qa-list { display: flex; flex-direction: column; gap: 4px; }
      .lim-cpv-empty-row { background: var(--bg-2); padding: 12px; color: var(--ink-3); font-size: 12px; }
      .lim-cpv-qa-row {
        background: var(--bg-2); border: none;
        border-left: 3px solid var(--red);
        padding: 8px 12px;
        display: flex; flex-direction: column; gap: 2px;
        cursor: pointer; transition: background 0.15s;
        font-family: inherit; color: var(--ink);
        text-align: left;
      }
      .lim-cpv-qa-row:hover { background: color-mix(in oklab, var(--red) 12%, var(--bg-2)); }
      .lim-cpv-qa-row-title { font-size: 13px; font-weight: 600; line-height: 1.3; }
      .lim-cpv-qa-row-err { font-size: 11px; color: var(--red); font-weight: 600; }
      .lim-cpv-qa-row-meta { display: flex; align-items: baseline; gap: 12px; font-size: 11px; }
      .lim-cpv-qa-row-editor { font-weight: 700; color: var(--ink-2); }
      .lim-cpv-qa-row-time { color: var(--ink-3); margin-left: auto; }

      /* ── EDITORS ── */
      .lim-cpv-editors { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .lim-cpv-editor {
        background: var(--bg-2); border: none;
        padding: 10px 14px;
        display: flex; flex-direction: column; gap: 4px;
        cursor: pointer; text-align: left;
        font-family: inherit; color: var(--ink);
        transition: background 0.15s;
      }
      .lim-cpv-editor:hover { background: var(--bg-3); }
      .lim-cpv-editor.is-over { background: color-mix(in oklab, var(--red) 12%, var(--bg-2)); border-left: 3px solid var(--red); padding-left: 11px; }
      .lim-cpv-editor-name { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-2); }
      .lim-cpv-editor-row { display: flex; align-items: center; gap: 8px; }
      .lim-cpv-editor-num { font-size: 32px; font-weight: 800; line-height: 1; letter-spacing: -0.04em; font-feature-settings: "tnum" 1; }
      .lim-cpv-editor.is-over .lim-cpv-editor-num { color: var(--red); }
      .lim-cpv-editor-denom { font-size: 14px; font-weight: 600; color: var(--ink-3); }
      .lim-cpv-editor-pips { display: flex; gap: 3px; margin-left: auto; }
      .lim-cpv-editor-pip { width: 10px; height: 16px; background: var(--bg-3); }
      .lim-cpv-editor-pip.is-on { background: var(--ink); }
      .lim-cpv-editor-pip.is-over { background: var(--red); }
      .lim-cpv-editor-state { font-size: 10px; font-weight: 800; letter-spacing: 0.12em; color: var(--ink-3); }
      .lim-cpv-editor.is-over .lim-cpv-editor-state { color: var(--red); }

      /* ── INTEGRATION HEALTH ── */
      .lim-cpv-health-list { display: flex; flex-direction: column; gap: 4px; }
      .lim-cpv-health {
        display: grid;
        grid-template-columns: 12px 1fr;
        gap: 12px;
        align-items: start;
        background: var(--bg-2);
        border: none;
        padding: 10px 14px;
        cursor: pointer; transition: background 0.15s;
        font-family: inherit; color: var(--ink);
        text-align: left;
      }
      .lim-cpv-health:hover { background: var(--bg-3); }
      .lim-cpv-health--amber { background: color-mix(in oklab, var(--amber) 8%, var(--bg-2)); }
      .lim-cpv-health--red   { background: color-mix(in oklab, var(--red) 12%, var(--bg-2)); border-left: 3px solid var(--red); padding-left: 11px; }
      .lim-cpv-health-dot { width: 10px; height: 10px; margin-top: 5px; }
      .lim-cpv-health-dot--green { background: var(--green); }
      .lim-cpv-health-dot--amber { background: var(--amber); }
      .lim-cpv-health-dot--red   { background: var(--red); }
      .lim-cpv-health-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .lim-cpv-health-row1 { display: flex; align-items: baseline; gap: 12px; }
      .lim-cpv-health-label { font-size: 13px; font-weight: 700; flex: 1; }
      .lim-cpv-health-val { font-size: 18px; font-weight: 800; font-feature-settings: "tnum" 1; }
      .lim-cpv-health-detail { font-size: 11px; color: var(--ink-2); line-height: 1.4; }

      /* ── SIGNALS ── */
      .lim-cpv-signals { background: var(--bg-2); padding: 14px 16px; }
      .lim-cpv-signal-hero { padding-bottom: 10px; border-bottom: 1px solid var(--rule); }
      .lim-cpv-signal-num { font-size: 36px; font-weight: 800; line-height: 1; letter-spacing: -0.03em; font-feature-settings: "tnum" 1; }
      .lim-cpv-signal-label { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); margin-top: 4px; }
      .lim-cpv-signal-summary { font-size: 12px; line-height: 1.55; color: var(--ink-2); margin: 10px 0 0; }
      .lim-cpv-signal-section { margin-top: 10px; }
      .lim-cpv-signal-section-head { font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 4px; }
      .lim-cpv-signal-line { font-size: 12px; color: var(--ink); padding: 2px 0; line-height: 1.45; }

      /* ── UPCOMING SHOOTS ── */
      .lim-cpv-shoots { display: flex; flex-direction: column; gap: 4px; }
      .lim-cpv-shoot {
        display: grid; grid-template-columns: 110px 1fr auto; gap: 14px; align-items: center;
        background: var(--bg-2); border: none;
        padding: 10px 14px;
        cursor: pointer; transition: background 0.15s;
        font-family: inherit; color: var(--ink); text-align: left;
      }
      .lim-cpv-shoot:hover { background: var(--bg-3); }
      .lim-cpv-shoot--red   { border-left: 3px solid var(--red); padding-left: 11px; background: color-mix(in oklab, var(--red) 10%, var(--bg-2)); }
      .lim-cpv-shoot--blue  { border-left: 3px solid var(--accent); padding-left: 11px; }
      .lim-cpv-shoot--gray  { opacity: 0.78; }
      .lim-cpv-shoot-when { display: flex; flex-direction: column; gap: 1px; }
      .lim-cpv-shoot-rel { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; }
      .lim-cpv-shoot-iso { font-size: 10px; color: var(--ink-3); letter-spacing: 0.04em; }
      .lim-cpv-shoot-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .lim-cpv-shoot-name { font-size: 13px; font-weight: 700; }
      .lim-cpv-shoot-loc { font-size: 11px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lim-cpv-shoot-status { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; }
      .lim-cpv-shoot-status--green { color: var(--green); }
      .lim-cpv-shoot-status--blue  { color: var(--accent); }
      .lim-cpv-shoot-status--red   { color: var(--red); }
      .lim-cpv-shoot-status--gray  { color: var(--ink-3); }
      .lim-cpv-shoot-dot { width: 8px; height: 8px; }
      .lim-cpv-shoot-dot--green { background: var(--green); }
      .lim-cpv-shoot-dot--blue  { background: var(--accent); animation: lim-cpv-blink 1.6s infinite; }
      .lim-cpv-shoot-dot--red   { background: var(--red); animation: lim-cpv-blink 1.6s infinite; }
      .lim-cpv-shoot-dot--gray  { background: var(--ink-3); }

      /* ── INTEGRATIONS ── 7 external systems, click to expand */
      .lim-cpv-int-list { display: flex; flex-direction: column; gap: 3px; }
      .lim-cpv-int { background: var(--bg-2); }
      .lim-cpv-int.is-open { background: var(--bg-3); }
      .lim-cpv-int-head {
        width: 100%; border: none; background: transparent;
        display: flex; align-items: center; gap: 10px;
        padding: 9px 14px;
        cursor: pointer; font-family: inherit; color: var(--ink); text-align: left;
      }
      .lim-cpv-int-dot { width: 8px; height: 8px; flex-shrink: 0; }
      .lim-cpv-int-dot--green { background: var(--green); }
      .lim-cpv-int-dot--red { background: var(--red); }
      .lim-cpv-int-name { font-size: 13px; font-weight: 700; min-width: 96px; }
      .lim-cpv-int-status { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; }
      .lim-cpv-int-status--green { color: var(--green); }
      .lim-cpv-int-status--red { color: var(--red); }
      .lim-cpv-int-sep { color: var(--ink-3); font-size: 11px; }
      .lim-cpv-int-last { font-size: 11px; color: var(--ink-2); flex: 1; }
      .lim-cpv-int-chev { font-size: 16px; font-weight: 700; color: var(--ink-3); width: 14px; text-align: center; }
      .lim-cpv-int-events { padding: 4px 14px 12px 32px; display: flex; flex-direction: column; gap: 3px; }
      .lim-cpv-int-event { font-size: 11px; color: var(--ink-2); line-height: 1.4; padding: 2px 0; border-bottom: 1px dashed var(--rule); }
      .lim-cpv-int-event:last-child { border-bottom: none; }

      /* ── ACTIVITY ── reuses .lim-c-log */
      .lim-cpv-activity {
        background: var(--bg-2);
        padding: 8px;
        max-height: 180px;
        overflow-y: auto;
        display: flex; flex-direction: column; gap: 2px;
      }
    `}</style>
  );
}
window.StylesCPV = StylesCPV;

// ---------- Compact pipeline summary — used on Laptop & Phone ----------
// 11 mini-columns: count, lowercase status name, stuck count if any. Click → /pipeline.
function PipelineSummary({ cols, layout = 'row' }) {
  return (
    <div className={`lim-cpl-pipe lim-cpl-pipe--${layout}`}>
      {D_CP.STATUS_ORDER.map((s, idx) => {
        const list = cols[s] || [];
        const stuckN = list.filter((v) => v.stuck_days > 0).length;
        const failN = list.filter((v) => v.qa_passed === false).length;
        const tone = failN > 0 ? 'red' : stuckN > 0 ? 'amber' : 'green';
        return (
          <button key={s} type="button" className={`lim-cpl-pipe-col lim-cpl-pipe-col--${tone}`}>
            <div className="lim-cpl-pipe-count">{list.length}</div>
            <div className="lim-cpl-pipe-name">{s.toLowerCase()}</div>
            <div className="lim-cpl-pipe-flags">
              {stuckN > 0 && <span className="lim-cpl-pipe-flag lim-cpl-pipe-flag--amber">{stuckN}↻</span>}
              {failN > 0  && <span className="lim-cpl-pipe-flag lim-cpl-pipe-flag--red">{failN}✕</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------- MacBook Air 1440x932 — vertical scroll allowed ----------
// Same content priorities as Studio Display, agent grid is the headline.
function DirCLaptop({ scenario, theme, accent, stuckStyle, grain, grainOn, mono, setTheme, bg, setBg, setMono, alpha, setAlpha }) {
  const data = window.LIMITLESS_SCENARIOS[scenario] || window.LIMITLESS_SCENARIOS.busy;
  const dark = theme === 'dark';
  const glass = grainOn;
  // Card transparency — alpha 0..100 (0 = invisible, 100 = solid). Default 65.
  // When grain bg is on, panels use the live alpha so the shader shows through.
  // When grain is off, panels stay solid (alpha doesn't fight a flat backdrop).
  const a = (typeof alpha === 'number') ? Math.max(0, Math.min(100, alpha)) / 100 : 0.65;
  const a2 = Math.min(1, a + 0.05);
  const cssVars = {
    '--bg':      dark ? '#0a0c0e' : '#f6f6f4',
    '--bg-2':    glass ? (dark ? `rgba(20,20,24,${a})` : `rgba(255,255,255,${a})`) : (dark ? '#13161a' : '#ececea'),
    '--bg-3':    glass ? (dark ? `rgba(28,32,38,${a2})` : `rgba(255,255,255,${a2})`) : (dark ? '#1c2026' : '#e2e2df'),
    '--ink':     dark ? '#f5f5f2' : '#0a0c0e',
    '--ink-2':   dark ? '#a8aaad' : '#54565a',
    '--ink-3':   dark ? '#62656b' : '#9a9ca0',
    '--rule':    dark ? '#262a30' : '#d8d8d4',
    '--accent':  accent,
    '--green':   dark ? '#5cd18b' : '#1c8a3c',
    '--amber':   dark ? '#f0b03a' : '#b8721a',
    '--red':     dark ? '#ff5c4a' : '#cc2a18',
  };
  const cols = useMemoCP(() => {
    const m = {};
    for (const s of D_CP.STATUS_ORDER) m[s] = [];
    for (const v of data.videos) (m[v.status] || (m[v.status] = [])).push(v);
    return m;
  }, [data]);
  const stuck = data.videos.filter((v) => v.stuck_days > 0).length;
  const failed = data.videos.filter((v) => v.qa_passed === false || v.status === 'WAITING');

  return (
    <div data-glass={glass ? 'on' : 'off'} className="lim-c lim-cpv-root lim-cpl-root" style={{ ...cssVars, background: 'var(--bg)', color: 'var(--ink)', position: 'relative', height: '100%', overflow: 'hidden', fontFamily: mono ? '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' : '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif' }}>
      <DirCGlassStyles />
      <window.LIM.GrainBackground on={grainOn} dark={dark} paused={data.health.systemScore < 60} pixelated={mono} />
      <div className="lim-cpv-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', zIndex: 1 }}>
      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.22em', color: 'var(--ink-3)' }}>LIMITLESS · AUSTIN · OPS</div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1, marginTop: 4 }}>
              FRI · 09:03 <span style={{ color: 'var(--ink-3)' }}>CT</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', color: 'var(--ink-3)' }}>
              <span style={{ width: 7, height: 7, background: 'var(--green)' }} />
              POLLING · 15s
            </div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--ink-3)', marginTop: 3 }}>
              <span style={{ color: 'var(--ink)' }}>{data.videos.length}</span> ACTIVE · <span style={{ color: stuck > 0 ? 'var(--amber)' : 'var(--ink)' }}>{stuck}</span> STUCK · <span style={{ color: failed.length > 0 ? 'var(--red)' : 'var(--ink)' }}>{failed.length}</span> QA
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 6, justifyContent: 'flex-end' }}>
              {data.health.cells.map((c) => (
                <div key={c.id} className={`lim-c-pip lim-c-pip--${c.state}`} title={`${c.label}: ${c.detail}`}>{c.label.split(' ')[0].slice(0, 4).toUpperCase()}</div>
              ))}
            </div>
          </div>
        </div>

        {/* HEALTH BARS */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <PortraitHero title="OPERATIONAL" score={data.opScore} breakdown={data.op} />
          <PortraitHero title="SYSTEM" score={data.sysScore} breakdown={data.health.systemBreakdown} />
        </div>

        {/* AGENT GRID — the headline. 7 in a row */}
        <div className="lim-cpl-agents-wrap">
          <PortraitAgents data={data} />
        </div>

        {/* UPCOMING SHOOTS */}
        <PortraitShoots data={data} />

        {/* COMPACT PIPELINE SUMMARY — 11 mini-columns */}
        <section>
          <PortraitSectionTitle right={`${data.videos.length} ACTIVE · ${stuck} STUCK · CLICK → /pipeline`}>PIPELINE</PortraitSectionTitle>
          <PipelineSummary cols={cols} layout="row" />
        </section>

        {/* QA + EDITORS row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <PortraitQA data={data} />
          <PortraitEditors data={data} />
        </div>

        {/* SIGNALS — full width */}
        <PortraitSignals data={data} />

        {/* INTEGRATIONS + SYSTEM HEALTH row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <PortraitIntegrations data={data} />
          <PortraitHealth data={data} />
        </div>

        {/* ACTIVITY */}
        <PortraitActivity data={data} />
      </div>
      </div>
      <InAppToolbar theme={theme} setTheme={setTheme} bg={bg} setBg={setBg} mono={mono ? "on" : "off"} setMono={setMono} alpha={alpha} setAlpha={setAlpha} compact={false} />
      <InAppToolbarStyles />
      <window.StylesCP />
      <window.StylesCPV />
      <window.StylesCPL />
      <window.StylesC />
    </div>
  );
}

// ---------- iPhone 430x932 portrait — full vertical scroll, no tabs ----------
function DirCMobile({ scenario, theme, accent, stuckStyle, grain, grainOn, mono, setTheme, bg, setBg, setMono, alpha, setAlpha }) {
  const data = window.LIMITLESS_SCENARIOS[scenario] || window.LIMITLESS_SCENARIOS.busy;
  const dark = theme === 'dark';
  const glass = grainOn;
  // Card transparency — alpha 0..100 (0 = invisible, 100 = solid). Default 65.
  // When grain bg is on, panels use the live alpha so the shader shows through.
  // When grain is off, panels stay solid (alpha doesn't fight a flat backdrop).
  const a = (typeof alpha === 'number') ? Math.max(0, Math.min(100, alpha)) / 100 : 0.65;
  const a2 = Math.min(1, a + 0.05);
  const cssVars = {
    '--bg':      dark ? '#0a0c0e' : '#f6f6f4',
    '--bg-2':    glass ? (dark ? `rgba(20,20,24,${a})` : `rgba(255,255,255,${a})`) : (dark ? '#13161a' : '#ececea'),
    '--bg-3':    glass ? (dark ? `rgba(28,32,38,${a2})` : `rgba(255,255,255,${a2})`) : (dark ? '#1c2026' : '#e2e2df'),
    '--ink':     dark ? '#f5f5f2' : '#0a0c0e',
    '--ink-2':   dark ? '#a8aaad' : '#54565a',
    '--ink-3':   dark ? '#62656b' : '#9a9ca0',
    '--rule':    dark ? '#262a30' : '#d8d8d4',
    '--accent':  accent,
    '--green':   dark ? '#5cd18b' : '#1c8a3c',
    '--amber':   dark ? '#f0b03a' : '#b8721a',
    '--red':     dark ? '#ff5c4a' : '#cc2a18',
  };
  const cols = useMemoCP(() => {
    const m = {};
    for (const s of D_CP.STATUS_ORDER) m[s] = [];
    for (const v of data.videos) (m[v.status] || (m[v.status] = [])).push(v);
    return m;
  }, [data]);
  const stuck = data.videos.filter((v) => v.stuck_days > 0).length;
  const qaFail = data.videos.filter((v) => v.qa_passed === false).length;
  const alerts = data.health.cells.filter((c) => c.state !== 'green').length;
  const opState = window.LIM.healthState(data.opScore);
  const sysState = window.LIM.healthState(data.sysScore);

  return (
    <div data-glass={glass ? 'on' : 'off'} className="lim-c lim-cpv-root lim-cpm-root" style={{ ...cssVars, background: 'var(--bg)', color: 'var(--ink)', position: 'relative', height: '100%', overflow: 'hidden', fontFamily: mono ? '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' : '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif' }}>
      <DirCGlassStyles />
      <window.LIM.GrainBackground on={grainOn} dark={dark} paused pixelated={mono} />
      <div className="lim-cpv-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', zIndex: 1 }}>
      <div style={{ padding: '46px 14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* 1. HEADER (compact) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, fontWeight: 800, color: 'var(--ink-3)', letterSpacing: '0.16em' }}>
          <span>LIMITLESS · 09:03 CT</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, background: 'var(--green)' }} />LIVE
          </span>
        </div>

        {/* 2. HEALTH BARS — Operational + System, stacked */}
        <PortraitHero title="OPERATIONAL" score={data.opScore} breakdown={data.op} />
        <PortraitHero title="SYSTEM" score={data.sysScore} breakdown={data.health.systemBreakdown} />

        {/* 3. QUICK STATS ROW */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <MobileKPI n={stuck} label="STUCK" state={stuck > 3 ? 'red' : stuck > 0 ? 'amber' : 'green'} />
          <MobileKPI n={qaFail} label="QA FAIL" state={qaFail > 0 ? 'red' : 'green'} />
          <MobileKPI n={alerts} label="ALERTS" state={sysState} />
        </div>

        {/* 4. AGENT GRID — stacked vertically */}
        <PortraitAgents data={data} />

        {/* 5. UPCOMING SHOOTS */}
        <PortraitShoots data={data} />

        {/* 6. COMPACT PIPELINE — stacked column on phone */}
        <section>
          <PortraitSectionTitle right={`${data.videos.length} ACTIVE · ${stuck} STUCK`}>PIPELINE</PortraitSectionTitle>
          <PipelineSummary cols={cols} layout="stack" />
        </section>

        {/* 7. QA QUEUE */}
        <PortraitQA data={data} />

        {/* 8. EDITOR CAPACITY */}
        <PortraitEditors data={data} />

        {/* 9. PERFORMANCE SIGNALS */}
        <PortraitSignals data={data} />

        {/* 10. INTEGRATIONS */}
        <PortraitIntegrations data={data} />

        {/* 11. SYSTEM HEALTH */}
        <PortraitHealth data={data} />

        {/* 12. ACTIVITY FEED */}
        <PortraitActivity data={data} />
      </div>
      </div>
      <InAppToolbar theme={theme} setTheme={setTheme} bg={bg} setBg={setBg} mono={mono ? "on" : "off"} setMono={setMono} alpha={alpha} setAlpha={setAlpha} compact={true} />
      <InAppToolbarStyles />
      <window.StylesCP />
      <window.StylesCPV />
      <window.StylesCPL />
      <window.StylesC />
    </div>
  );
}

function MobileKPI({ n, label, state }) {
  return (
    <div data-kpi="" style={{ background: state === 'red' ? 'color-mix(in oklab, var(--red) 12%, var(--bg-2))' : state === 'amber' ? 'color-mix(in oklab, var(--amber) 10%, var(--bg-2))' : 'var(--bg-2)', padding: 10, textAlign: 'center', borderTop: `3px solid var(--${state})` }}>
      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 0.9, color: `var(--${state})` }}>{n}</div>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: 'var(--ink-3)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// Reused by old code — kept as a no-op style element so existing class refs still work.
function StylesCP() {
  return (
    <style>{`
      /* Legacy lim-cp-* used only by previous laptop variant; kept for safety. */
      .lim-cp-row { background: var(--bg-2); padding: 16px 20px; }
    `}</style>
  );
}

// Laptop + Mobile overrides to the Portrait* (lim-cpv-*) class system.
function StylesCPL() {
  return (
    <style>{`
      /* ── PIPELINE SUMMARY — compact 11-column or stacked ── */
      .lim-cpl-pipe--row {
        display: grid;
        grid-template-columns: repeat(11, minmax(0, 1fr));
        gap: 4px;
      }
      .lim-cpl-pipe--stack {
        display: flex; flex-direction: column; gap: 3px;
      }
      .lim-cpl-pipe-col {
        background: var(--bg-2); border: none;
        padding: 10px 10px 10px;
        display: flex; flex-direction: column; gap: 4px;
        cursor: pointer; text-align: left;
        font-family: inherit; color: var(--ink);
        transition: background 0.15s;
        min-height: 78px;
      }
      .lim-cpl-pipe-col:hover { background: var(--bg-3); }
      .lim-cpl-pipe-col--amber { box-shadow: inset 0 -3px 0 var(--amber); }
      .lim-cpl-pipe-col--red   { box-shadow: inset 0 -3px 0 var(--red); }
      .lim-cpl-pipe-count {
        font-size: 28px; font-weight: 800; line-height: 0.9;
        letter-spacing: -0.04em; font-feature-settings: "tnum" 1;
      }
      .lim-cpl-pipe-col--amber .lim-cpl-pipe-count { color: var(--amber); }
      .lim-cpl-pipe-col--red   .lim-cpl-pipe-count { color: var(--red); }
      .lim-cpl-pipe-name {
        font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
        text-transform: uppercase; color: var(--ink-2);
        line-height: 1.2; word-break: break-word;
      }
      .lim-cpl-pipe-flags { display: flex; gap: 4px; margin-top: auto; }
      .lim-cpl-pipe-flag {
        font-size: 9px; font-weight: 800; letter-spacing: 0.08em;
        padding: 2px 5px;
      }
      .lim-cpl-pipe-flag--amber { background: var(--amber); color: var(--bg); }
      .lim-cpl-pipe-flag--red { background: var(--red); color: var(--bg); }
      .lim-cpl-pipe--stack .lim-cpl-pipe-col {
        flex-direction: row; align-items: center; gap: 12px;
        min-height: 0; padding: 10px 12px;
      }
      .lim-cpl-pipe--stack .lim-cpl-pipe-count { min-width: 36px; }
      .lim-cpl-pipe--stack .lim-cpl-pipe-name { flex: 1; font-size: 11px; }
      .lim-cpl-pipe--stack .lim-cpl-pipe-flags { margin-top: 0; }

      /* ── LAPTOP overrides ── 7 agents in a single row */
      .lim-cpl-root .lim-cpv-agents { grid-template-columns: repeat(7, 1fr); }
      .lim-cpl-root .lim-cpv-agents > .lim-cpv-agent:nth-child(7) { grid-column: auto; }
      .lim-cpl-root .lim-cpv-agent { min-height: 130px; }
      .lim-cpl-root .lim-cpv-spark { height: 24px; }

      /* ── MOBILE overrides ── single column for everything */
      .lim-cpm-root { font-size: 13px; }
      .lim-cpm-root .lim-cpv-agents { grid-template-columns: 1fr; gap: 4px; }
      .lim-cpm-root .lim-cpv-agents > .lim-cpv-agent:nth-child(7) { grid-column: auto; }
      .lim-cpm-root .lim-cpv-agent { min-height: 0; padding: 10px 14px; }
      .lim-cpm-root .lim-cpv-spark { display: none; }
      .lim-cpm-root .lim-cpv-hero { padding: 12px 14px 14px; }
      .lim-cpm-root .lim-cpv-hero-num { font-size: 64px; }
      .lim-cpm-root .lim-cpv-hero-denom { font-size: 16px; }
      .lim-cpm-root .lim-cpv-hero-keys { gap: 4px 10px; }
      .lim-cpm-root .lim-cpv-shoot {
        grid-template-columns: 78px 1fr;
        grid-template-rows: auto auto;
        row-gap: 4px;
      }
      .lim-cpm-root .lim-cpv-shoot-status { grid-column: 1 / -1; font-size: 10px; }
      .lim-cpm-root .lim-cpv-editors { grid-template-columns: 1fr; }
      .lim-cpm-root .lim-cpv-qa-grid { grid-template-columns: 1fr 1fr; }
      .lim-cpm-root .lim-cpv-int-name { min-width: 80px; font-size: 12px; }
      .lim-cpm-root .lim-cpv-int-last { font-size: 10px; }
      .lim-cpm-root .lim-cpv-int-status { font-size: 10px; }
      .lim-cpm-root .lim-cpv-activity { max-height: 240px; }
      .lim-cpm-root h3 { font-size: 18px; }
      .lim-cpm-root .lim-cpl-pipe-col { padding: 10px 12px; }
    `}</style>
  );
}

window.DirCPortrait = DirCPortrait;
window.DirCLaptop = DirCLaptop;
window.DirCMobile = DirCMobile;
window.StylesCP = StylesCP;
window.StylesCPL = StylesCPL;
