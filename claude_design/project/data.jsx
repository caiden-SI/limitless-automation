// Seed data for the 9 AM scenario:
// - 47 videos across all 11 statuses (weighted)
// - 2 editors: Charles Williams (5 active = OVERLOADED), Tipra (3 active)
// - 12 agent activity rows incl. 1 QA error and 1 webhook error
// - 1 perf signal for last week
// - System health: webhook RED, recent errors AMBER, others GREEN

const STATUS_ORDER = [
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

const STUCK_THRESHOLDS_HRS = {
  'IDEA': 7 * 24,
  'READY FOR SHOOTING': 5 * 24,
  'READY FOR EDITING': 3 * 24,
  'IN EDITING': 4 * 24,
  'EDITED': 24,
  'WAITING': 24,
  // all others 7 days
};
const stuckThreshold = (s) => STUCK_THRESHOLDS_HRS[s] ?? 7 * 24;

// 9 AM "now" anchor — every relative time is computed against this so a
// reload doesn't shift the scenario.
const NOW = new Date('2026-05-01T14:03:00Z'); // 9:03 AM CT
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

const EDITORS = [
  { id: 'ed-1', name: 'Charles Williams', active: true },
  { id: 'ed-2', name: 'Tipra', active: true },
];

// Generate 47 videos. Weights from brief.
const titles = {
  IDEA: ['Cold approach in Whole Foods', 'Why she ghosted you', 'Texting after the date', 'First-date energy reset', 'Stop chasing — start magnetic', 'How to read mixed signals', 'The 3-minute coffee close', 'Approach anxiety hack'],
  'READY FOR SHOOTING': ['B-roll: Domain rooftop', 'Voiceover: "you don\'t need closure"', 'Skit — bartender wingman', 'Direct address — pickup myths', 'Walking POV — South Congress', 'Studio interview — Erika'],
  'READY FOR EDITING': ['Hook test 04 — sunset', 'Long-form 12 — vulnerability', 'Reaction — DM screenshot', 'Pattern interrupt cold open'],
  'IN EDITING': ['Storytime — the Friday she canceled', 'Cold approach montage v2', 'Walk & talk — abundance mindset', 'Reframe: rejection isn\'t personal', 'Stitch — comment reply', 'Q&A — long distance', '"Texts that work" — split-screen'],
  EDITED: ['Hook variants reel', 'Sunday recap — June 14', '90sec — date frame'],
  'UPLOADED TO DROPBOX': ['Raw call — Mason coaching', 'Bts — studio Wed', 'Ad cutdown — webinar v3', 'Ad cutdown — webinar v4', 'Trailer — bootcamp launch'],
  'SENT TO CLIENT': ['Mason — 60sec ad', 'Erika — long-form testimonial', 'Trent — testimonial cut', 'Bootcamp launch — teaser'],
  REVISED: ['Mason — round 2 notes', 'Cold approach — captions fix'],
  'POSTED BY CLIENT': ['Erika — IG reel', 'Mason — TikTok', 'Trent — YouTube short', 'Bootcamp — IG carousel cover', 'Mason — IG story set'],
  DONE: ['Q1 sizzle reel', 'Welcome video — site embed'],
  WAITING: ['Mason — pending source files'],
};

// Status → ages (hours). Designed so SOME rows are stuck and some are fresh.
const ageBuckets = {
  IDEA: [240, 14, 2, 50, 100, 220, 6, 30],          // first one stuck (>168h)
  'READY FOR SHOOTING': [140, 30, 8, 80, 200, 4],   // last one fresh, [4]=200h stuck (>120h)
  'READY FOR EDITING': [80, 20, 6, 100],            // [3]=100h stuck (>72h)
  'IN EDITING': [110, 18, 50, 120, 8, 30, 70],      // [0]=110, [3]=120h stuck (>96h)
  EDITED: [40, 12, 6],                              // [0] stuck (>24h)
  'UPLOADED TO DROPBOX': [50, 30, 12, 8, 200],
  'SENT TO CLIENT': [60, 24, 12, 6],
  REVISED: [30, 8],
  'POSTED BY CLIENT': [80, 50, 20, 8, 4],
  DONE: [200, 100],
  WAITING: [50],                                    // [0] stuck (>24h)
};

const editorAssign = {
  'IN EDITING': ['ed-1', 'ed-1', 'ed-1', 'ed-1', 'ed-1', 'ed-2', 'ed-2'], // Charles 5, Tipra 2
  EDITED: [null, 'ed-2', 'ed-1'],                                          // Tipra +1
  WAITING: ['ed-1'],
};

const studentNames = ['Mason R.', 'Erika P.', 'Trent K.', 'Devon S.', 'Hailey W.', 'Marco V.', 'Ava L.', 'Jordan T.', 'Cole F.', null, null];

const VIDEOS = [];
let vid = 0;
for (const s of STATUS_ORDER) {
  const ts = titles[s] || [];
  const ages = ageBuckets[s] || [];
  for (let i = 0; i < ts.length; i++) {
    vid++;
    const status = s;
    const ageH = ages[i] ?? 24;
    const isStuck = ageH > stuckThreshold(status);
    let qa_passed = null;
    if (status === 'EDITED' && i === 0) qa_passed = null;        // awaiting QA
    if (status === 'EDITED' && i === 1) qa_passed = false;       // failed
    if (status === 'WAITING') qa_passed = false;                 // failed → waiting
    if (['UPLOADED TO DROPBOX', 'SENT TO CLIENT', 'REVISED', 'POSTED BY CLIENT', 'DONE'].includes(status)) qa_passed = true;
    VIDEOS.push({
      id: `v-${vid}`,
      title: ts[i],
      status,
      qa_passed,
      student_name: studentNames[(vid * 3) % studentNames.length],
      assignee_id: (editorAssign[status] || [])[i] ?? null,
      updated_at: hoursAgo(ageH),
      stuck_hours: isStuck ? Math.round(ageH) : 0,
      stuck_days: isStuck ? Math.max(1, Math.round(ageH / 24)) : 0,
    });
  }
}

const AGENT_LOGS = [
  { id: 'l-1',  agent_name: 'webhook',     action: 'inbox event failed: clickup.task.updated — 502 from upstream', status: 'error',   error_message: '502 Bad Gateway from clickup.com — retry 3/3 exhausted', retry_count: 3, created_at: hoursAgo(0.6) },
  { id: 'l-2',  agent_name: 'qa',          action: 'QA failed for "Sunday recap — June 14"',                       status: 'error',   error_message: 'LUFS -17.2 (target -14 ±1) · stutter at 00:42', retry_count: 0, created_at: hoursAgo(0.9) },
  { id: 'l-3',  agent_name: 'pipeline',    action: 'moved "Hook variants reel" → EDITED',                          status: 'success', error_message: null, retry_count: 0, created_at: hoursAgo(1.1) },
  { id: 'l-4',  agent_name: 'fireflies',   action: 'transcribed meeting — "Mason 1:1 — sales rhythm"',             status: 'success', error_message: null, retry_count: 0, created_at: hoursAgo(1.4) },
  { id: 'l-5',  agent_name: 'qa',          action: 'QA passed for "Trent — testimonial cut"',                      status: 'success', error_message: null, retry_count: 0, created_at: hoursAgo(2.0) },
  { id: 'l-6',  agent_name: 'scheduler',   action: 'scheduled 6 posts to ClickUp',                                  status: 'success', error_message: null, retry_count: 0, created_at: hoursAgo(2.7) },
  { id: 'l-7',  agent_name: 'research',    action: 'pulled 12 trending hooks (TikTok)',                             status: 'success', error_message: null, retry_count: 0, created_at: hoursAgo(3.3) },
  { id: 'l-8',  agent_name: 'pipeline',    action: 'created idea card from Fireflies action item',                 status: 'success', error_message: null, retry_count: 0, created_at: hoursAgo(4.1) },
  { id: 'l-9',  agent_name: 'scripting',   action: 'generated 3 hook variants for "abundance mindset"',            status: 'success', error_message: null, retry_count: 0, created_at: hoursAgo(5.4) },
  { id: 'l-10', agent_name: 'qa',          action: 'flagged audio drift on "Storytime — the Friday she canceled"', status: 'warning', error_message: 'audio drift > 80ms after 2:00', retry_count: 0, created_at: hoursAgo(6.6) },
  { id: 'l-11', agent_name: 'onboarding',  action: 'new student record — Hailey W.',                                status: 'success', error_message: null, retry_count: 0, created_at: hoursAgo(8.2) },
  { id: 'l-12', agent_name: 'performance', action: 'compiled weekly signal report — week of Apr 27',                status: 'success', error_message: null, retry_count: 0, created_at: hoursAgo(11.0) },
];

const PERF_SIGNAL = {
  id: 'p-1',
  week_of: '2026-04-27',
  summary: 'Storytime hooks led the week (avg 184K views) with vulnerability framing carrying long-form. Direct address opens lost ground vs. last week — pattern interrupt cold opens are pulling 2.3× more retention.',
  top_hooks: [
    { type: 'Storytime — "the night she..."', avg_views: 184000 },
    { type: 'Pattern interrupt — cold open', avg_views: 142000 },
    { type: 'POV walk-and-talk', avg_views: 96000 },
  ],
  top_formats: [
    { type: 'Long-form (60–90s)', avg_views: 121000 },
    { type: 'Stitch / reaction', avg_views: 88000 },
    { type: 'Split-screen text', avg_views: 64000 },
  ],
  top_topics: [
    { topic: 'reading mixed signals', avg_views: 156000 },
    { topic: 'abundance mindset', avg_views: 98000 },
    { topic: 'cold approach in public', avg_views: 71000 },
  ],
  raw_output: {
    recommendations: [
      'Lean into pattern-interrupt cold opens — 2.3× retention vs. direct address.',
      'Reuse the "mixed signals" topic across 3 more storytime variants this week.',
      'Pair POV walk-and-talks with abundance-mindset framing — strong overlap.',
    ],
    underperforming_patterns: [
      'Direct address openers slipped 28% — avoid until next test cycle.',
      'Studio interview cuts under 30s lost retention vs. long-form (-41%).',
    ],
  },
};

// System health — 9 AM scenario: webhook RED (failed event 38min ago),
// recent errors AMBER (2 errors in last hour), rest GREEN.
const SYSTEM_HEALTH = {
  cells: [
    { id: 'webhook', label: 'Webhook inbox',  state: 'red',   detail: '1 failed event 38m ago · clickup.task.updated · retry 3/3' },
    { id: 'errors',  label: 'Recent errors',  state: 'amber', detail: '2 errors in last hour (qa, webhook)' },
    { id: 'cron',    label: 'Cron jobs',      state: 'green', detail: 'all 5 ran on time · last: scheduler 02:00' },
    { id: 'ffmpeg',  label: 'FFmpeg',         state: 'green', detail: 'last QA produced LUFS measurement 0.9h ago' },
    { id: 'tailscale', label: 'Tailscale',     state: 'green', detail: 'last webhook 0.6h ago' },
  ],
  // System Health bar: weights from brief
  // FFmpeg 25 (green=25) + Webhook 0 (red) + Cron 20 (green) + Errors 7 (amber) + Tailscale 15 (green) = 67
  systemScore: 67,
  systemBreakdown: [
    { label: 'FFmpeg',        score: 25, max: 25, state: 'green' },
    { label: 'Webhook inbox', score: 0,  max: 25, state: 'red' },
    { label: 'Cron jobs',     score: 20, max: 20, state: 'green' },
    { label: 'Recent errors', score: 7,  max: 15, state: 'amber' },
    { label: 'Tailscale',     score: 15, max: 15, state: 'green' },
  ],
};

// Stuck count — videos with stuck_hours > 0
const STUCK_COUNT = VIDEOS.filter((v) => v.stuck_days > 0).length;
// Editors over threshold
const editorActiveCount = (id) => VIDEOS.filter((v) => v.assignee_id === id && v.status === 'IN EDITING').length;
const overloadedEditors = EDITORS.filter((e) => editorActiveCount(e.id) >= 5).length;
// QA fail rate (last 7 days) — assume 22% for the scenario
const QA_FAIL_RATE = 0.22;

// Operational Health (Scott's bar):
//  - stuck videos: STUCK_COUNT (we'll see ~5 stuck) → 12/35 (3-5)
//  - editor overload: 1 editor (Charles) ≥5 → 15/30
//  - QA fail rate 22% (10–25%) → 17/35
//  → 44/100
const OP_BREAKDOWN = [
  { label: 'Stuck videos',  score: STUCK_COUNT >= 6 ? 0 : STUCK_COUNT >= 3 ? 12 : STUCK_COUNT >= 1 ? 23 : 35, max: 35, state: STUCK_COUNT >= 6 ? 'red' : STUCK_COUNT >= 3 ? 'amber' : 'green', detail: `${STUCK_COUNT} videos past their stuck threshold` },
  { label: 'Editor overload', score: overloadedEditors === 0 ? 30 : overloadedEditors === 1 ? 15 : 0, max: 30, state: overloadedEditors === 0 ? 'green' : overloadedEditors === 1 ? 'amber' : 'red', detail: `${overloadedEditors} editor at or above 5 active` },
  { label: 'QA failure rate', score: QA_FAIL_RATE < 0.10 ? 35 : QA_FAIL_RATE <= 0.25 ? 17 : 0, max: 35, state: QA_FAIL_RATE < 0.10 ? 'green' : QA_FAIL_RATE <= 0.25 ? 'amber' : 'red', detail: `${Math.round(QA_FAIL_RATE * 100)}% over the last 7 days` },
];
const OP_SCORE = OP_BREAKDOWN.reduce((s, b) => s + b.score, 0);

window.LIMITLESS_DATA = {
  STATUS_ORDER,
  STUCK_THRESHOLDS_HRS,
  stuckThreshold,
  NOW,
  EDITORS,
  VIDEOS,
  AGENT_LOGS,
  PERF_SIGNAL,
  SYSTEM_HEALTH,
  OP_BREAKDOWN,
  OP_SCORE,
  STUCK_COUNT,
  QA_FAIL_RATE,
  hoursAgo,
  daysAgo,
};

// Worst-case + calm variants (deterministic transformations of the seed).
const WORST_VIDEOS = VIDEOS.map((v, i) => ({
  ...v,
  stuck_days: i % 3 === 0 ? Math.max(v.stuck_days, 4) : v.stuck_days,
  qa_passed: v.status === 'EDITED' && i % 2 === 0 ? false : v.qa_passed,
}));
const WORST_LOGS = [
  { id: 'w-1', agent_name: 'webhook',  action: 'inbox event failed: stripe.charge.failed — timeout',          status: 'error', error_message: 'upstream timeout 30s', retry_count: 3, created_at: hoursAgo(0.05) },
  { id: 'w-2', agent_name: 'qa',       action: 'QA failed for "Hook test 04 — sunset"',                       status: 'error', error_message: 'LUFS -19.0 · clipping 00:18, 01:04', retry_count: 0, created_at: hoursAgo(0.1) },
  { id: 'w-3', agent_name: 'qa',       action: 'QA failed for "Long-form 12 — vulnerability"',                status: 'error', error_message: 'sample-rate mismatch 44.1k vs 48k', retry_count: 0, created_at: hoursAgo(0.2) },
  { id: 'w-4', agent_name: 'pipeline', action: 'crashed processing ClickUp webhook payload',                  status: 'error', error_message: 'TypeError: cannot read properties of undefined (reading "status")', retry_count: 1, created_at: hoursAgo(0.4) },
  { id: 'w-5', agent_name: 'webhook',  action: 'inbox event failed: clickup.task.updated — 502',              status: 'error', error_message: '502 Bad Gateway', retry_count: 3, created_at: hoursAgo(0.6) },
  { id: 'w-6', agent_name: 'scheduler',action: 'cron run skipped: scheduler.weekly missed window',            status: 'error', error_message: 'previous run still in progress', retry_count: 0, created_at: hoursAgo(0.8) },
  ...AGENT_LOGS.slice(2),
];
const WORST_HEALTH = {
  cells: [
    { id: 'webhook', label: 'Webhook inbox', state: 'red',   detail: '4 failed events in last hour' },
    { id: 'errors',  label: 'Recent errors', state: 'red',   detail: '6 errors in last hour' },
    { id: 'cron',    label: 'Cron jobs',     state: 'red',   detail: 'scheduler.weekly missed by 3h' },
    { id: 'ffmpeg',  label: 'FFmpeg',        state: 'green', detail: 'last QA produced LUFS' },
    { id: 'tailscale', label: 'Tailscale',    state: 'amber', detail: 'last webhook 31h ago' },
  ],
  systemScore: 25,
  systemBreakdown: [
    { label: 'FFmpeg',        score: 25, max: 25, state: 'green' },
    { label: 'Webhook inbox', score: 0,  max: 25, state: 'red' },
    { label: 'Cron jobs',     score: 0,  max: 20, state: 'red' },
    { label: 'Recent errors', score: 0,  max: 15, state: 'red' },
    { label: 'Tailscale',     score: 7,  max: 15, state: 'amber' },
  ],
};
const WORST_OP = [
  { label: 'Stuck videos',    score: 0,  max: 35, state: 'red',   detail: '11 videos past their stuck threshold' },
  { label: 'Editor overload', score: 0,  max: 30, state: 'red',   detail: '2 editors at or above 5 active' },
  { label: 'QA failure rate', score: 0,  max: 35, state: 'red',   detail: '34% over the last 7 days' },
];

const CALM_LOGS = AGENT_LOGS.slice(2).map((l) => ({ ...l, status: 'success', error_message: null }));
const CALM_HEALTH = {
  cells: SYSTEM_HEALTH.cells.map((c) => ({ ...c, state: 'green', detail: c.detail.replace(/red|amber/i, 'green') })),
  systemScore: 100,
  systemBreakdown: SYSTEM_HEALTH.systemBreakdown.map((b) => ({ ...b, score: b.max, state: 'green' })),
};
const CALM_OP = OP_BREAKDOWN.map((b) => ({ ...b, score: b.max, state: 'green' }));
const CALM_VIDEOS = VIDEOS.map((v) => ({ ...v, stuck_days: 0, stuck_hours: 0, qa_passed: v.qa_passed === false ? null : v.qa_passed }));

window.LIMITLESS_SCENARIOS = {
  busy: {
    label: '9 AM scenario',
    videos: VIDEOS, logs: AGENT_LOGS, health: SYSTEM_HEALTH, op: OP_BREAKDOWN, opScore: OP_SCORE, sysScore: SYSTEM_HEALTH.systemScore,
  },
  worst: {
    label: 'Worst case',
    videos: WORST_VIDEOS, logs: WORST_LOGS, health: WORST_HEALTH, op: WORST_OP, opScore: 0, sysScore: WORST_HEALTH.systemScore,
  },
  calm: {
    label: 'Calm / healthy',
    videos: CALM_VIDEOS, logs: CALM_LOGS, health: CALM_HEALTH, op: CALM_OP, opScore: 100, sysScore: 100,
  },
};
