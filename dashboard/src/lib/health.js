// Pure helpers for derived dashboard state. No React, no Supabase here.

export const STATUS_ORDER = [
  'IDEA',
  'READY FOR SHOOTING',
  'READY FOR EDITING',
  'IN EDITING',
  'EDITED',
  'UPLOADED TO DROPBOX',
  'SENT TO CLIENT',
  'REVISED',
  'POSTED BY CLIENT',
  'DONE',
  'WAITING',
];

export const STATUS_COLORS = {
  'IDEA': '#94a3b8',
  'READY FOR SHOOTING': '#f59e0b',
  'READY FOR EDITING': '#3b82f6',
  'IN EDITING': '#8b5cf6',
  'EDITED': '#06b6d4',
  'UPLOADED TO DROPBOX': '#0891b2',
  'SENT TO CLIENT': '#a855f7',
  'REVISED': '#ec4899',
  'POSTED BY CLIENT': '#f97316',
  'DONE': '#10b981',
  'WAITING': '#ef4444',
};

// Stuck thresholds (ms) per status, copied from the design brief.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const STUCK_THRESHOLDS = {
  'IDEA': 7 * DAY,
  'READY FOR SHOOTING': 5 * DAY,
  'READY FOR EDITING': 3 * DAY,
  'IN EDITING': 4 * DAY,
  'EDITED': 24 * HOUR,
  'WAITING': 24 * HOUR,
  'UPLOADED TO DROPBOX': 7 * DAY,
  'SENT TO CLIENT': 7 * DAY,
  'REVISED': 7 * DAY,
  'POSTED BY CLIENT': 7 * DAY,
  'DONE': 7 * DAY,
};

export function isStuck(video, now = Date.now()) {
  if (!video?.updated_at) return false;
  const threshold = STUCK_THRESHOLDS[video.status] ?? 7 * DAY;
  return now - new Date(video.updated_at).getTime() > threshold;
}

export function statusLabel(s) {
  return s ? s.toLowerCase() : '';
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const diff = now - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// === Operational health (Scott's bar) — out of 100 ===
// Thresholds copied directly from the design brief.
export function operationalHealth({ videos, editors }) {
  const now = Date.now();

  const stuckCount = (videos || []).filter((v) => isStuck(v, now)).length;
  let stuckScore = 0;
  if (stuckCount === 0) stuckScore = 35;
  else if (stuckCount <= 2) stuckScore = 23;
  else if (stuckCount <= 5) stuckScore = 12;

  const editorCounts = {};
  for (const v of videos || []) {
    if (v.assignee_id && v.status === 'IN EDITING') {
      editorCounts[v.assignee_id] = (editorCounts[v.assignee_id] || 0) + 1;
    }
  }
  const overloaded = (editors || []).filter(
    (e) => (editorCounts[e.id] || 0) >= 5,
  ).length;
  let editorScore = 30;
  if (overloaded === 1) editorScore = 15;
  else if (overloaded > 1) editorScore = 0;

  const cutoff = now - 7 * DAY;
  const recentlyTouched = (videos || []).filter(
    (v) => v.qa_passed !== null && new Date(v.updated_at).getTime() >= cutoff,
  );
  const failed = recentlyTouched.filter((v) => v.qa_passed === false).length;
  const total = recentlyTouched.length;
  const failRate = total === 0 ? 0 : failed / total;
  let qaScore = 35;
  if (failRate > 0.25) qaScore = 0;
  else if (failRate >= 0.10) qaScore = 17;

  const total100 = stuckScore + editorScore + qaScore;
  return {
    score: total100,
    parts: [
      {
        label: 'Stuck videos',
        value: stuckCount,
        score: stuckScore,
        max: 35,
        anchor: 'pipeline-summary',
      },
      {
        label: 'Editor overload',
        value: overloaded,
        score: editorScore,
        max: 30,
        anchor: 'editor-capacity',
      },
      {
        label: 'QA failure rate',
        value: total === 0 ? '—' : `${(failRate * 100).toFixed(0)}%`,
        score: qaScore,
        max: 35,
        anchor: 'qa-queue',
      },
    ],
  };
}

// === System health (Caiden's bar) — out of 100 ===
// "Tailscale" cell measures time since last received webhook (the tunnel
// is the proxy — log labels and field names use "tailscale" per project
// convention even though the underlying transport may be ngrok today).
export function systemHealth({ inbox, summary }) {
  const now = Date.now();

  // Webhook inbox
  let webhookState = 'green';
  if (inbox?.failed > 0 && inbox?.latest_failed_at) {
    const failedAge = now - new Date(inbox.latest_failed_at).getTime();
    if (failedAge < HOUR) webhookState = 'red';
  }
  if (webhookState !== 'red' && inbox?.oldest_pending_received_at) {
    const pendingAge = now - new Date(inbox.oldest_pending_received_at).getTime();
    if (pendingAge > 60 * 1000) webhookState = 'amber';
  }

  // Cron jobs — green if all five scheduled jobs ran within their expected
  // window; amber if any missed by >2h; red if any missed by >24h.
  // The five we register: research (24h), performance (weekly + 2h grace),
  // scripting (15min + 2h grace), fireflies (24h), and the request handler
  // is itself event-driven so we don't include the webhook server here.
  const cronAges = [
    { name: 'research', last: summary?.last_research_run, expectedMs: 26 * HOUR },
    { name: 'performance', last: summary?.last_performance_run, expectedMs: 7 * DAY + 2 * HOUR },
    { name: 'scripting', last: summary?.last_scripting_run, expectedMs: 15 * 60 * 1000 + 2 * HOUR },
    { name: 'fireflies', last: summary?.last_fireflies_run, expectedMs: 26 * HOUR },
  ];
  let cronState = 'green';
  for (const job of cronAges) {
    if (!job.last) {
      cronState = cronState === 'red' ? 'red' : 'amber';
      continue;
    }
    const age = now - new Date(job.last).getTime();
    if (age > job.expectedMs + 22 * HOUR) cronState = 'red';
    else if (age > job.expectedMs + 2 * HOUR && cronState !== 'red') cronState = 'amber';
  }

  // FFmpeg — binary green/red. Green if last QA produced a LUFS measurement
  // OR the last server boot health check succeeded; red if the boot check
  // explicitly failed.
  let ffmpegState = 'green';
  if (summary?.ffmpeg_boot_check_status === 'error') ffmpegState = 'red';
  else if (!summary?.last_lufs_measurement && summary?.ffmpeg_boot_check_status !== 'success') {
    ffmpegState = 'red';
  }

  // Tailscale tunnel — proxied by time since last received webhook.
  let tailscaleState = 'red';
  if (summary?.last_webhook_received_at) {
    const age = now - new Date(summary.last_webhook_received_at).getTime();
    if (age < 24 * HOUR) tailscaleState = 'green';
    else if (age < 48 * HOUR) tailscaleState = 'amber';
  }

  // Recent errors
  const errors = Number(summary?.errors_last_hour ?? 0);
  let errorsState = 'green';
  if (errors >= 5) errorsState = 'red';
  else if (errors >= 1) errorsState = 'amber';

  const cells = [
    { id: 'webhook', label: 'Webhook inbox', state: webhookState, weight: 25 },
    { id: 'cron', label: 'Cron jobs', state: cronState, weight: 20 },
    { id: 'ffmpeg', label: 'FFmpeg', state: ffmpegState, weight: 25 },
    { id: 'tailscale', label: 'Tailscale', state: tailscaleState, weight: 15 },
    { id: 'errors', label: 'Recent errors', state: errorsState, weight: 15 },
  ];

  let score = 0;
  for (const c of cells) {
    if (c.state === 'green') score += c.weight;
    else if (c.state === 'amber') {
      // FFmpeg has no amber state — binary 25/0
      score += c.id === 'ffmpeg' ? 0 : Math.round(c.weight / 2);
    }
  }

  return { score, cells, errors };
}

export function healthColor(score) {
  if (score >= 90) return 'ok';
  if (score >= 60) return 'warn';
  return 'err';
}

export function healthHexFor(state) {
  switch (state) {
    case 'green':
    case 'ok':
      return '#10b981';
    case 'amber':
    case 'warn':
      return '#d97706';
    case 'red':
    case 'err':
      return '#dc2626';
    default:
      return '#6b7280';
  }
}

// Bucket logs into 24 hourly bins ending at `now` for sparkline rendering.
export function hourlyBuckets(logs, now = Date.now()) {
  const bins = new Array(24).fill(0);
  const start = now - 24 * HOUR;
  for (const log of logs || []) {
    const t = new Date(log.created_at).getTime();
    if (t < start || t > now) continue;
    const idx = Math.min(23, Math.floor((t - start) / HOUR));
    bins[idx] += 1;
  }
  return bins;
}

// Latest log with status='success' or 'error' for an agent.
export function summarizeAgent(name, logs, now = Date.now()) {
  const own = (logs || []).filter((l) => l.agent_name === name);
  const last = own[0] || null; // logs come back DESC

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayMs = startOfDay.getTime();
  const today = own.filter((l) => new Date(l.created_at).getTime() >= startOfDayMs);
  const successesToday = today.filter((l) => (l.status || 'success') === 'success').length;

  const errors24h = own.filter(
    (l) =>
      l.status === 'error' &&
      now - new Date(l.created_at).getTime() < 24 * HOUR,
  );

  let pillState = 'idle';
  if (last && last.status === 'error' && now - new Date(last.created_at).getTime() < HOUR) {
    pillState = 'error';
  }

  return {
    last,
    successesToday,
    errors24h,
    pillState,
    sparkline: hourlyBuckets(own, now),
    recentLogs: own.slice(0, 5),
  };
}

// Pipeline summary helper: counts per status with stuck-count overlay.
export function pipelineSummary(videos) {
  const out = STATUS_ORDER.map((status) => ({
    status,
    label: statusLabel(status),
    color: STATUS_COLORS[status],
    count: 0,
    stuck: 0,
  }));
  const byStatus = Object.fromEntries(out.map((o) => [o.status, o]));
  for (const v of videos || []) {
    const bucket = byStatus[v.status];
    if (!bucket) continue;
    bucket.count += 1;
    if (isStuck(v)) bucket.stuck += 1;
  }
  return out;
}
