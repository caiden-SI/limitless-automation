// Dashboard agent metadata.
//
// AGENT_REGISTRY is the source of truth for the AGENTS panel rebuild
// (dashboard-agents-rebuild-spec.md). Each entry carries: cadence
// description, sparkline window/bars, dot health thresholds, the
// human description shown on hover, a headlineMetric() that derives
// the bold operational counter from agent_logs rows, and an
// actionProse map (+ optional parseAction) used by the activity
// feed and future row-detail surfaces.
//
// 9 cards from 8 distinct agent_name values: footage-scan is a
// logical slice of pipeline rows, separated by actionFilter.
//
// AGENTS / AGENT_BY_NAME are derived from the registry for
// back-compat with LiveEventStream.jsx (filter dropdown) and
// AgentGrid.jsx (current renderer; replaced in a later turn).
// INTEGRATIONS, prevCronFire, nextCronFire are unchanged.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Local time start-of-today. Most headline metrics filter rows to
// today; centralizing this keeps the boundary consistent and makes
// timezone behavior explicit.
function startOfTodayLocal(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Lightweight relative-time formatter, duplicated from health.js to
// avoid a circular import (health.js imports prevCronFire from here).
function relTimeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const diff = now - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / SECOND);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / MINUTE);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / HOUR);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / DAY);
  return `${days}d ago`;
}

// =============================================================
// AGENT_REGISTRY — 9 cards, ordered for the 3×3 grid:
//   row 1: pipeline       footage-scan    qa
//   row 2: research       performance     scripting
//   row 3: onboarding     fireflies       profile-views
// =============================================================

export const AGENT_REGISTRY = {
  pipeline: {
    name: 'pipeline',
    sourceAgent: 'pipeline',
    // Excludes the footage-scan slice. dropbox_scan_complete is the
    // 15-min footage-scan tick marker (so it belongs to footage-scan,
    // not pipeline); dropbox_webhook_received is real-time inbound
    // pipeline traffic and stays here.
    actionFilter: (a) =>
      !a.startsWith('footage_') &&
      a !== 'dropbox_list_folder_error' &&
      a !== 'dropbox_scan_complete',
    cadenceLabel: 'webhook · live',
    cadenceType: 'event',
    cronExpression: null,
    sparklineWindowMs: 7 * DAY,
    sparklineBars: 7,
    greenWithinMs: 24 * HOUR,
    redAfterMs: null, // event-driven: never red on idleness alone
    description:
      'Routes ClickUp status changes through 11 production stages — creates Dropbox folders, assigns editors, gates QA, syncs Frame.io, ships share links.',
    headlineMetric: (rows, now = Date.now()) => {
      const today = startOfTodayLocal(now);
      const todayRows = rows.filter(
        (r) => new Date(r.created_at).getTime() >= today,
      );
      const statusChanges = todayRows.filter((r) =>
        (r.action || '').startsWith('status_change:'),
      ).length;
      const errors = todayRows.filter((r) => r.status === 'error').length;
      const base = `${statusChanges} status changes today`;
      return errors > 0 ? `${base} · ${errors} errors` : base;
    },
    actionProse: {
      creating_dropbox_folders: 'creating Dropbox folders',
      dropbox_folders_created: 'Dropbox folders created',
      dropbox_scan_complete: 'Dropbox scan complete',
      dropbox_webhook_received: 'Dropbox webhook received',
      editor_assigned: 'editor assigned',
      assign_editor_skipped: 'editor not assigned',
      qa_gate_passed: 'QA gate passed',
      qa_gate_blocked: 'QA gate blocked — waiting',
      frameio_link_synced: 'Frame.io link synced',
      frameio_link_unchanged: 'Frame.io link unchanged',
      frameio_link_sync_skipped: 'Frame.io link sync skipped',
      frameio_link_sync_error: 'Frame.io link sync errored',
      frameio_link_opaque: 'Frame.io link opaque',
      share_link_created: 'share link created',
      share_link_reused: 'share link reused',
      clickup_frame_link_updated: 'ClickUp Frame field updated',
      review_comment_routed: 'review comment routed',
      resolve_task_rejected: 'task could not be resolved',
      done_received_noop: 'done — no action',
    },
    // Variable-key actions: status_change:<status>,
    // status_change_error:<status>, clickup_webhook_received:<event>.
    // Returns a humanized string or null if no pattern matches.
    parseAction: (action) => {
      if (action.startsWith('status_change_error: ')) {
        return `status change errored: ${action.slice('status_change_error: '.length)}`;
      }
      if (action.startsWith('status_change: ')) {
        return `routed status: ${action.slice('status_change: '.length)}`;
      }
      if (action.startsWith('clickup_webhook_received: ')) {
        return `ClickUp webhook: ${action.slice('clickup_webhook_received: '.length)}`;
      }
      return null;
    },
  },

  'footage-scan': {
    name: 'footage-scan',
    sourceAgent: 'pipeline',
    // Inverse of the pipeline filter. dropbox_scan_complete is the
    // every-15-min footage-scan tick marker — counted as "checks"
    // here, not as pipeline traffic.
    actionFilter: (a) =>
      a.startsWith('footage_') ||
      a === 'dropbox_list_folder_error' ||
      a === 'dropbox_scan_complete',
    cadenceLabel: 'every 15 min',
    cadenceType: 'cron',
    cronExpression: '*/15 * * * *',
    sparklineWindowMs: 24 * HOUR,
    sparklineBars: 48,
    // Cron fires every 15 min, but the agent only writes a log row
    // when it has actual work (scan_complete, footage_detected, etc.) —
    // ~5 rows/day per the May 4 census. Thresholds reflect observed
    // logging cadence, not cron rhythm.
    greenWithinMs: 12 * HOUR,
    redAfterMs: 24 * HOUR,
    description:
      'Checks Dropbox every 15 min for new raw footage; advances videos when folders appear, with a 1-hour propagation delay.',
    headlineMetric: (rows, now = Date.now()) => {
      const today = startOfTodayLocal(now);
      const todayRows = rows.filter(
        (r) => new Date(r.created_at).getTime() >= today,
      );
      const checks = todayRows.length;
      const detected = todayRows.filter(
        (r) =>
          r.action === 'footage_detected_pending_delay' ||
          r.action === 'footage_detected_status_updated',
      ).length;
      return detected > 0
        ? `${checks} checks · ${detected} footage detected today`
        : `${checks} checks today`;
    },
    actionProse: {
      footage_detected_empty: 'no footage in folder',
      footage_detected_pending_delay: 'footage detected — waiting 1h',
      footage_detected_skipped: 'footage check skipped',
      footage_detected_status_updated: 'footage ready — status advanced',
      footage_detected_stamp_error: 'footage timestamp errored',
      footage_detection_cleared: 'footage detection cleared',
      footage_scan_campus_error: 'campus scan errored',
      dropbox_list_folder_error: 'Dropbox listing errored',
    },
  },

  qa: {
    name: 'qa',
    sourceAgent: 'qa',
    cadenceLabel: 'on EDITED status',
    cadenceType: 'event',
    cronExpression: null,
    sparklineWindowMs: 7 * DAY,
    sparklineBars: 7,
    greenWithinMs: 7 * DAY,
    redAfterMs: null,
    description:
      'Runs 4-check QA (LUFS audio loudness, transcript cleanliness, hook presence, framing) when a video moves to EDITED. Stages corrections to ClickUp on failure.',
    headlineMetric: (rows, now = Date.now()) => {
      const everStarted = rows.some((r) => r.action === 'qa_started');
      if (!everStarted) return '0 reviewed · waiting for EDITED';
      const today = startOfTodayLocal(now);
      const todayRows = rows.filter(
        (r) => new Date(r.created_at).getTime() >= today,
      );
      const reviewed = todayRows.filter((r) => r.action === 'qa_started').length;
      const passed = todayRows.filter((r) => r.action === 'qa_passed').length;
      const failed = todayRows.filter((r) => r.action === 'qa_failed').length;
      return `${reviewed} reviewed today · ${passed} passed · ${failed} corrections staged`;
    },
    actionProse: {
      qa_started: 'QA started',
      qa_passed: 'QA passed',
      qa_failed: 'QA failed — corrections staged',
      runQA: 'QA dispatch started',
      lufs_failed_no_ffmpeg: 'LUFS check failed (FFmpeg missing)',
      self_heal_attempted: 'self-heal recovery attempted',
      self_heal_window_hit: 'self-heal retry window hit',
      self_heal_alert_sent: 'self-heal alert sent',
    },
  },

  research: {
    name: 'research',
    sourceAgent: 'research',
    cadenceLabel: 'daily · 6 am',
    cadenceType: 'cron',
    cronExpression: '0 6 * * *',
    sparklineWindowMs: 24 * HOUR,
    sparklineBars: 24,
    greenWithinMs: 36 * HOUR,
    redAfterMs: 48 * HOUR,
    description:
      'Daily TikTok and Instagram scrape, classified by Claude into the hook taxonomy Scripting reads.',
    headlineMetric: (rows, now = Date.now()) => {
      const today = startOfTodayLocal(now);
      const todayRows = rows.filter(
        (r) => new Date(r.created_at).getTime() >= today,
      );
      // Primary: research_run_complete payload.hooks_classified
      const completes = todayRows.filter(
        (r) => r.action === 'research_run_complete',
      );
      let count = 0;
      for (const r of completes) {
        const hc = r.payload?.hooks_classified;
        if (typeof hc === 'number') count += hc;
      }
      // Fallback: count tiktok_scrape_complete + instagram_scrape_complete
      // rows for today (per spec — literal row count, not summed payload).
      if (count === 0) {
        count = todayRows.filter(
          (r) =>
            r.action === 'tiktok_scrape_complete' ||
            r.action === 'instagram_scrape_complete',
        ).length;
      }
      return `${count} hooks classified today`;
    },
    actionProse: {
      research_run_started: 'research run started',
      tiktok_scrape_complete: 'TikTok scraped',
      instagram_scrape_complete: 'Instagram scraped',
      tiktok_scrape_error: 'TikTok scrape errored',
      instagram_scrape_error: 'Instagram scrape errored',
      research_run_complete: (payload) => {
        const c = payload?.hooks_classified;
        return typeof c === 'number'
          ? `${c} hooks classified`
          : 'research run complete';
      },
      research_run_empty: 'no hooks scraped',
      research_video_error: 'video classification errored',
      research_insert_error: 'hook insert errored',
      run_all_error: 'campus iteration errored',
    },
  },

  performance: {
    name: 'performance',
    sourceAgent: 'performance',
    cadenceLabel: 'mon · 7 am',
    cadenceType: 'cron',
    cronExpression: '0 7 * * 1',
    sparklineWindowMs: 14 * DAY,
    sparklineBars: 14,
    greenWithinMs: 10 * DAY,
    redAfterMs: 14 * DAY,
    description:
      'Weekly Claude analysis of top and bottom performing posts. Generates the signals the SIGNALS panel renders.',
    headlineMetric: (rows) => {
      // rows are DESC by created_at — first matching is the most recent.
      const recentTerminal = rows.find(
        (r) =>
          r.action === 'performance_run_complete' ||
          r.action === 'performance_run_skipped',
      );
      if (!recentTerminal) return 'no runs yet';
      if (recentTerminal.action === 'performance_run_skipped') {
        const reason = recentTerminal.payload?.reason || 'no data yet';
        return `skipped — ${reason}`;
      }
      return 'signals generated · last Mon';
    },
    actionProse: {
      performance_run_started: 'performance run started',
      performance_run_complete: 'signals generated',
      performance_run_skipped: (payload) =>
        payload?.reason
          ? `skipped — ${payload.reason}`
          : 'skipped (no data yet)',
      run_all_error: 'campus iteration errored',
    },
  },

  scripting: {
    name: 'scripting',
    sourceAgent: 'scripting',
    cadenceLabel: 'every 15 min',
    cadenceType: 'cron',
    cronExpression: '*/15 * * * *',
    sparklineWindowMs: 24 * HOUR,
    sparklineBars: 48,
    // Cron fires every 15 min, but the agent skips fast on the
    // no-event path — only ~7 rows/day per the May 4 census.
    // Thresholds reflect observed logging cadence, not cron rhythm.
    greenWithinMs: 1 * HOUR,
    redAfterMs: 6 * HOUR,
    description:
      'Watches Google Calendar every 15 min and stages 3 concept scripts when a filming event is upcoming. Brand-voice validation gates each concept before ClickUp.',
    headlineMetric: (rows, now = Date.now()) => {
      // Voice-abort branch dominates per the May 4 census; show the
      // 30-day abort streak when active.
      const cutoff30 = now - 30 * DAY;
      const within30d = rows.filter(
        (r) => new Date(r.created_at).getTime() >= cutoff30,
      );
      const scans30d = within30d.filter(
        (r) => r.action === 'campus_run_started',
      ).length;
      const voiceAborts30d = within30d.filter(
        (r) => r.action === 'brand_voice_validate_abort',
      ).length;
      if (voiceAborts30d > 0) {
        return `${scans30d} scans · ${voiceAborts30d} voice aborts in 30d`;
      }
      // Once the agent is staging concepts, switch to the post-stub view.
      const hasStaged = within30d.some(
        (r) =>
          r.action === 'campus_run_complete' && (r.payload?.concepts || 0) > 0,
      );
      if (hasStaged) {
        const cutoff7 = now - 7 * DAY;
        const within7d = rows.filter(
          (r) => new Date(r.created_at).getTime() >= cutoff7,
        );
        let conceptsStaged = 0;
        for (const r of within7d) {
          if (r.action === 'campus_run_complete') {
            conceptsStaged += r.payload?.concepts || 0;
          }
        }
        const eventsServed = within7d.filter(
          (r) => r.action === 'event_received',
        ).length;
        return `${conceptsStaged} concepts staged this week · ${eventsServed} events served`;
      }
      // Stub default.
      return `stub mode · ${scans30d} scans, 0 events triggered`;
    },
    actionProse: {
      campus_run_started: 'campus scan started',
      campus_run_complete: (payload) => {
        const c = payload?.concepts;
        return typeof c === 'number' && c > 0
          ? `${c} concepts staged`
          : 'campus scan complete';
      },
      campus_skipped_no_calendar: 'no calendar configured',
      event_received: 'calendar event received',
      event_claimed: 'calendar event claimed',
      student_matched: 'student matched',
      context_loaded: 'student context loaded',
      validation_passed: 'validation passed',
      voice_validation_failed_retrying: 'voice validation failed — retrying',
      voice_abort_claim_released: 'voice abort: claim released',
      brand_voice_validate_abort: 'voice validation aborted',
      brand_voice_escalated_to_failed_cleanup: 'voice escalated to cleanup',
      brand_voice_log_only_comment_posted: 'voice issue noted (log-only)',
      brand_voice_log_only_comment_failed: 'voice comment write failed',
      claim_released: 'event claim released',
      claim_release_failed: 'event claim release failed',
      claim_completion_update_failed: 'claim completion update failed',
    },
  },

  onboarding: {
    name: 'onboarding',
    sourceAgent: 'onboarding',
    cadenceLabel: 'on /onboard visit',
    cadenceType: 'event',
    cronExpression: null,
    sparklineWindowMs: 7 * DAY,
    sparklineBars: 7,
    greenWithinMs: 7 * DAY,
    redAfterMs: null,
    description:
      'Conversational student intake at /onboard. Generates the Claude project context document Scripting uses to personalize scripts.',
    headlineMetric: (rows, now = Date.now()) => {
      const completions = rows.filter(
        (r) => r.action === 'onboarding_complete',
      );
      if (completions.length === 0) {
        return '0 students onboarded · ready for next student';
      }
      const word = completions.length === 1 ? 'student' : 'students';
      // rows DESC: completions[0] is the most recent.
      return `${completions.length} ${word} onboarded · ${relTimeAgo(completions[0].created_at, now)}`;
    },
    actionProse: {
      completion_started: 'onboarding completion started',
      industry_report_generated: 'industry report generated',
      industry_report_error: 'industry report errored',
      context_document_synthesized: 'context document synthesized',
      context_document_synth_error: 'context document synthesis errored',
      students_table_written: 'students table updated',
      onboarding_complete: 'context ready for student',
      influencer_scrape_failed: 'influencer scrape failed',
      influencer_scrape_batch_error: 'influencer batch errored',
      answer_persist_error: 'answer save errored',
      final_session_update_warning: 'final session update warning',
    },
  },

  fireflies: {
    name: 'fireflies',
    sourceAgent: 'fireflies',
    cadenceLabel: 'nightly · 9 pm',
    cadenceType: 'cron',
    cronExpression: '0 21 * * *',
    sparklineWindowMs: 24 * HOUR,
    sparklineBars: 24,
    greenWithinMs: 30 * HOUR,
    redAfterMs: 48 * HOUR,
    description:
      'Pulls meeting transcripts nightly and creates ClickUp tasks for action items extracted via Claude.',
    headlineMetric: (rows) => {
      // Most recent fireflies_run_complete payload carries both counts.
      const recent = rows.find((r) => r.action === 'fireflies_run_complete');
      if (!recent) return 'awaiting first run';
      const meetings = recent.payload?.inserted_transcripts ?? 0;
      const actionItems = recent.payload?.action_items_created ?? 0;
      const meetingsWord = meetings === 1 ? 'meeting' : 'meetings';
      return `${meetings} ${meetingsWord} · ${actionItems} action items created`;
    },
    actionProse: {
      fireflies_run_started: 'Fireflies sync started',
      fireflies_run_complete: (payload) => {
        const c = payload?.inserted_transcripts;
        return typeof c === 'number'
          ? `${c} meetings ingested`
          : 'Fireflies sync complete';
      },
      student_match_ambiguous: 'student match ambiguous',
      campus_match_failed: 'campus match failed',
      extraction_failed: 'action item extraction failed',
      clickup_create_failed: 'ClickUp task create failed',
      clickup_retry_failed: 'ClickUp retry exhausted',
      action_item_insert_failed: 'action item insert failed',
      action_item_sync_error: 'action item sync errored',
      run: 'run wrap',
      self_heal_alert_skipped: 'self-heal alert skipped',
    },
  },

  'profile-views': {
    name: 'profile-views',
    sourceAgent: 'profile-views',
    cadenceLabel: 'thu · 9 am',
    cadenceType: 'cron',
    cronExpression: '0 9 * * 4',
    sparklineWindowMs: 14 * DAY,
    sparklineBars: 14,
    greenWithinMs: 10 * DAY,
    redAfterMs: 14 * DAY,
    description:
      'Weekly Apify scrape of student + brand profiles. Writes anchor or delta rows to performance per (video, platform, week).',
    headlineMetric: (rows) => {
      if (rows.length === 0) return 'awaiting first run';

      const completeRow = rows.find(
        (r) => r.action === 'profile_views_run_complete',
      );

      if (completeRow) {
        const day = DAY_SHORT[new Date(completeRow.created_at).getDay()];
        const p = completeRow.payload || {};
        const hasFields =
          typeof p.anchorsPlanted === 'number' ||
          typeof p.deltasWritten === 'number' ||
          typeof p.matched === 'number';
        if (hasFields) {
          const total = (p.anchorsPlanted || 0) + (p.deltasWritten || 0);
          return `${total} rows written · last ${day}`;
        }
        // run_complete row exists but the payload is missing the
        // expected counters (older row format, or run completed
        // without writing any rows).
        return `profile-views run complete · last ${day}`;
      }

      // Rows exist but none of them are run_complete — typically
      // run_started, scrape errors, or duplicate-detection events.
      const word = rows.length === 1 ? 'event' : 'events';
      return `${rows.length} ${word} logged · awaiting first complete run`;
    },
    actionProse: {
      profile_views_run_started: 'profile-views run started',
      profile_views_run_complete: (payload) => {
        const matched = payload?.matched ?? 0;
        const anchors = payload?.anchorsPlanted ?? 0;
        const deltas = payload?.deltasWritten ?? 0;
        if (
          typeof payload?.matched === 'number' ||
          typeof payload?.anchorsPlanted === 'number' ||
          typeof payload?.deltasWritten === 'number'
        ) {
          return `${matched} matched, ${anchors} anchors / ${deltas} deltas`;
        }
        return 'profile-views run complete';
      },
      profile_views_unmatched: (payload) =>
        typeof payload?.count === 'number'
          ? `${payload.count} unmatched URLs`
          : 'unmatched URLs',
      profile_views_handleless_with_videos: 'student has videos but no handle',
      profile_views_handle_invalid: 'invalid handle skipped',
      profile_views_invalid_items: (payload) =>
        typeof payload?.count === 'number'
          ? `${payload.count} bad scraped items`
          : 'bad scraped items',
      profile_views_negative_delta_floored: 'negative delta floored — review',
      profile_views_scrape_error: 'scrape errored',
      duplicate_post_urls_detected: 'duplicate post_urls detected',
    },
  },
};

// =============================================================
// Back-compat shim: AGENTS / AGENT_BY_NAME derived from registry.
// LiveEventStream.jsx and the existing AgentGrid.jsx render off
// these. The legacy `label` and `color` fields are no longer
// authoritative — `label` falls back to the lowercase name (which
// LiveEventStream uppercases for the dropdown), `color` is null.
// =============================================================

export const AGENTS = Object.values(AGENT_REGISTRY).map((a) => ({
  name: a.name,
  label: a.name,
  description: a.description,
  trigger: a.cadenceType,
  triggerLabel: a.cadenceLabel,
  cron: a.cronExpression,
  color: null,
}));

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
    case '0 9 * * 4': {
      const target = new Date(now);
      target.setHours(9, 0, 0, 0);
      const dow = target.getDay(); // 0=Sun..6=Sat; Thursday=4
      const daysSinceThu = (dow - 4 + 7) % 7;
      target.setDate(target.getDate() - daysSinceThu);
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
    case '0 9 * * 4': {
      const target = new Date(now);
      target.setHours(9, 0, 0, 0);
      const dow = target.getDay();
      const daysUntilThu = (4 - dow + 7) % 7;
      target.setDate(target.getDate() + daysUntilThu);
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
