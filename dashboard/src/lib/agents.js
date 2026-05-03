// Static metadata for the seven AI agents. Headline order = order in which
// the cards are rendered. Trigger and schedule strings are display-only;
// they're sourced from server.js cron registrations and the architecture doc.

export const AGENTS = [
  {
    name: 'pipeline',
    label: 'Pipeline',
    description: 'Routes ClickUp status changes',
    trigger: 'event',
    triggerLabel: 'On ClickUp webhook',
    cron: null,
    color: '#3b82f6',
  },
  {
    name: 'qa',
    label: 'QA',
    description: 'Quality gate · spelling, captions, audio, fillers',
    trigger: 'event',
    triggerLabel: 'On EDITED status',
    cron: null,
    color: '#06b6d4',
  },
  {
    name: 'research',
    label: 'Research',
    description: 'Scrapes TikTok / Instagram for trending hooks',
    trigger: 'cron',
    triggerLabel: 'Daily 6:00 AM',
    cron: '0 6 * * *',
    color: '#8b5cf6',
  },
  {
    name: 'performance',
    label: 'Performance',
    description: 'Weekly Claude pattern recognition',
    trigger: 'cron',
    triggerLabel: 'Mon 7:00 AM',
    cron: '0 7 * * 1',
    color: '#f59e0b',
  },
  {
    name: 'scripting',
    label: 'Scripting',
    description: '3 concept scripts per filming event',
    trigger: 'cron',
    triggerLabel: 'Every 15 min',
    cron: '*/15 * * * *',
    color: '#10b981',
  },
  {
    name: 'onboarding',
    label: 'Onboarding',
    description: 'Conversational student intake',
    trigger: 'event',
    triggerLabel: 'On /onboard URL open',
    cron: null,
    color: '#ec4899',
  },
  {
    name: 'fireflies',
    label: 'Fireflies',
    description: 'Meeting transcripts → Supabase + ClickUp',
    trigger: 'cron',
    triggerLabel: 'Nightly 9:00 PM',
    cron: '0 21 * * *',
    color: '#a855f7',
  },
];

export const AGENT_BY_NAME = Object.fromEntries(AGENTS.map((a) => [a.name, a]));

// External integrations the system depends on. The "key" is the agent_name or
// log substring used to find recent activity in agent_logs.
export const INTEGRATIONS = [
  { name: 'ClickUp', key: 'clickup', category: 'pipeline' },
  { name: 'Dropbox', key: 'dropbox', category: 'pipeline' },
  { name: 'Frame.io', key: 'frame', category: 'pipeline' },
  { name: 'Fireflies', key: 'fireflies', category: 'meetings' },
  { name: 'Google Calendar', key: 'calendar', category: 'scheduling' },
  { name: 'Supabase', key: 'supabase', category: 'core' },
  { name: 'Anthropic', key: 'claude', category: 'core' },
];

// Compute the most recent moment a cron should have fired (largest cron-tick
// boundary ≤ now). Returns a Date or null. Mirrors nextCronFire — together
// they let the dashboard answer "did the cron fire on schedule?" without
// pulling in cron-parser.
export function prevCronFire(cron, now = new Date()) {
  if (!cron) return null;
  switch (cron) {
    case '0 6 * * *': {
      const target = new Date(now);
      target.setHours(6, 0, 0, 0);
      if (target > now) target.setDate(target.getDate() - 1);
      return target;
    }
    case '0 7 * * 1': {
      const target = new Date(now);
      target.setHours(7, 0, 0, 0);
      const dow = target.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      const daysSinceMon = (dow + 6) % 7;
      target.setDate(target.getDate() - daysSinceMon);
      if (target > now) target.setDate(target.getDate() - 7);
      return target;
    }
    case '0 21 * * *': {
      const target = new Date(now);
      target.setHours(21, 0, 0, 0);
      if (target > now) target.setDate(target.getDate() - 1);
      return target;
    }
    case '*/15 * * * *': {
      const target = new Date(now);
      const prevMinute = Math.floor(target.getMinutes() / 15) * 15;
      target.setMinutes(prevMinute, 0, 0);
      return target;
    }
    default:
      return null;
  }
}

// Compute the next firing of a tiny subset of cron expressions we actually
// register. Returns a Date or null. Keeps us from pulling in cron-parser.
export function nextCronFire(cron, now = new Date()) {
  if (!cron) return null;
  const next = new Date(now);
  next.setSeconds(0, 0);
  switch (cron) {
    case '0 6 * * *': {
      next.setHours(6, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }
    case '0 7 * * 1': {
      const target = new Date(now);
      target.setHours(7, 0, 0, 0);
      const dow = target.getDay();
      const daysUntilMon = (1 - dow + 7) % 7;
      target.setDate(target.getDate() + daysUntilMon);
      if (target <= now) target.setDate(target.getDate() + 7);
      return target;
    }
    case '0 21 * * *': {
      next.setHours(21, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }
    case '*/15 * * * *': {
      const minutes = now.getMinutes();
      const nextMinute = Math.ceil((minutes + 1) / 15) * 15;
      const target = new Date(now);
      target.setSeconds(0, 0);
      if (nextMinute >= 60) {
        target.setHours(target.getHours() + 1);
        target.setMinutes(nextMinute - 60);
      } else {
        target.setMinutes(nextMinute);
      }
      return target;
    }
    default:
      return null;
  }
}
