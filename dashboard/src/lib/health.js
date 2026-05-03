// Pure helpers for derived dashboard state. No React, no Supabase here.

import { prevCronFire } from './agents';

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

// ============================================================================
// Operator-facing scoring (docs/dashboard-scoring-fix-spec.md)
// ============================================================================
//
// Three layers, separated to eliminate the false-positive class that the
// previous weighted-score system produced:
//
//   1. actionItems()  — concrete to-dos. Items only appear when there is
//                       something a human needs to do.
//   2. systemPulse()  — binary green/amber/red pulse cells. Only confirmed
//                       failures turn red.
//   3. integrations   — informational; rendered directly in the component
//                       (no helper here).
//
// A cron that hasn't been due yet during the system's lifetime is green by
// definition. A gate that hasn't been exercised (no `EDITED` videos → no
// LUFS check) is green by definition. We never invent failures from
// missing data.

const truncate = (s, max = 140) =>
  !s ? s : (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// Cron schedule list — same set the system_health RPC populates and the
// AGENTS metadata describes. Kept in sync manually; if a new cron is
// registered server-side, add it here.
const CRON_AGENTS = [
  { name: 'research',    cron: '0 6 * * *',   summaryKey: 'last_research_run' },
  { name: 'performance', cron: '0 7 * * 1',   summaryKey: 'last_performance_run' },
  { name: 'scripting',   cron: '*/15 * * * *', summaryKey: 'last_scripting_run' },
  { name: 'fireflies',   cron: '0 21 * * *',  summaryKey: 'last_fireflies_run' },
];

// Per-cron evaluation. Returns { agent, state, prev, last, detail }.
// Decision table comes verbatim from the spec.
function evaluateCron(agent, summary, now) {
  const prev = prevCronFire(agent.cron, new Date(now));
  if (!prev) {
    return { agent: agent.name, state: 'green', prev: null, last: null, detail: 'cron expression not recognized' };
  }
  const prevMs   = prev.getTime();
  const uptime   = summary?.system_uptime ? new Date(summary.system_uptime).getTime() : null;
  const lastRaw  = summary?.[agent.summaryKey];
  const lastMs   = lastRaw ? new Date(lastRaw).getTime() : null;

  // Cron has never been due during this system's lifetime.
  if (uptime != null && prevMs < uptime) {
    return { agent: agent.name, state: 'green', prev, last: lastRaw, detail: `${agent.name} not yet due since boot` };
  }
  // No prior log — can't conclude "broken" without a baseline.
  if (lastMs == null) {
    return { agent: agent.name, state: 'green', prev, last: null, detail: `${agent.name} hasn't logged any activity yet` };
  }
  // Ran on or after the most recent expected fire.
  if (lastMs >= prevMs) {
    return { agent: agent.name, state: 'green', prev, last: lastRaw, detail: `${agent.name} on schedule` };
  }
  // Last fire was before prev; how late are we?
  const lateMs = now - prevMs;
  if (lateMs <= 2 * HOUR) {
    return { agent: agent.name, state: 'green', prev, last: lastRaw, detail: `${agent.name} within 2h grace` };
  }
  if (lateMs <= 24 * HOUR) {
    return { agent: agent.name, state: 'amber', prev, last: lastRaw, detail: `${agent.name} ${timeAgo(prev, now)} overdue` };
  }
  return { agent: agent.name, state: 'red', prev, last: lastRaw, detail: `${agent.name} not fired in ${timeAgo(prev, now)}` };
}

function worstState(states) {
  if (states.includes('red')) return 'red';
  if (states.includes('amber')) return 'amber';
  return 'green';
}

// Layer 1 — Action Items.
// Concrete to-dos for the operator. Empty array when there's nothing to do.
export function actionItems({ videos = [], editors = [], logs = [], inbox = null, summary = null } = {}, now = Date.now()) {
  const items = [];

  // 1. Stuck videos
  const stuckVideos = videos.filter((v) => isStuck(v, now));
  if (stuckVideos.length > 0) {
    const byStatus = {};
    for (const v of stuckVideos) {
      byStatus[v.status] = (byStatus[v.status] || 0) + 1;
    }
    const statusList = Object.keys(byStatus);
    const headline = statusList.length === 1
      ? `${stuckVideos.length} stuck in ${statusLabel(statusList[0])}`
      : `${stuckVideos.length} stuck in pipeline`;
    const detail = Object.entries(byStatus)
      .map(([s, n]) => `${s}: ${n}`)
      .join(' · ');
    items.push({
      id: 'stuck',
      category: 'stuck',
      headline,
      detail: truncate(detail),
      anchor: '#pipeline-summary',
      urgency: 2,
    });
  }

  // 2. Editor overload — one item per overloaded editor
  const editorCounts = {};
  for (const v of videos) {
    if (v.assignee_id && v.status === 'IN EDITING') {
      editorCounts[v.assignee_id] = (editorCounts[v.assignee_id] || 0) + 1;
    }
  }
  for (const ed of editors) {
    const n = editorCounts[ed.id] || 0;
    if (n >= 5) {
      items.push({
        id: `editor-overload:${ed.id}`,
        category: 'editor-overload',
        headline: `${ed.name} overloaded — ${n} active edits`,
        detail: truncate(`${ed.name}: ${n} active edits.`),
        anchor: '#editor-capacity',
        urgency: 1,
      });
    }
  }

  // 3. QA failures within last 7 days
  const sevenDaysAgo = now - 7 * DAY;
  const qaFailed = videos.filter(
    (v) => v.qa_passed === false &&
      v.updated_at &&
      new Date(v.updated_at).getTime() >= sevenDaysAgo,
  );
  if (qaFailed.length > 0) {
    const editorById = Object.fromEntries(editors.map((e) => [e.id, e]));
    const byEditor = {};
    for (const v of qaFailed) {
      const ed = editorById[v.assignee_id];
      const name = ed?.name?.split(' ')[0] || 'unassigned';
      byEditor[name] = (byEditor[name] || 0) + 1;
    }
    const detail = Object.entries(byEditor)
      .map(([name, n]) => `${name}: ${n}`)
      .join(' · ');
    items.push({
      id: 'qa-fail',
      category: 'qa-fail',
      headline: `${qaFailed.length} QA failure${qaFailed.length === 1 ? '' : 's'} awaiting re-review`,
      detail: truncate(detail),
      anchor: '#qa-queue',
      urgency: 2,
    });
  }

  // 4. Webhook failures — only when failed_at within last hour
  if (inbox?.failed > 0 && inbox?.latest_failed_at) {
    const failedAge = now - new Date(inbox.latest_failed_at).getTime();
    if (failedAge < HOUR) {
      const errMsg = inbox.latest_failed_error_message || 'no error message captured';
      items.push({
        id: 'webhook-fail',
        category: 'webhook-fail',
        headline: `${inbox.failed} webhook${inbox.failed === 1 ? '' : 's'} failed in last hour`,
        detail: truncate(errMsg),
        anchor: '#system-health',
        urgency: 3,
      });
    }
  }

  // 5. Cron miss — one item per RED cron
  const cronEvals = CRON_AGENTS.map((a) => evaluateCron(a, summary, now));
  for (const cron of cronEvals) {
    if (cron.state === 'red') {
      const cutoff = now - 24 * HOUR;
      const recentErr = (logs || []).find(
        (l) =>
          l.agent_name === cron.agent &&
          l.status === 'error' &&
          new Date(l.created_at).getTime() >= cutoff &&
          l.error_message,
      );
      const detail = recentErr?.error_message
        ? recentErr.error_message
        : cron.last
          ? `${cron.agent} hasn't logged anything since ${timeAgo(cron.last, now)}`
          : `${cron.agent} hasn't logged any activity yet`;
      const prevStr = cron.prev ? cron.prev.toLocaleString() : 'unknown';
      items.push({
        id: `cron-miss:${cron.agent}`,
        category: 'cron-miss',
        headline: `${cron.agent} cron has not fired since ${prevStr}`,
        detail: truncate(detail),
        anchor: '#system-health',
        urgency: 3,
      });
    }
  }

  // 6. Error spike — 5+ agent errors in last hour
  const errorsLastHour = Number(summary?.errors_last_hour ?? 0);
  if (errorsLastHour >= 5) {
    const cutoff = now - HOUR;
    const recentErrors = (logs || []).filter(
      (l) => l.status === 'error' && new Date(l.created_at).getTime() >= cutoff,
    );
    const counts = {};
    for (const l of recentErrors) {
      counts[l.agent_name] = (counts[l.agent_name] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const detail = top
      ? `most: ${top[0]} (${top[1]} of total)`
      : `${errorsLastHour} errors recorded`;
    items.push({
      id: 'error-spike',
      category: 'error-spike',
      headline: `${errorsLastHour} agent errors in last hour`,
      detail: truncate(detail),
      anchor: '#system-health',
      urgency: 3,
    });
  }

  // Sort: urgency desc, then category, then headline
  items.sort((a, b) => {
    if (a.urgency !== b.urgency) return b.urgency - a.urgency;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.headline.localeCompare(b.headline);
  });

  return items;
}

// Layer 2 — System Pulse.
// Binary cells. Returns { count, cells: [{ id, label, state, detail }] }
// where count is the number of non-green cells.
export function systemPulse({ logs = [], inbox = null, summary = null } = {}, now = Date.now()) {
  // Webhook ingestion
  let webhookState = 'green';
  let webhookDetail = 'no failed webhooks in last hour';
  if (inbox?.latest_failed_at) {
    const age = now - new Date(inbox.latest_failed_at).getTime();
    if (age < HOUR) {
      webhookState = 'red';
      webhookDetail = `${inbox.failed} failed in last hour`;
    }
  }
  if (webhookState !== 'red' && inbox?.oldest_pending_received_at) {
    const pendingAge = now - new Date(inbox.oldest_pending_received_at).getTime();
    if (pendingAge > 5 * 60 * 1000) {
      webhookState = 'red';
      webhookDetail = `oldest pending ${timeAgo(inbox.oldest_pending_received_at, now)}`;
    } else if (pendingAge > 60 * 1000) {
      webhookState = 'amber';
      webhookDetail = `oldest pending ${timeAgo(inbox.oldest_pending_received_at, now)}`;
    }
  }

  // Cron schedule — aggregate worst across all crons
  const cronEvals = CRON_AGENTS.map((a) => evaluateCron(a, summary, now));
  const cronState = worstState(cronEvals.map((c) => c.state));
  let cronDetail;
  if (cronState === 'green') {
    cronDetail = 'all crons on schedule';
  } else {
    const worst = cronEvals.find((c) => c.state === cronState);
    cronDetail = worst?.detail || `${cronState} cron condition`;
  }

  // Worker errors
  const errors = Number(summary?.errors_last_hour ?? 0);
  let errorsState = 'green';
  if (errors >= 5) errorsState = 'red';
  else if (errors >= 1) errorsState = 'amber';
  const errorsDetail = errors === 0
    ? 'no errors in last hour'
    : `${errors} error${errors === 1 ? '' : 's'} in last hour`;

  // Webhook tunnel — last received timestamp
  let tunnelState = 'red';
  let tunnelDetail = 'no webhook received yet';
  if (summary?.last_webhook_received_at) {
    const age = now - new Date(summary.last_webhook_received_at).getTime();
    if (age < 24 * HOUR) {
      tunnelState = 'green';
      tunnelDetail = `last webhook ${timeAgo(summary.last_webhook_received_at, now)}`;
    } else if (age < 48 * HOUR) {
      tunnelState = 'amber';
      tunnelDetail = `last webhook ${timeAgo(summary.last_webhook_received_at, now)}`;
    } else {
      tunnelState = 'red';
      tunnelDetail = `no webhook in ${timeAgo(summary.last_webhook_received_at, now)}`;
    }
  }

  // Audio normalization — gate principle
  const editedCount = Number(summary?.edited_video_count ?? 0);
  const lufsErrors = Number(summary?.lufs_errors_24h ?? 0);
  let audioState = 'green';
  let audioDetail;
  if (editedCount === 0) {
    audioDetail = 'no EDITED videos yet — gate not exercised';
  } else if (lufsErrors === 0) {
    audioDetail = 'no LUFS failures';
  } else if (lufsErrors === 1) {
    audioState = 'amber';
    audioDetail = '1 LUFS error in last 24h';
  } else {
    audioState = 'red';
    audioDetail = `${lufsErrors} LUFS errors in last 24h`;
  }

  const cells = [
    { id: 'webhook', label: 'Webhook ingestion', state: webhookState, detail: truncate(webhookDetail, 60) },
    { id: 'cron',    label: 'Cron schedule',     state: cronState,    detail: truncate(cronDetail, 60) },
    { id: 'errors',  label: 'Worker errors',     state: errorsState,  detail: truncate(errorsDetail, 60) },
    { id: 'tunnel',  label: 'Webhook tunnel',    state: tunnelState,  detail: truncate(tunnelDetail, 60) },
    { id: 'audio',   label: 'Audio normalization', state: audioState, detail: truncate(audioDetail, 60) },
  ];
  const count = cells.filter((c) => c.state !== 'green').length;
  return { count, cells, errors };
}

// ============================================================================

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
