// Compact pipeline summary — ported from PipelineSummary in
// dir-c-responsive.jsx. 11 mini-columns (`row`) on laptop / portrait,
// stacked rows (`stack`) on phone. Each tile shows count + lowercase status
// + flag chips for stuck / failed.

import { Link } from 'react-router-dom';
import { STATUS_ORDER, isStuck, statusLabel } from '../lib/health';

export default function PipelineSummary({ videos, layout = 'row', loading }) {
  const cols = {};
  for (const s of STATUS_ORDER) cols[s] = [];
  for (const v of videos || []) {
    if (cols[v.status]) cols[v.status].push(v);
  }
  const total = (videos || []).length;
  const stuckTotal = (videos || []).filter((v) => isStuck(v)).length;

  return (
    <section id="pipeline-summary" aria-label="Pipeline summary">
      <div className="lim-section-title">
        <h3>PIPELINE</h3>
        <span className="lim-section-title__right">
          {total} ACTIVE · {stuckTotal} STUCK ·{' '}
          <Link to="/pipeline" style={{ color: 'inherit', textDecoration: 'underline' }}>
            CLICK → /pipeline
          </Link>
        </span>
      </div>

      {loading && <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading…</div>}

      <div className={`lim-cpl-pipe lim-cpl-pipe--${layout}`}>
        {STATUS_ORDER.map((s) => {
          const list = cols[s] || [];
          const stuckN = list.filter((v) => isStuck(v)).length;
          const failN  = list.filter((v) => v.qa_passed === false).length;
          const tone = failN > 0 ? 'red' : stuckN > 0 ? 'amber' : 'green';
          return (
            <Link
              key={s}
              to="/pipeline"
              className={`lim-cpl-pipe-col lim-cpl-pipe-col--${tone}`}
              aria-label={`${statusLabel(s)} · ${list.length} videos${stuckN ? `, ${stuckN} stuck` : ''}`}
            >
              <div className="lim-cpl-pipe-count">{list.length}</div>
              <div className="lim-cpl-pipe-name">{statusLabel(s)}</div>
              <div className="lim-cpl-pipe-flags">
                {stuckN > 0 && <span className="lim-cpl-pipe-flag lim-cpl-pipe-flag--amber">{stuckN}↻</span>}
                {failN  > 0 && <span className="lim-cpl-pipe-flag lim-cpl-pipe-flag--red">{failN}✕</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
