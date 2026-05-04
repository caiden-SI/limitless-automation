// System Pulse cells. Per docs/dashboard-scoring-fix-spec.md:
//   - Consume new pulse.cells shape (state + detail, no weighted score).
//   - No per-cell x/y readout. Just dot + label + one-line detail.
//   - Each cell renders the spec's detail string verbatim (≤ 60 chars).

export default function SystemHealthStrip({ pulse }) {
  const cells = pulse?.cells || [];
  return (
    <section id="system-health" aria-label="System pulse">
      <div className="lim-section-title">
        <h3>SYSTEM PULSE</h3>
        <span className="lim-section-title__right">{cells.length} SUBSYSTEMS</span>
      </div>
      <div className="lim-cpv-health-list">
        {cells.map((cell) => (
          <button
            key={cell.id}
            type="button"
            className={`lim-cpv-health lim-cpv-health--${cell.state}`}
          >
            <span className={`lim-cpv-health-dot lim-cpv-health-dot--${cell.state}`} />
            <div className="lim-cpv-health-body">
              <div className="lim-cpv-health-row1">
                <span className="lim-cpv-health-label">{cell.label}</span>
                <span
                  className="lim-cpv-health-state"
                  style={{
                    color:
                      cell.state === 'red' ? 'var(--red)' :
                      cell.state === 'amber' ? 'var(--amber)' :
                      'var(--green)',
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: '0.12em',
                  }}
                >
                  {cell.state.toUpperCase()}
                </span>
              </div>
              <div className="lim-cpv-health-detail">{cell.detail}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
