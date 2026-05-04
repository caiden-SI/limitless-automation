// Direction C — Wall-monitor maximalism.
// Giant numbers, glance-from-across-the-room. Hi-contrast, big type,
// aggressive use of color for status. The OPS bar is the hero.

const LIM_C = window.LIM;
const D_C = window.LIMITLESS_DATA;
const { useState: useStateC, useMemo: useMemoC } = React;

function DirC({ scenario, theme, accent, density, stuckStyle, pipelineMode, grain, grainOn }) {
  const data = window.LIMITLESS_SCENARIOS[scenario] || window.LIMITLESS_SCENARIOS.busy;
  const dark = theme === 'dark';
  const compact = density === 'compact';

  const cssVars = {
    '--bg':      dark ? '#0a0c0e' : '#f6f6f4',
    '--bg-2':    dark ? '#13161a' : '#ececea',
    '--bg-3':    dark ? '#1c2026' : '#e2e2df',
    '--ink':     dark ? '#f5f5f2' : '#0a0c0e',
    '--ink-2':   dark ? '#a8aaad' : '#54565a',
    '--ink-3':   dark ? '#62656b' : '#9a9ca0',
    '--rule':    dark ? '#262a30' : '#d8d8d4',
    '--accent':  accent,
    '--green':   dark ? '#5cd18b' : '#1c8a3c',
    '--amber':   dark ? '#f0b03a' : '#b8721a',
    '--red':     dark ? '#ff5c4a' : '#cc2a18',
  };

  return (
    <div className="lim-c" style={{ ...cssVars, background: 'var(--bg)', color: 'var(--ink)', position: 'relative', minHeight: '100%' }}>
      <LIM_C.GrainBackground on={grainOn} intensity={grain * 0.7} dark={dark} paused={data.health.systemScore < 60} />
      <div style={{ position: 'relative', zIndex: 1, padding: compact ? '20px 28px' : '32px 40px' }}>
        <CHeader data={data} compact={compact} />
        <div style={{ height: compact ? 16 : 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: compact ? 16 : 24, alignItems: 'start' }}>
          <CPipeline data={data} stuckStyle={stuckStyle} mode={pipelineMode} />
          <CSidebar data={data} />
        </div>
      </div>
      <StylesC />
    </div>
  );
}

function CHeader({ data, compact }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--ink-3)' }}>LIMITLESS · AUSTIN · OPS</div>
          <div style={{ fontSize: compact ? 38 : 52, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1, marginTop: 4 }}>
            FRI · 09:03 <span style={{ color: 'var(--ink-3)' }}>CT</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--ink-3)' }}>POLLING · 15s</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
            {data.health.cells.map((c) => (
              <div key={c.id} className={`lim-c-pip lim-c-pip--${c.state}`} title={`${c.label}: ${c.detail}`}>{c.label.split(' ')[0].slice(0, 4).toUpperCase()}</div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: compact ? 12 : 16 }}>
        <CHero score={data.opScore} breakdown={data.op} title="OPERATIONAL" stuckCount={data.videos.filter((v) => v.stuck_days > 0).length} />
        <CHero score={data.sysScore} breakdown={data.health.systemBreakdown} title="SYSTEM" />
      </div>
    </div>
  );
}

function CHero({ title, score, breakdown, stuckCount }) {
  const state = LIM_C.healthState(score);
  const color = `var(--${state})`;
  return (
    <div className={`lim-c-hero lim-c-hero--${state}`}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.2em' }}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '0.16em' }}>{state.toUpperCase()}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span className="lim-c-mega" style={{ color }}>{score}</span>
        <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink-3)' }}>/100</span>
      </div>
      <div className="lim-c-hero-bar">
        {breakdown.map((b, i) => (
          <div key={i} className={`lim-c-hero-seg lim-c-hero-seg--${b.state}`} style={{ flex: b.max }}>
            <div className="lim-c-hero-seg-fill" style={{ width: `${(b.score / b.max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="lim-c-hero-keys">
        {breakdown.map((b, i) => (
          <div key={i} className="lim-c-hero-key">
            <span className={`lim-c-hero-key-dot lim-c-hero-key-dot--${b.state}`} />
            <span className="lim-c-hero-key-label">{b.label}</span>
            <span className="lim-c-hero-key-val">{b.score}<span style={{ color: 'var(--ink-3)' }}>/{b.max}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CPipeline({ data, stuckStyle, mode }) {
  const cols = useMemoC(() => {
    const m = {};
    for (const s of D_C.STATUS_ORDER) m[s] = [];
    for (const v of data.videos) (m[v.status] || (m[v.status] = [])).push(v);
    return m;
  }, [data]);
  return (
    <section>
      <CSectionTitle right={`${data.videos.length} active · ${data.videos.filter((v) => v.stuck_days > 0).length} stuck`}>PIPELINE</CSectionTitle>
      {(mode === 'compressed' || !mode) && <CCompressed cols={cols} stuckStyle={stuckStyle} />}
      {mode === 'kanban' && <CKanban cols={cols} stuckStyle={stuckStyle} />}
      {mode === 'list' && <CList cols={cols} stuckStyle={stuckStyle} />}
    </section>
  );
}

function CCompressed({ cols, stuckStyle }) {
  const [open, setOpen] = useStateC(null);
  const max = Math.max(...D_C.STATUS_ORDER.map((s) => (cols[s] || []).length));
  return (
    <div className="lim-c-pipe">
      {D_C.STATUS_ORDER.map((s, idx) => {
        const list = cols[s] || [];
        const stuckN = list.filter((v) => v.stuck_days > 0).length;
        const isOpen = open === s;
        const heightPct = max ? Math.max(8, (list.length / max) * 100) : 8;
        return (
          <div key={s} className={`lim-c-lane ${isOpen ? 'is-open' : ''} ${stuckN > 0 ? 'has-stuck' : ''}`}
            onClick={() => setOpen(isOpen ? null : s)}
            onMouseEnter={() => setOpen(s)}>
            <div className="lim-c-lane-bar-wrap">
              <div className="lim-c-lane-bar" style={{ height: `${heightPct}%` }}>
                {stuckN > 0 && <div className="lim-c-lane-bar-stuck" style={{ height: `${(stuckN / list.length) * 100}%` }} />}
              </div>
            </div>
            <div className="lim-c-lane-info">
              <div className="lim-c-lane-count">{String(list.length).padStart(2, '0')}</div>
              <div className="lim-c-lane-name">{s.toLowerCase()}</div>
              <div className="lim-c-lane-idx">{String(idx + 1).padStart(2, '0')}/11</div>
              {stuckN > 0 && <div className="lim-c-lane-stuck">{stuckN} STUCK</div>}
            </div>
            {isOpen && (
              <div className="lim-c-lane-body" onClick={(e) => e.stopPropagation()} onMouseLeave={() => setOpen(null)}>
                {list.length === 0 && <div className="lim-c-empty">— no videos —</div>}
                {list.map((v) => (
                  <div key={v.id} className={`lim-c-card ${v.qa_passed === false ? 'is-fail' : ''} ${v.stuck_days ? 'is-stuck' : ''}`}>
                    <div className="lim-c-card-title">{v.title}</div>
                    <div className="lim-c-card-row">
                      <span>{v.student_name || '—'}</span>
                      {v.assignee_id && <span style={{ color: 'var(--ink-3)' }}>· {D_C.EDITORS.find((e) => e.id === v.assignee_id)?.name.split(' ')[0]}</span>}
                      <span style={{ marginLeft: 'auto', color: 'var(--ink-3)' }}>{LIM_C.timeAgo(v.updated_at, D_C.NOW)}</span>
                    </div>
                    {(v.stuck_days > 0 || v.qa_passed === false) && (
                      <div className="lim-c-card-flags">
                        {v.qa_passed === false && <span className="lim-c-flag lim-c-flag--red">QA FAIL</span>}
                        {v.stuck_days > 0 && <LIM_C.StuckMark days={v.stuck_days} style={stuckStyle} />}
                      </div>
                    )}
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

function CKanban({ cols, stuckStyle }) {
  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto' }}>
      {D_C.STATUS_ORDER.map((s) => {
        const list = cols[s] || [];
        return (
          <div key={s} style={{ flex: '0 0 200px', background: 'var(--bg-2)', padding: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{list.length}</div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{s.toLowerCase()}</div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {list.map((v) => (
                <div key={v.id} className="lim-c-card">
                  <div className="lim-c-card-title">{v.title}</div>
                  <div className="lim-c-card-row"><LIM_C.StuckMark days={v.stuck_days} style={stuckStyle} /></div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CList({ cols, stuckStyle }) {
  return (
    <div>
      {D_C.STATUS_ORDER.map((s) => {
        const list = cols[s] || [];
        if (list.length === 0) return null;
        return (
          <div key={s} style={{ marginBottom: 12, background: 'var(--bg-2)', padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
              <span style={{ fontSize: 24, fontWeight: 800 }}>{list.length}</span>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>{s.toLowerCase()}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 4 }}>
              {list.map((v) => (
                <div key={v.id} className="lim-c-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="lim-c-card-title" style={{ flex: 1 }}>{v.title}</span>
                  <LIM_C.StuckMark days={v.stuck_days} style={stuckStyle} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CSidebar({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <CQA data={data} />
      <CEditors data={data} />
      <CActivity data={data} />
      <CPerf data={data} />
    </div>
  );
}

function CQA({ data }) {
  const awaiting = data.videos.filter((v) => v.status === 'EDITED' && v.qa_passed === null);
  const failed = data.videos.filter((v) => v.qa_passed === false || v.status === 'WAITING');
  const lastQAErr = data.logs.find((l) => l.agent_name === 'qa' && l.status === 'error');
  return (
    <section>
      <CSectionTitle right={`${awaiting.length + failed.length} TOTAL`}>QA</CSectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div style={{ background: 'var(--bg-2)', padding: 12 }}>
          <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1 }}>{awaiting.length}</div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 4 }}>awaiting QA</div>
        </div>
        <div style={{ background: failed.length > 0 ? 'color-mix(in oklab, var(--red) 12%, var(--bg-2))' : 'var(--bg-2)', padding: 12, borderLeft: failed.length > 0 ? '4px solid var(--red)' : 'none' }}>
          <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, color: failed.length > 0 ? 'var(--red)' : 'var(--ink)' }}>{failed.length}</div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: failed.length > 0 ? 'var(--red)' : 'var(--ink-3)', marginTop: 4 }}>failed / waiting</div>
        </div>
      </div>
      {failed.map((v) => {
        const editor = D_C.EDITORS.find((e) => e.id === v.assignee_id);
        return (
          <div key={v.id} className="lim-c-card is-fail" style={{ marginBottom: 4 }}>
            <div className="lim-c-card-title">{v.title}</div>
            {lastQAErr && v.qa_passed === false && (
              <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600, margin: '2px 0' }}>{lastQAErr.error_message}</div>
            )}
            <div className="lim-c-card-row">
              <span style={{ fontWeight: 700 }}>{editor?.name || 'unassigned'}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--ink-3)' }}>{LIM_C.timeAgo(v.updated_at, D_C.NOW)}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function CEditors({ data }) {
  const counts = {};
  for (const v of data.videos) if (v.status === 'IN EDITING' && v.assignee_id) counts[v.assignee_id] = (counts[v.assignee_id] || 0) + 1;
  return (
    <section>
      <CSectionTitle>EDITORS</CSectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {D_C.EDITORS.map((ed) => {
          const n = counts[ed.id] || 0;
          const over = n >= 5;
          return (
            <div key={ed.id} style={{ background: over ? 'color-mix(in oklab, var(--red) 12%, var(--bg-2))' : 'var(--bg-2)', padding: 14, borderLeft: over ? '4px solid var(--red)' : 'none' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--ink-2)', textTransform: 'uppercase' }}>{ed.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, color: over ? 'var(--red)' : 'var(--ink)' }}>{n}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-3)' }}>/5</span>
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: over ? 'var(--red)' : 'var(--ink-3)', marginTop: 4, textTransform: 'uppercase' }}>{over ? 'OVERLOADED' : `${5 - n} headroom`}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CActivity({ data }) {
  const [paused, setPaused] = useStateC(false);
  return (
    <section>
      <CSectionTitle right={paused ? 'PAUSED' : 'LIVE · 10s'}>ACTIVITY</CSectionTitle>
      <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
        style={{ background: 'var(--bg-2)', padding: 8, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {data.logs.slice(0, 10).map((l) => (
          <div key={l.id} className={`lim-c-log lim-c-log--${l.status}`}>
            <span className="lim-c-log-time">{new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span className={`lim-c-log-agent lim-c-log-agent--${l.status}`}>{LIM_C.AGENT_LABEL[l.agent_name] || l.agent_name}</span>
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

function CPerf({ data }) {
  const sig = D_C.PERF_SIGNAL;
  return (
    <section>
      <CSectionTitle right={`WK ${sig.week_of}`}>SIGNALS</CSectionTitle>
      <div style={{ background: 'var(--bg-2)', padding: 14 }}>
        <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1 }}>{(sig.top_hooks[0].avg_views / 1000).toFixed(0)}K</div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 4 }}>top hook · {sig.top_hooks[0].type}</div>
        <p style={{ fontSize: 12, lineHeight: 1.55, margin: '12px 0 0', color: 'var(--ink-2)' }}>{sig.summary}</p>
        <div style={{ marginTop: 12, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--green)', textTransform: 'uppercase' }}>+ DO MORE OF</div>
        {sig.raw_output.recommendations.slice(0, 2).map((r, i) => (
          <div key={i} style={{ fontSize: 12, color: 'var(--ink)', padding: '3px 0' }}>{r}</div>
        ))}
        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--red)', textTransform: 'uppercase' }}>− AVOID</div>
        {sig.raw_output.underperforming_patterns.slice(0, 1).map((p, i) => (
          <div key={i} style={{ fontSize: 12, color: 'var(--ink)', padding: '3px 0' }}>{p}</div>
        ))}
      </div>
    </section>
  );
}

function CSectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>{children}</h3>
      {right && <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--ink-3)' }}>{right}</span>}
    </div>
  );
}

function StylesC() {
  return (
    <style>{`
      .lim-c {
        font-family: "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace;
        font-size: 13px;
        line-height: 1.5;
        font-feature-settings: "tnum" 1, "ss01" 1;
      }
      .lim-c h3, .lim-c .lim-c-mega { font-feature-settings: "tnum" 1; }
      .lim-c *::-webkit-scrollbar { width: 6px; }
      .lim-c *::-webkit-scrollbar-thumb { background: var(--rule); }

      .lim-c-mega {
        font-size: 84px; font-weight: 800; line-height: 0.9; letter-spacing: -0.05em;
      }
      .lim-c-pip {
        font-size: 9px; font-weight: 800; letter-spacing: 0.12em;
        padding: 4px 6px; border: 1px solid var(--rule);
      }
      .lim-c-pip--green { border-color: var(--green); color: var(--green); }
      .lim-c-pip--amber { border-color: var(--amber); color: var(--amber); background: color-mix(in oklab, var(--amber) 12%, transparent); }
      .lim-c-pip--red { border-color: var(--red); color: var(--bg); background: var(--red); animation: lim-c-redblink 2s infinite; }
      @keyframes lim-c-redblink { 50% { opacity: 0.7; } }

      .lim-c-hero {
        background: var(--bg-2);
        border-left: 6px solid var(--rule);
        padding: 16px 20px;
      }
      .lim-c-hero--green { border-left-color: var(--green); }
      .lim-c-hero--amber { border-left-color: var(--amber); background: color-mix(in oklab, var(--amber) 6%, var(--bg-2)); }
      .lim-c-hero--red { border-left-color: var(--red); background: color-mix(in oklab, var(--red) 8%, var(--bg-2)); }

      .lim-c-hero-bar {
        display: flex; gap: 2px; height: 10px; margin-top: 12px;
      }
      .lim-c-hero-seg { background: var(--bg-3); position: relative; }
      .lim-c-hero-seg-fill { height: 100%; }
      .lim-c-hero-seg--green .lim-c-hero-seg-fill { background: var(--green); }
      .lim-c-hero-seg--amber .lim-c-hero-seg-fill { background: var(--amber); }
      .lim-c-hero-seg--red .lim-c-hero-seg-fill { background: var(--red); }
      .lim-c-hero-keys {
        display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 10px;
      }
      .lim-c-hero-key { display: flex; align-items: center; gap: 6px; font-size: 11px; }
      .lim-c-hero-key-dot { width: 8px; height: 8px; }
      .lim-c-hero-key-dot--green { background: var(--green); }
      .lim-c-hero-key-dot--amber { background: var(--amber); }
      .lim-c-hero-key-dot--red { background: var(--red); }
      .lim-c-hero-key-label { color: var(--ink-2); font-weight: 600; }
      .lim-c-hero-key-val { color: var(--ink); font-weight: 800; }

      .lim-c-pipe {
        display: grid;
        grid-template-columns: repeat(11, 1fr);
        gap: 4px;
        position: relative;
      }
      .lim-c-lane {
        background: var(--bg-2);
        cursor: pointer;
        position: relative;
        min-height: 220px;
        display: flex; flex-direction: column;
        transition: background 0.18s;
      }
      .lim-c-lane:hover, .lim-c-lane.is-open { background: var(--bg-3); }
      .lim-c-lane.has-stuck { box-shadow: inset 0 -3px 0 var(--amber); }
      .lim-c-lane-bar-wrap { flex: 1; display: flex; align-items: flex-end; padding: 8px; min-height: 80px; }
      .lim-c-lane-bar {
        width: 100%; background: var(--ink-2); position: relative;
        min-height: 4px;
      }
      .lim-c-lane.is-open .lim-c-lane-bar { background: var(--accent); }
      .lim-c-lane.has-stuck .lim-c-lane-bar { background: var(--amber); }
      .lim-c-lane-bar-stuck {
        position: absolute; top: 0; left: 0; right: 0;
        background-image: repeating-linear-gradient(45deg, var(--red) 0 4px, transparent 4px 8px);
      }
      .lim-c-lane-info { padding: 8px 10px 10px; }
      .lim-c-lane-count { font-size: 32px; font-weight: 800; line-height: 0.9; letter-spacing: -0.04em; }
      .lim-c-lane-name { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); margin-top: 4px; line-height: 1.2; min-height: 22px; }
      .lim-c-lane-idx { font-size: 9px; color: var(--ink-3); margin-top: 4px; letter-spacing: 0.1em; }
      .lim-c-lane-stuck {
        font-size: 9px; font-weight: 800; color: var(--bg); background: var(--amber); padding: 2px 4px; margin-top: 4px; display: inline-block; letter-spacing: 0.08em;
      }
      .lim-c-lane-body {
        position: absolute; top: 100%; left: 0; right: 0;
        background: var(--bg-2);
        border: 2px solid var(--accent);
        z-index: 10;
        padding: 10px;
        display: flex; flex-direction: column; gap: 4px;
        max-height: 300px; overflow-y: auto;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        min-width: 240px;
      }
      .lim-c-card {
        background: var(--bg-3); padding: 8px 10px;
        display: flex; flex-direction: column; gap: 2px;
        text-align: left;
      }
      .lim-c-card.is-fail { border-left: 3px solid var(--red); background: color-mix(in oklab, var(--red) 8%, var(--bg-3)); }
      .lim-c-card.is-stuck { border-left: 3px solid var(--amber); }
      .lim-c-card-title { font-weight: 700; font-size: 13px; line-height: 1.3; }
      .lim-c-card-row { display: flex; gap: 6px; font-size: 11px; color: var(--ink-2); }
      .lim-c-card-flags { display: flex; gap: 6px; margin-top: 4px; }
      .lim-c-flag { font-size: 9px; font-weight: 800; padding: 2px 5px; letter-spacing: 0.1em; }
      .lim-c-flag--red { background: var(--red); color: var(--bg); }
      .lim-c-empty { color: var(--ink-3); padding: 8px; text-align: center; font-size: 12px; }

      .lim-c-log { display: flex; gap: 8px; padding: 4px 6px; align-items: flex-start; background: var(--bg-3); }
      .lim-c-log--error { background: color-mix(in oklab, var(--red) 18%, var(--bg-3)); }
      .lim-c-log--warning { background: color-mix(in oklab, var(--amber) 14%, var(--bg-3)); }
      .lim-c-log-time { font-size: 11px; color: var(--ink-3); width: 38px; flex-shrink: 0; font-weight: 600; }
      .lim-c-log-agent { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; width: 60px; flex-shrink: 0; color: var(--ink-2); }
      .lim-c-log-agent--error { color: var(--red); }
      .lim-c-log-agent--warning { color: var(--amber); }
      .lim-c-log-msg { font-size: 12px; flex: 1; line-height: 1.4; }

      .lim-stuck { font-size: 10px; font-weight: 800; padding: 2px 5px; display: inline-flex; align-items: center; gap: 3px; letter-spacing: 0.05em; }
      .lim-stuck--hg { color: var(--bg); background: var(--amber); }
      .lim-stuck--pulse { color: var(--amber); }
      .lim-stuck--pulse .lim-pulse-dot { background: var(--amber); color: var(--amber); }
      .lim-stuck--stripe { color: var(--bg); padding: 2px 6px;
        background-image: repeating-linear-gradient(45deg, var(--amber) 0 4px, color-mix(in oklab, var(--amber) 50%, transparent) 4px 8px); }
    `}</style>
  );
}

window.DirC = DirC;
window.StylesC = StylesC;
