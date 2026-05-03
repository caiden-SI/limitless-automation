// System health rows — ported from PortraitHealth. Five infra cells with
// state dot + score over weight + drill-in detail line.

import { timeAgo } from '../lib/health';

export default function SystemHealthStrip({ system, inbox, summary }) {
  const cellMeta = {
    webhook: {
      detail: inbox
        ? `${inbox.pending} pending · ${inbox.failed} failed · ${inbox.processed} processed`
        : 'no webhook activity on record',
    },
    cron: {
      detail: summary?.last_research_run
        ? `last research ${timeAgo(summary.last_research_run)}`
        : 'no cron jobs reporting',
    },
    ffmpeg: {
      detail: summary?.last_lufs_measurement
        ? `last LUFS measurement ${timeAgo(summary.last_lufs_measurement)}`
        : 'no LUFS measurement on record',
    },
    tailscale: {
      detail: summary?.last_webhook_received_at
        ? `last webhook ${timeAgo(summary.last_webhook_received_at)}`
        : 'no webhooks received',
    },
    errors: {
      detail: `${system.errors} ${system.errors === 1 ? 'error' : 'errors'} in last hour`,
    },
  };

  return (
    <section id="system-health" aria-label="System health">
      <div className="lim-section-title">
        <h3>SYSTEM HEALTH</h3>
        <span className="lim-section-title__right">5 SUBSYSTEMS</span>
      </div>
      <div className="lim-cpv-health-list">
        {system.cells.map((cell) => {
          const score = cell.state === 'green'
            ? cell.weight
            : cell.state === 'amber'
              ? Math.round(cell.weight / 2)
              : 0;
          const valColor =
            cell.state === 'red' ? 'var(--red)' :
            cell.state === 'amber' ? 'var(--amber)' :
            'var(--ink)';
          return (
            <button key={cell.id} type="button" className={`lim-cpv-health lim-cpv-health--${cell.state}`}>
              <span className={`lim-cpv-health-dot lim-cpv-health-dot--${cell.state}`} />
              <div className="lim-cpv-health-body">
                <div className="lim-cpv-health-row1">
                  <span className="lim-cpv-health-label">{cell.label}</span>
                  <span className="lim-cpv-health-val" style={{ color: valColor }}>
                    {score}<span style={{ color: 'var(--ink-3)', fontWeight: 600 }}>/{cell.weight}</span>
                  </span>
                </div>
                <div className="lim-cpv-health-detail">{cellMeta[cell.id]?.detail}</div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
