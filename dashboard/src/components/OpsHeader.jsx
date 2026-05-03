// Header chrome for Ops + Pipeline routes. Per docs/dashboard-scoring-fix-spec.md:
//   - Counts row stays (active/stuck/failed) but the alarm-coloring
//     classes (is-amber, is-red) are removed; numbers default to ink color.
//     Alarm semantics belong in Action Items.
//   - Pip strip consumes pulse.cells with --{state} modifier (the spec
//     replaces the old sysCells shape with the new pulse cells).
//   - Polling label changes from "POLLING · 15s" to "LIVE".

import { useLiveClock } from '../lib/theme';

function abbrev(label) {
  return (label || '').split(' ')[0].slice(0, 4).toUpperCase();
}

export default function OpsHeader({
  campusId, campuses, onCampus, campusLoading,
  totals, pulseCells,
}) {
  const { dow, time, tzAbbrev } = useLiveClock();
  const stuck = totals?.stuck ?? 0;
  const failed = totals?.failed ?? 0;
  const active = totals?.active ?? 0;
  return (
    <div className="lim-header2">
      <div>
        <div className="lim-header2__brand-eyebrow">LIMITLESS · AUSTIN · OPS</div>
        <div className="lim-header2__clock">
          {dow} · {time} <span className="lim-header2__clock-zone">{tzAbbrev}</span>
        </div>
        {campuses && campuses.length > 1 && (
          <select
            className="lim-header2__campus"
            value={campusId || ''}
            onChange={(e) => onCampus?.(e.target.value || null)}
            disabled={campusLoading}
            aria-label="Campus"
          >
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>
      <div className="lim-header2__right">
        <div className="lim-header2__poll">
          <span className="lim-header2__poll-dot" />
          LIVE
        </div>
        <div className="lim-header2__counts">
          <strong>{active}</strong> ACTIVE ·{' '}
          <strong>{stuck}</strong> STUCK ·{' '}
          <strong>{failed}</strong> QA
        </div>
        {pulseCells && pulseCells.length > 0 && (
          <div className="lim-header2__pips">
            {pulseCells.map((c) => (
              <div
                key={c.id}
                className={`lim-c-pip lim-c-pip--${c.state}`}
                title={`${c.label}: ${c.detail || c.state}`}
              >
                {abbrev(c.label)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
