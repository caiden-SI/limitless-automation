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
// QA check) is green by definition. We never invent failures from missing
// data.

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

  // 1. Stuck videos.
  // Headline always names the status in uppercase. Detail differs by
  // shape: single-status → oldest age (adds info); multi-status →
  // per-status breakdown (the only useful summary).
  const stuckVideos = videos.filter((v) => isStuck(v, now));
  if (stuckVideos.length > 0) {
    const byStatus = {};
    for (const v of stuckVideos) {
      byStatus[v.status] = (byStatus[v.status] || 0) + 1;
    }
    const statusList = Object.keys(byStatus);
    const word = stuckVideos.length === 1 ? 'video' : 'videos';
    let headline;
    let detail;
    if (statusList.length === 1) {
      const status = statusList[0];
      headline = `${stuckVideos.length} ${word} stuck in ${status}`;
      const oldestAgeMs = stuckVideos.reduce((max, v) => {
        const age = now - new Date(v.updated_at).getTime();
        return age > max ? age : max;
      }, 0);
      const oldestDays = Math.floor(oldestAgeMs / DAY);
      const oldestHours = Math.floor(oldestAgeMs / HOUR);
      detail = oldestDays >= 1
        ? `oldest stuck: ${oldestDays} day${oldestDays === 1 ? '' : 's'}`
        : `oldest stuck: ${oldestHours}h`;
    } else {
      headline = `${stuckVideos.length} ${word} stuck in pipeline`;
      detail = Object.entries(byStatus)
        .map(([s, n]) => `${s}: ${n}`)
        .join(' · ');
    }
    items.push({
      id: 'stuck',
      category: 'stuck',
      headline,
      detail: truncate(detail),
      anchor: '#pipeline-summary',
      urgency: 2,
    });
  }

  // 2. Editor overload — one item per overloaded editor.
  // Detail adds the over-by count; headline already states name + count.
  const editorCounts = {};
  for (const v of videos) {
    if (v.assignee_id && v.status === 'IN EDITING') {
      editorCounts[v.assignee_id] = (editorCounts[v.assignee_id] || 0) + 1;
    }
  }
  for (const ed of editors) {
    const n = editorCounts[ed.id] || 0;
    if (n >= 5) {
      const over = n - 5;
      items.push({
        id: `editor-overload:${ed.id}`,
        category: 'editor-overload',
        headline: `${ed.name} overloaded — ${n} active edits`,
        detail: truncate(`limit 5 · ${over} over capacity`),
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
    const top = topErrorAgent(logs, now);
    const detail = top
      ? `most: ${top.name} (${top.count} of total)`
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

  // 7. Tunnel down — health-ping verification failing.
  //    >= 3 consecutive ping failures in last 5 min (matches the pulse
  //    cell's red threshold).
  const tunnelFailures = Number(summary?.tunnel_recent_failures ?? 0);
  if (tunnelFailures >= 3) {
    items.push({
      id: 'tunnel-down',
      category: 'tunnel-down',
      headline: `Tunnel verification failing — ${tunnelFailures} consecutive ping failures`,
      detail: truncate(summary?.tunnel_last_error || 'no error captured', 120),
      anchor: '#system-health',
      urgency: 3,
    });
  }

  // 8. PM2 process(es) not online (most recent ping_pm2 status='error')
  if (summary?.pm2_status === 'error') {
    items.push({
      id: 'pm2-fail',
      category: 'pm2-fail',
      headline: 'PM2 process(es) not online',
      detail: truncate(summary?.pm2_detail || 'see Mac Mini PM2 status', 120),
      anchor: '#system-health',
      urgency: 3,
    });
  }

  // 9. FFmpeg not responding on Mac Mini
  if (summary?.ffmpeg_status === 'error') {
    items.push({
      id: 'ffmpeg-fail',
      category: 'ffmpeg-fail',
      headline: 'FFmpeg not responding on Mac Mini',
      detail: truncate(summary?.ffmpeg_detail || 'check ffmpeg install on Mac Mini', 120),
      anchor: '#system-health',
      urgency: 3,
    });
  }

  // 10. Mac Mini resources critical (disk OR memory at error level)
  if (summary?.disk_status === 'error' || summary?.memory_status === 'error') {
    const parts = [];
    if (summary?.disk_status === 'error') parts.push(summary?.disk_detail || 'disk critical');
    if (summary?.memory_status === 'error') parts.push(summary?.memory_detail || 'memory critical');
    items.push({
      id: 'resources-fail',
      category: 'resources-fail',
      headline: 'Mac Mini resources critical',
      detail: truncate(parts.join(', '), 120),
      anchor: '#system-health',
      urgency: 3,
    });
  }

  // 11. Output quality — QA error rate red (>= 2 in last 24h)
  const qaErrors24h = Number(summary?.qa_errors_24h ?? 0);
  if (qaErrors24h >= 2) {
    const recentQaErr = (logs || []).find(
      (l) => l.agent_name === 'qa' && l.status === 'error' && l.error_message,
    );
    const errMsg = recentQaErr?.error_message
      ? `${recentQaErr.error_message} · review at #qa-queue`
      : 'review at #qa-queue';
    items.push({
      id: 'output-quality',
      category: 'output-quality',
      headline: `${qaErrors24h} QA errors in last 24h`,
      detail: truncate(errMsg, 120),
      anchor: '#system-health',
      urgency: 2,
    });
  }

  // Sort by category priority — explicit list so infra items bubble to top
  // (tunnel before webhook-fail before pm2 before ffmpeg before resources
  // before cron-miss before error-spike), then output-layer items, then
  // workload items. Ties break on headline.
  items.sort((a, b) => {
    const ai = CATEGORY_PRIORITY.indexOf(a.category);
    const bi = CATEGORY_PRIORITY.indexOf(b.category);
    const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (aRank !== bRank) return aRank - bRank;
    return a.headline.localeCompare(b.headline);
  });

  return items;
}

// Action item ranking. Lower index = higher priority. Spec: tunnel before
// pm2 before ffmpeg before resources before output (infrastructure first).
// Existing pre-Phase-A categories slot in around them by impact.
const CATEGORY_PRIORITY = [
  'tunnel-down',     // network transport down
  'webhook-fail',    // application transport failing
  'pm2-fail',        // process manager broken
  'ffmpeg-fail',     // toolchain broken
  'resources-fail',  // hardware critical
  'cron-miss',       // scheduled work overdue
  'error-spike',     // application error volume
  'output-quality',  // QA failure rate
  'qa-fail',         // editor needs to re-review
  'stuck',           // pipeline backlog
  'editor-overload', // capacity warning
];

// Layer 2 — System Pulse.
// Eight binary cells, one per failure mode at one layer of the stack:
// network transport, application transport, scheduling, application errors,
// process manager, toolchain, hardware, output quality. Returns
// { count, cells: [{ id, label, pipLabel, state, detail }], errors }.
//
// Cells 2 (tunnel), 5 (pm2), 6 (ffmpeg), 7 (resources) are driven by the
// Mac Mini health-ping agent (scripts/health-ping.js → agent_logs). When
// the ping agent itself stops, those cells go amber (not green) — green
// requires an active recent success, never just absence of failure.
export function systemPulse({ logs = [], inbox = null, summary = null } = {}, now = Date.now()) {
  // 1. Webhook ingestion (application transport — the inbox table)
  let webhookState = 'green';
  let webhookDetail = 'no failed webhooks in last hour';
  const failedCount = Number(inbox?.failed ?? 0);
  if (inbox?.latest_failed_at) {
    const age = now - new Date(inbox.latest_failed_at).getTime();
    if (age < HOUR) {
      webhookState = 'red';
      webhookDetail = `${failedCount} failed in last hour — see action items`;
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

  // 2. Webhook tunnel (network transport — active outbound ping by
  //    health-ping agent, no longer time-based on inbound webhooks)
  const tunnelFailures = Number(summary?.tunnel_recent_failures ?? 0);
  const tunnelLastOk = summary?.last_tunnel_ping_ok
    ? new Date(summary.last_tunnel_ping_ok).getTime()
    : null;
  const tunnelLastErr = summary?.tunnel_last_error || null;
  let tunnelState = 'amber';
  let tunnelDetail;
  if (tunnelFailures >= 3) {
    tunnelState = 'red';
    tunnelDetail = `tunnel down · ${tunnelFailures} consecutive failures${tunnelLastErr ? ` · ${tunnelLastErr}` : ''}`;
  } else if (tunnelFailures >= 1) {
    tunnelState = 'amber';
    tunnelDetail = `${tunnelFailures} ping failure${tunnelFailures === 1 ? '' : 's'} in last 5 min`;
  } else if (tunnelLastOk && now - tunnelLastOk < 5 * 60 * 1000) {
    tunnelState = 'green';
    tunnelDetail = `tunnel verified · last ping ${timeAgo(summary.last_tunnel_ping_ok, now)}`;
  } else {
    tunnelState = 'amber';
    tunnelDetail = 'no recent pings — check ping agent';
  }

  // 3. Cron schedule (work scheduling — prevCronFire vs latest log)
  const cronEvals = CRON_AGENTS.map((a) => evaluateCron(a, summary, now));
  const cronState = worstState(cronEvals.map((c) => c.state));
  let cronDetail;
  if (cronState === 'green') {
    cronDetail = 'all crons on schedule';
  } else if (cronState === 'red') {
    const worst = cronEvals.find((c) => c.state === 'red');
    cronDetail = worst
      ? `${worst.agent} not fired in ${timeAgo(worst.prev, now)} — check scheduler`
      : 'cron overdue';
  } else {
    const worst = cronEvals.find((c) => c.state === 'amber');
    cronDetail = worst
      ? `${worst.agent} ${timeAgo(worst.prev, now)} overdue`
      : 'cron overdue';
  }

  // 4. Worker errors (application errors — agent_logs.status='error')
  const errors = Number(summary?.errors_last_hour ?? 0);
  let errorsState = 'green';
  if (errors >= 5) errorsState = 'red';
  else if (errors >= 1) errorsState = 'amber';
  let errorsDetail;
  if (errors === 0) {
    errorsDetail = 'no errors in last hour';
  } else if (errors < 5) {
    errorsDetail = `${errors} error${errors === 1 ? '' : 's'} in last hour`;
  } else {
    const top = topErrorAgent(logs, now);
    errorsDetail = top
      ? `${errors} errors in last hour — most: ${top.name}`
      : `${errors} errors in last hour`;
  }

  // 5. Process manager (OS processes — pm2 jlist via health-ping)
  const pm2Status = summary?.pm2_status || null;
  const pm2Detail = summary?.pm2_detail || null;
  let pm2State;
  let pm2DisplayDetail;
  if (pm2Status === 'success') {
    pm2State = 'green';
    pm2DisplayDetail = 'all PM2 processes online';
  } else if (pm2Status === 'error') {
    pm2State = 'red';
    pm2DisplayDetail = pm2Detail || 'PM2 process failure';
  } else {
    pm2State = 'amber';
    pm2DisplayDetail = 'no recent PM2 health ping';
  }

  // 6. FFmpeg (toolchain — ffmpeg -version via health-ping)
  const ffmpegStatus = summary?.ffmpeg_status || null;
  const ffmpegDetail = summary?.ffmpeg_detail || null;
  let ffmpegState;
  let ffmpegDisplayDetail;
  if (ffmpegStatus === 'success') {
    ffmpegState = 'green';
    ffmpegDisplayDetail = 'ffmpeg responding';
  } else if (ffmpegStatus === 'error') {
    ffmpegState = 'red';
    ffmpegDisplayDetail = ffmpegDetail || 'ffmpeg not responding';
  } else {
    ffmpegState = 'amber';
    ffmpegDisplayDetail = 'no recent ffmpeg health ping';
  }

  // 7. Server resources (hardware — disk + memory via health-ping).
  //    Aggregate worst of disk and memory; surface the offending component.
  const diskStatus = summary?.disk_status || null;
  const diskDetailRaw = summary?.disk_detail || null;
  const memoryStatus = summary?.memory_status || null;
  const memoryDetailRaw = summary?.memory_detail || null;
  const resourceParts = [
    { name: 'disk', status: diskStatus, detail: diskDetailRaw },
    { name: 'memory', status: memoryStatus, detail: memoryDetailRaw },
  ];
  const anyResourceMissing = resourceParts.some((p) => !p.status);
  const anyResourceError = resourceParts.find((p) => p.status === 'error');
  const anyResourceWarning = resourceParts.find((p) => p.status === 'warning');
  let resourcesState;
  let resourcesDisplayDetail;
  if (anyResourceError) {
    resourcesState = 'red';
    resourcesDisplayDetail = `${anyResourceError.name} critical · ${anyResourceError.detail || 'see logs'}`;
  } else if (anyResourceWarning) {
    resourcesState = 'amber';
    resourcesDisplayDetail = `${anyResourceWarning.name} elevated · ${anyResourceWarning.detail || 'see logs'}`;
  } else if (anyResourceMissing) {
    resourcesState = 'amber';
    resourcesDisplayDetail = 'no recent resource health ping';
  } else {
    resourcesState = 'green';
    resourcesDisplayDetail = 'disk + memory healthy';
  }

  // 8. Output quality (application output — QA error rate, gate principle).
  //    Gate: no EDITED video → no QA check has run → green by definition.
  const editedCount = Number(summary?.edited_video_count ?? 0);
  const qaErrors = Number(summary?.qa_errors_24h ?? 0);
  let outputState = 'green';
  let outputDetail;
  if (editedCount === 0) {
    outputDetail = 'no EDITED videos yet — gate not exercised';
  } else if (qaErrors === 0) {
    outputDetail = 'no QA failures in last 24h';
  } else if (qaErrors === 1) {
    outputState = 'amber';
    outputDetail = '1 QA error in last 24h';
  } else {
    outputState = 'red';
    outputDetail = `${qaErrors} QA errors in last 24h — see QA queue`;
  }

  // Cell order matches the spec's pulse-cell architecture table
  // (Phase A spec §"Pulse cell architecture after Phase A").
  // Per-cell pipLabel disambiguates the header's abbreviated pip strip;
  // OUT/PM2/FFMP/RES are explicit so abbrev() collisions can't happen.
  const cells = [
    { id: 'webhook',   label: 'Webhook ingestion', pipLabel: 'INGEST', state: webhookState,   detail: truncate(webhookDetail, 60) },
    { id: 'tunnel',    label: 'Webhook tunnel',    pipLabel: 'TUNNEL', state: tunnelState,    detail: truncate(tunnelDetail, 60) },
    { id: 'cron',      label: 'Cron schedule',     pipLabel: 'CRON',   state: cronState,      detail: truncate(cronDetail, 60) },
    { id: 'errors',    label: 'Worker errors',     pipLabel: 'ERRORS', state: errorsState,    detail: truncate(errorsDetail, 60) },
    { id: 'pm2',       label: 'Process manager',   pipLabel: 'PM2',    state: pm2State,       detail: truncate(pm2DisplayDetail, 60) },
    { id: 'ffmpeg',    label: 'FFmpeg',            pipLabel: 'FFMP',   state: ffmpegState,    detail: truncate(ffmpegDisplayDetail, 60) },
    { id: 'resources', label: 'Server resources',  pipLabel: 'RES',    state: resourcesState, detail: truncate(resourcesDisplayDetail, 60) },
    { id: 'output',    label: 'Output quality',    pipLabel: 'OUT',    state: outputState,    detail: truncate(outputDetail, 60) },
  ];
  const count = cells.filter((c) => c.state !== 'green').length;
  return { count, cells, errors };
}

// Find which agent contributed the most error logs in the last hour.
// Used by both the worker-errors pulse-cell red detail and the
// error-spike action item.
function topErrorAgent(logs, now = Date.now()) {
  const cutoff = now - HOUR;
  const counts = {};
  for (const l of logs || []) {
    if (l.status !== 'error') continue;
    if (new Date(l.created_at).getTime() < cutoff) continue;
    counts[l.agent_name] = (counts[l.agent_name] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? { name: top[0], count: top[1] } : null;
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
