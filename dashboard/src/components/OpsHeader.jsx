// Header chrome for Ops + Pipeline routes.
//   - Counts row stays (active/stuck/failed); alarm semantics live in
//     Action Items, so the count numbers stay default-ink.
//   - Pip strip consumes pulse.cells using each cell's `pipLabel` field
//     (so Webhook ingestion + Webhook tunnel render distinct labels
//     instead of both abbreviating to "WEBH").
//   - LIVE pip transitions to amber + "stale" prefix when no successful
//     fetch has landed in the last 60s. The dashboard keeps showing the
//     last data it had — staleness is signalled, not blanking enforced.

import { useEffect, useState } from 'react';
import { useLiveClock } from '../lib/theme';

const STALE_AFTER_MS = 60_000;

export default function OpsHeader({
  campusId, campuses, onCampus, campusLoading,
  totals, pulseCells, lastFetchedAt,
}) {
  const { dow, time, tzAbbrev } = useLiveClock();
  const stuck = totals?.stuck ?? 0;
  const failed = totals?.failed ?? 0;
  const active = totals?.active ?? 0;

  // Tick every second so the "updated Xs ago" line stays accurate.
  // Local state only; nothing above this consumes the tick, so a re-render
  // stops at OpsHeader (won't trigger any data refetch).
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ageMs = lastFetchedAt ? tick - new Date(lastFetchedAt).getTime() : null;
  const isStale = ageMs == null || ageMs > STALE_AFTER_MS;
  const livePipState = isStale ? 'amber' : 'green';
  const liveLabel = isStale ? 'STALE' : 'LIVE';
  const updatedLabel = ageMs == null
    ? 'no fetch yet'
    : ageMs < 1000
      ? 'just now'
      : ageMs < 60_000
        ? `${Math.floor(ageMs / 1000)}s ago`
        : `${Math.floor(ageMs / 60_000)}m ago`;
  const updatedPrefix = isStale ? 'stale' : 'updated';

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
        <div className={`lim-header2__poll lim-header2__poll--${livePipState}`}>
          <span className={`lim-header2__poll-dot lim-header2__poll-dot--${livePipState}`} />
          {liveLabel}
          <span className="lim-header2__poll-fresh">
            · {updatedPrefix} {updatedLabel}
          </span>
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
                {c.pipLabel || c.label?.split(' ')[0].slice(0, 4).toUpperCase()}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
