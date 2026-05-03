// Header chrome for Ops + Pipeline routes — ported from
// dir-c-responsive.jsx. Eyebrow → mega clock on the left; live indicator,
// summary counts, and abbreviated status pips on the right.

import { useLiveClock } from '../lib/theme';

function abbrev(label) {
  return (label || '').split(' ')[0].slice(0, 4).toUpperCase();
}

export default function OpsHeader({
  campusId, campuses, onCampus, campusLoading,
  totals, sysCells, pollingInterval = '15s',
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
          POLLING · {pollingInterval}
        </div>
        <div className="lim-header2__counts">
          <strong>{active}</strong> ACTIVE ·{' '}
          <strong className={stuck > 0 ? 'is-amber' : ''}>{stuck}</strong> STUCK ·{' '}
          <strong className={failed > 0 ? 'is-red' : ''}>{failed}</strong> QA
        </div>
        {sysCells && (
          <div className="lim-header2__pips">
            {sysCells.map((c) => (
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
